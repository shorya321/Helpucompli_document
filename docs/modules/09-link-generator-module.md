# Module 9: Link Generator

**Phase:** 3 (Policy Engine + User Management)
**Priority:** High — distributes documents to external users

---

## Overview

Generates policy-enforced presigned URLs for sharing documents with external users. Tracks link usage, download counts, and access analytics. Links are treated as bearer tokens with security controls.

## Features

### F9.1 — Link Generation Flow
1. Select document from document browser or search
2. Select existing policy or create inline policy
3. Set TTL (15 min to 7 days, default from policy)
4. Set max downloads (from policy or override)
5. Generate presigned URL
6. Copy to clipboard
7. Track in `generated_links` table

### F9.2 — Link Properties
| Property | Source | Description |
|----------|--------|------------|
| Document | User picks | Target document for sharing |
| Policy | User picks or creates | Access restrictions to enforce |
| TTL | From policy or override | Link expiration time |
| Max Downloads | From policy or override | Download limit |
| Presigned URL Hash | System generated | SHA-256 hash of URL for tracking |
| Expires At | System calculated | Absolute expiration timestamp |

### F9.3 — Copy to Clipboard
- One-click copy of generated URL
- Toast notification on copy
- URL displayed in a read-only field

### F9.4 — QR Code Generation
- Optional QR code for generated link
- Download QR as PNG
- Useful for printed materials

### F9.5 — Link Usage Analytics
- **Per link:** Download count, last accessed timestamp, accessing IPs
- **Dashboard view:** Total links generated (time period), most shared documents, active vs expired links
- Data from `generated_links` table + `audit_logs` (action: `LINK_ACCESS`)

### F9.6 — Link Access Endpoint
When an external user clicks a generated link:
1. Request hits `/api/links/[hash]`
2. Look up link in `generated_links` table
3. Check: expired? Download count exceeded?
4. Look up associated policy
5. Enforce policy (IP, domain, auth)
6. If all pass: generate fresh presigned S3 URL → 302 redirect
7. If fail: 403 Forbidden
8. Increment download_count
9. Log in audit table

### F9.7 — Link Revocation
- Admin can manually revoke a generated link before expiration
- Revoked links return 403 on access

### F9.8 — Per-link `allowPublicEmbed` toggle (cross-platform iframe embedding)

A per-link boolean column on `generated_links`. Default `false`. When `true`, the link participates in the oEmbed flow (WordPress Embed block, Notion, Confluence, Iframely-backed Circle, etc.).

**Behavior matrix:**

| `allowPublicEmbed` | `policy.allowedDomains` | Direct browser nav (no Referer) | Browser nav from allowed domain | Browser nav from disallowed domain | iframe load from allowed domain | WordPress server-side oEmbed discovery |
|---|---|---|---|---|---|---|
| `false` | empty | 200 | n/a | n/a | not embeddable (CSP `'none'`) | 404 (no discovery tag) |
| `false` | `['x.com']` | **403** (F9.6 strict) | 200 | 403 | server 403 | 404 |
| `true` | empty | 200 | 200 | 200 | 200 (CSP `https:`) | 200 |
| `true` | `['x.com']` | **403** (browser narrowed by Sec-Fetch-Dest) | 200 (Referer match) | **403** (Referer mismatch) | 200 (Referer match + CSP allows) | 200 (no Sec-Fetch-Dest) |

**Key invariants:**

- `policy.allowedDomains` ALONE is NEVER an embed-enable signal. Embedding requires the explicit `allowPublicEmbed=true` toggle. When `allowPublicEmbed=false`, F9.6 strict enforcement applies regardless of policy contents — Referer / IP / auth gates are NOT bypassed.
- When `allowPublicEmbed=true`, the policy engine's IP + Referer gates are bypassed at the link-access layer (server-side discovery has no Referer; crawler IPs cannot be pre-listed). The browser-layer CSP `frame-ancestors` derived from `policy.allowedDomains` becomes the parent-host gate.
- `policy.requireAuth=true` ALWAYS overrides — embed flow returns 404 to anonymous third-party servers even when `allowPublicEmbed=true`.
- The download counter + `maxDownloads` are skipped on the embed path (each render produces ≥2 viewer hits — server-side discovery + browser iframe load).
- The form surfaces a HIPAA confirm prompt before flipping the toggle on. Every embed call is audited as `LINK_OEMBED_FETCHED`.

**Endpoints:**

| Route | Behavior |
|---|---|
| `GET /l/<hash>` | Viewer HTML. Emits `<link rel="alternate" type="application/json+oembed">` only when `allowPublicEmbed=true`. CSP `frame-ancestors` derived from policy. |
| `GET /api/oembed?url=<viewer>&format=json` | Returns oEmbed JSON (`rich` for everything except `video/*`, which uses `video`). 404 when `allowPublicEmbed=false` or `policy.requireAuth=true`. |

**Implementation note — `Sec-Fetch-Dest` discriminator:**

When `allowPublicEmbed=true` AND `policy.allowedDomains` is non-empty, the policy engine refines its bypass: it inspects the `Sec-Fetch-Dest` request header (W3C Fetch Metadata, sent by all modern browsers since Chrome 76 / Firefox 90 / Safari 16.4). Browser-originated requests (header present) MUST satisfy the Referer-vs-`allowedDomains` check; server-side oEmbed crawlers (header absent) keep bypassing so WordPress / Notion / Confluence discovery still succeeds. This stops a user from opening a domain-pinned public-embed link directly in a Chrome tab — they must reach it via an iframe on one of the listed parent sites. Pre-Sec-Fetch browsers (Safari < 16.4, Firefox < 90, Chrome < 76 — pre-2022 desktop) bypass server-side narrowing but the browser-layer CSP `frame-ancestors` still blocks any iframe attempt.

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/(dashboard)/links/page.tsx` | Link management page |
| `src/components/links/generate-link-form.tsx` | Link generation form |
| `src/components/links/link-table.tsx` | Generated links list |
| `src/components/links/link-analytics.tsx` | Usage analytics |
| `src/components/links/qr-code.tsx` | QR code generator |
| `src/app/api/links/route.ts` | GET (list) + POST (generate) |
| `src/app/api/links/[hash]/route.ts` | GET (access/redirect) + DELETE (revoke) |

## API Endpoints

| Route | Method | Role | Purpose |
|-------|--------|------|---------|
| `/api/links` | GET | admin+ | List all generated links |
| `/api/links` | POST | admin+ | Generate new link |
| `/api/links/[hash]` | GET | public | Access link (policy enforcement + redirect) |
| `/api/links/[hash]` | DELETE | admin+ | Revoke link |
| `/l/[hash]` | GET | public | Embeddable HTML viewer (oEmbed-compatible, dynamic CSP `frame-ancestors`) |
| `/l/[hash]/raw` | GET | public | Same-origin streaming proxy for the viewer's `<img>` / `<video>` / `<audio>` / `<iframe>` |

## Same-origin asset proxy `/l/[hash]/raw`

Every embed element in `/l/[hash]` (image, video, audio, iframe) loads its bytes from `/l/[hash]/raw`, never from the S3 presigned URL directly. The proxy:

- Reuses `resolveAndAuthorizeLink` so policy enforcement, audit, rate-limit, public-embed bypass, and the `Sec-Fetch-Dest` discriminator behave **byte-identically** to the viewer page. F8.7 / F9.3 / F9.8 invariants are preserved unchanged.
- Server-fetches the presigned S3 URL and streams the body back, so the URL never lands in the DOM (no replay risk via DOM inspection).
- Forwards `Range` headers and proxies `206 Partial Content` + `Content-Range` so Chrome's PDF viewer chunk-loads and HTML5 `<video>` seek work.
- Sets `Content-Type` from the document, `Content-Disposition: inline; filename="…"; filename*=UTF-8''…` (RFC 5987), `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.

Why: Chrome's built-in PDF viewer refuses to render PDFs delivered cross-origin inside an iframe ("This page has been blocked by Chrome"). Same-origin delivery sidesteps that and produces uniform behavior across every file type.

## Dependencies

- `qrcode` — QR code generation (optional)

## Acceptance Criteria

- [ ] Links generated with correct TTL and max downloads
- [ ] Copy to clipboard works
- [ ] QR code generates for link
- [ ] Link access enforces policy (TTL, IP, domain, download count)
- [ ] Download count increments on each access
- [ ] Expired links return 403
- [ ] Over-limit links return 403
- [ ] Revoked links return 403
- [ ] Link analytics show usage data
- [ ] Every link access logged in audit trail
