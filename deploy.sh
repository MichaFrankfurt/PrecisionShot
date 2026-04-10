#!/bin/bash
set -e

SERVER="root@178.104.109.249"
APP_DIR="/opt/precisionshot"

echo "=== PrecisionShot.ai Deployment ==="

# Step 1: Build frontend locally
echo "1. Building frontend..."
cd ~/Desktop/PrecisionShot/frontend
npm run build

# Step 2: Push to GitHub
echo "2. Pushing to GitHub..."
cd ~/Desktop/PrecisionShot
git add -A
git commit -m "Deploy $(date +%Y-%m-%d_%H:%M)" --allow-empty
git push origin main

# Step 3: Deploy on server
echo "3. Deploying on server..."
ssh $SERVER << 'REMOTE'
set -e
APP_DIR="/opt/precisionshot"

# Clone or pull
if [ -d "$APP_DIR" ]; then
  cd $APP_DIR
  git pull origin main
else
  git clone https://github.com/MichaFrankfurt/PrecisionShot.git $APP_DIR
  cd $APP_DIR
fi

# Install backend dependencies
cd $APP_DIR/backend
npm ci --production

# Create .env if not exists
if [ ! -f .env ]; then
  cat > .env << 'ENV'
PORT=3002
JWT_SECRET=$(openssl rand -hex 32)
NODE_ENV=production
ENV
  echo "Created .env"
fi

# Create systemd service
cat > /etc/systemd/system/precisionshot.service << 'SERVICE'
[Unit]
Description=PrecisionShot.ai Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/precisionshot/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable precisionshot
systemctl restart precisionshot

echo "Backend started on port 3002"

# Create nginx config
cat > /etc/nginx/sites-available/precisionshot << 'NGINX'
server {
    server_name precisionshot.ai www.precisionshot.ai;

    root /opt/precisionshot/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 25M;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    listen 80;
}
NGINX

# Enable site
ln -sf /etc/nginx/sites-available/precisionshot /etc/nginx/sites-enabled/precisionshot
nginx -t && systemctl reload nginx

echo "Nginx configured"

# SSL with Certbot (first time only)
if [ ! -d "/etc/letsencrypt/live/precisionshot.ai" ]; then
  echo "Requesting SSL certificate..."
  certbot --nginx -d precisionshot.ai -d www.precisionshot.ai --non-interactive --agree-tos -m mail@michaelrubin.de
  echo "SSL configured!"
fi

echo ""
echo "=== Deployment complete! ==="
systemctl status precisionshot --no-pager
REMOTE

echo ""
echo "Done! Visit https://precisionshot.ai/"
