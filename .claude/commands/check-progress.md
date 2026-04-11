# Check Feature Progress

Show the current implementation progress for all modules (or a specific module).

**Usage:** `/check-progress` or `/check-progress 06`

## Instructions

1. Read `feature_list.json`
2. Read `claude-progress.json`
3. For each module, count features where `passes: true` vs total
4. Display a progress report in this format:

```
============================================================
  HelpUcompli Document Repository — Feature Progress
============================================================

  [01] Authentication & Authorization  ████░░░░░░░░░░░░░░░░  20%  1/5
  [02] Database Schema                 ████████████████████ 100%  3/3 ✓
  ...

  TOTAL                                12/56 features (21%)
============================================================
```

If a module number is provided as argument (`$ARGUMENTS`), also list individual features with their status:
- `✓` for `passes: true`
- `○` for `passes: false`

Also show from `claude-progress.json`:
- Current module being worked on
- Last completed feature
- Any blockers
- Session count
