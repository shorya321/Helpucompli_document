# Module 3: AWS S3 Integration

**Phase:** 1 (Foundation)
**Priority:** Critical — core storage layer

---

## Overview

AWS S3 serves as the document storage backend. All buckets are configured with HIPAA-mandatory settings. The application uses IAM role-based authentication with least-privilege permissions. No long-lived access keys in production.

## Features

### F3.1 — S3 Client Configuration
- AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- IAM role-based auth (dedicated role: `helpucompli-docs-app-role`)
- SSE-KMS encryption on all operations
- Client singleton pattern

### F3.2 — HIPAA-Mandatory S3 Settings (Auto-Applied on Bucket Creation)
| Setting | Configuration |
|---------|--------------|
| Encryption at Rest | SSE-KMS with customer-managed key |
| Encryption in Transit | Bucket policy denying `aws:SecureTransport = false` |
| Block Public Access | All four public access blocks enabled |
| Versioning | Enabled on all document buckets |
| Server Access Logging | Enabled, targeting dedicated logs bucket |
| CloudTrail Data Events | Logs every GetObject, PutObject, DeleteObject |

### F3.3 — Presigned URL Generation
- **Upload (PUT):** Generate presigned PUT URL for direct browser-to-S3 upload
- **Download (GET):** Generate presigned GET URL with configurable TTL
- TTL range: 15 minutes to 7 days
- URLs are bearer tokens — treated as secrets

### F3.4 — S3 Operations
- `ListObjectsV2` — browse bucket contents with prefix
- `PutObject` (via presigned URL) — upload documents
- `GetObject` (via presigned URL) — download documents
- `CopyObject` — copy/move documents between buckets or folders
- `DeleteObject` — soft delete (versioning retains object)
- `DeleteObjects` — bulk operations
- `CreateBucket` — with all HIPAA settings auto-applied
- `DeleteBucket` — super_admin only, bucket must be empty

### F3.5 — Multipart Upload Support
- Files > 100 MB use S3 multipart upload
- Maximum file size: 5 GB

### F3.6 — IAM Permissions (Least Privilege)
```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:PutObject",
    "s3:DeleteObject",
    "s3:ListBucket",
    "s3:GetBucketLocation"
  ],
  "Resource": [
    "arn:aws:s3:::helpucompli-docs-*",
    "arn:aws:s3:::helpucompli-docs-*/*"
  ]
}
```
Plus KMS permissions:
```json
{
  "Effect": "Allow",
  "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
  "Resource": "arn:aws:kms:<region>:<account>:key/<cmk-id>"
}
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/s3.ts` | S3 client singleton + helper functions |

## Environment Variables

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<for dev only, use IAM role in prod>
AWS_SECRET_ACCESS_KEY=<for dev only>
AWS_KMS_KEY_ID=<customer-managed KMS key ARN>
AWS_S3_LOGS_BUCKET=helpucompli-docs-access-logs
```

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/s3/buckets` | GET | List all registered buckets |
| `/api/s3/buckets` | POST | Create new bucket (super_admin only) |
| `/api/s3/buckets/[id]` | DELETE | Delete empty bucket (super_admin only) |
| `/api/s3/objects` | GET | List objects in bucket/prefix |
| `/api/s3/upload-url` | POST | Generate presigned PUT URL |
| `/api/s3/download-url` | POST | Generate presigned GET URL |
| `/api/s3/move` | POST | Move/copy objects |
| `/api/s3/objects` | DELETE | Soft/hard delete objects |

## Dependencies

- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`

## Acceptance Criteria

- [ ] S3 client connects to AWS with IAM credentials
- [ ] Presigned PUT URLs work for browser-to-S3 upload
- [ ] Presigned GET URLs work for download with configurable TTL
- [ ] All new buckets auto-apply HIPAA settings (encryption, versioning, public access block)
- [ ] SSE-KMS encryption active on all object operations
- [ ] Bucket policy enforces HTTPS-only access
- [ ] No public bucket access possible
- [ ] Multipart upload works for files > 100 MB
