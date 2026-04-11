#!/bin/bash
# ===========================================
# Verify a module: type-check, lint, test
# Usage: ./scripts/verify-module.sh 01
# ===========================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

MODULE_NUM="${1:-}"

if [ -z "$MODULE_NUM" ]; then
    echo "Usage: ./scripts/verify-module.sh <module_number>"
    echo "Runs type-check, lint, and tests for a specific module."
    exit 1
fi

declare -A MODULE_NAMES
MODULE_NAMES[01]="auth"
MODULE_NAMES[02]="database"
MODULE_NAMES[03]="s3"
MODULE_NAMES[04]="dashboard"
MODULE_NAMES[05]="buckets"
MODULE_NAMES[06]="documents"
MODULE_NAMES[07]="audit"
MODULE_NAMES[08]="policies"
MODULE_NAMES[09]="links"
MODULE_NAMES[10]="users"
MODULE_NAMES[11]="security"
MODULE_NAMES[12]="testing"

MODULE_NAME="${MODULE_NAMES[$MODULE_NUM]}"

if [ -z "$MODULE_NAME" ]; then
    echo "ERROR: Invalid module number '$MODULE_NUM'"
    exit 1
fi

echo "=========================================="
echo "  Verifying Module $MODULE_NUM: $MODULE_NAME"
echo "=========================================="

# 1. TypeScript type-check
echo ""
echo "[1/4] Type-checking..."
npx tsc --noEmit 2>&1 || { echo "  TYPE CHECK FAILED"; exit 1; }
echo "  Type check passed"

# 2. Lint
echo ""
echo "[2/4] Linting..."
npx next lint 2>&1 || { echo "  LINT FAILED"; exit 1; }
echo "  Lint passed"

# 3. Unit/Integration tests for this module
echo ""
echo "[3/4] Running tests for $MODULE_NAME..."
if [ -d "src/__tests__/$MODULE_NAME" ]; then
    npx vitest run "src/__tests__/$MODULE_NAME" --reporter=verbose 2>&1
    echo "  Tests passed"
else
    echo "  No tests found at src/__tests__/$MODULE_NAME (skipped)"
fi

# 4. Build check
echo ""
echo "[4/4] Build check..."
npm run build 2>&1 || { echo "  BUILD FAILED"; exit 1; }
echo "  Build passed"

echo ""
echo "=========================================="
echo "  Module $MODULE_NUM VERIFIED SUCCESSFULLY"
echo "=========================================="

# Show feature progress for this module
echo ""
./scripts/check-progress.sh "$MODULE_NUM"
