# Run Module Implementation

Implement the specified module of the HelpUcompli Document Repository.

**Usage:** `/run-module <module_number>` (e.g., `/run-module 01`)

## Module Map

| # | Module | Phase |
|---|--------|-------|
| 01 | Authentication & Authorization | 1 |
| 02 | Database Schema | 1 |
| 03 | AWS S3 Integration | 1 |
| 04 | Dashboard Home | 2 |
| 05 | Bucket Manager | 2 |
| 06 | Document Browser | 2 |
| 07 | Audit Logging | 2 |
| 08 | Policy Engine | 3 |
| 09 | Link Generator | 3 |
| 10 | User Management | 3 |
| 11 | Security & HIPAA | 4 |
| 12 | Testing & Launch | 4 |

## Session Protocol

Follow this EXACT sequence for module `$ARGUMENTS`:

1. Read `claude-progress.json` — understand what was done before
2. Read `feature_list.json` — filter features for this module, find first `passes: false`
3. Read `docs/modules/<module_number>-*-module.md` — understand the full spec
4. For EACH feature (one at a time):
   a. **Write test FIRST** → `src/__tests__/<module>/<feature>.test.ts`
   b. **Run test** → it should FAIL (RED)
   c. **Implement minimal code** to pass (GREEN)
   d. **Run test** → it should PASS
   e. **Refactor** if needed (IMPROVE)
   f. **Run `npm run test`** → verify nothing else broke
   g. **Git commit** → `feat(<module>): <description>`
   h. **Update `feature_list.json`** → set `passes: true` for this feature
   i. **Update `claude-progress.json`** → record session state
   j. **Move to next feature**

## Agent Routing

- Use `tdd-guide` agent for writing tests
- Use `code-reviewer` agent after each feature
- For modules 01, 03, 08, 09, 11: also use `security-reviewer` agent
- For module 02: use `database-reviewer` agent
- For build failures: use `build-error-resolver` agent
- For docs lookup (Auth0, Prisma, AWS): use `docs-lookup` agent

## Rules

- ONE feature at a time — do NOT batch multiple features
- Test MUST pass before marking feature done
- Conventional commits: `feat(<module>): <description>`
- Validate all API input with Zod
- Log all mutations in audit trail via `logAudit()`
- Check user role before operations
- NEVER store secrets in code

Start now. Read progress, read features, read module doc, then implement feature by feature.
