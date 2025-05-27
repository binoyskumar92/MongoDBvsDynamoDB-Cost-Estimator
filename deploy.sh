#!/bin/bash

# EC2 Deployment Script for Static Web App with Nginx and Basic Auth
# Updated for Amazon Linux 2

echo "Starting deployment process..."

# Update system packages
sudo yum update -y

# Install Git and Apache utilities (for htpasswd)
sudo yum install -y git httpd-tools

# Install Nginx using Amazon Linux Extras
sudo amazon-linux-extras install -y nginx1

# Clone your repository
cd /tmp
rm -rf MongoDBvsDynamoDB-Cost-Estimator  # Remove if exists
git clone https://github.com/binoyskumar92/MongoDBvsDynamoDB-Cost-Estimator.git
cd MongoDBvsDynamoDB-Cost-Estimator

# Create web directory and copy files
sudo mkdir -p /var/www/html/app
sudo cp index.html logic.js style.css /var/www/html/app/

# Set proper permissions (nginx user on Amazon Linux 2)
sudo chown -R nginx:nginx /var/www/html/app
sudo chmod -R 755 /var/www/html/app

# Create directory for nginx config if it doesn't exist
sudo mkdir -p /etc/nginx/conf.d

# Create basic auth password file
echo "Creating basic authentication..."
echo "Enter username for web access:"
read username
echo "Enter password for $username:"
read -s password
echo "$username:$(openssl passwd -apr1 $password)" | sudo tee /etc/nginx/.htpasswd > /dev/null

# Backup original nginx config
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup

# Create Nginx configuration
sudo tee /etc/nginx/conf.d/app.conf > /dev/null <<EOF
server {
    listen 80;
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
    
    # Check status
    sudo systemctl status nginx --no-pager -l
    
    # Get public IP
    PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
    
    echo ""
    echo "✅ Deployment completed successfully!"
    echo ""
    echo "🔧 IMPORTANT: Make sure your EC2 Security Group allows inbound traffic on port 80 (HTTP)"
    echo "🌐 Your app is accessible at: http://$PUBLIC_IP"
    echo "👤 Username: $username"
    echo "🔒 You'll be prompted for password when accessing the site"
    echo ""
    echo "📁 App files are located at: /var/www/html/app"
    echo "⚙️  Nginx config: /etc/nginx/conf.d/app.conf"
    echo ""
    echo "🔄 To update your app in the future:"
    echo "   cd /tmp/MongoDBvsDynamoDB-Cost-Estimator"
    echo "   git pull"
    echo "   sudo cp *.html *.js *.css /var/www/html/app/"
    echo ""
    echo "🏥 Health check (no auth): http://$PUBLIC_IP/health"
    
else
    echo "❌ Nginx configuration failed! Please check the config manually."
fi