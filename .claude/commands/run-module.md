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
   a. **Research first (MANDATORY)** — before writing any code:
      - Identify every external API / SDK / framework / security pattern the feature touches
      - Query **Ref MCP** (`mcp__claude_ai_ref__ref_search_documentation`) for current API signatures + deprecation notices; follow with `ref_read_url` on the top hit
      - Fall back to **Context7** (`/docs` skill or `docs-lookup` agent) → **Exa** (`exa-search` / `deep-research`) → **Firecrawl** (`firecrawl_scrape`) → **SERP** in that order — stop at the first step that answers the question
      - Capture the source (URL or `package@version`) — will be cited in the commit body and `claude-progress.json` session notes
      - Skip ONLY for doc-only edits or pure internal refactors with no new deps / no new API surface
   b. **Write test FIRST** → `src/__tests__/<module>/<feature>.test.ts`
   c. **Run test** → it should FAIL (RED)
   d. **Implement minimal code** to pass (GREEN)
   e. **Run test** → it should PASS
   f. **Refactor** if needed (IMPROVE)
   g. **Run `npm run test`** → verify nothing else broke
   h. **Git commit** → `feat(<module>): <description>` — commit body MUST include `Research:` citations (URL or `package@version`) for each external API touched
   i. **Update `feature_list.json`** → set `passes: true` for this feature
   j. **Update `claude-progress.json`** → record session state AND research sources consulted
   k. **Move to next feature**

## Agent Routing

- Use `tdd-guide` agent for writing tests
- Use `code-reviewer` agent after each feature
- For modules 01, 03, 08, 09, 11: also use `security-reviewer` agent
- For module 02: use `database-reviewer` agent
- For build failures: use `build-error-resolver` agent
- For docs lookup (Auth0, Prisma, AWS): use `docs-lookup` agent

## Rules

- ONE feature at a time — do NOT batch multiple features
- **Research MUST precede code** for any feature touching an external library, SDK, framework API, or security pattern — Ref → Context7 → Exa → Firecrawl → SERP, stop at first answer
- **Cite the Ref/Context7/Exa URL or `library@version`** in the commit message body and in `claude-progress.json` session notes
- Skip research ONLY for doc-only edits or internal refactors with no new deps
- Test MUST pass before marking feature done
- Conventional commits: `feat(<module>): <description>`
- Validate all API input with Zod
- Log all mutations in audit trail via `logAudit()`
- Check user role before operations
- NEVER store secrets in code

Start now. Read progress, read features, read module doc, then implement feature by feature.
