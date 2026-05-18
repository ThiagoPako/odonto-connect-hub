#!/bin/bash

# ==============================================================================
# Odonto Connect - Deploy & Recovery Script
# Purpose: Pull latest changes, update dependencies, run migrations, and 
# ensure PM2 services (odonto-api & odonto-connect) are running.
# ==============================================================================

set -e # Exit on error

PROJECT_ROOT="/root/odonto-connect"
ECOSYSTEM_CONFIG="ecosystem.config.cjs"
API_PORT=3002
DB_PORT=5433
DB_NAME="odonto_db"

echo "=== Starting Deploy/Recovery: $(date) ==="

# 1. Access project directory
cd "$PROJECT_ROOT" || { echo "Error: Directory $PROJECT_ROOT not found"; exit 1; }

# 2. Update code
echo "--> Pulling latest changes from git..."
git fetch origin main
git reset --hard origin/main

# 3. Install dependencies (Backend)
echo "--> Installing backend dependencies..."
if [ -d "vps-api-server" ]; then
    cd vps-api-server
    if command -v bun &> /dev/null; then
        bun install
    else
        npm install
    fi
    cd ..
else
    echo "Warning: vps-api-server directory not found!"
fi

# 4. Run Migrations
echo "--> Running database migrations..."
MIGRATION_FILES=$(ls vps-api-server/migration*.sql 2>/dev/null || true)
if [ -n "$MIGRATION_FILES" ]; then
    for f in $MIGRATION_FILES; do
        echo "  Applying $f..."
        sudo -u postgres psql -p "$DB_PORT" -d "$DB_NAME" -f "$f" > /dev/null 2>&1 || echo "  Warning: Migration $f might have already been applied or failed."
    done
else
    echo "  No migration files found."
fi

# 5. Build Frontend (if applicable)
if [ -f "package.json" ]; then
    echo "--> Building frontend..."
    if command -v bun &> /dev/null; then
        bun run build || echo "Build failed, continuing anyway..."
    else
        npm run build || echo "Build failed, continuing anyway..."
    fi
fi

# 6. PM2 Restart/Start
echo "--> Managing PM2 processes..."
# Check if services are defined in ecosystem
if [ -f "$ECOSYSTEM_CONFIG" ]; then
    # Try to restart first to pick up new code/env
    pm2 startOrReload "$ECOSYSTEM_CONFIG" --update-env
    pm2 save
else
    echo "Error: $ECOSYSTEM_CONFIG not found!"
    exit 1
fi

# 7. Health Check
echo "--> Performing health check on API (Port $API_PORT)..."
sleep 5
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:"$API_PORT"/api/health 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Success: API is healthy (HTTP 200)"
else
    echo "⚠️ Warning: API returned HTTP $HTTP_STATUS. Checking logs..."
    pm2 logs odonto-api --lines 20 --nostream
fi

echo "=== Operation Completed: $(date) ==="
pm2 status
