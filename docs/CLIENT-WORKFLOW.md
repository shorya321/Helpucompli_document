# HelpUcompli Document Repository — Superadmin Workflow

Plain-language walkthrough for the superadmin who runs the document repository. For API details see `API-REFERENCE.md`. For full admin reference see `ADMIN-GUIDE.md`.

---

## What the superadmin owns

- The entire workspace at `https://docs.helpucompli.com`.
- All buckets (top-level folders that hold documents).
- All users and their roles.
- All policies, share links, and the full audit log.
- Compliance posture — HIPAA encryption, retention, access reviews.

---

## The superadmin workflow

```
1. Sign in  →  2. Create a bucket  →  3. Upload documents
                                              ↓
6. Audit    ←  5. Share via link   ←  4. Set a policy
```

### Step 1 — Sign in

1. Open `https://docs.helpucompli.com`.
2. Log in with work email. MFA is required for superadmin.
3. Session lasts 30 minutes idle, 8 hours absolute.

### Step 2 — Create a bucket

A bucket is a top-level folder. One per client or per category is typical.

1. **Buckets** → **Create bucket**.
2. Enter a name (lowercase, dashes — e.g. `client-acme`). System prefixes `helpucompli-docs-` automatically.
3. Pick an AWS region.
4. Submit. Encryption, versioning, and public-access blocks are applied automatically.

### Step 3 — Upload documents

1. Open the bucket → **Upload**.
2. Drag files or click to browse. Multi-file OK. Large files resume on drop.
3. Optional tags and folder path.
4. Wait for green checkmark.

> Never put PHI (patient names, MRNs) in file names, tags, or folder paths. Keep PHI inside the encrypted file contents only.

### Step 4 — Set a policy

A policy controls who can open a document and for how long. Policies can attach to a bucket, a folder, or an individual document. Most specific wins.

1. **Policies** → **Create policy**.
2. Pick rules:
   - Require login (recipient must authenticate).
   - Allowed email domains or IP ranges.
   - Link TTL (15 min – 7 days).
   - Max download count.
3. Attach to a bucket, folder, or document.

No policy set → bucket default applies → `linkDefaultPolicy` applies.

### Step 5 — Share via link

1. Select a document → **Generate link**.
2. Banner shows the effective policy (inherited or override).
3. Optional overrides on this link: shorter TTL, fewer downloads, tighter IP range.
4. **Copy link**. Paste into email or secure channel.
5. Recipient clicks → system checks policy → serves file or returns 403.

Revoke: **Links** page → find link → **Revoke**. Immediate.

### Step 6 — Audit

Every action is logged. Append-only. 6-year retention per HIPAA §164.316.

1. **Audit** in sidebar.
2. Filter by user, action, target type, date range.
3. **Export CSV** for compliance reports.
4. Watch for: `LINK_ACCESS_DENIED`, `DOCUMENT_DELETE`, failed logins, role changes.

---

## Governance routines

| Cadence | Task |
|---------|------|
| Daily | Scan audit for denied access + unusual download bursts |
| Weekly | Review new user invites and role assignments |
| Monthly | Remove ex-employees. Review bucket access matrix |
| Quarterly | Export audit log to compliance archive. Rotate `AUTH0_SECRET` |
| Yearly | HIPAA Security Rule review. Confirm AWS BAA active. Key rotation check |

---

## High-trust actions (superadmin only)

| Action | Where | Safety |
|--------|-------|--------|
| Delete a bucket | Buckets → Details → **Delete** | Must be empty. Type bucket name to confirm |
| Delete a document | Document row → **Delete** | Versioned — 30 days recoverable |
| Disable a user | Users → row → **Disable** | Signs them out within 8 hours (sooner on secret rotation) |
| Promote to superadmin | Users → row → Role | Cannot demote the last active superadmin |
| Revoke all links by a user | Links → filter by creator → **Revoke selected** | Use after employee offboarding |

---

## Incident response quick reference

| Symptom | First action |
|---------|--------------|
| Suspected credential leak | Disable user + rotate `AUTH0_SECRET` (ends all sessions) |
| Data exfiltration suspected | Revoke all active links + export audit for window |
| Lost superadmin access | Recover via Auth0 tenant admin console |
| S3 public-access alert | Check bucket policy in AWS console + audit `BUCKET_*` rows |

Escalation: `security@helpucompli.com` + `#ops` Slack. Full procedure in `INCIDENT-RESPONSE-PLAN.md`.

---

## Compliance assurances

- AWS Business Associate Agreement (BAA) in place.
- SSE-KMS encryption at rest on every bucket.
- TLS 1.2+ enforced in transit.
- MFA mandatory for superadmin.
- Audit log append-only, 6-year retention.
- File contents are opaque to the system — never parsed or indexed.

---

## Support

- Helpdesk: `support@helpucompli.com`
- Security: `security@helpucompli.com`
- Status: `status.helpucompli.com`
