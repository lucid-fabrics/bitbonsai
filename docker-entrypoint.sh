#!/bin/sh
set -e

echo "🌳 BitBonsai - Starting all-in-one container..."

# ============================================================================
# ENVIRONMENT SETUP
# ============================================================================

export NODE_ENV="${NODE_ENV:-production}"
export PGDATA="${PGDATA:-/config/postgres}"
export DATABASE_URL="${DATABASE_URL:-postgresql://bitbonsai:bitbonsai@localhost:5432/bitbonsai}"

# Create required directories
echo "📁 Setting up directories..."
mkdir -p /config/cache /config/logs /config/postgres /run/postgresql
chown -R postgres:postgres /config/postgres /run/postgresql

# ============================================================================
# POSTGRESQL INITIALIZATION
# ============================================================================

echo "🐘 Setting up PostgreSQL..."

# Check if PostgreSQL data directory is initialized
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "📦 Initializing PostgreSQL database..."
  su-exec postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=md5

  # Configure PostgreSQL for local and network connections (for child nodes)
  echo "host all all 127.0.0.1/32 md5" >> "$PGDATA/pg_hba.conf"
  echo "host all all 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
  echo "listen_addresses = '*'" >> "$PGDATA/postgresql.conf"
  echo "port = 5432" >> "$PGDATA/postgresql.conf"

  # Start PostgreSQL temporarily to create database and user
  su-exec postgres pg_ctl -D "$PGDATA" -w start

  # Create user and database
  su-exec postgres psql -c "CREATE USER bitbonsai WITH PASSWORD 'bitbonsai';"
  su-exec postgres psql -c "CREATE DATABASE bitbonsai OWNER bitbonsai;"
  su-exec postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE bitbonsai TO bitbonsai;"

  # Stop PostgreSQL (will be started properly below)
  su-exec postgres pg_ctl -D "$PGDATA" -w stop

  echo "✅ PostgreSQL initialized"
else
  echo "✅ Found existing PostgreSQL data"
fi

# Start PostgreSQL
echo "🔄 Starting PostgreSQL..."
su-exec postgres pg_ctl -D "$PGDATA" -w start

# ============================================================================
# DATABASE MIGRATIONS
# ============================================================================

echo "💾 Running database migrations..."
cd /app
./node_modules/.bin/prisma migrate deploy 2>&1 || {
  echo "⚠️  Migration failed, trying db push..."
  ./node_modules/.bin/prisma db push --accept-data-loss 2>&1 || true
}

# ============================================================================
# GENERATE JWT SECRET IF MISSING
# ============================================================================

if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(head -c 32 /dev/urandom | base64)
  echo "🔑 Generated JWT secret (ephemeral - set JWT_SECRET env var for persistence)"
fi

# ============================================================================
# START SERVICES
# ============================================================================

# Start nginx in background
echo "📦 Starting nginx (frontend + API proxy)..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Give nginx a moment to start
sleep 1

# Start backend
echo "⚙️  Starting NestJS backend..."
cd /app
node dist/apps/backend/main.js &
BACKEND_PID=$!

echo "🚀 BitBonsai is running!"
echo "   Frontend: http://localhost:8108"
echo "   API:      http://localhost:8108/api"

# ============================================================================
# SIGNAL HANDLING
# ============================================================================

cleanup() {
  echo "⛔ Shutting down..."
  kill $NGINX_PID $BACKEND_PID 2>/dev/null || true
  su-exec postgres pg_ctl -D "$PGDATA" -w stop 2>/dev/null || true
  wait
}

trap cleanup SIGTERM SIGINT

# Wait for processes
wait $NGINX_PID $BACKEND_PID
