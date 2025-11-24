#!/bin/sh
set -e

echo "🚀 BitBonsai - Starting all-in-one container..."

# Start nginx in background
echo "📦 Starting nginx (frontend + API proxy)..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Start backend in foreground
echo "⚙️  Starting NestJS backend..."
node /app/dist/apps/backend/main.js &
BACKEND_PID=$!

# Trap SIGTERM and SIGINT to gracefully shut down both processes
trap 'echo "⛔ Shutting down..."; kill $NGINX_PID $BACKEND_PID; wait' SIGTERM SIGINT

# Wait for both processes
wait $NGINX_PID $BACKEND_PID
