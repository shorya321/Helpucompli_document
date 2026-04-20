# Admin User Guide

How to operate the HelpUcompli Document Repository as a superadmin or admin. For developer-facing API reference see `docs/API-REFERENCE.md`. For HIPAA + security procedures see `docs/HIPAA-COMPLIANCE-CHECKLIST.md` and `docs/INCIDENT-RESPONSE-PLAN.md`.

---

## Roles

| Role | Can |
|------|-----|
| **superadmin** | Create buckets, delete buckets, create/disable users, assign any role, full document + audit access. Cannot demote the last active superadmin. |
| **admin** | Create/edit documents + policies + links, invite viewers (cannot invite admin/superadmin), manage viewer bucket access, read audit logs. |
| **viewer** | Read-only on bucket contents assigned to them. Can generate links only if explicitly permitted by policy. No access to audit or user management. |

Role changes go through Auth0 — sign out + sign back in after promotion for updated claims.

---

## Dashboard

- **/dashboard** — recent activity + bucket stats + last-login summary.
- **/buckets** — bucket list (superadmin sees all, viewer sees assigned).
- **/documents/<bucketId>** — document browser per bucket.
- **/policies** — link policy catalog.
- **/links** — generated link history + revoke.
- **/users** — user management (admin + superadmin).
- **/audit** — audit log query with filters.

---

## Common operations

### Create a bucket

1. Navigate to `/buckets` → **Create bucket**.
2. Enter name (lowercase, dashes; auto-prefixed `helpucompli-docs-`).
3. Select AWS region.
4. Optional description.
5. Submit — SSE-KMS + TLS-only + Block Public Access + versioning applied automatically. Audit row `BUCKET_CREATE` recorded.

### Upload a document

1. Open a bucket → **Upload**.
2. Drag-drop or select files. Multi-part for > 5 MB.
3. Tags + folder path optional.
4. Uploaded via presigned PUT direct to S3 — server never holds the bytes. Upload-receipt verified before DB row insert.

### Generate a share link

1. Select a document → **Generate link**.
2. Pick policy (or accept inherited policy).
3. Optional overrides: TTL (15–604800 s), max downloads, allowed domains / IP CIDR.
4. Copy URL. Recipients resolve at `/api/links/<token>` → 302 to presigned S3 URL if policy permits.
5. Audit row `LINK_CREATE`, then `LINK_ACCESS` per use.

### Invite a user

1. `/users` → **Invite user**.
2. Enter email + name + role (admin can only invite viewer).
3. Submit — Auth0 user created + password-change ticket generated + invite email via Resend.
4. Fallback: if tenant SMTP unconfigured, the response surfaces the activation URL — email it manually.

### Disable a user

1. `/users` → target row → **Disable**.
2. Confirmation prompt.
3. Auth0 blocks the user + local `User.status = disabled` + audit row.
4. NOTE: existing session cookies remain valid until their 8-hour absolute cap. For immediate logout, rotate `AUTH0_SECRET` (see `docs/INCIDENT-RESPONSE-PLAN.md` §3.2).

### Filter audit logs + export

1. `/audit` — filter by actor, action, target type, date range.
2. Paginated 25 per page.
3. **Export CSV** — downloads current filter. Retention 6 years (§164.316(b)(2)(i)).

### Change bucket access (viewer)

1. `/users/<id>` → **Bucket access**.
2. Tick/untick buckets → Save.
3. Takes effect immediately on next request — access derived server-side via `user_bucket_access` join.

---

## Troubleshooting

| Symptom | First check |
|---------|-------------|
| Invite email not received | Verify Resend domain verified + `RESEND_API_KEY`; fallback surfaces ticket URL in 201 response body. |
| Link returns 403 | Inspect link policy (IP CIDR / domain referer / TTL). Audit row `LINK_ACCESS_DENIED` has reason. |
| Upload fails silently | Browser CSP may be blocking S3 PUT — confirm `connect-src` includes `https://*.s3.<region>.amazonaws.com`. Logged server-side as `DOCUMENT_UPLOAD_ABORT`. |
| 403 on bucket list | Viewer has no `user_bucket_access` assignments. Assign via `/users/<id>`. |
| Rate-limited 429 | `Retry-After` header gives seconds to wait. Limits in `docs/modules/11-security-hipaa-module.md`. |

Escalation: `#ops` Slack + `security@helpucompli.com` per `docs/INCIDENT-RESPONSE-PLAN.md`.
