# Verify Module

Run type-check, lint, tests, and build for a specific module to confirm it's working.

**Usage:** `/verify-module <module_number>` (e.g., `/verify-module 01`)

## Verification Steps

For module `$ARGUMENTS`, run these checks in order:

### 1. TypeScript Type Check
```bash
npx tsc --noEmit
```
If errors found: report them but continue to next check.

### 2. ESLint
```bash
npx next lint
```
If errors found: report them but continue.

### 3. Unit/Integration Tests
```bash
npx vitest run src/__tests__/<module_name>/ --reporter=verbose
```
Where `<module_name>` maps from the module number (01=auth, 02=database, etc.)

### 4. Build Check
```bash
npm run build
```

### 5. Feature Status
Read `feature_list.json` and show all features for this module with pass/fail status.

## Report Format

After all checks, produce a summary:

```
Module XX Verification Report
─────────────────────────────
TypeScript:  ✓ PASS / ✗ FAIL (N errors)
Lint:        ✓ PASS / ✗ FAIL (N warnings)
Tests:       ✓ PASS / ✗ FAIL (N/M passing)
Build:       ✓ PASS / ✗ FAIL
Features:    N/M complete
─────────────────────────────
Status:      VERIFIED / NEEDS WORK
```

If any check fails, use `build-error-resolver` agent to diagnose and fix.
