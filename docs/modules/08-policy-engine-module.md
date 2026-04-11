# Module 8: Policy Engine

**Phase:** 3 (Policy Engine + User Management)
**Priority:** High — core differentiator of the platform

---

## Overview

Visual, no-code interface for defining access restrictions on documents shared from S3. Policies are stored in PostgreSQL and enforced at the API layer when presigned URLs are generated or embedded content is accessed.

## Features

### F8.1 — Visual Policy Builder
Form-based UI with live preview showing how the policy will behave.

**Policy Properties:**

| Property | Type | Description |
|----------|------|------------|
| Name | String | Human-readable policy name |
| Target Type | Enum | `bucket`, `prefix` (folder), or `object` (specific file) |
| Target Value | String | Bucket name, folder prefix, or S3 object key |
| Allowed Domains | String[] | Domains where content can be embedded (checked via HTTP Referer) |
| Allowed IP Ranges | String[] | CIDR ranges permitted to access (e.g., `192.168.1.0/24`) |
| Link Expiration | Int | TTL in seconds. Options: 900 (15 min), 3600 (1 hr), 86400 (24 hr), 604800 (7 days), custom |
| Max Downloads | Int | Max times a link can be used before invalidation |
| Require Authentication | Boolean | If true, presigned URL also requires valid Auth0 session |

### F8.2 — Policy CRUD
- **Create:** Form with all properties, validation via Zod
- **Read:** List all policies with target info and restriction summary
- **Update:** Edit existing policy (creates audit log entry)
- **Delete:** Remove policy (creates audit log entry)

### F8.3 — Policy Inheritance
- Object-level policy takes precedence over prefix-level
- Prefix-level policy takes precedence over bucket-level
- If no policy exists, default settings apply (15 min TTL, no IP/domain restriction)

### F8.4 — Policy Enforcement Flow
```
Request for document
  → API receives document ID + auth token
    → Look up policy (object → prefix → bucket → default)
      → Check: Authenticated? (if require_auth)
      → Check: IP in allowed range? (if allowed_ip_ranges set)
      → Check: Referrer in allowed domains? (if allowed_domains set)
        → ALL PASS: Generate presigned S3 URL with policy TTL → return
        → ANY FAIL: Return 403 Forbidden (generic error, no info leak)
      → Log result in audit table (pass or fail)
```

### F8.5 — Domain Allowlist Input
- Add domains one by one (e.g., `example.com`, `*.example.com`)
- Wildcard subdomain support
- Validation: must be valid domain format
- Visual chips/tags for each added domain

### F8.6 — IP Range Input
- CIDR notation input with validation
- Support single IPs (e.g., `1.2.3.4/32`) and ranges (e.g., `10.0.0.0/8`)
- Visual chips/tags for each added range

### F8.7 — Live Policy Preview
- Shows a summary panel:
  - "This policy applies to: [target description]"
  - "Links expire after: [TTL]"
  - "Max downloads: [count or unlimited]"
  - "IP restriction: [ranges or none]"
  - "Domain restriction: [domains or none]"
  - "Auth required: [yes/no]"

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/(dashboard)/policies/page.tsx` | Policy list page |
| `src/app/(dashboard)/policies/new/page.tsx` | Create policy page |
| `src/app/(dashboard)/policies/[id]/page.tsx` | Edit policy page |
| `src/components/policies/policy-form.tsx` | Policy builder form |
| `src/components/policies/policy-preview.tsx` | Live preview panel |
| `src/components/policies/domain-input.tsx` | Domain allowlist input |
| `src/components/policies/ip-range-input.tsx` | CIDR range input |
| `src/components/policies/target-picker.tsx` | Bucket/folder/object picker |
| `src/lib/policy-engine.ts` | Policy lookup + enforcement logic |
| `src/app/api/policies/route.ts` | GET (list) + POST (create) |
| `src/app/api/policies/[id]/route.ts` | GET + PUT + DELETE |

## API Endpoints

| Route | Method | Role | Purpose |
|-------|--------|------|---------|
| `/api/policies` | GET | admin+ | List all policies |
| `/api/policies` | POST | admin+ | Create new policy |
| `/api/policies/[id]` | GET | admin+ | Get policy details |
| `/api/policies/[id]` | PUT | admin+ | Update policy |
| `/api/policies/[id]` | DELETE | admin+ | Delete policy |

## Acceptance Criteria

- [ ] Policies can be created with all properties
- [ ] Policy inheritance works (object > prefix > bucket)
- [ ] IP range validation rejects invalid CIDR notation
- [ ] Domain input validates domain format
- [ ] Live preview updates as form changes
- [ ] Policy enforcement blocks disallowed IPs
- [ ] Policy enforcement blocks disallowed referrer domains
- [ ] Auth-required policies reject unauthenticated requests
- [ ] Every enforcement decision logged in audit trail
- [ ] 403 response gives no information about which check failed
