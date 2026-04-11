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
