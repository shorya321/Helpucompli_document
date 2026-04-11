# Session Start

Resume work on the HelpUcompli Document Repository. Run this at the start of every new session.

**Usage:** `/session-start`

## Protocol (Anthropic Agent Harness Pattern)

### 1. Verify Working Directory
```bash
pwd
```
Must be `/Volumes/shorya/apps/helpucompli_document`.

### 2. Read Progress State
Read `claude-progress.json` — understand:
- Which module is in progress
- What was the last completed feature
- Any blockers from previous session

### 3. Read Feature List
Read `feature_list.json` — find:
- Total completed vs pending features
- Current module's next incomplete feature

### 4. Check Git State
```bash
git log --oneline -10
git status
```
Understand recent commits and any uncommitted changes.

### 5. Check Dev Server
```bash
curl -s http://localhost:3000/api/health 2>/dev/null || echo "Dev server not running"
```
If not running, start with `npm run dev` in background.

### 6. Run Baseline Tests
```bash
npm run test 2>/dev/null || echo "No tests yet or tests failing"
```

### 7. Report Status
Display:
```
============================================================
  Session Resumed — HelpUcompli Document Repository
============================================================
  Current module:  XX - <name>
  Next feature:    F<X.Y> - <description>
  Progress:        N/56 features (XX%)
  Git:             <branch> — <last commit message>
  Dev server:      ✓ running / ✗ not running
  Tests:           ✓ passing / ✗ N failures
============================================================
```

### 8. Begin Work
Proceed with the next incomplete feature from `feature_list.json`.
Follow TDD: write test → implement → verify → commit → update tracker.
