#!/bin/bash
set -e

CHILD_IP="192.168.1.170"
CHILD_USER="root"
APP_DIR="/opt/bitbonsai"

echo "🚀 Deploying BitBonsai to Child Node ($CHILD_IP)..."

# Sync code to child node
echo "📦 Syncing code..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'data' \
  --exclude '.env' \
  apps/ libs/ prisma/ nx.json tsconfig.json package.json package-lock.json \
  $CHILD_USER@$CHILD_IP:$APP_DIR/

# Run deployment commands on child node
echo "🔨 Building and restarting..."
ssh $CHILD_USER@$CHILD_IP "cd $APP_DIR && \
  npm install --production --legacy-peer-deps --ignore-scripts && \
  npx prisma generate && \
  npx prisma migrate deploy && \
  systemctl restart bitbonsai-backend && \
  echo '✅ Deployment complete!' && \
  sleep 3 && \
  systemctl status bitbonsai-backend --no-pager -l"

echo "🎉 Child node deployment complete!"
