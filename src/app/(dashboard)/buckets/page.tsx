import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/prisma";
import {
  asBucketListPrisma,
  getBucketList,
  parseBucketListQuery,
  type BucketListOptions,
  type BucketListScope,
  type BucketSummary,
} from "@/lib/bucket-list";
import { createRateLimiter } from "@/lib/rate-limit";
import { BucketCard } from "@/components/buckets/bucket-card";
import { CreateBucketDialog } from "@/components/buckets/create-bucket-dialog";

export const dynamic = "force-dynamic";

// SSR-render rate limiter. The API route also limits, but a direct
// page.tsx path bypasses that — without this an authed user can hammer
// Prisma with reload loops. Higher cap than the API (60/30s) because
// page loads carry the whole dashboard chrome + this fetch in one hit.
const pageLimiter = createRateLimiter({
  max: 60,
  windowMs: 30_000,
  prefix: "@helpucompli/buckets-page",
});

// Search-params shape forwarded by Next.js App Router. Values may be
// string | string[] | undefined — delegated to `parseBucketListQuery`.
interface PageProps {
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}

export default async function BucketsPage({ searchParams }: PageProps) {
  const session = await auth0.getSession();
  // Layout already guards session + role — but defensive resolution keeps
  // the page safe if layout is bypassed by a future refactor.
  const role = await resolveRole(session ?? null);
  if (!role) {
    return <EmptyState message="You do not have access to the bucket manager." />;
  }

  // SSR rate-limit — hard-caps the Prisma aggregate calls even when the
  // user refresh-spams the page directly (bypasses the API route limit).
  const sub = session?.user.sub as string | undefined;
  if (sub) {
    const quota = await pageLimiter.limit(`buckets-page:${sub}`);
    if (!quota.success) {
      return (
        <EmptyState message="You are refreshing too fast. Please wait a moment and try again." />
      );
    }
  }

  const params = await searchParams;
  const options: BucketListOptions = parseBucketListQuery(params) ?? {};

  let scope: BucketListScope;
  let list: readonly BucketSummary[] = [];
  let loadError = false;

  if (role === "viewer") {
    const sub = session?.user.sub as string | undefined;
    if (!sub) {
      return <BucketsView role={role} buckets={[]} options={options} />;
    }
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    if (!dbUser) {
      return <BucketsView role={role} buckets={[]} options={options} />;
    }
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  try {
    list = await getBucketList(asBucketListPrisma(prisma), scope, options);
  } catch {
    // Engine errors can embed DATABASE_URL (F2.2 sec-review M2).
    loadError = true;
  }

  const dialogOpen = role === "superadmin" && params.new === "1";

  return (
    <>
      <BucketsView
        role={role}
        buckets={list}
        options={options}
        loadError={loadError}
      />
      {dialogOpen ? <CreateBucketDialog closeHref="/buckets" /> : null}
    </>
  );
}

interface BucketsViewProps {
  readonly role: "superadmin" | "admin" | "viewer";
  readonly buckets: readonly BucketSummary[];
  readonly options: BucketListOptions;
  readonly loadError?: boolean;
}

function BucketsView({ role, buckets, options, loadError }: BucketsViewProps) {
  const canCreate = role === "superadmin";
  const sortField = options.sort?.field ?? "name";
  const sortDir = options.sort?.dir ?? "asc";
  const region = options.filters?.region ?? "";
  const status = options.filters?.status ?? "active";

  return (
    <section
      style={{
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
            Buckets
          </h1>
          <p style={{ marginTop: "0.25rem", color: "rgba(30,41,59,0.72)" }}>
            {role === "viewer"
              ? "Buckets you have access to."
              : "All managed document buckets."}
          </p>
        </div>
        {canCreate ? (
          <a
            href="/buckets?new=1"
            style={{
              background: BRAND.colors.pink,
              color: "#FFFFFF",
              padding: "0.625rem 1rem",
              borderRadius: "0.5rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Create bucket
          </a>
        ) : null}
      </header>

      <form
        method="GET"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
          gap: "0.75rem",
          alignItems: "end",
          padding: "1rem",
          background: "#FFFFFF",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.75rem",
        }}
      >
        <label style={labelStyle}>
          Sort
          <select name="sort" defaultValue={sortField} style={selectStyle}>
            <option value="name">Name</option>
            <option value="createdAt">Created date</option>
            <option value="documentCount">Document count</option>
          </select>
        </label>
        <label style={labelStyle}>
          Direction
          <select name="dir" defaultValue={sortDir} style={selectStyle}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        <label style={labelStyle}>
          Region
          <input
            name="region"
            defaultValue={region}
            placeholder="us-east-1"
            maxLength={32}
            style={selectStyle}
          />
        </label>
        <label style={labelStyle}>
          Status
          <select name="status" defaultValue={status} style={selectStyle}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </label>
        <button
          type="submit"
          style={{
            background: BRAND.colors.blue,
            color: "#FFFFFF",
            padding: "0.5rem 0.875rem",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
          }}
        >
          Apply
        </button>
      </form>

      {loadError ? (
        <p role="alert" style={{ color: BRAND.colors.pink }}>
          Unable to load buckets. Please try again.
        </p>
      ) : buckets.length === 0 ? (
        <EmptyState
          message={
            role === "viewer"
              ? "You have not been granted access to any buckets yet."
              : "No buckets match the current filters."
          }
        />
      ) : (
        <ul
          role="list"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(18rem, 1fr))",
            gap: "1rem",
          }}
        >
          {buckets.map((b) => (
            <li key={b.id}>
              <BucketCard bucket={b} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState({ message }: { readonly message: string }) {
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

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: BRAND.colors.blue,
  fontWeight: 600,
};

const selectStyle: React.CSSProperties = {
  padding: "0.4375rem 0.5rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  color: BRAND.colors.dark,
  background: "#FFFFFF",
  border: `1px solid ${BRAND.colors.dark}26`,
  borderRadius: "0.375rem",
  fontFamily: "inherit",
};
