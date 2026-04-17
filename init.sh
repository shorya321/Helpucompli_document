#!/bin/bash
# ===========================================
# HelpUcompli Document Repository — Init Script
# Anthropic Agent Harness Pattern: Environment Bootstrap
# ===========================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "=========================================="
echo "  HelpUcompli Document Repository Setup"
echo "=========================================="

# 1. Check Node.js
echo ""
echo "[1/6] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found. Install Node.js 20+ first."
    exit 1
fi
NODE_VERSION=$(node -v)
echo "  Node.js $NODE_VERSION found"

# 2. Check .env / .env.local
echo ""
echo "[2/6] Checking environment..."
if [ ! -f .env ] && [ ! -f .env.local ]; then
    echo "  WARNING: .env or .env.local file not found!"
    echo "  Copy .env.example to .env.local and fill in your credentials:"
    echo "    cp .env.example .env.local"
    echo ""
    echo "  Continuing without env file (some features will not work)..."
else
    if [ -f .env.local ]; then
        echo "  .env.local file found"
    fi
    if [ -f .env ]; then
        echo "  .env file found"
    fi
fi

# 3. Install dependencies
echo ""
echo "[3/6] Installing dependencies..."
if [ ! -d node_modules ]; then
    npm install
else
    echo "  node_modules exists, skipping install"
    echo "  (run 'npm install' manually if needed)"
fi

# 4. Generate Prisma client
echo ""
echo "[4/6] Generating Prisma client..."
if [ -f prisma/schema.prisma ]; then
    npx prisma generate
else
    echo "  prisma/schema.prisma not found yet, skipping"
fi

# 5. Run database migrations (if DATABASE_URL is set)
echo ""
echo "[5/6] Checking database..."
ENV_FILE=""
[ -f .env ] && ENV_FILE=".env"
[ -f .env.local ] && ENV_FILE=".env.local"
if [ -n "$ENV_FILE" ] && grep -q "DATABASE_URL" "$ENV_FILE" 2>/dev/null; then
    if [ -f prisma/schema.prisma ]; then
        echo "  Running Prisma migrations from $ENV_FILE..."
        npx prisma migrate dev --name init 2>/dev/null || echo "  Migration skipped (may already be applied)"
    fi
else
    echo "  DATABASE_URL not configured, skipping migrations"
fi

# 6. Start dev server
echo ""
echo "[6/6] Starting dev server..."
echo "  Starting Next.js on http://localhost:3000"
echo ""
echo "=========================================="
echo "  Setup complete! Dev server starting..."
echo "=========================================="
echo ""

npm run dev
