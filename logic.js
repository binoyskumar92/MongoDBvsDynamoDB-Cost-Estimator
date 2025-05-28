// Atlas tier specifications with conservative operations estimates
const atlasTiers = [
    { tier: "M10", ram: 4, vcpu: 2, storage: 10, price: 58, ops: 700 },
    { tier: "M20", ram: 8, vcpu: 4, storage: 20, price: 160, ops: 1400 },
    { tier: "M30", ram: 16, vcpu: 8, storage: 40, price: 394, ops: 2800 },
    { tier: "M40", ram: 32, vcpu: 12, storage: 80, price: 759, ops: 4200 },
    { tier: "M50", ram: 64, vcpu: 16, storage: 160, price: 1460, ops: 5600 },
    { tier: "M60", ram: 128, vcpu: 20, storage: 320, price: 2880, ops: 7000 },
    { tier: "M80", ram: 192, vcpu: 24, storage: 500, price: 3840, ops: 8400 },
    { tier: "M140", ram: 192, vcpu: 48, storage: 1000, price: 6720, ops: 16800 },
    { tier: "M200", ram: 384, vcpu: 48, storage: 750, price: 9600, ops: 16800 },
    { tier: "M300", ram: 768, vcpu: 96, storage: 1500, price: 19200, ops: 33600 },
    { tier: "M400", ram: 488, vcpu: 64, storage: 3000, price: 22400, ops: 22400 },
    { tier: "M700", ram: 768, vcpu: 96, storage: 4000, price: 33260, ops: 33600 }
];

// DynamoDB pricing rates (corrected structure and rates)
const DYNAMO_PRICING_RATES = {
    'on-demand': {
        read_rate_per_million: 0.125,    // $0.125 per million reads
        write_rate_per_million: 0.625,   // $0.625 per million writes
        description: "On-demand pricing - pay per actual request"
    },
    'provisioned': {
        rcu_hourly_rate: 0.00013,        // $0.00013 per RCU per hour
        wcu_hourly_rate: 0.00065,        // $0.00065 per WCU per hour
        description: "Provisioned capacity - pay for reserved throughput"
    },
    'reserved': {
        rcu_hourly_rate: 0.00005925,     // Lower rates with 1-year commitment
        wcu_hourly_rate: 0.00029923,
        description: "Reserved capacity (1-year commitment)"
    }
};

const DYNAMO_STORAGE_PRICE = 0.25; // Per GB
const DYNAMO_FREE_STORAGE = 25; // First 25GB free
const SECONDS_PER_MONTH = 2592000; // 30 days

// DynamoDB backup and additional costs
const DYNAMO_PITR_PRICE = 0.20; // Per GB per month for PITR
const DYNAMO_ONDEMAND_BACKUP_PRICE = 0.10; // Per GB per month for on-demand backups
const DYNAMO_DATA_TRANSFER_PRICE = 0.09; // Per GB for cross-region transfer

// Support and backup pricing
const ATLAS_SUPPORT_PERCENTAGE_FULL = 0.70;
const ATLAS_SUPPORT_PERCENTAGE_DISCOUNTED = 0.37;
const ATLAS_DISCOUNT_PERCENTAGE = 0.17; // 17% enterprise discount

// Atlas backup pricing
const ATLAS_SNAPSHOT_BACKUP_PRICE = 0.14; // Per GB per month base rate for snapshot backup
const ATLAS_SNAPSHOT_GB_DAY_RATE = (ATLAS_SNAPSHOT_BACKUP_PRICE * 12) / 365;

// Atlas snapshot retention based on actual backup policy
const ATLAS_SNAPSHOT_RETENTION = {
    hourly: {
        retention_days: 2,
        frequency_per_month: 30 * 4 // 4 times per day for 30 days
    },
    daily: {
        retention_days: 7,
        frequency_per_month: 30 // Once per day for 30 days
    },
    weekly: {
        retention_days: 28, // 4 weeks
        frequency_per_month: 4.3 // ~4.3 weeks per month
    },
    monthly: {
        retention_days: 365, // 12 months
        frequency_per_month: 1 // Once per month
    },
    yearly: {
        retention_days: 365, // 1 year
        frequency_per_month: 1 / 12 // Once per year = 1/12 per month
    }
};

// Atlas continuous backup tiered pricing for AWS (per GB per month)
const ATLAS_CONTINUOUS_BACKUP_TIERS = [
    { min: 0, max: 5, rate: 0.00 },
    { min: 5, max: 100, rate: 1.00 },
    { min: 100, max: 250, rate: 0.75 },
    { min: 250, max: 500, rate: 0.50 },
    { min: 500, max: Infinity, rate: 0.25 }
];

// AWS Business Support pricing tiers
const AWS_BUSINESS_SUPPORT_TIERS = [
    { min: 0, max: 10000, rate: 0.10, minimum: 100 },
    { min: 10000, max: 80000, rate: 0.07, minimum: 0 },
    { min: 80000, max: 250000, rate: 0.05, minimum: 0 },
    { min: 250000, max: Infinity, rate: 0.03, minimum: 0 }
];

// DOM elements - will be initialized when DOM loads
let readRatioSlider, itemSizeSlider, dataUsageSlider, utilizationSlider;
let crossRegionSlider, transactionSlider, crossRegionValue, transactionValue;
let readRatioValue, writeRatioValue, itemSizeValue, dataUsageValue, utilizationValue;
let tableBody, m30Details;
let atlasSupportToggle, atlasDiscountToggle, atlasContinuousBackupToggle, atlasSnapshotBackupToggle;
let dynamoSupportToggle, dynamoBackupToggle, dynamoSnapshotBackupToggle, dynamoCrossRegionToggle;
let dynamoPricingModeSelect, targetUtilizationSlider, targetUtilizationValue;

// Chart initialization
let costChart = null;

// Calculate DynamoDB backup costs using realistic storage multipliers
function calculateDynamoBackupCosts(actualDataSize) {
    let costs = {
        onDemandBackupCost: 0,
        pitrCost: 0,
        crossRegionCost: 0,
        totalBackupCost: 0,
        totalBackupStorage: 0
    };

    if (!dynamoSnapshotBackupToggle.checked && !dynamoBackupToggle.checked) {
        return costs;
    }

    // Calculate on-demand backup storage using realistic enterprise multiplier
    if (dynamoSnapshotBackupToggle.checked) {
        // Typical enterprise backup retention results in 15-20x table size in total backup storage
        // This accounts for: daily (30 days) + weekly (12 weeks) + monthly (12 months) + yearly (7 years)
        const backupStorageMultiplier = 18; // Conservative enterprise estimate
        const totalBackupStorage = actualDataSize * backupStorageMultiplier;

        costs.onDemandBackupCost = totalBackupStorage * DYNAMO_ONDEMAND_BACKUP_PRICE;
        costs.totalBackupStorage = Math.round(totalBackupStorage * 10) / 10; // Round for display
    }

    // PITR cost (continuous backup)
    if (dynamoBackupToggle.checked) {
        costs.pitrCost = actualDataSize * DYNAMO_PITR_PRICE;
    }

    // Cross-region replication costs (for disaster recovery)
    if (dynamoCrossRegionToggle && dynamoCrossRegionToggle.checked) {
        // Additional storage in secondary region
        costs.crossRegionCost += actualDataSize * DYNAMO_STORAGE_PRICE;
        // Data transfer costs for initial replication
        costs.crossRegionCost += actualDataSize * DYNAMO_DATA_TRANSFER_PRICE;
        // Monthly change volume (~10% of data size)
        costs.crossRegionCost += (actualDataSize * 0.1) * DYNAMO_DATA_TRANSFER_PRICE;
    }

    costs.totalBackupCost = costs.onDemandBackupCost + costs.pitrCost + costs.crossRegionCost;
    return costs;
}

// Calculate MongoDB Atlas snapshot backup cost with actual retention policy
function calculateAtlasSnapshotBackupCost(actualDataSize) {
    if (!atlasSnapshotBackupToggle.checked) {
        return 0;
    }

    let totalMonthlyGBDays = 0;

    for (const period in ATLAS_SNAPSHOT_RETENTION) {
        const { retention_days, frequency_per_month } = ATLAS_SNAPSHOT_RETENTION[period];

        // For each snapshot type, calculate GB-days per month
        // Each snapshot of actualDataSize is retained for retention_days
        // And we take frequency_per_month snapshots per month
        const gbDaysForThisPeriod = actualDataSize * retention_days * frequency_per_month;
        totalMonthlyGBDays += gbDaysForThisPeriod;
    }

    // Cost = total GB-days per month * GB-day rate
    return totalMonthlyGBDays * ATLAS_SNAPSHOT_GB_DAY_RATE;
}

// Calculate MongoDB Atlas continuous backup cost using tiered pricing
function calculateAtlasContinuousBackupCost(actualDataSize) {
    if (!atlasContinuousBackupToggle.checked) {
        return 0;
    }

    const oplogSizeEstimate = actualDataSize * 0.20;
    const combinedSize = actualDataSize + oplogSizeEstimate;

    let totalCost = 0;
    let remainingSize = combinedSize;

    for (const tier of ATLAS_CONTINUOUS_BACKUP_TIERS) {
        if (remainingSize <= 0) break;

        if (combinedSize > tier.min) {
            const tierSize = Math.min(remainingSize, tier.max - tier.min);
            totalCost += tierSize * tier.rate;
            remainingSize -= tierSize;
        }
    }

    return totalCost;
}

// Calculate AWS Business Support cost with minimums
function calculateAWSBusinessSupportCost(monthlyAWSBill) {
    if (!dynamoSupportToggle.checked) {
        return 0;
    }

    let supportCost = 0;
    let remainingBill = monthlyAWSBill;

    for (const tier of AWS_BUSINESS_SUPPORT_TIERS) {
        if (remainingBill <= 0) break;

        if (monthlyAWSBill > tier.min) {
            const billableAmount = Math.min(remainingBill, tier.max - tier.min);
            supportCost += billableAmount * tier.rate;
            remainingBill -= billableAmount;
        }
    }

    // Apply minimum if applicable (first tier only)
    if (monthlyAWSBill > 0 && supportCost < AWS_BUSINESS_SUPPORT_TIERS[0].minimum) {
        supportCost = AWS_BUSINESS_SUPPORT_TIERS[0].minimum;
    }

    return supportCost;
}

// Function to calculate the overall Atlas total cost 
function calculateAtlasTotalCost(basePrice, includedStorageGB, dataUsagePercentage) {
    const actualDataSize = calculateActualDataSize(includedStorageGB, dataUsagePercentage);

    const continuousBackupCost = calculateAtlasContinuousBackupCost(actualDataSize);
    const snapshotBackupCost = calculateAtlasSnapshotBackupCost(actualDataSize);

    const baseAndBackupSubtotal = basePrice + continuousBackupCost + snapshotBackupCost;

    let supportCost = 0;
    if (atlasSupportToggle.checked) {
        const supportRate = atlasDiscountToggle.checked
            ? ATLAS_SUPPORT_PERCENTAGE_DISCOUNTED
            : ATLAS_SUPPORT_PERCENTAGE_FULL;
        supportCost = baseAndBackupSubtotal * supportRate;
    }

    let totalCost = baseAndBackupSubtotal + supportCost;

    if (atlasDiscountToggle.checked) {
        totalCost -= totalCost * ATLAS_DISCOUNT_PERCENTAGE;
    }

    return totalCost;
}

// Calculate actual data size based on usage percentage
function calculateActualDataSize(includedStorageGB, usagePercentage) {
    return includedStorageGB * (usagePercentage / 100);
}

// Calculate DynamoDB costs for each Atlas tier
function calculateDynamoCosts(readRatio, itemSizeKB, dataUsagePercentage, utilizationPercentage) {
    const crossRegionReplicas = parseInt(crossRegionSlider.value);
    const transactionPercentage = parseInt(transactionSlider.value);
    const pricingMode = dynamoPricingModeSelect.value;
    const pricing = DYNAMO_PRICING_RATES[pricingMode];
    const targetUtilization = parseInt(targetUtilizationSlider.value) / 100;
    
    return atlasTiers.map(tier => {
        const actualDataSize = calculateActualDataSize(tier.storage, dataUsagePercentage);
        const effectiveOps = tier.ops * (utilizationPercentage / 100);

        const readsPerSec = effectiveOps * (readRatio / 100);
        const writesPerSec = effectiveOps * (1 - readRatio / 100);

        const rruPerRead = Math.ceil(itemSizeKB / 4);
        const wruPerWrite = Math.ceil(itemSizeKB / 1);

        const rrusPerSec = readsPerSec * rruPerRead;
        const wrusPerSec = writesPerSec * wruPerWrite;

        const transactionMultiplier = 1 + (transactionPercentage / 100);
        const adjustedRRUs = rrusPerSec * transactionMultiplier;
        const adjustedWRUs = wrusPerSec * transactionMultiplier;

        // Apply cross-region write amplification
        const crossRegionWriteMultiplier = 1 + crossRegionReplicas;
        const finalRRUs = adjustedRRUs;  // Reads don't amplify
        const finalWRUs = adjustedWRUs * crossRegionWriteMultiplier;

        let readCost, writeCost, provisionedRRUs, provisionedWRUs, bufferMultiplier;

        if (pricingMode === 'on-demand') {
            // ON-DEMAND: Pay for actual operations used
            const actualMonthlyReads = finalRRUs * SECONDS_PER_MONTH;
            const actualMonthlyWrites = finalWRUs * SECONDS_PER_MONTH;
            
            readCost = (actualMonthlyReads / 1000000) * pricing.read_rate_per_million;
            writeCost = (actualMonthlyWrites / 1000000) * pricing.write_rate_per_million;
            
            // For display purposes (no actual provisioning in on-demand)
            provisionedRRUs = finalRRUs;
            provisionedWRUs = finalWRUs;
            bufferMultiplier = 1.0; // No buffer needed for on-demand
        } else {
            // PROVISIONED/RESERVED: Pay for capacity reserved
            bufferMultiplier = 1;
            
            // Only apply buffer for provisioned/reserved modes
            if (targetUtilization && targetUtilization > 0 && targetUtilization <= 1) {
                bufferMultiplier = 1 / targetUtilization;
            } else {
                console.warn('Invalid targetUtilization, using default 70%:', targetUtilization);
                bufferMultiplier = 1 / 0.70; // Default to 70% if invalid
            }
            
            provisionedRRUs = finalRRUs * bufferMultiplier;
            provisionedWRUs = finalWRUs * bufferMultiplier;
            
            const hoursPerMonth = 30 * 24; // 720 hours
            
            // Check if pricing rates exist for the current mode
            if (!pricing.rcu_hourly_rate || !pricing.wcu_hourly_rate) {
                console.error('Missing hourly pricing rates for mode:', pricingMode, pricing);
                readCost = 0;
                writeCost = 0;
            } else {
                readCost = provisionedRRUs * pricing.rcu_hourly_rate * hoursPerMonth;
                writeCost = provisionedWRUs * pricing.wcu_hourly_rate * hoursPerMonth;
            }
        }

        // Validate costs before proceeding
        if (isNaN(readCost) || isNaN(writeCost)) {
            console.error('NaN detected in costs:', {
                readCost,
                writeCost,
                pricingMode,
                finalRRUs,
                finalWRUs,
                targetUtilization,
                pricing
            });
            readCost = readCost || 0;
            writeCost = writeCost || 0;
        }

        const billableStorage = Math.max(0, actualDataSize - DYNAMO_FREE_STORAGE);
        const storageCost = billableStorage * DYNAMO_STORAGE_PRICE;

        let dynamoBaseCost = readCost + writeCost + storageCost;

        // Calculate backup costs
        const backupCosts = calculateDynamoBackupCosts(actualDataSize);

        // Add backup costs to base cost for support calculation
        const costForSupportCalculation = dynamoBaseCost + backupCosts.totalBackupCost;
        const supportCost = calculateAWSBusinessSupportCost(costForSupportCalculation);

        const dynamoTotalCost = costForSupportCalculation + supportCost;

        const atlasTotalCost = calculateAtlasTotalCost(tier.price, tier.storage, dataUsagePercentage);

        return {
            tier: tier.tier,
            atlasBasePrice: tier.price,
            atlasTotalPrice: Math.round(atlasTotalCost),
            dynamoBasePrice: Math.round(dynamoBaseCost),
            dynamoTotalPrice: Math.round(dynamoTotalCost),
            costRatio: atlasTotalCost > 0 ? Math.round(dynamoTotalCost / atlasTotalCost * 10) / 10 : 0,
            includedStorage: tier.storage,
            actualDataSize: Math.round(actualDataSize * 10) / 10,
            effectiveOps: Math.round(effectiveOps),
            pricingMode: pricingMode,
            targetUtilization: targetUtilization,
            details: {
                readCost: Math.round(readCost),
                writeCost: Math.round(writeCost),
                storageCost: Math.round(storageCost),
                dynamoSupportCost: Math.round(supportCost),
                provisionedRRUs: Math.round(provisionedRRUs),
                provisionedWRUs: Math.round(provisionedWRUs),
                actualRRUs: Math.round(finalRRUs),
                actualWRUs: Math.round(finalWRUs),
                bufferMultiplier: bufferMultiplier,
                pricingDescription: pricing.description,
                // Calculate actual monthly operations for display
                monthlyReads: Math.round(finalRRUs * SECONDS_PER_MONTH / 1000000), // in millions
                monthlyWrites: Math.round(finalWRUs * SECONDS_PER_MONTH / 1000000), // in millions
                ...Object.fromEntries(
                    Object.entries(backupCosts).map(([key, value]) =>
                        [key, typeof value === 'number' ? Math.round(value) : value]
                    )
                ),
                atlasSupportCost: atlasSupportToggle.checked
                    ? Math.round((tier.price +
                        calculateAtlasContinuousBackupCost(actualDataSize) +
                        calculateAtlasSnapshotBackupCost(actualDataSize)) *
                        (atlasDiscountToggle.checked ? ATLAS_SUPPORT_PERCENTAGE_DISCOUNTED : ATLAS_SUPPORT_PERCENTAGE_FULL))
                    : 0,
                atlasDiscountAmount: atlasDiscountToggle.checked ? Math.round(calculateAtlasTotalCost(tier.price, tier.storage, dataUsagePercentage) * ATLAS_DISCOUNT_PERCENTAGE / (1 - ATLAS_DISCOUNT_PERCENTAGE)) : 0,
                atlasContinuousBackupCost: Math.round(calculateAtlasContinuousBackupCost(actualDataSize)),
                atlasSnapshotBackupCost: Math.round(calculateAtlasSnapshotBackupCost(actualDataSize))
            }
        };
    });
}

// Update the chart with new data
function updateChart(comparisonData) {
    const ctx = document.getElementById('costChart').getContext('2d');

    const visibleTiers = 8;
    const labels = comparisonData.slice(0, visibleTiers).map(item => item.tier);
    const atlasData = comparisonData.slice(0, visibleTiers).map(item => item.atlasTotalPrice);
    const dynamoData = comparisonData.slice(0, visibleTiers).map(item => item.dynamoTotalPrice);

    const pricingMode = comparisonData[0]?.pricingMode || 'provisioned';
    const pricingDescription = DYNAMO_PRICING_RATES[pricingMode]?.description || '';

    if (costChart) {
        costChart.destroy();
    }

    costChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'MongoDB Atlas' + (atlasDiscountToggle.checked ? ' (with 17% discount)' : ''),
                    data: atlasData,
                    backgroundColor: 'rgba(52, 168, 83, 0.7)',
                    borderColor: 'rgba(52, 168, 83, 1)',
                    borderWidth: 1
                },
                {
                    label: 'DynamoDB (' + pricingMode.replace('-', ' ') + ')',
                    data: dynamoData,
                    backgroundColor: 'rgba(66, 133, 244, 0.7)',
                    borderColor: 'rgba(66, 133, 244, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Monthly Cost ($)'
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.dataset.label + ': $' + context.raw;
                        }
                    }
                }
            }
        }
    });
}

// Update the table with new data
function updateTable(comparisonData) {
    tableBody.innerHTML = '';

    comparisonData.forEach((item, index) => {
        const row = document.createElement('tr');
        const yearlyAtlasCost = item.atlasTotalPrice * 12;
        const yearlyDynamoCost = item.dynamoTotalPrice * 12;

        row.innerHTML = `
            <td>${item.tier}</td>
            <td class="text-right">${atlasTiers[index].ops} / ${item.effectiveOps}</td>
            <td class="text-right">${item.includedStorage} GB</td>
            <td class="text-right">${item.actualDataSize} GB</td>
            <td class="text-right">${item.atlasTotalPrice.toLocaleString()}${atlasDiscountToggle.checked ? ' <span class="discount-badge">-17%</span>' : ''}</td>
            <td class="text-right">${item.dynamoTotalPrice.toLocaleString()}</td>
            <td class="text-right">${yearlyAtlasCost.toLocaleString()}${atlasDiscountToggle.checked ? ' <span class="discount-badge">-17%</span>' : ''}</td>
            <td class="text-right">${yearlyDynamoCost.toLocaleString()}</td>
            <td class="text-right">${item.costRatio}x</td>
        `;

        tableBody.appendChild(row);
    });

    // Update M30 details
    const m30 = comparisonData[2];
    const backupDetails = m30.details;
    const crossRegionReplicas = parseInt(crossRegionSlider.value);
    const transactionPercentage = parseInt(transactionSlider.value);
    const pricingMode = m30.pricingMode;
    const pricing = DYNAMO_PRICING_RATES[pricingMode];

    m30Details.innerHTML = `
<h3>Detailed Cost Breakdown for M30 Tier (${m30.actualDataSize}GB actual data, ${utilizationSlider.value}% utilization)</h3>

<div style="display: flex; flex-wrap: wrap; gap: 20px;">
    <div style="flex: 1; min-width: 300px;">
        <h4>MongoDB Atlas Costs</h4>
        <p>Base Cluster Cost: $${m30.atlasBasePrice}/month ($${(m30.atlasBasePrice * 12).toLocaleString()}/year)</p>
        <p>Continuous Backup (tiered pricing): $${backupDetails.atlasContinuousBackupCost}/month ($${(backupDetails.atlasContinuousBackupCost * 12).toLocaleString()}/year)</p>
        <p>Snapshot Backup (weekly/monthly/yearly): $${backupDetails.atlasSnapshotBackupCost}/month ($${(backupDetails.atlasSnapshotBackupCost * 12).toLocaleString()}/year)</p>
        <p>Support (${atlasDiscountToggle.checked ? '37' : '70'}%): $${backupDetails.atlasSupportCost}/month ($${(backupDetails.atlasSupportCost * 12).toLocaleString()}/year)</p>
        ${atlasDiscountToggle.checked ? `<p>Enterprise Discount (17%): -$${backupDetails.atlasDiscountAmount}/month (-$${(backupDetails.atlasDiscountAmount * 12).toLocaleString()}/year)</p>` : ''}
        <p><strong>Total Atlas Cost: $${m30.atlasTotalPrice}/month ($${(m30.atlasTotalPrice * 12).toLocaleString()}/year)</strong></p>
    </div>
    
    <div style="flex: 1; min-width: 300px;">
        <h4>DynamoDB Costs (${pricingMode.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())})</h4>
        <p><em>Pricing Mode: ${pricing.description}</em></p>
        <p>Actual Operations: ${m30.effectiveOps}/sec (${utilizationSlider.value}% of ${atlasTiers[2].ops}/sec)</p>
        ${pricingMode !== 'on-demand' ? `<p>Capacity Buffer: ${backupDetails.bufferMultiplier.toFixed(2)}x multiplier (auto-scaling overhead)</p>` : ''}
        <p>Required Capacity: ${backupDetails.actualRRUs} RCUs/sec, ${backupDetails.actualWRUs} WCUs/sec</p>
        ${pricingMode !== 'on-demand' ? `<p>Provisioned Capacity: ${backupDetails.provisionedRRUs} RCUs/sec, ${backupDetails.provisionedWRUs} WCUs/sec</p>` : ''}
        ${transactionPercentage > 0 ? `<p><em>ACID Transactions: +${transactionPercentage}% operational overhead</em></p>` : ''}
        ${crossRegionReplicas > 0 ? `<p><em>Cross-Region: ${crossRegionReplicas} additional region(s) = ${crossRegionReplicas + 1}x write amplification</em></p>` : ''}
        <p>Read Operations: $${backupDetails.readCost}/month ($${(backupDetails.readCost * 12).toLocaleString()}/year)</p>
        <p>Write Operations: $${backupDetails.writeCost}/month ($${(backupDetails.writeCost * 12).toLocaleString()}/year)</p>
        <p>Storage: $${backupDetails.storageCost}/month ($${(backupDetails.storageCost * 12).toLocaleString()}/year)</p>
        <p>Business Support (Tiered): $${backupDetails.dynamoSupportCost}/month ($${(backupDetails.dynamoSupportCost * 12).toLocaleString()}/year)</p>
        <p>Point-in-Time Recovery (PITR): $${backupDetails.pitrCost}/month ($${(backupDetails.pitrCost * 12).toLocaleString()}/year)</p>
        <p>On-Demand Backup (${backupDetails.totalBackupStorage}GB storage): $${backupDetails.onDemandBackupCost}/month ($${(backupDetails.onDemandBackupCost * 12).toLocaleString()}/year)</p>
        <p><strong>Total DynamoDB Cost: $${m30.dynamoTotalPrice}/month ($${(m30.dynamoTotalPrice * 12).toLocaleString()}/year)</strong></p>
    </div>
</div>

<p style="font-weight: 500; margin-top: 10px;">With these parameters, DynamoDB is ${m30.costRatio}x ${m30.costRatio >= 1 ? 'more expensive than' : 'cheaper than'} MongoDB Atlas M30.</p>
`;
}

// Update everything when parameters change
function updateUI() {
    const readRatio = parseInt(readRatioSlider.value);
    const itemSize = parseInt(itemSizeSlider.value);
    const dataUsage = parseInt(dataUsageSlider.value);
    const utilization = parseInt(utilizationSlider.value);
    const crossRegion = parseInt(crossRegionSlider.value);
    const transaction = parseInt(transactionSlider.value);
    const targetUtilization = parseInt(targetUtilizationSlider.value);

    readRatioValue.textContent = readRatio;
    writeRatioValue.textContent = 100 - readRatio;
    itemSizeValue.textContent = itemSize;
    dataUsageValue.textContent = dataUsage;
    utilizationValue.textContent = utilization;
    crossRegionValue.textContent = crossRegion;
    transactionValue.textContent = transaction;
    targetUtilizationValue.textContent = targetUtilization;

    // Show/hide target utilization slider based on pricing mode
    const pricingMode = dynamoPricingModeSelect.value;
    const targetUtilizationContainer = document.getElementById('targetUtilizationContainer');
    if (pricingMode === 'on-demand') {
        targetUtilizationContainer.style.display = 'none';
    } else {
        targetUtilizationContainer.style.display = 'block';
    }

    const comparisonData = calculateDynamoCosts(readRatio, itemSize, dataUsage, utilization);
    updateChart(comparisonData);
    updateTable(comparisonData);
}

// Initialize DOM elements and event listeners
function initializeApp() {
    // Get DOM elements
    readRatioSlider = document.getElementById('readRatio');
    itemSizeSlider = document.getElementById('itemSize');
    dataUsageSlider = document.getElementById('dataUsage');
    utilizationSlider = document.getElementById('utilization');
    readRatioValue = document.getElementById('readRatioValue');
    writeRatioValue = document.getElementById('writeRatioValue');
    itemSizeValue = document.getElementById('itemSizeValue');
    dataUsageValue = document.getElementById('dataUsageValue');
    utilizationValue = document.getElementById('utilizationValue');
    tableBody = document.getElementById('tableBody');
    m30Details = document.getElementById('m30Details');

    atlasSupportToggle = document.getElementById('atlasSupportToggle');
    atlasDiscountToggle = document.getElementById('atlasDiscountToggle');
    atlasContinuousBackupToggle = document.getElementById('atlasContinuousBackupToggle');
    atlasSnapshotBackupToggle = document.getElementById('atlasSnapshotBackupToggle');
    dynamoSupportToggle = document.getElementById('dynamoSupportToggle');
    dynamoBackupToggle = document.getElementById('dynamoBackupToggle');
    dynamoSnapshotBackupToggle = document.getElementById('dynamoSnapshotBackupToggle');
    dynamoCrossRegionToggle = document.getElementById('dynamoCrossRegionToggle');
    crossRegionSlider = document.getElementById('crossRegionSlider');
    transactionSlider = document.getElementById('transactionSlider');
    crossRegionValue = document.getElementById('crossRegionValue');
    transactionValue = document.getElementById('transactionValue');
    dynamoPricingModeSelect = document.getElementById('dynamoPricingMode');
    targetUtilizationSlider = document.getElementById('targetUtilizationSlider');
    targetUtilizationValue = document.getElementById('targetUtilizationValue');

    // Event listeners
    readRatioSlider.addEventListener('input', updateUI);
    itemSizeSlider.addEventListener('input', updateUI);
    dataUsageSlider.addEventListener('input', updateUI);
    utilizationSlider.addEventListener('input', updateUI);
    atlasSupportToggle.addEventListener('change', updateUI);
    atlasDiscountToggle.addEventListener('change', updateUI);
    atlasContinuousBackupToggle.addEventListener('change', updateUI);
    atlasSnapshotBackupToggle.addEventListener('change', updateUI);
    dynamoSupportToggle.addEventListener('change', updateUI);
    dynamoBackupToggle.addEventListener('change', updateUI);
    dynamoSnapshotBackupToggle.addEventListener('change', updateUI);
    crossRegionSlider.addEventListener('input', updateUI);
    transactionSlider.addEventListener('input', updateUI);
    dynamoPricingModeSelect.addEventListener('change', updateUI);
    targetUtilizationSlider.addEventListener('input', updateUI);

    if (dynamoCrossRegionToggle) {
        dynamoCrossRegionToggle.addEventListener('change', updateUI);
    }

    // Initialize the UI
    updateUI();
}

// Initialize the app when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);