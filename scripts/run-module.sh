#!/bin/bash
# ===========================================
# Run a specific module implementation via Claude Code
# Usage: ./scripts/run-module.sh 01
#        ./scripts/run-module.sh 06
# ===========================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

MODULE_NUM="${1:-}"

if [ -z "$MODULE_NUM" ]; then
    echo "Usage: ./scripts/run-module.sh <module_number>"
    echo ""
    echo "Available modules:"
    echo "  01 - Authentication & Authorization (Phase 1)"
    echo "  02 - Database Schema (Phase 1)"
    echo "  03 - AWS S3 Integration (Phase 1)"
    echo "  04 - Dashboard Home (Phase 2)"
    echo "  05 - Bucket Manager (Phase 2)"
    echo "  06 - Document Browser (Phase 2)"
    echo "  07 - Audit Logging (Phase 2)"
    echo "  08 - Policy Engine (Phase 3)"
    echo "  09 - Link Generator (Phase 3)"
    echo "  10 - User Management (Phase 3)"
    echo "  11 - Security & HIPAA (Phase 4)"
    echo "  12 - Testing & Launch (Phase 4)"
    exit 1
fi

# Map module numbers to names and docs
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

declare -A MODULE_DOCS
MODULE_DOCS[01]="01-auth-module.md"
MODULE_DOCS[02]="02-database-module.md"
MODULE_DOCS[03]="03-s3-module.md"
MODULE_DOCS[04]="04-dashboard-module.md"
MODULE_DOCS[05]="05-bucket-manager-module.md"
MODULE_DOCS[06]="06-document-browser-module.md"
MODULE_DOCS[07]="07-audit-module.md"
MODULE_DOCS[08]="08-policy-engine-module.md"
MODULE_DOCS[09]="09-link-generator-module.md"
MODULE_DOCS[10]="10-user-management-module.md"
MODULE_DOCS[11]="11-security-hipaa-module.md"
MODULE_DOCS[12]="12-testing-launch-module.md"

# Security-sensitive modules that need security-reviewer
SECURITY_MODULES="01 03 08 09 11"

MODULE_NAME="${MODULE_NAMES[$MODULE_NUM]}"
MODULE_DOC="${MODULE_DOCS[$MODULE_NUM]}"

if [ -z "$MODULE_NAME" ]; then
    echo "ERROR: Invalid module number '$MODULE_NUM'"
    echo "Valid: 01-12"
    exit 1
fi

DOC_PATH="docs/modules/$MODULE_DOC"
if [ ! -f "$DOC_PATH" ]; then
    echo "ERROR: Module doc not found: $DOC_PATH"
    exit 1
fi

# Count pending features for this module
PENDING=$(python3 -c "
import json
with open('feature_list.json') as f:
    data = json.load(f)
for m in data['modules']:
    if m['module'] == '$MODULE_NUM-$MODULE_NAME':
        pending = sum(1 for f in m['features'] if not f['passes'])
        total = len(m['features'])
        print(f'{pending}/{total}')
        break
" 2>/dev/null || echo "?/?")

echo "=========================================="
echo "  Module $MODULE_NUM: $MODULE_NAME"
echo "  Pending features: $PENDING"
echo "=========================================="
echo ""

# Determine if this module needs security review
NEEDS_SECURITY=""
if echo "$SECURITY_MODULES" | grep -qw "$MODULE_NUM"; then
    NEEDS_SECURITY="IMPORTANT: This module handles security-sensitive code. After implementing each feature, invoke the security-reviewer agent to check for vulnerabilities."
fi

# Build the prompt for Claude Code
PROMPT="You are implementing Module $MODULE_NUM ($MODULE_NAME) of the HelpUcompli Document Repository.

## Session Protocol
1. Read claude-progress.json for current state
2. Read feature_list.json and filter for module '$MODULE_NUM-$MODULE_NAME'
3. Read docs/modules/$MODULE_DOC for the full module spec
4. Pick the FIRST feature where passes=false
5. Follow TDD: write test → implement → verify → mark done
6. After each feature: git commit, update feature_list.json (passes=true), update claude-progress.json
7. Continue to next feature until all pass or session ends

## Agents to Use
- tdd-guide: For writing tests first
- code-reviewer: After each feature implementation
${NEEDS_SECURITY}

## Key Rules
- One feature at a time — do NOT batch
- Test must pass before marking feature done
- Conventional commits: feat($MODULE_NAME): <description>
- Validate all input with Zod on API routes
- Log all mutations in audit trail
- Check user role before operations

Start now. Read the progress and feature files, then begin implementing."

echo "Launching Claude Code for Module $MODULE_NUM..."
echo ""

# Launch Claude Code with the prompt
claude --print "$PROMPT"
