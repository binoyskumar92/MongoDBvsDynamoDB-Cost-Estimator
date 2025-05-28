#!/bin/bash

# EC2 Smart Deployment Script for Static Web App with Nginx and Basic Auth
# Handles both initial deployment and updates automatically

echo "Starting deployment process..."

# Function to check if app is already deployed
check_deployment_status() {
    if [ -d "/var/www/html/app" ] && [ -f "/etc/nginx/conf.d/app.conf" ] && systemctl is-active --quiet nginx; then
        return 0  # Already deployed
    else
        return 1  # Not deployed
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
    echo "$username:$(openssl passwd -apr1 $password)" | sudo tee /etc/nginx/.htpasswd > /dev/null

    # Backup original nginx config and disable default server
    sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup
    
    # Comment out the default server block to avoid conflicts
    sudo sed -i '/server {/,/^    }/s/^/#/' /etc/nginx/nginx.conf

    # Create directory for nginx config if it doesn't exist
    sudo mkdir -p /etc/nginx/conf.d

    # Create Nginx configuration
    sudo tee /etc/nginx/conf.d/app.conf > /dev/null <<EOF
server {
    listen 80 default_server;
    server_name _;
    
    location / {
        auth_basic "Restricted Access - MongoDB vs DynamoDB Cost Estimator";
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        root /var/www/html/app;
        index index.html;
        
        # Handle static files with caching
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
        
        # Fallback to index.html for SPA routing
        try_files \$uri \$uri/ /index.html;
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
    
    # Navigate to temp directory
    cd /tmp

    # Check if repo exists, if not clone it
    if [ ! -d "MongoDBvsDynamoDB-Cost-Estimator" ]; then
        echo "📥 Repository not found, cloning..."
        git clone https://github.com/binoyskumar92/MongoDBvsDynamoDB-Cost-Estimator.git
    fi

    # Navigate to repo and pull latest changes
    cd MongoDBvsDynamoDB-Cost-Estimator
    echo "📦 Pulling latest changes from Git..."
    
    # Check if there are any changes
    git fetch
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse @{u})
    
    if [ "$LOCAL" = "$REMOTE" ]; then
        echo "📋 No new changes found in repository"
        echo "🌐 Your app is already up to date!"
        return 0
    fi
    
    git pull origin main

    # Create backup of current deployment with timestamp
    if [ -d "/var/www/html/app" ]; then
        BACKUP_DIR="/var/www/html/app.backup.$(date +%Y%m%d-%H%M%S)"
        echo "💾 Creating backup at $BACKUP_DIR"
        sudo cp -r /var/www/html/app "$BACKUP_DIR"
    fi

    # Copy updated files
    echo "📋 Copying updated files..."
    sudo cp index.html logic.js style.css /var/www/html/app/

    # Set proper permissions (nginx user on Amazon Linux 2)
    sudo chown -R nginx:nginx /var/www/html/app
    sudo chmod -R 755 /var/www/html/app

    # Test nginx config (in case there were any changes)
    sudo nginx -t

    if [ $? -eq 0 ]; then
        # Reload nginx to clear any cached content
        sudo systemctl reload nginx
        echo "✅ Code updated successfully!"
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