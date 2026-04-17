# Module 4: Dashboard Home

**Phase:** 2 (Core Features)
**Priority:** High — primary landing page after login

---

## Overview

The dashboard is the main interface at docs.helpucompli.com after authentication. Shows summary metrics, recent activity, and quick action buttons. Only accessible to users with `superadmin`, `admin`, or `viewer` roles.

## Features

### F4.1 — Dashboard Layout
- **Sidebar:** Navigation links to all modules (Buckets, Documents, Policies, Links, Users, Audit)
- **Topbar:** HelpUcompli logo, user name + role badge, logout button
- **Responsive:** Sidebar collapses to hamburger on mobile

### F4.2 — Summary Cards
- **Total Documents** — count from `documents` table (where `is_deleted = false`)
- **Total Buckets** — count from `buckets` table (where `is_active = true`)
- **Recent Uploads** — count of documents uploaded in last 7 days
- **Recent Link Generations** — count of links generated in last 7 days
- **Active Users** — count of users with `status = active`

### F4.3 — Recent Activity Feed
- Last 20 entries from `audit_logs` table
- Shows: timestamp, user name, action (with badge), target document/bucket name
- Auto-refreshes every 30 seconds (client-side polling or React Query refetch)

### F4.4 — Quick Action Buttons
- "Upload Document" — opens document browser with upload dialog
- "Create Bucket" — opens bucket creation modal (superadmin only)
- "Generate Link" — opens link generator
- "View Audit Log" — navigates to full audit log page

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/(dashboard)/layout.tsx` | Dashboard layout with sidebar + topbar |
| `src/app/(dashboard)/page.tsx` | Dashboard home page |
| `src/components/layout/sidebar.tsx` | Navigation sidebar |
| `src/components/layout/topbar.tsx` | Top navigation bar |
| `src/components/layout/brand-logo.tsx` | HelpUcompli logo component |
| `src/components/dashboard/summary-cards.tsx` | Metric cards |
| `src/components/dashboard/activity-feed.tsx` | Recent activity list |
| `src/components/dashboard/quick-actions.tsx` | Action buttons |

## UI Components (shadcn/ui)

- `Card` — for summary metrics
- `Badge` — for role badges and action types
- `Button` — for quick actions
- `Separator` — between sections
- `Sheet` — for mobile sidebar

## Acceptance Criteria

- [ ] Dashboard loads in < 2 seconds
- [ ] Summary cards show correct counts
- [ ] Recent activity feed shows last 20 actions
- [ ] Quick action buttons navigate to correct pages
- [ ] Sidebar highlights current page
- [ ] Responsive layout works on mobile
- [ ] Role-based visibility (viewer sees limited actions)
