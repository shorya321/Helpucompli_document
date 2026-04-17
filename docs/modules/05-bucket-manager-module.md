# Module 5: Bucket Manager

**Phase:** 2 (Core Features)
**Priority:** High — manages S3 bucket lifecycle

---

## Overview

Admin interface for listing, creating, configuring, and deleting S3 buckets. All buckets are created programmatically with HIPAA settings auto-applied — no manual bucket creation allowed.

## Features

### F5.1 — Bucket List View
- Card grid or list view of all registered buckets
- Each card shows: bucket name, region, document count, storage usage, status (active/inactive), created date
- Sorting: by name, date, document count
- Filtering: by region, status

### F5.2 — Create Bucket
- **Access:** `superadmin` only
- Modal form with fields:
  - Bucket name (validated: lowercase, alphanumeric + hyphens, 3-63 chars)
  - AWS region (dropdown: us-east-1, us-west-2, etc.)
  - Description (optional text)
- **Auto-applied HIPAA settings on creation:**
  - SSE-KMS encryption with customer-managed key
  - Block Public Access (all 4 blocks enabled)
  - Versioning enabled
  - Server Access Logging to logs bucket
  - Bucket policy denying non-HTTPS access
- Bucket registered in PostgreSQL `buckets` table
- Audit log entry: `BUCKET_CREATE`

### F5.3 — Bucket Details
- Click bucket card to view details:
  - Storage metrics (total size, object count)
  - Encryption status
  - Versioning status
  - Access policies applied
  - Recent documents in this bucket

### F5.4 — Delete Bucket
- **Access:** `superadmin` only
- Bucket must be empty (no documents)
- Confirmation dialog: user must type bucket name to confirm
- S3 bucket deleted + PostgreSQL record deactivated
- Audit log entry: `BUCKET_DELETE`

### F5.5 — Bucket Settings
- View and verify HIPAA compliance settings
- Cannot modify security settings (enforced by design)

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/(dashboard)/buckets/page.tsx` | Bucket list page |
| `src/app/(dashboard)/buckets/[id]/page.tsx` | Bucket details page |
| `src/components/buckets/bucket-card.tsx` | Individual bucket card |
| `src/components/buckets/create-bucket-dialog.tsx` | Create bucket modal |
| `src/components/buckets/delete-bucket-dialog.tsx` | Delete confirmation dialog |
| `src/app/api/s3/buckets/route.ts` | GET (list) + POST (create) |
| `src/app/api/s3/buckets/[id]/route.ts` | GET (details) + DELETE |

## API Endpoints

| Route | Method | Role | Purpose |
|-------|--------|------|---------|
| `/api/s3/buckets` | GET | all | List all buckets (filtered by role) |
| `/api/s3/buckets` | POST | superadmin | Create new bucket |
| `/api/s3/buckets/[id]` | GET | all | Get bucket details |
| `/api/s3/buckets/[id]` | DELETE | superadmin | Delete empty bucket |

## Acceptance Criteria

- [ ] All buckets displayed with correct metrics
- [ ] New buckets auto-apply all HIPAA settings
- [ ] Only superadmin can create/delete buckets
- [ ] Delete requires empty bucket + name confirmation
- [ ] Bucket creation logged in audit trail
- [ ] Bucket name validation prevents invalid S3 names
- [ ] Viewer only sees assigned buckets
