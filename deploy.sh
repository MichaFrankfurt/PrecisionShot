#!/bin/bash
set -e

SERVER="root@178.104.109.249"
APP_DIR="/opt/precisionshot"

echo "=== PrecisionShot.ai Deployment ==="

# Step 1: Push latest code to GitHub
echo "1. Pushing to GitHub..."
cd ~/Desktop/PrecisionShot
git add -A
git commit -m "Deploy $(date +%Y-%m-%d_%H:%M)" --allow-empty
git push origin main

# Step 2: Deploy on server
echo "2. Deploying on server..."
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

# Create .env if not exists
if [ ! -f .env ]; then
  echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
  echo "Created .env"
fi

# First deployment: use init config (no SSL), get cert, then switch to SSL config
if [ ! -f "$APP_DIR/.ssl-done" ]; then
  echo "First deployment — starting without SSL..."
  cp nginx/nginx-init.conf nginx/nginx-active.conf

  # Temporarily use init config
  sed -i 's|./nginx/nginx.conf|./nginx/nginx-active.conf|' docker-compose.prod.yml 2>/dev/null || true

  docker compose -f docker-compose.prod.yml build --no-cache
  docker compose -f docker-compose.prod.yml up -d

  echo "Waiting for services..."
  sleep 10

  echo "Requesting SSL certificate..."
  docker compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --email mail@michaelrubin.de --agree-tos --no-eff-email \
    -d precisionshot.ai -d www.precisionshot.ai

  # Switch to SSL config
  cp nginx/nginx.conf nginx/nginx-active.conf
  docker compose -f docker-compose.prod.yml restart nginx
  touch "$APP_DIR/.ssl-done"
  echo "SSL configured!"
else
  echo "Updating deployment..."
  docker compose -f docker-compose.prod.yml build --no-cache
  docker compose -f docker-compose.prod.yml up -d
fi

echo ""
echo "=== Deployment complete! ==="
docker compose -f docker-compose.prod.yml ps
REMOTE

echo ""
echo "Done! Visit https://precisionshot.ai/"
