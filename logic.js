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

// DynamoDB pricing constants
const DYNAMO_RRU_PRICE = 0.125; // Per million
const DYNAMO_WRU_PRICE = 0.625; // Per million
const DYNAMO_STORAGE_PRICE = 0.25; // Per GB
const DYNAMO_FREE_STORAGE = 25; // First 25GB free
const SECONDS_PER_MONTH = 2592000; // 30 days

// Support and backup pricing
const ATLAS_SUPPORT_PERCENTAGE_FULL = 0.70;
const ATLAS_SUPPORT_PERCENTAGE_DISCOUNTED = 0.37;
const ATLAS_DISCOUNT_PERCENTAGE = 0.17; // 17% enterprise discount

// Updated constants for backup pricing
const ATLAS_SNAPSHOT_BACKUP_PRICE = 0.14; // Per GB per month base rate for snapshot backup
const DYNAMO_PITR_PRICE = 0.20; // Per GB per month for PITR
const DYNAMO_SNAPSHOT_PRICE = 0.10; // Per GB per month for on-demand backups

// Atlas snapshot backup pricing - using GB-days model
// Convert monthly rate to daily rate: (monthly_rate * 12) / 365
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
    { min: 0, max: 5, rate: 0.00 },      // First 5GB free
    { min: 5, max: 100, rate: 1.00 },    // 5-100GB at $1.00/GB
    { min: 100, max: 250, rate: 0.75 },  // 100-250GB at $0.75/GB
    { min: 250, max: 500, rate: 0.50 },  // 250-500GB at $0.50/GB
    { min: 500, max: Infinity, rate: 0.25 } // >500GB at $0.25/GB
];

// AWS Business Support pricing tiers
const AWS_BUSINESS_SUPPORT_TIERS = [
    { min: 0, max: 10000, rate: 0.10 },
    { min: 10000, max: 80000, rate: 0.07 },
    { min: 80000, max: 250000, rate: 0.05 },
    { min: 250000, max: Infinity, rate: 0.03 }
];

// DOM elements - will be initialized when DOM loads
let readRatioSlider, itemSizeSlider, dataUsageSlider, utilizationSlider;
let readRatioValue, writeRatioValue, itemSizeValue, dataUsageValue, utilizationValue;
let tableBody, m30Details;
let atlasSupportToggle, atlasDiscountToggle, atlasContinuousBackupToggle, atlasSnapshotBackupToggle;
let dynamoSupportToggle, dynamoBackupToggle, dynamoSnapshotBackupToggle;

// Chart initialization
let costChart = null;

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

    // For continuous backups, we need to estimate the combined snapshot + oplog size
    // Typically, the oplog is a fraction of the data size (let's estimate 20% for calculation)
    const oplogSizeEstimate = actualDataSize * 0.20;
    const combinedSize = actualDataSize + oplogSizeEstimate;

    // Calculate cost using tiered pricing
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

// Calculate DynamoDB Point-in-Time Recovery (PITR) cost
function calculateDynamoPITRCost(actualDataSize) {
    if (!dynamoBackupToggle.checked) {
        return 0;
    }

    // DynamoDB PITR is charged per GB-month based on table size
    return actualDataSize * DYNAMO_PITR_PRICE;
}

// Calculate DynamoDB on-demand backup cost
function calculateDynamoSnapshotCost(actualDataSize) {
    if (!dynamoSnapshotBackupToggle.checked) {
        return 0;
    }

    // DynamoDB on-demand backup is charged per GB-month
    // Using warm backup storage pricing ($0.10/GB-month)
    // Cold backup storage ($0.03/GB-month) is available but requires AWS Backup
    return actualDataSize * DYNAMO_SNAPSHOT_PRICE;
}

// Function to calculate the overall Atlas total cost 
function calculateAtlasTotalCost(basePrice, includedStorageGB, dataUsagePercentage) {
    const actualDataSize = calculateActualDataSize(includedStorageGB, dataUsagePercentage);

    // Calculate backup costs
    const continuousBackupCost = calculateAtlasContinuousBackupCost(actualDataSize);
    const snapshotBackupCost = calculateAtlasSnapshotBackupCost(actualDataSize);

    // Base cost + backup costs
    const baseAndBackupSubtotal = basePrice + continuousBackupCost + snapshotBackupCost;

    // Calculate support cost (based on base + backup subtotal)
    let supportCost = 0;
    if (atlasSupportToggle.checked) {
        const supportRate = atlasDiscountToggle.checked
            ? ATLAS_SUPPORT_PERCENTAGE_DISCOUNTED
            : ATLAS_SUPPORT_PERCENTAGE_FULL;
        supportCost = baseAndBackupSubtotal * supportRate;
    }

    // Total before discount
    let totalCost = baseAndBackupSubtotal + supportCost;

    // Apply discount to entire bundle if enabled
    if (atlasDiscountToggle.checked) {
        totalCost -= totalCost * ATLAS_DISCOUNT_PERCENTAGE;
    }

    return totalCost;
}

// Calculate actual data size based on usage percentage
function calculateActualDataSize(includedStorageGB, usagePercentage) {
    return includedStorageGB * (usagePercentage / 100);
}

// Calculate AWS Business Support cost based on tiered pricing
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

    return supportCost;
}

// Calculate DynamoDB costs for each Atlas tier
function calculateDynamoCosts(readRatio, itemSizeKB, dataUsagePercentage, utilizationPercentage) {
    return atlasTiers.map(tier => {
        // Calculate actual data size
        const actualDataSize = calculateActualDataSize(tier.storage, dataUsagePercentage);

        // Apply utilization factor to operations (DynamoDB is usage-based)
        const effectiveOps = tier.ops * (utilizationPercentage / 100);

        // Split operations into reads and writes based on read ratio
        const readsPerSec = effectiveOps * (readRatio / 100);
        const writesPerSec = effectiveOps * (1 - readRatio / 100);

        // Calculate capacity units needed based on item size
        const rruPerRead = Math.ceil(itemSizeKB / 4); // 4KB per RRU for consistent reads
        const wruPerWrite = Math.ceil(itemSizeKB / 1); // 1KB per WRU

        const rrusPerSec = readsPerSec * rruPerRead;
        const wrusPerSec = writesPerSec * wruPerWrite;

        // Monthly calculations
        const totalRrus = rrusPerSec * SECONDS_PER_MONTH / 1000000; // In millions
        const totalWrus = wrusPerSec * SECONDS_PER_MONTH / 1000000; // In millions

        // Calculate base costs
        const readCost = totalRrus * DYNAMO_RRU_PRICE;
        const writeCost = totalWrus * DYNAMO_WRU_PRICE;

        // Storage cost (first 25GB free)
        const billableStorage = Math.max(0, actualDataSize - DYNAMO_FREE_STORAGE);
        const storageCost = billableStorage * DYNAMO_STORAGE_PRICE;

        let dynamoBaseCost = readCost + writeCost + storageCost;

        // Calculate AWS Business Support cost (tiered pricing)
        const supportCost = calculateAWSBusinessSupportCost(dynamoBaseCost);

        let dynamoTotalCost = dynamoBaseCost + supportCost;

        // Calculate backup costs
        const dynamoPitrCost = calculateDynamoPITRCost(actualDataSize);
        const dynamoSnapshotCost = calculateDynamoSnapshotCost(actualDataSize);

        // Add backup costs to total
        dynamoTotalCost += dynamoPitrCost + dynamoSnapshotCost;

        // Calculate Atlas total cost
        const atlasTotalCost = calculateAtlasTotalCost(tier.price, tier.storage, dataUsagePercentage);

        return {
            tier: tier.tier,
            atlasBasePrice: tier.price,
            atlasTotalPrice: Math.round(atlasTotalCost),
            dynamoBasePrice: Math.round(dynamoBaseCost),
            dynamoTotalPrice: Math.round(dynamoTotalCost),
            costRatio: Math.round(dynamoTotalCost / atlasTotalCost * 10) / 10,
            includedStorage: tier.storage,
            actualDataSize: Math.round(actualDataSize * 10) / 10,
            effectiveOps: Math.round(effectiveOps),
            details: {
                readCost: Math.round(readCost),
                writeCost: Math.round(writeCost),
                storageCost: Math.round(storageCost),
                dynamoSupportCost: Math.round(supportCost),
                dynamoPitrCost: Math.round(dynamoPitrCost),
                dynamoSnapshotCost: Math.round(dynamoSnapshotCost),
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

    // Only use first 8 tiers for better chart readability
    const visibleTiers = 8;
    const labels = comparisonData.slice(0, visibleTiers).map(item => item.tier);
    const atlasData = comparisonData.slice(0, visibleTiers).map(item => item.atlasTotalPrice);
    const dynamoData = comparisonData.slice(0, visibleTiers).map(item => item.dynamoTotalPrice);

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
                    backgroundColor: 'rgba(52, 168, 83, 0.7)',  // Changed to green
                    borderColor: 'rgba(52, 168, 83, 1)',        // Changed to green
                    borderWidth: 1
                },
                {
                    label: 'Amazon DynamoDB' + (utilizationSlider.value < 100 ? ' (' + utilizationSlider.value + '% utilization)' : ''),
                    data: dynamoData,
                    backgroundColor: 'rgba(66, 133, 244, 0.7)',  // Changed to blue
                    borderColor: 'rgba(66, 133, 244, 1)',        // Changed to blue
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
            <td class="text-right">$${item.atlasTotalPrice.toLocaleString()}${atlasDiscountToggle.checked ? ' <span class="discount-badge">-17%</span>' : ''}</td>
            <td class="text-right">$${item.dynamoTotalPrice.toLocaleString()}</td>
            <td class="text-right">$${yearlyAtlasCost.toLocaleString()}${atlasDiscountToggle.checked ? ' <span class="discount-badge">-17%</span>' : ''}</td>
            <td class="text-right">$${yearlyDynamoCost.toLocaleString()}</td>
            <td class="text-right">${item.costRatio}x</td>
        `;

        tableBody.appendChild(row);
    });

    // Update M30 details box (index 2 is M30)
    const m30 = comparisonData[2];
    m30Details.innerHTML = `
<h3>Detailed Cost Breakdown for M30 Tier (${m30.actualDataSize}GB actual data, ${utilizationSlider.value}% utilization)</h3>

<div style="display: flex; flex-wrap: wrap; gap: 20px;">
    <div style="flex: 1; min-width: 300px;">
        <h4>MongoDB Atlas Costs</h4>
        <p>Base Cluster Cost: $${m30.atlasBasePrice}/month ($${(m30.atlasBasePrice * 12).toLocaleString()}/year)</p>
        <p>Continuous Backup (tiered pricing): $${m30.details.atlasContinuousBackupCost.toFixed(2)}/month ($${(m30.details.atlasContinuousBackupCost * 12).toFixed(2)}/year)</p>
        <p>Snapshot Backup (GB-days pricing): $${m30.details.atlasSnapshotBackupCost.toFixed(2)}/month ($${(m30.details.atlasSnapshotBackupCost * 12).toFixed(2)}/year)</p>
        <p>Support (${atlasDiscountToggle.checked ? '37' : '70'}%): $${m30.details.atlasSupportCost}/month ($${(m30.details.atlasSupportCost * 12).toLocaleString()}/year)</p>
        ${atlasDiscountToggle.checked ? `<p>Enterprise Discount (17%): -$${m30.details.atlasDiscountAmount}/month (-$${(m30.details.atlasDiscountAmount * 12).toLocaleString()}/year)</p>` : ''}
        <p><strong>Total Atlas Cost: $${m30.atlasTotalPrice}/month ($${(m30.atlasTotalPrice * 12).toLocaleString()}/year)</strong></p>
    </div>
    
    <div style="flex: 1; min-width: 300px;">
        <h4>DynamoDB Costs</h4>
        <p>Actual Operations: ${m30.effectiveOps}/sec (${utilizationSlider.value}% of ${atlasTiers[2].ops}/sec)</p>
        <p>Read Operations: $${m30.details.readCost}/month ($${(m30.details.readCost * 12).toLocaleString()}/year)</p>
        <p>Write Operations: $${m30.details.writeCost}/month ($${(m30.details.writeCost * 12).toLocaleString()}/year)</p>
        <p>Storage: $${m30.details.storageCost}/month ($${(m30.details.storageCost * 12).toLocaleString()}/year)</p>
        <p>Business Support (Tiered): $${m30.details.dynamoSupportCost}/month ($${(m30.details.dynamoSupportCost * 12).toLocaleString()}/year)</p>
        <p>Point-in-Time Recovery (PITR): $${m30.details.dynamoPitrCost}/month ($${(m30.details.dynamoPitrCost * 12).toLocaleString()}/year)</p>
        <p>On-Demand Backup: $${m30.details.dynamoSnapshotCost}/month ($${(m30.details.dynamoSnapshotCost * 12).toLocaleString()}/year)</p>
        <p><strong>Total DynamoDB Cost: $${m30.dynamoTotalPrice}/month ($${(m30.dynamoTotalPrice * 12).toLocaleString()}/year)</strong></p>
    </div>
</div>

<div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 6px;">
    <h4>Backup Cost Comparison for ${m30.actualDataSize}GB Data</h4>
    <div style="display: flex; flex-wrap: wrap; gap: 20px;">
        <div style="flex: 1; min-width: 200px;">
            <h5>MongoDB Atlas Backups</h5>
            <p>• Continuous: $${m30.details.atlasContinuousBackupCost.toFixed(2)}/month</p>
            <p>• Snapshots: $${m30.details.atlasSnapshotBackupCost.toFixed(2)}/month</p>
            <p><strong>Total: $${(m30.details.atlasContinuousBackupCost + m30.details.atlasSnapshotBackupCost).toFixed(2)}/month</strong></p>
        </div>
        <div style="flex: 1; min-width: 200px;">
            <h5>DynamoDB Backups</h5>
            <p>• PITR: $${m30.details.dynamoPitrCost}/month</p>
            <p>• On-Demand: $${m30.details.dynamoSnapshotCost}/month</p>
            <p><strong>Total: $${(m30.details.dynamoPitrCost + m30.details.dynamoSnapshotCost)}/month</strong></p>
        </div>
    </div>
    <p style="margin-top: 10px; font-style: italic;">
        Note: Atlas continuous backup uses tiered pricing (first 5GB free, then $1.00/GB up to 100GB, etc.). 
        Atlas snapshot backup uses GB-days pricing ($0.10/GB/month = $0.003288/GB/day) with 30-day avg retention.
        DynamoDB PITR is a flat $0.20/GB/month, and on-demand backups are $0.10/GB/month.
    </p>
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

    readRatioValue.textContent = readRatio;
    writeRatioValue.textContent = 100 - readRatio;
    itemSizeValue.textContent = itemSize;
    dataUsageValue.textContent = dataUsage;
    utilizationValue.textContent = utilization;

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

    // Initialize the UI
    updateUI();
}

// Initialize the app when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);