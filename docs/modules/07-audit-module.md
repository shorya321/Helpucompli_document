# Module 7: Audit Logging

**Phase:** 2 (Core Features)
**Priority:** Critical — HIPAA compliance requirement

---

## Overview

Immutable, append-only audit trail capturing every significant action in the system. Required by HIPAA for access controls and audit controls (164.312(a)(1) and 164.312(b)). 6-year minimum retention.

## Features

### F7.1 — Audit Log Writer
- Centralized helper function (`src/lib/audit.ts`) called from every API route
- Captures: user_id, action, target_type, target_id, metadata (JSONB), IP address, user agent, timestamp
- **No update or delete operations** on audit_logs table — append-only by design

### F7.2 — Action Types (Enum)

| Action | Description |
|--------|------------|
| `LOGIN` | User logged in |
| `LOGOUT` | User logged out |
| `BUCKET_CREATE` | New bucket created |
| `BUCKET_DELETE` | Bucket deleted |
| `DOCUMENT_UPLOAD` | Document uploaded |
| `DOCUMENT_DOWNLOAD` | Document downloaded |
| `DOCUMENT_SOFT_DELETE` | Document soft-deleted |
| `DOCUMENT_HARD_DELETE` | Document permanently deleted |
| `DOCUMENT_MOVE` | Document moved |
| `DOCUMENT_COPY` | Document copied |
| `POLICY_CREATE` | Access policy created |
| `POLICY_UPDATE` | Access policy updated |
| `POLICY_DELETE` | Access policy deleted |
| `LINK_GENERATE` | Presigned URL generated |
| `LINK_ACCESS` | Generated link accessed |
| `LINK_DENIED` | Link access denied (policy check failed) |
| `USER_INVITE` | New user invited |
| `USER_ROLE_CHANGE` | User role changed |
| `USER_DISABLE` | User account disabled |
| `USER_ENABLE` | User account enabled |

### F7.3 — Audit Log Viewer
- Searchable data table using TanStack Table
- **Columns:** Timestamp, User, Action (with badge), Target, IP Address
- **Filters:**
  - By user (dropdown)
  - By action type (multi-select)
  - By date range (date picker)
  - By target type (bucket/document/policy/user)
- **Sorting:** By timestamp (default desc), action, user
- **Pagination:** 50 rows per page with cursor-based pagination

### F7.4 — CSV Export
- Export filtered results to CSV
- Includes all columns
- Filename format: `audit_log_YYYY-MM-DD_HH-mm.csv`

### F7.5 — Audit Log Retention
- 6-year minimum retention (HIPAA requirement)
- Future: table partitioning by month, archive to S3 Glacier

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/audit.ts` | Audit logging helper function |
| `src/app/(dashboard)/audit/page.tsx` | Audit log viewer page |
| `src/components/audit/audit-table.tsx` | Data table with filters |
| `src/components/audit/audit-filters.tsx` | Filter controls |
| `src/components/audit/export-csv.tsx` | CSV export button |
| `src/app/api/audit/route.ts` | GET (query with filters/pagination) |

## Audit Helper Function

```typescript
// src/lib/audit.ts
export async function logAudit(params: {
  userId: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
}) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ?? {},
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    },
  });
}
```

## Acceptance Criteria

- [ ] Every significant action creates an audit log entry
- [ ] Audit logs are immutable (no update/delete in code)
- [ ] Audit log viewer loads with pagination
- [ ] Filters work: by user, action, date range, target
- [ ] CSV export downloads correctly
- [ ] IP address and user agent captured on every entry
- [ ] Metadata JSONB stores action-specific details
- [ ] 6-year retention policy documented
