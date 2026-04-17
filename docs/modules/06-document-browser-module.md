# Module 6: Document Browser

**Phase:** 2 (Core Features)
**Priority:** Critical — primary document management interface

---

## Overview

File explorer UI for navigating, uploading, downloading, moving, copying, and deleting documents within S3 buckets. Supports drag-and-drop upload, multi-file selection, and document preview.

## Features

### F6.1 — File Explorer Layout
- **Left panel:** Tree sidebar showing bucket → folder hierarchy
- **Right panel:** Content area showing files in current folder
- **Breadcrumb navigation:** Bucket > Folder > Subfolder
- **View modes:** Grid view (thumbnails) and list view (table)

### F6.2 — Document Upload
- **Drag-and-drop zone** using `react-dropzone`
- **Multi-file upload** supported
- **Upload flow:**
  1. Admin selects target bucket and folder
  2. Client requests presigned PUT URL from `/api/s3/upload-url`
  3. File uploads directly from browser to S3 (no server proxy)
  4. On completion, client notifies API to write metadata to PostgreSQL
  5. Upload progress bar shown per file
- **Max file size:** 5 GB
- **Multipart upload** for files > 100 MB
- Audit log entry: `DOCUMENT_UPLOAD`

### F6.3 — Document Download
- Click to download → generates presigned GET URL
- Policy checked before URL generation (if policy exists)
- Audit log entry: `DOCUMENT_DOWNLOAD`

### F6.4 — Move / Copy Between Buckets
- Select source document(s) + target bucket/folder
- API executes S3 `CopyObject` + optional `DeleteObject` (for move)
- Metadata updated in PostgreSQL
- Audit log entries: `DOCUMENT_MOVE` or `DOCUMENT_COPY`

### F6.5 — Document Deletion
- **Soft delete:** S3 delete marker placed. Document hidden but recoverable via versioning.
- **Hard delete:** `superadmin` only. Permanently removes all versions. Requires confirmation dialog with document name typed.
- **Regulatory hold:** Documents under HIPAA retention cannot be hard-deleted
- Audit log entries: `DOCUMENT_SOFT_DELETE` or `DOCUMENT_HARD_DELETE`

### F6.6 — Document Preview
- **PDF:** Preview via iframe with S3 presigned URL
- **Images:** Inline preview (jpg, png, gif, webp)
- **Other files:** Show metadata (name, type, size, upload date, uploader)

### F6.7 — Right-Click Context Menu
- Download
- Move to...
- Copy to...
- Generate link (opens link generator)
- Delete
- View details

### F6.8 — Search & Filter
- Search by filename within current bucket/folder
- Filter by content type, upload date, uploader
- Sort by name, date, size

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/(dashboard)/documents/page.tsx` | Document browser page |
| `src/components/documents/file-tree.tsx` | Folder tree sidebar |
| `src/components/documents/file-list.tsx` | File content area |
| `src/components/documents/upload-zone.tsx` | Drag-drop upload component |
| `src/components/documents/document-preview.tsx` | File preview modal |
| `src/components/documents/context-menu.tsx` | Right-click menu |
| `src/components/documents/move-copy-dialog.tsx` | Move/copy target picker |
| `src/components/documents/delete-dialog.tsx` | Delete confirmation |
| `src/app/api/s3/objects/route.ts` | GET (list) + DELETE |
| `src/app/api/s3/upload-url/route.ts` | POST (presigned PUT URL) |
| `src/app/api/s3/download-url/route.ts` | POST (presigned GET URL) |
| `src/app/api/s3/move/route.ts` | POST (move/copy) |
| `src/app/api/s3/upload-complete/route.ts` | POST (write metadata after upload) |

## API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/s3/objects` | GET | List objects (bucket, prefix params) |
| `/api/s3/upload-url` | POST | Generate presigned PUT URL |
| `/api/s3/download-url` | POST | Generate presigned GET URL (policy-checked) |
| `/api/s3/upload-complete` | POST | Record metadata after successful upload |
| `/api/s3/move` | POST | Move or copy objects |
| `/api/s3/objects` | DELETE | Soft or hard delete |

## UI Components (shadcn/ui)

- `Table` (TanStack Table) — for list view
- `DropdownMenu` — for right-click context menu
- `Dialog` — for modals (upload, delete, move)
- `Progress` — for upload progress
- `Breadcrumb` — for folder navigation
- `Tabs` — for grid/list view toggle

## Dependencies

- `react-dropzone` — drag-and-drop file upload
- `@tanstack/react-table` — data table for file listing

## Acceptance Criteria

- [ ] File explorer shows bucket/folder hierarchy
- [ ] Drag-and-drop upload works with progress indicator
- [ ] Files upload directly to S3 via presigned PUT URL
- [ ] Metadata stored in PostgreSQL after upload
- [ ] Download generates presigned GET URL
- [ ] Move/copy between buckets works correctly
- [ ] Soft delete hides document but retains via versioning
- [ ] Hard delete requires superadmin + confirmation
- [ ] PDF and image preview works
- [ ] Search and filter functional
- [ ] All operations logged in audit trail
