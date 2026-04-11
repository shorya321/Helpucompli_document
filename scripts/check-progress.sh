#!/bin/bash
# ===========================================
# Check feature progress across all modules
# Usage: ./scripts/check-progress.sh
#        ./scripts/check-progress.sh 06
# ===========================================

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

MODULE_FILTER="${1:-}"

python3 << 'PYTHON_SCRIPT'
import json
import sys

with open('feature_list.json') as f:
    data = json.load(f)

module_filter = sys.argv[1] if len(sys.argv) > 1 else ""

print("=" * 60)
print("  HelpUcompli Document Repository — Feature Progress")
print("=" * 60)
print()

total_all = 0
done_all = 0

for module in data['modules']:
    mod_id = module['module'][:2]

    if module_filter and mod_id != module_filter:
        continue

    features = module['features']
    total = len(features)
    done = sum(1 for f in features if f['passes'])
    total_all += total
    done_all += done

    pct = int((done / total) * 100) if total > 0 else 0
    bar_fill = int(pct / 5)
    bar = "█" * bar_fill + "░" * (20 - bar_fill)

    status = "✓ DONE" if done == total else f"  {done}/{total}"

    print(f"  [{mod_id}] {module['name']:<30} {bar} {pct:>3}% {status}")

    if module_filter:
        print()
        for f in features:
            icon = "✓" if f['passes'] else "○"
            print(f"      {icon} {f['id']}: {f['description']}")
        print()

if not module_filter:
    print()
    pct_all = int((done_all / total_all) * 100) if total_all > 0 else 0
    print(f"  {'TOTAL':<35} {done_all}/{total_all} features ({pct_all}%)")

print()
print("=" * 60)

# Show current state from progress file
try:
    with open('claude-progress.json') as f:
        progress = json.load(f)
    if progress.get('current_module'):
        print(f"  Current module: {progress['current_module']}")
    if progress.get('last_completed_feature'):
        print(f"  Last completed: {progress['last_completed_feature']}")
    if progress.get('blockers'):
        print(f"  Blockers: {', '.join(progress['blockers'])}")
    print()
except:
    pass
PYTHON_SCRIPT
