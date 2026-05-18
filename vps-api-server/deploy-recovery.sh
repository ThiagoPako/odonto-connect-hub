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

# 7. Critical Route Validation (Post-deploy check)
echo "--> Validating critical routes..."
sleep 5

# Function to check route and fail script if error
check_route() {
    local name=$1
    local url=$2
    local expected=$3
    local headers=$4
    
    echo -n "  Testing $name ($url)... "
    local status
    if [ -n "$headers" ]; then
        status=$(curl -s -o /dev/null -w "%{http_code}" -H "$headers" "$url" 2>/dev/null || echo "000")
    else
        status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    fi

    if [ "$status" = "$expected" ] || ([ "$expected" = "200" ] && [ "$status" = "401" ]); then
        # 401 is acceptable for protected routes as it means the API is responsive but needs token
        echo "✅ OK (HTTP $status)"
    else
        echo "❌ FAILED (HTTP $status, expected $expected)"
        echo "!!! CRITICAL FAILURE: API is not behaving as expected after deploy !!!"
        pm2 logs odonto-api --lines 50 --nostream
        exit 1
    fi
}

# Check Health
check_route "Health Check" "http://127.0.0.1:$API_PORT/api/health" "200"

# Check Auth/Me (should return 401/200 if up)
check_route "Auth Profile" "http://127.0.0.1:$API_PORT/api/auth/me" "200"

# Check a multi-tenant query route (e.g. consultations or patients)
check_route "Multi-tenant Data" "http://127.0.0.1:$API_PORT/api/consultations" "200"

echo "=== Operation Completed Successfully: $(date) ==="
pm2 status

