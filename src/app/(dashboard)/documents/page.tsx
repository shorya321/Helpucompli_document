import Link from "next/link";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
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
import { FileTree } from "@/components/documents/file-tree";
import {
  FileList,
  type FileListEntry,
} from "@/components/documents/file-list";
import { UploadZone } from "@/components/documents/upload-zone";
import { CreateFolderDialog } from "@/components/documents/create-folder-dialog";

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

  return (
    <section
      style={{
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
        display: "grid",
        gridTemplateColumns: "minmax(14rem, 18rem) 1fr",
        gap: "1.5rem",
        alignItems: "start",
      }}
    >
      <FileTree buckets={buckets} activeBucket={inScope?.name} />

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
            Documents
          </h1>
          {inScope ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {role === "superadmin" || role === "admin" ? (
                <Link
                  href={`/documents?bucket=${encodeURIComponent(inScope.name)}${
                    q.prefix ? `&prefix=${encodeURIComponent(q.prefix)}` : ""
                  }&newFolder=1`}
                  style={{
                    padding: "0.3125rem 0.75rem",
                    borderRadius: "999px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    textDecoration: "none",
                    color: BRAND.colors.blue,
                    background: `${BRAND.colors.blue}14`,
                    border: `1px solid ${BRAND.colors.blue}33`,
                  }}
                >
                  + New folder
                </Link>
              ) : null}
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
      style={{
        display: "inline-flex",
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "999px",
        padding: "0.1875rem",
        gap: "0.125rem",
      }}
    >
      {(["list", "grid"] as const).map((v) => (
        <Link
          key={v}
          href={`${base}&view=${v}`}
          role="tab"
          aria-selected={v === current}
          style={{
            padding: "0.3125rem 0.75rem",
            borderRadius: "999px",
            fontSize: "0.75rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            textDecoration: "none",
            color: v === current ? "#FFFFFF" : BRAND.colors.dark,
            background: v === current ? BRAND.colors.blue : "transparent",
          }}
        >
          {v}
        </Link>
      ))}
    </nav>
  );
}

function EmptyPage({ message }: { readonly message: string }) {
  return (
    <div
      style={{
        padding: "2rem",
        background: "#FFFFFF",
        border: `1px dashed ${BRAND.colors.dark}33`,
        borderRadius: "0.75rem",
        textAlign: "center",
        color: "rgba(30,41,59,0.72)",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
      }}
    >
      {message}
    </div>
  );
}

function EmptyPanel({ message }: { readonly message: string }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "1.5rem",
        background: "#FFFFFF",
        border: `1px dashed ${BRAND.colors.dark}33`,
        borderRadius: "0.75rem",
        textAlign: "center",
        color: "rgba(30,41,59,0.72)",
      }}
    >
      {message}
    </p>
  );
}
