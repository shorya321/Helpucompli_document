import Link from "next/link";
import { FolderPlus, Trash2 } from "lucide-react";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asBucketListPrisma,
  getBucketList,
  type BucketListScope,
  type BucketSummary,
} from "@/lib/bucket-list";
import { createRateLimiter } from "@/lib/rate-limit";
import { parseBrowseQuery } from "@/lib/documents-browse";
import { listObjects } from "@/lib/s3-objects";
import { Button } from "@/components/ui/button";
import { FileTree } from "@/components/documents/file-tree";
import {
  FileList,
  type FileListEntry,
} from "@/components/documents/file-list";
import { UploadZone } from "@/components/documents/upload-zone";
import { CreateFolderDialog } from "@/components/documents/create-folder-dialog";
import { MoveCopyDialog } from "@/components/documents/move-copy-dialog";
import { DeleteDialog } from "@/components/documents/delete-dialog";
import { DownloadButton } from "@/components/documents/download-button";
import { DeleteFolderDialog } from "@/components/documents/delete-folder-dialog";
import { DocumentPreviewDialog } from "@/components/documents/document-preview-dialog";
import { DocumentSearch } from "@/components/documents/document-search";
import { TrashView, type TrashEntry } from "@/components/documents/trash-view";
import { ensureUser } from "@/lib/ensure-user";

export const dynamic = "force-dynamic";

// Page-level rate limit mirrors the buckets page — keeps SSR Prisma +
// S3 listObjects bounded when the user reload-spams. Higher cap than
// per-API routes because this single render fans out to one Prisma
// query + one S3 ListObjectsV2 call.
const pageLimiter = createRateLimiter({
  max: 60,
  windowMs: 30_000,
  prefix: "@helpucompli/documents-page",
});

interface PageProps {
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}

export default async function DocumentsPage({ searchParams }: PageProps) {
  const session = await auth0.getSession();
  const role = await resolveRole(session ?? null);
  if (!role) {
    return <EmptyPage message="You do not have access to documents." />;
  }

  const sub = session?.user.sub as string | undefined;
  // Empty-sub gate runs BEFORE pageLimiter (sub is the quota key — a
  // missing sub would collide all misconfigured tokens into one bucket).
  // Differs from buckets/page.tsx which treats no-sub as a soft failure;
  // here we hard-deny so the rate-limit contract is always valid.
  if (!sub) {
    return <EmptyPage message="You do not have access to documents." />;
  }

  const quota = await pageLimiter.limit(`documents-page:${sub}`);
  if (!quota.success) {
    return (
      <EmptyPage message="You are refreshing too fast. Please wait a moment and try again." />
    );
  }

  const params = await searchParams;
  const q = parseBrowseQuery(params);
  const isSearchView = params.op === "search";
  const isTrashView = params.trash === "1";

  // F6.7 — Trash view. Mounted only on `?trash=1` opt-in. Listing,
  // restore, and per-row purge controls live here. Default browser
  // (no `?trash=1`) is unchanged so existing tests + behavior keep
  // working bit-for-bit.
  if (isTrashView) {
    if (role !== "superadmin" && role !== "admin") {
      return <EmptyPage message="You do not have access to the trash." />;
    }
    const dbUser = await ensureUser(prisma, {
      session: session!,
      role: role === "superadmin" ? "superadmin" : "admin",
    });
    let bucketIdScope: string[] | null = null;
    if (role === "admin") {
      const accessRows = await prisma.userBucketAccess.findMany({
        where: { userId: dbUser.id },
        select: { bucketId: true },
      });
      bucketIdScope = accessRows.map((r) => r.bucketId);
      if (bucketIdScope.length === 0) {
        return <EmptyPage message="Trash is empty." />;
      }
    }
    const where = {
      isDeleted: true,
      ...(bucketIdScope !== null ? { bucketId: { in: bucketIdScope } } : {}),
    };
    const rows = await prisma.document.findMany({
      where,
      orderBy: { deletedAt: "desc" },
      take: 200,
      select: {
        id: true,
        bucketId: true,
        s3Key: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        deletedAt: true,
        bucket: { select: { name: true } },
        deletedBy: { select: { email: true } },
      },
    });
    const entries: TrashEntry[] = rows.map((r) => ({
      id: r.id,
      bucketId: r.bucketId,
      bucketName: r.bucket.name,
      s3Key: r.s3Key,
      filename: r.filename,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes ?? BigInt(0),
      deletedAt: r.deletedAt,
      deletedByEmail: r.deletedBy?.email ?? null,
    }));
    return (
      <TrashView
        entries={entries}
        canHardDelete={role === "superadmin"}
      />
    );
  }

  // Scope the sidebar bucket list the same way the bucket manager does:
  // viewers only see buckets they have UserBucketAccess rows for.
  let scope: BucketListScope;
  if (role === "viewer") {
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    if (!dbUser) {
      return <EmptyPage message="You do not have access to any buckets yet." />;
    }
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  let buckets: ReadonlyArray<BucketSummary> = [];
  try {
    buckets = await getBucketList(
      asBucketListPrisma(prisma),
      scope,
      { filters: { status: "active" }, sort: { field: "name", dir: "asc" } },
    );
  } catch {
    // Engine errors can embed DATABASE_URL (F2.2 sec-review M2).
    return <EmptyPage message="Unable to load buckets. Please try again." />;
  }

  // Confirm the requested bucket is within the caller's scope before
  // touching S3. A non-scope bucket is silently collapsed to "no
  // selection" rather than 403 — viewers land on the tree view without
  // triggering a leak of bucket-existence.
  const inScope = q.bucket ? buckets.find((b) => b.name === q.bucket) : undefined;
  let entries: ReadonlyArray<FileListEntry> = [];
  let listError = false;

  if (inScope) {
    try {
      // MVP cap. listObjects defaults to 1000 keys, which is enough for
      // the F6.1 scaffolding — a folder with >LIST_PAGE keys would
      // truncate the view. F6.8 will wire pagination + search before
      // real tenants hit this ceiling; until then the view is
      // intentionally bounded.
      const LIST_PAGE = 200;
      const res = await listObjects({
        bucket: inScope.name,
        prefix: q.prefix === "" ? undefined : q.prefix,
        delimiter: "/",
        maxKeys: LIST_PAGE,
      });
      const folders: FileListEntry[] = res.commonPrefixes.map((p) => ({
        kind: "folder",
        name: p.slice(q.prefix.length).replace(/\/$/, ""),
        prefix: p,
      }));
      const files: FileListEntry[] = res.contents
        // S3 "folder marker" objects (zero-byte keys ending in "/") are
        // hidden — they are filesystem-skeuomorphic and not useful to
        // the user; folders are already surfaced via commonPrefixes.
        .filter((c) => typeof c.Key === "string" && !c.Key.endsWith("/"))
        .map((c) => ({
          kind: "file" as const,
          key: c.Key!,
          size: BigInt(c.Size ?? 0),
          lastModified: c.LastModified,
        }));
      entries = [...folders, ...files];
    } catch {
      listError = true;
    }
  }

  // Resolve the canonical Document.filename for the delete dialog. The
  // S3 key tail is NOT the filename — uploads prefix it with a UUID and
  // sanitize the original name (see src/lib/document-upload.ts), while
  // Document.filename stores the raw upload name. The hard-delete route
  // compares confirmName against doc.filename, so the dialog must show
  // and validate that same value, not the S3 key tail.
  const deleteDoc =
    (params.op === "delete" || params.op === "hard-delete") &&
    typeof params.bucketId === "string" &&
    typeof params.s3Key === "string"
      ? await prisma.document.findFirst({
          where: { bucketId: params.bucketId, s3Key: params.s3Key },
          select: { filename: true },
        })
      : null;

  return (
    <section className="text-foreground grid items-start gap-6 [grid-template-columns:minmax(14rem,18rem)_1fr]">
      <FileTree buckets={buckets} activeBucket={inScope?.name} />

      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-foreground m-0 text-3xl font-semibold tracking-tight">
            Documents
          </h1>
          {!inScope && (role === "superadmin" || role === "admin") ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/documents?trash=1">
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                Trash
              </Link>
            </Button>
          ) : null}
          {inScope ? (
            <div className="flex items-center gap-2">
              {role === "superadmin" || role === "admin" ? (
                <>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/documents?bucket=${encodeURIComponent(inScope.name)}${
                        q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                      }&newFolder=1`}
                    >
                      <FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />
                      New folder
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/documents?trash=1">
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      Trash
                    </Link>
                  </Button>
                </>
              ) : null}
              <Button asChild variant={isSearchView ? "default" : "outline"} size="sm">
                <Link
                  href={
                    isSearchView
                      ? `/documents?bucket=${encodeURIComponent(inScope.name)}${
                          q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                        }`
                      : `/documents?bucket=${encodeURIComponent(inScope.name)}${
                          q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                        }&op=search`
                  }
                >
                  {isSearchView ? "Browse" : "Search"}
                </Link>
              </Button>
              <ViewToggle
                bucket={inScope.name}
                prefix={q.prefix}
                current={q.view}
              />
            </div>
          ) : null}
        </header>

        {!inScope ? (
          <EmptyPanel
            message={
              buckets.length === 0
                ? "You do not have access to any buckets yet."
                : "Pick a bucket from the left panel to start browsing."
            }
          />
        ) : isSearchView ? (
          <DocumentSearch initialBucketId={inScope.id} />
        ) : listError ? (
          <EmptyPanel message="Unable to load this folder. Please try again." />
        ) : (
          <>
            {role === "superadmin" || role === "admin" ? (
              <UploadZone
                bucketId={inScope.id}
                folderPrefix={q.prefix}
              />
            ) : null}
            <FileList
              bucket={inScope.name}
              bucketId={inScope.id}
              canModify={role !== "viewer"}
              canHardDelete={role === "superadmin"}
              canGenerateLink={role === "superadmin" || role === "admin"}
              canDeleteFolder={role === "superadmin" || role === "admin"}
              prefix={q.prefix}
              entries={entries}
              view={q.view}
            />
            {params.newFolder === "1" &&
            (role === "superadmin" || role === "admin") ? (
              <CreateFolderDialog
                bucketId={inScope.id}
                parentPrefix={q.prefix}
                closeHref={`/documents?bucket=${encodeURIComponent(
                  inScope.name,
                )}${q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""}`}
              />
            ) : null}
          </>
        )}
      </div>

      {/*
        MoveCopyDialog lives at section scope so it mounts independent
        of inScope. Its required inputs (sourceBucketId / sourceS3Key)
        come from the URL directly — a user bookmarking or reloading
        mid-dialog with a dropped bucket= param must still see the
        dialog instead of an empty panel.
      */}
      {(params.op === "move" || params.op === "copy") &&
      typeof params.bucketId === "string" &&
      typeof params.s3Key === "string" &&
      (role === "superadmin" || role === "admin") ? (
        <MoveCopyDialog
          sourceBucketId={params.bucketId}
          sourceS3Key={params.s3Key}
          sourceFilename={
            params.s3Key.split("/").filter((s) => s !== "").pop() ??
            params.s3Key
          }
          buckets={buckets.map((b) => ({ id: b.id, name: b.name }))}
          closeHref={
            inScope
              ? `/documents?bucket=${encodeURIComponent(inScope.name)}${
                  q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                }`
              : "/documents"
          }
          initialMode={params.op}
        />
      ) : null}

      {/*
        DocumentPreviewDialog mounts when op=preview. The Document row
        is fetched server-side from Prisma so metadata (contentType,
        sizeBytes, uploadedAt, uploader) is authoritative; the client
        component then fetches a presigned inline GET URL to render PDF
        iframe or image tag. Viewers are scoped via the `buckets` list —
        the bucketId must belong to a bucket in their UserBucketAccess
        set for the preview to mount, otherwise it silently no-ops.
      */}
      {/*
        Download flow — the right-click context menu emits a navigation
        link to ?op=download&bucketId=...&s3Key=..., so we mount the
        existing DownloadButton in autoFire mode here. The button POSTs
        /api/s3/download-url and redirects to the presigned URL, exactly
        the same flow used in document-search. closeHref clears the op
        param afterwards so reload does not re-trigger.
      */}
      {params.op === "download" &&
      typeof params.bucketId === "string" &&
      typeof params.s3Key === "string" &&
      buckets.some((b) => b.id === params.bucketId) ? (
        <DownloadButton
          bucketId={params.bucketId}
          s3Key={params.s3Key}
          autoFire
          closeHref={
            inScope
              ? `/documents?bucket=${encodeURIComponent(inScope.name)}${
                  q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                }`
              : "/documents"
          }
        />
      ) : null}

      {params.op === "preview" &&
      typeof params.bucketId === "string" &&
      typeof params.s3Key === "string" &&
      buckets.some((b) => b.id === params.bucketId) ? (
        <PreviewMount
          bucketId={params.bucketId}
          s3Key={params.s3Key}
          closeHref={
            inScope
              ? `/documents?bucket=${encodeURIComponent(inScope.name)}${
                  q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                }`
              : "/documents"
          }
        />
      ) : null}

      {/*
        DeleteDialog handles both soft and hard delete. op=delete opens
        with soft pre-selected (admin + superadmin). op=hard-delete
        opens with hard pre-selected and is gated to superadmin only,
        matching the backend route's role check at /api/s3/delete.
      */}
      {deleteDoc &&
      typeof params.bucketId === "string" &&
      typeof params.s3Key === "string" &&
      (role === "superadmin" ||
        (role === "admin" && params.op === "delete")) ? (
        <DeleteDialog
          bucketId={params.bucketId}
          s3Key={params.s3Key}
          filename={deleteDoc.filename}
          canHardDelete={role === "superadmin"}
          initialMode={params.op === "hard-delete" ? "hard" : "soft"}
          closeHref={
            inScope
              ? `/documents?bucket=${encodeURIComponent(inScope.name)}${
                  q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                }`
              : "/documents"
          }
        />
      ) : null}

      {/*
        Folder delete dialog. op=delete-folder opens with soft pre-selected
        (admin + superadmin). op=hard-delete-folder opens with hard
        pre-selected and is gated to superadmin only — same shape as the
        per-document delete flow. folderPrefix is the URL param produced
        by buildFolderMenu().
      */}
      {(params.op === "delete-folder" || params.op === "hard-delete-folder") &&
      typeof params.bucketId === "string" &&
      typeof params.folderPrefix === "string" &&
      (role === "superadmin" ||
        (role === "admin" && params.op === "delete-folder")) ? (
        <DeleteFolderDialog
          bucketId={params.bucketId}
          folderPrefix={params.folderPrefix}
          folderName={
            params.folderPrefix.split("/").filter((s) => s !== "").pop() ??
            params.folderPrefix
          }
          canHardDelete={role === "superadmin"}
          initialMode={params.op === "hard-delete-folder" ? "hard" : "soft"}
          closeHref={
            inScope
              ? `/documents?bucket=${encodeURIComponent(inScope.name)}${
                  q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                }`
              : "/documents"
          }
        />
      ) : null}
    </section>
  );
}

interface ViewToggleProps {
  readonly bucket: string;
  readonly prefix: string;
  readonly current: "grid" | "list";
}

function ViewToggle({ bucket, prefix, current }: ViewToggleProps) {
  const base = `/documents?bucket=${encodeURIComponent(bucket)}${
    prefix ? `&prefix=${encodeURIComponent(prefix)}` : ""
  }`;
  return (
    <nav
      role="tablist"
      aria-label="View mode"
      className="border-border bg-card inline-flex gap-0.5 rounded-full border p-0.5"
    >
      {(["list", "grid"] as const).map((v) => (
        <Link
          key={v}
          href={`${base}&view=${v}`}
          role="tab"
          aria-selected={v === current}
          className={
            v === current
              ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider no-underline"
              : "text-muted-foreground hover:text-foreground rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider no-underline transition-colors"
          }
        >
          {v}
        </Link>
      ))}
    </nav>
  );
}

interface PreviewMountProps {
  readonly bucketId: string;
  readonly s3Key: string;
  readonly closeHref: string;
}

// Server-side Document lookup for preview metadata. Soft-deleted docs
// are excluded so a stale `?op=preview` URL cannot expose a hidden
// document's metadata via the dialog header. Missing / deleted docs
// silently no-op — no 404 rendered so the browser view under the
// dialog remains intact.
async function PreviewMount({
  bucketId,
  s3Key,
  closeHref,
}: PreviewMountProps) {
  const doc = await prisma.document.findFirst({
    where: { bucketId, s3Key, isDeleted: false },
    select: {
      filename: true,
      contentType: true,
      sizeBytes: true,
      uploadedAt: true,
      uploadedBy: { select: { name: true, email: true } },
    },
  });
  if (!doc) return null;
  return (
    <DocumentPreviewDialog
      bucketId={bucketId}
      s3Key={s3Key}
      filename={doc.filename}
      contentType={doc.contentType}
      sizeBytes={doc.sizeBytes ?? BigInt(0)}
      uploadedAt={doc.uploadedAt}
      uploadedByName={doc.uploadedBy.name ?? doc.uploadedBy.email}
      closeHref={closeHref}
    />
  );
}

function EmptyPage({ message }: { readonly message: string }) {
  return (
    <div className="border-border bg-card text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <FolderPlus aria-hidden="true" className="size-5" />
      </div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

function EmptyPanel({ message }: { readonly message: string }) {
  return (
    <p className="border-border bg-card text-muted-foreground m-0 rounded-xl border border-dashed px-6 py-10 text-center text-sm">
      {message}
    </p>
  );
}
