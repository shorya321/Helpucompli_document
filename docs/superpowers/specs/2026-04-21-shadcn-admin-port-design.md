# Spec: Port satnaing/shadcn-admin chrome + primitives

**Status:** Draft
**Owner:** dotcomharman@gmail.com
**Target:** `docs.helpucompli.com` (Next.js 16 App Router)
**Reference:** <https://shadcn-admin.netlify.app> · <https://github.com/satnaing/shadcn-admin> (v2.2.1)
**Follows:** previous design-system migration (Phases A–D, commits `c028bce` → `0728339`).

## Context

The dashboard was migrated to shadcn monochrome + dark mode in the prior PR series. That shipped the token system, shell, and per-module restyling. The user wants the next layer: adopt satnaing/shadcn-admin's chrome and pattern library so the app feels visually equivalent to that template (sidebar with grouped nav, rich header, command palette, data-table primitives, settings sub-router, illustrated error pages, polish details), while keeping every existing HIPAA feature (Auth0 session, S3 buckets, documents, policies, audit, links) working unchanged.

Scope was confirmed with the user:

- **Port scope:** chrome + primitives only. No kanban, chat, apps, or auth screens.
- **Palette:** hybrid — zinc neutral scale kept from the previous redesign, but adopt the reference's floating-card surface in dark mode (`--card` slightly lighter than `--background`) and translucent white borders on dark.
- **Add-ons:** settings sub-router, breadcrumbs + TopNav, top loading bar, illustrated error pages — all opted in.

## Goals

1. Visual parity with the reference template's chrome: grouped sidebar, collapsible subgroups, badge support, NavUser footer, header with Search + ThemeSwitch + ConfigDrawer + ProfileDropdown, frosted scroll effect.
2. A global Command palette (Ctrl/Cmd+K) that lets users jump between dashboard routes, switch theme, and trigger common actions.
3. A reusable TanStack Table primitives folder mirroring the reference's `components/data-table/*`, applied to our existing Documents / Users / Audit / Links tables.
4. A Settings sub-router with Profile / Account / Appearance / Display / Notifications panels.
5. Top loading bar on route transitions.
6. Illustrated error pages for 401 / 403 / 404 / 500 / 503.

## Non-goals

- No changes to server logic, API routes, Prisma schemas, Auth0 flows, S3 operations, audit logging, or Zod contracts.
- No new domain features (no tasks kanban, chats, apps tiles, team switcher, or multi-tenant).
- No change to where brand colours live: `BRAND.colors` still scoped to `src/lib/email.ts` and `src/lib/auth0-branding.ts` only.
- No `dark:` Tailwind variants in components (theme flip continues to happen purely via token remap in `globals.css`).

## Hard constraints

- Single-source-of-truth stays: every color / radius / font token lives only in `src/app/globals.css`. Guard is already enforced by ESLint `no-restricted-syntax` + `scripts/lint-tokens.mjs` (strict after Phase D).
- Each phase is an independently mergeable PR.
- After every phase: `npm run typecheck` + `npm run test` + `node scripts/lint-tokens.mjs` all green.
- No mass refactors beyond what each phase needs. No unrelated cleanup.
- No server-component → client-component conversion unless the new chrome requires it (topbar + command palette + NavUser are already client).

## Architecture

### Palette delta (E1 only)

`src/app/globals.css`:

- Light mode: unchanged.
- Dark mode: `--card` bumps from `oklch(0.21 0.006 285.885)` to a slightly lighter surface so cards float above `--background`. `--popover` matches `--card`. `--border` becomes `oklch(1 0 0 / 10%)` (already is — keep). `--input` stays `oklch(1 0 0 / 15%)`.
- Hue remains zinc (285–286). We do not adopt the reference's blue hue (264).

### Layout shell (E1)

**Sidebar** — reshape `src/components/layout/sidebar.tsx`:

- Source of truth for nav becomes `src/lib/dashboard-nav.ts` (already exists) plus a new `src/lib/sidebar-groups.ts` file that groups nav items into `{ title, items }` sections ("Workspace" / "Management" / "Account"). Role-filtered exactly like today.
- New `NavGroup` component in `src/components/layout/nav-group.tsx` renders one `SidebarGroupLabel` + `SidebarMenu`. Supports:
  - `items[].badge?: string | number` for counts (e.g. pending-review count on Audit).
  - `items[].children?: NavItem[]` for collapsible subsections — rendered as `SidebarMenuSub` when expanded, as a hover-dropdown (`DropdownMenu`) when sidebar is collapsed to icon-only.
- Header keeps `BrandLogo`; footer replaces the current ModeToggle with a new `NavUser` block (see below).

**NavUser** — new `src/components/layout/nav-user.tsx`:

- Avatar + displayName + email, trailing ChevronsUpDown icon.
- Clicking opens a right-side `DropdownMenu` with: Account, Billing (placeholder — link to settings), Notifications, Separator, Sign out (destructive variant via `text-destructive focus:bg-destructive/10`).
- The ModeToggle moves into the header (per reference pattern).

**Topbar** — rework `src/components/layout/topbar.tsx`:

- Pattern: `SidebarTrigger` → vertical `Separator` → `<Search />` (Command palette trigger; `me-auto` to push the rest right) → `<ThemeSwitch />` (current ModeToggle, renamed) → `<ConfigDrawer />` (sidebar variant / font picker) → `<ProfileDropdown />` (or reuse NavUser).
- Scroll-aware: add a `useScrolled(threshold=10)` hook. When scrolled, header gets `shadow-sm` + `bg-background/20 backdrop-blur-lg` via conditional classes.
- Sticky `top-0 z-20 h-14`.

**Global polish CSS** — append to `src/app/globals.css`:

- `button:not(:disabled) { cursor: pointer }`
- `::-webkit-scrollbar { width: 8px; height: 8px }`, `scrollbar-width: thin; scrollbar-color: var(--border) transparent`.
- `@media (max-width: 767px) { input, select, textarea { font-size: 16px } }` (iOS Safari zoom fix).
- `@utility no-scrollbar { scrollbar-width: none; &::-webkit-scrollbar { display: none } }`.
- `@utility faded-bottom { &::after { content: ''; pointer-events: none; position: absolute; inset-inline: 0; bottom: 0; height: 8rem; background: linear-gradient(180deg, transparent, var(--background)) } }`.
- `@keyframes collapsible-down / collapsible-up` at 300ms ease-out (Radix collapsible data-state driven).

### Navigation extras (E2)

- `src/components/layout/breadcrumbs.tsx` — reads `usePathname()`, splits on `/`, maps segment → label via a small lookup table colocated in the file (or derived from `dashboard-nav.ts`). Renders a shadcn Breadcrumb component (install if not present).
- `src/components/layout/top-nav.tsx` — horizontal tabbed nav for deep pages. Accepts `links: { href, label, isActive? }[]`. Used on `/buckets/[id]` initially.
- `src/app/(dashboard)/buckets/[id]/page.tsx` gets a `<TopNav links={...}>` beneath the existing header, with tabs: Overview / Policies / Compliance / Documents. These map to anchors / query-string tabs on the existing page (no new routes yet).
- `react-top-loading-bar@3` (or `nprogress` via `nextjs-toploader@3`) added. Wired via a `src/components/layout/top-loader.tsx` client component mounted in the root layout. Tracks `useRouter` events / App Router `loading.tsx`.

### Command palette (E3)

- Install `cmdk@1`. shadcn `Command` is already present from Phase A.
- `src/components/layout/command-menu.tsx` — client component; `CommandDialog` wraps `CommandInput` + `CommandList` with sections:
  - **Navigation** — every role-allowed nav item from `DASHBOARD_NAV_ITEMS`, with its Lucide icon.
  - **Theme** — Light / Dark / System.
  - **Quick actions** — role-gated: Create bucket (superadmin), Upload document (admin/superadmin), Generate link (all roles on active bucket), Invite user (superadmin). Each triggers a `router.push()` to the corresponding route with `?new=1`.
- Global listener for `meta+k` / `ctrl+k` opens the dialog. `Escape` closes.
- Search input in topbar becomes a `<Button variant="outline" onClick={openCommand}>` styled as a fake search box with placeholder "Search…" + a `kbd ⌘K` hint on the right.
- `SearchProvider` context in `src/app/(dashboard)/layout.tsx` exposes `open` state to both trigger and dialog.

### Settings sub-router (E4)

- New route: `/settings` under `src/app/(dashboard)/settings/`.
- `settings/layout.tsx` — renders a left vertical nav using `Sidebar`-style tokens, tabs by `pathname`.
- Sub-routes (each server-component page rendering a client form):
  - `/settings/profile` — display name + email (read-only from Auth0 session), avatar (read-only for now — upload deferred).
  - `/settings/account` — timezone, date format, language select. Persists to `User` row via a new Zod-validated PATCH `/api/users/:id/preferences` (thin endpoint; needs a Prisma field `preferences Json?` — skipped if we avoid schema changes, see open questions).
  - `/settings/appearance` — theme picker (light/dark/system — wraps next-themes), font picker (Inter / JetBrains Mono / Manrope — writes to `localStorage` + applies `document.documentElement.style.setProperty('--font-sans', ...)`; client-only, not persisted server-side).
  - `/settings/display` — feature-toggle checkboxes that persist to `localStorage` (density, show-role-badges, etc.).
  - `/settings/notifications` — email-notification prefs. Defers to backend — UI only in this spec.
- Forms use `react-hook-form` (already installed) + `zodResolver` + shadcn Form components.

**Open question (settings):** do we add a `User.preferences Json?` Prisma column for server-side persistence, or restrict Settings to localStorage-only for this PR? See Open Questions.

### Data-table primitives (E5)

- New folder `src/components/data-table/` mirroring the reference:
  - `data-table.tsx` — typed wrapper around `useReactTable` + rendering.
  - `data-table-column-header.tsx` — sortable column header with Lucide `ChevronUp/Down/ChevronsUpDown` affordance + dropdown for sort/hide.
  - `data-table-pagination.tsx` — rows-per-page select + page counter + first/prev/next/last buttons.
  - `data-table-toolbar.tsx` — search input + faceted filter buttons + reset-filters.
  - `data-table-faceted-filter.tsx` — shadcn `Popover` + `Command` with multi-select checkbox list.
  - `data-table-view-options.tsx` — column visibility `DropdownMenu`.
  - `data-table-bulk-actions.tsx` — visible when rows selected, shows count + actions.
- `@tanstack/react-table@8` already installed.
- Retrofit (no new routes):
  - `src/components/users/user-table.tsx` — replace the current simple table with `DataTable<User>` + role-filter facet + status-filter facet + bulk-disable action.
  - `src/components/audit/audit-table.tsx` — add action-filter facet (select from all `AuditAction`s), target-type facet, user facet. Bulk actions: export selected to CSV.
  - `src/components/documents/file-list.tsx` — switch to `DataTable<Document>` on the list view (keep grid view as an alt render); filters for content-type + bucket.
  - `src/components/links/link-table.tsx` — status facet (active / expired / revoked), bucket facet.

### Illustrated error pages (E5)

- New route group `src/app/(errors)/` with layout wrapping each page in a full-viewport shell.
- Pages: `/errors/401`, `/errors/403`, `/errors/404`, `/errors/500`, `/errors/503` (each a server page).
- Shared component `src/components/layout/error-illustration.tsx` renders: large Lucide icon (unique per status — `Lock`, `Ban`, `Search`, `ServerCrash`, `PlugZap`), status code, title, description, primary action button.
- Existing `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx` get rewritten to render `ErrorIllustration` with the matching status. `src/app/(auth)/access-denied/page.tsx` rewrites to `ErrorIllustration status="403"` while keeping the existing `BRAND.name` mention + force-dynamic + mailto admin link.

## Data flow

No changes to data flow. All new components are presentational wrappers around existing Auth0 session, Prisma queries, and API routes.

- Command palette navigation fires `router.push()` — same as clicking a sidebar item today.
- Settings forms POST/PATCH to existing user endpoints (or just localStorage where marked).
- Data-table toolbar filter state lives in URL search params via `nuqs` or `useSearchParams()` (decision deferred — see Open Questions) so filters survive reload and are shareable.

## Error handling

- Command palette: if a role-gated quick action is selected by a user who lacks role (defensive — we hide them at render time too), the server route still 403s.
- Data-table filters: invalid URL param values are ignored and state falls back to default.
- TopLoader: errors in a route do not leave the loader pinned — mount a cleanup effect that finishes the bar on `router.events.routeChangeError` (App Router equivalent: `useRouter` subscribe to `router.push` promise rejection).
- Settings forms: server errors surface via `text-destructive` under the field + a sonner toast.

## Testing

- Unit tests (vitest):
  - `breadcrumbs.test.tsx` — verify segment → label mapping for known routes.
  - `nav-user.test.tsx` — renders email, opens dropdown, sign-out link uses plain `<a>` (Auth0 proxy flow).
  - `command-menu.test.tsx` — meta+k opens, escape closes, navigation items match role, selecting an item triggers router.push mock.
  - `data-table.test.tsx` — renders rows, sorting triggers column state change, faceted filter narrows rows, bulk action fires with selected row ids.
  - `top-nav.test.tsx` — active tab detection via pathname mock.
  - Existing `sidebar.test.tsx` adjusted for new NavGroup DOM shape.
- Integration / E2E (Playwright, optional for this spec):
  - Cmd+K opens palette, type "buckets", Enter → URL is `/buckets`.
  - Dark mode toggle from ThemeSwitch persists across reload.
  - Data-table faceted filter on Users narrows visible rows and updates URL.
- Gates after every phase: `npm run typecheck`, `npm run test`, `node scripts/lint-tokens.mjs`.

## Rollout plan (5 PRs)

| Phase | PR title                                                                        | Est. |
| ----- | ------------------------------------------------------------------------------- | ---- |
| E1    | `feat(design-system): Phase E1 — sidebar groups + rich header + NavUser`        | 2 h  |
| E2    | `feat(design-system): Phase E2 — breadcrumbs + TopNav + top loading bar`        | 1 h  |
| E3    | `feat(design-system): Phase E3 — global command palette (Ctrl/Cmd+K)`           | 1.5h |
| E4    | `feat(design-system): Phase E4 — settings sub-router (profile/appearance/…)`    | 3 h  |
| E5    | `feat(design-system): Phase E5 — data-table primitives + illustrated errors`    | 5–7h |

Every phase flagged-out behind a feature flag is **not** required — phases are additive and each ends in a green build. User can stop after any phase.

## Open questions

1. **Server persistence for Settings (E4).** Three options:
   - (a) localStorage only — zero schema changes, fastest, but settings don't follow user across devices.
   - (b) Add `User.preferences Json?` Prisma column + thin `/api/users/me/preferences` endpoint. Requires a migration.
   - (c) Defer server persistence to a later PR — ship E4 as UI-only on localStorage.
   Recommend (c) for this spec; revisit after E4 lands.
2. **Data-table filter state — URL params vs client state (E5).** Reference uses TanStack Router `useSearch()` for typed params. Options:
   - (a) Use `useSearchParams()` + manual serialisation. Works, no new dep.
   - (b) Add `nuqs` for typed search-param state management.
   Recommend (a) — no new dep, matches the existing `/buckets` filter form pattern.
3. **Font picker persistence (E4 Appearance).** localStorage only for this spec; revisit if users want it to follow their session.
4. **Top loader library.** `nextjs-toploader` vs `react-top-loading-bar`. Recommend `nextjs-toploader` — App-Router-native, no event wiring needed.
5. **Breadcrumb source of truth.** Map inline in `breadcrumbs.tsx` vs extend `DASHBOARD_NAV_ITEMS`. Recommend inline — keeps `dashboard-nav.ts` a single-responsibility role-filter config.

## Verification checklist (run after each phase)

- [ ] `npm run typecheck` clean.
- [ ] `npm run test` full suite passes (baseline 1450 tests; new tests pushed with each phase).
- [ ] `node scripts/lint-tokens.mjs`: single-source-of-truth fully enforced.
- [ ] `npx eslint src/components src/app/\(dashboard\)`: 0 `no-restricted-syntax` violations.
- [ ] Manual browser: dashboard renders, dark mode flip works, new chrome is visible, Ctrl/Cmd+K opens palette (from E3 onward), every dashboard module still loads and lets role-appropriate mutations succeed.
- [ ] HIPAA integrity check (after E5): Auth0 login → role guard → S3 upload → audit row written → presigned link works → no regression vs pre-redesign baseline.

## Critical files

**Added:**

- `src/components/layout/nav-group.tsx`
- `src/components/layout/nav-user.tsx`
- `src/components/layout/breadcrumbs.tsx`
- `src/components/layout/top-nav.tsx`
- `src/components/layout/top-loader.tsx`
- `src/components/layout/command-menu.tsx`
- `src/components/layout/search-provider.tsx`
- `src/components/layout/config-drawer.tsx`
- `src/components/layout/error-illustration.tsx`
- `src/components/data-table/data-table.tsx`
- `src/components/data-table/data-table-column-header.tsx`
- `src/components/data-table/data-table-pagination.tsx`
- `src/components/data-table/data-table-toolbar.tsx`
- `src/components/data-table/data-table-faceted-filter.tsx`
- `src/components/data-table/data-table-view-options.tsx`
- `src/components/data-table/data-table-bulk-actions.tsx`
- `src/lib/sidebar-groups.ts`
- `src/hooks/use-scrolled.ts`
- `src/app/(dashboard)/settings/layout.tsx` + 5 sub-route pages
- `src/app/(errors)/layout.tsx` + 5 status pages

**Modified:**

- `src/app/globals.css` — palette tweak (E1), polish utilities (E1).
- `src/app/(dashboard)/layout.tsx` — wrap in `SearchProvider`, add `TopLoader`.
- `src/components/layout/sidebar.tsx` — switch to `NavGroup` + `NavUser`, move ModeToggle out.
- `src/components/layout/topbar.tsx` — add Search trigger, ConfigDrawer, ThemeSwitch, ProfileDropdown, frosted scroll via `use-scrolled`.
- `src/app/(dashboard)/buckets/[id]/page.tsx` — add `<TopNav>` (E2).
- `src/components/users/user-table.tsx` — switch to `DataTable` (E5).
- `src/components/audit/audit-table.tsx` — switch to `DataTable` (E5).
- `src/components/documents/file-list.tsx` — add `DataTable` list render (E5).
- `src/components/links/link-table.tsx` — switch to `DataTable` (E5).
- `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx`, `(auth)/access-denied/page.tsx` — render `ErrorIllustration` (E5).

**Untouched:**

- `src/lib/brand.ts`, `src/lib/email.ts`, `src/lib/auth0-branding.ts`
- `src/lib/prisma.ts`, `src/lib/auth0.ts`, `src/lib/audit.ts`, `src/lib/s3.ts`, `src/lib/iam-policies.ts`
- Every API route under `src/app/api/**`
- Every Zod schema, route handler, server action
