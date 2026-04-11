# Module 10: User Management

**Phase:** 3 (Policy Engine + User Management)
**Priority:** High — controls who can access the platform

---

## Overview

User management is delegated to Auth0 with metadata synced to the local PostgreSQL database. Admins can invite users, assign roles, manage bucket access for viewers, and disable/enable accounts.

## Features

### F10.1 — User List
- Data table showing all users synced from Auth0
- **Columns:** Name, Email, Role (badge), Last Login, Status (active/disabled), Actions
- **Sorting:** By name, last login, role
- **Search:** By name or email
- **Filters:** By role, by status

### F10.2 — Invite New User
- **Access:** `super_admin` and `admin` roles
- Invite modal with fields:
  - Email address (required)
  - Name (optional)
  - Role (dropdown: admin, viewer — only super_admin can create other admins)
- Creates user in Auth0 via Management API
- Sends invitation email via Auth0
- Syncs user record to local PostgreSQL
- Audit log entry: `USER_INVITE`

### F10.3 — Role Management
- Change user role via dropdown
- **Role hierarchy:**
  - `super_admin` can assign any role
  - `admin` can only assign `viewer` role
  - Cannot demote yourself
  - Cannot modify another `super_admin` (only another super_admin can)
- Auth0 role updated via Management API
- Local DB role updated
- Audit log entry: `USER_ROLE_CHANGE`

### F10.4 — Bucket Access Control (Viewer Role)
- Assign specific buckets to viewer-role users
- Uses `user_bucket_access` junction table
- Viewers can only see documents in their assigned buckets
- Multi-select bucket picker for assignment

### F10.5 — Disable / Enable User
- Toggle user status (active/disabled)
- Disabled users cannot log in (blocked in Auth0)
- Audit log entry: `USER_DISABLE` or `USER_ENABLE`

### F10.6 — User Sync from Auth0
- On login: upsert user record from Auth0 profile to PostgreSQL
- Fields synced: auth0_id, email, name, role, last_login_at
- Handles edge cases: email change, name change

### F10.7 — User Details View
- Click user row to see details:
  - Profile info (name, email, role)
  - Last login timestamp
  - Assigned buckets (for viewers)
  - Recent activity (from audit_logs filtered by user)
  - Document access history

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/(dashboard)/users/page.tsx` | User list page |
| `src/app/(dashboard)/users/[id]/page.tsx` | User details page |
| `src/components/users/user-table.tsx` | User data table |
| `src/components/users/invite-user-dialog.tsx` | Invite modal |
| `src/components/users/role-select.tsx` | Role change dropdown |
| `src/components/users/bucket-access.tsx` | Bucket assignment picker |
| `src/lib/auth0-management.ts` | Auth0 Management API wrapper |
| `src/app/api/users/route.ts` | GET (list) + POST (invite) |
| `src/app/api/users/[id]/route.ts` | GET + PUT (role/status change) |
| `src/app/api/users/[id]/buckets/route.ts` | GET + PUT (bucket assignments) |

## API Endpoints

| Route | Method | Role | Purpose |
|-------|--------|------|---------|
| `/api/users` | GET | admin+ | List all users |
| `/api/users` | POST | admin+ | Invite new user |
| `/api/users/[id]` | GET | admin+ | Get user details |
| `/api/users/[id]` | PUT | admin+ | Update role or status |
| `/api/users/[id]/buckets` | GET | admin+ | Get assigned buckets |
| `/api/users/[id]/buckets` | PUT | admin+ | Update bucket assignments |

## Environment Variables

```env
AUTH0_MGMT_CLIENT_ID=<management API client ID>
AUTH0_MGMT_CLIENT_SECRET=<management API client secret>
AUTH0_DOMAIN=<tenant>.auth0.com
```

## Dependencies

- Auth0 Management API (via REST calls or `auth0` npm package)

## Acceptance Criteria

- [ ] User list shows all Auth0 users with correct roles
- [ ] Invite sends Auth0 invitation email
- [ ] Role change updates both Auth0 and local DB
- [ ] Role hierarchy enforced (admin cannot create super_admin)
- [ ] Viewer bucket access controls work
- [ ] Disabled users cannot log in
- [ ] User sync on login updates local DB
- [ ] User details show activity history
- [ ] All user management actions logged in audit trail
