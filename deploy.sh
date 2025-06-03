#!/bin/bash

# EC2 Smart Deployment Script for Static Web App with Nginx and Basic Auth
# Handles both initial deployment and updates automatically

echo "Starting deployment process..."

# Function to check if app is already deployed
check_deployment_status() {
    if [ -d "/var/www/html/app" ] && [ -f "/etc/nginx/conf.d/app.conf" ] && systemctl is-active --quiet nginx; then
        return 0 # Already deployed
    else
        return 1 # Not deployed
    fi
}
# Function for initial deployment
initial_deployment() {
    echo "🚀 Performing initial deployment..."

    # Update system packages
    sudo yum update -y

    # Install Git and Apache utilities (for htpasswd)
    sudo yum install -y git httpd-tools

    # Install Nginx using Amazon Linux Extras
    sudo amazon-linux-extras install -y nginx1

    # Create web directory
    sudo mkdir -p /var/www/html/app

    # Create basic auth password file
    echo "Creating basic authentication..."
    echo "Enter username for web access:"
    read username
    echo "Enter password for $username:"
    read -s password
    echo "$username:$(openssl passwd -apr1 $password)" | sudo tee /etc/nginx/.htpasswd >/dev/null

    # Backup original nginx config and disable default server
    sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup

    # Comment out the default server block to avoid conflicts
    sudo sed -i '/server {/,/^    }/s/^/#/' /etc/nginx/nginx.conf

    # Create directory for nginx config if it doesn't exist
    sudo mkdir -p /etc/nginx/conf.d

    # Create Nginx configuration
    sudo tee /etc/nginx/conf.d/app.conf >/dev/null <<EOF
server {
    listen 80 default_server;
    server_name _;
    
    location / {
        auth_basic "Restricted Access - MongoDB vs DynamoDB Cost Estimator";
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        root /var/www/html/app;
        index index.html;
        
        # Disable all caching
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        
        # Fallback to index.html for SPA routing
        try_files $uri $uri/ /index.html;
    }
    
    # Health check endpoint (no auth required)
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

    # Test Nginx configuration
    echo "Testing Nginx configuration..."
    sudo nginx -t

    if [ $? -eq 0 ]; then
        echo "Nginx configuration is valid!"

        # Start and enable Nginx
        sudo systemctl start nginx
        sudo systemctl enable nginx

        echo "✅ Initial deployment infrastructure ready!"
    else
        echo "❌ Nginx configuration failed! Please check the config manually."
        exit 1
    fi
}

# Function for code update
update_code() {
    echo "🔄 Updating application code..."
    
    # Define paths
    REPO_PATH="/tmp/MongoDBvsDynamoDB-Cost-Estimator"
    REPO_URL="https://github.com/binoyskumar92/MongoDBvsDynamoDB-Cost-Estimator.git"

    # Navigate to temp directory
    cd /tmp

    # Clean up any existing problematic repository
    if [ -d "MongoDBvsDynamoDB-Cost-Estimator" ]; then
        echo "🧹 Cleaning up existing repository..."
        sudo rm -rf MongoDBvsDynamoDB-Cost-Estimator
    fi

    # Clone repository fresh
    echo "📥 Cloning repository..."
    git clone "$REPO_URL"
    if [ $? -ne 0 ]; then
        echo "❌ Failed to clone repository"
        exit 1
    fi

    # Fix ownership immediately after clone
    sudo chown -R ec2-user:ec2-user MongoDBvsDynamoDB-Cost-Estimator
    
    # Add as safe directory for git operations
    git config --global --add safe.directory "$REPO_PATH" 2>/dev/null

    # Navigate to repository
    cd "$REPO_PATH"
    
    echo "📦 Repository cloned successfully!"
    echo "📋 Current files in repository:"
    ls -la
    
    # Verify we're in a git repository
    if [ ! -d ".git" ]; then
        echo "❌ Not in a git repository after clone. Something went wrong."
        exit 1
    fi

    # Verify required files exist
    if [ ! -f "index.html" ] || [ ! -f "logic.js" ] || [ ! -f "style.css" ]; then
        echo "❌ Required files (index.html, logic.js, style.css) not found in repository"
        echo "Files found:"
        ls -la *.html *.js *.css 2>/dev/null || echo "No matching files found"
        exit 1
    fi
    
    # Show what we're about to copy
    echo "📋 Files to be copied:"
    ls -la index.html logic.js style.css
    
    # Create backup of current deployment with timestamp
    if [ -d "/var/www/html/app" ] && [ "$(ls -A /var/www/html/app)" ]; then
        BACKUP_DIR="/var/www/html/app.backup.$(date +%Y%m%d-%H%M%S)"
        echo "💾 Creating backup at $BACKUP_DIR"
        sudo cp -r /var/www/html/app "$BACKUP_DIR"
    fi
    
    # Ensure web directory exists
    sudo mkdir -p /var/www/html/app
    
    # Copy updated files with verbose output
    echo "📋 Copying updated files to web directory..."
    echo "Current directory: $(pwd)"
    echo "Copying to: /var/www/html/app/"
    
    sudo cp -v index.html logic.js style.css /var/www/html/app/
    
    if [ $? -eq 0 ]; then
        echo "✅ Files copied successfully!"
    else
        echo "❌ File copy failed!"
        exit 1
    fi
    
    # Verify files were copied
    echo "📋 Verifying copied files:"
    ls -la /var/www/html/app/
    
    # Set proper permissions
    sudo chown -R nginx:nginx /var/www/html/app
    sudo chmod -R 755 /var/www/html/app
    
    # Test nginx config
    sudo nginx -t
    
    if [ $? -eq 0 ]; then
        # Reload nginx to clear any cached content
        sudo systemctl reload nginx
        echo "✅ Code updated and deployed successfully!"
        
        # Show file timestamps to confirm update
        echo "📅 Deployed file timestamps:"
        ls -lt /var/www/html/app/
    else
        echo "⚠️  Nginx config test failed, but files were updated"
    fi
}

# Function to display deployment info
show_deployment_info() {
    # Get public IP
    PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "Unable to fetch IP")

    echo ""
    echo "🌐 Your app is accessible at: http://$PUBLIC_IP"
    echo "🏥 Health check (no auth): http://$PUBLIC_IP/health"
    echo ""
    echo "📁 App files location: /var/www/html/app"
    echo "⚙️  Nginx config: /etc/nginx/conf.d/app.conf"
    echo "🕐 Last updated: $(date)"
    echo ""
}

# Main execution logic
echo "🔍 Checking deployment status..."

if check_deployment_status; then
    echo "✅ Existing deployment detected!"
    echo "🔄 Proceeding with code update only..."
    update_code
else
    echo "🆕 No existing deployment found!"
    echo "🚀 Performing full initial deployment..."
    initial_deployment
    update_code

    echo ""
    echo "🔧 IMPORTANT: Make sure your EC2 Security Group allows inbound traffic on port 80 (HTTP)"
    echo ""
    echo "🔄 For future updates, just run this same script!"
fi

# Show current status
sudo systemctl status nginx --no-pager -l
show_deployment_info

echo ""
echo "✨ Deployment process completed!"
