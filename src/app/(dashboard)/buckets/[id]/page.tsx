import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/prisma";
import {
  asBucketDetailsPrisma,
  BucketAccessDeniedError,
  BucketNotFoundError,
  getBucketDetails,
  type BucketDetails,
  type BucketDetailsScope,
} from "@/lib/bucket-details";
import { formatStorage } from "@/components/buckets/bucket-card";
import { ComplianceVerifier } from "@/components/buckets/compliance-verifier";
import { DeleteBucketDialog } from "@/components/buckets/delete-bucket-dialog";
import { createRateLimiter } from "@/lib/rate-limit";

const idSchema = z.string().min(1).max(64);

export const dynamic = "force-dynamic";

const pageLimiter = createRateLimiter({
  max: 60,
  windowMs: 30_000,
  prefix: "@helpucompli/buckets-details-page",
});

interface PageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}

export default async function BucketDetailsPage({
  params,
  searchParams,
}: PageProps) {
  const { id: rawId } = await params;
  const sp = await searchParams;
  const parsedId = idSchema.safeParse(rawId);
  if (!parsedId.success) notFound();
  const id = parsedId.data;

  const session = await auth0.getSession();
  const role = await resolveRole(session);
  if (!role) return <AccessDenied />;

  // Missing sub must not bypass the rate-limit — resolve sub before
  // the limiter so a malformed session token cannot drive unbounded
  // SSR Prisma work.
  const sub = session?.user.sub as string | undefined;
  if (!sub) return <AccessDenied />;

  const quota = await pageLimiter.limit(`bucket-details-page:${sub}`);
  if (!quota.success) {
    return (
      <Shell>
        <p
          role="alert"
          style={{ color: BRAND.colors.pink, textAlign: "center" }}
        >
          You are refreshing too fast. Please wait a moment.
        </p>
      </Shell>
    );
  }

  let scope: BucketDetailsScope;
  if (role === "viewer") {
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    if (!dbUser) return <AccessDenied />;
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  let details: BucketDetails;
  try {
    details = await getBucketDetails(
      asBucketDetailsPrisma(prisma),
      scope,
      id,
    );
  } catch (err) {
    if (err instanceof BucketAccessDeniedError) return <AccessDenied />;
    if (err instanceof BucketNotFoundError) notFound();
    return (
      <Shell>
        <p role="alert" style={{ color: BRAND.colors.pink }}>
          Unable to load bucket details. Please try again.
        </p>
      </Shell>
    );
  }

  const canDelete = role === "superadmin";
  const canVerify = role === "superadmin" || role === "admin";
  const dialogOpen = canDelete && sp.delete === "1";

  return (
    <>
      <DetailsView
        details={details}
        canDelete={canDelete}
        canVerify={canVerify}
      />
      {dialogOpen ? (
        <DeleteBucketDialog
          bucketId={details.id}
          bucketName={details.name}
          closeHref={`/buckets/${details.id}`}
          onSuccessHref="/buckets"
        />
      ) : null}
    </>
  );
}

function DetailsView({
  details,
  canDelete,
  canVerify,
}: {
  readonly details: BucketDetails;
  readonly canDelete: boolean;
  readonly canVerify: boolean;
}) {
  return (
    <Shell>
      <nav style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link href="/buckets" style={{ color: BRAND.colors.blue }}>
          ← All buckets
        </Link>
      </nav>

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 700,
              wordBreak: "break-all",
            }}
          >
            {details.name}
          </h1>
          <p style={{ marginTop: "0.25rem", color: "rgba(30,41,59,0.72)" }}>
            Created {details.createdAt.toISOString().slice(0, 10)} •{" "}
            {details.region}
          </p>
        </div>
        <div
          style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
        >
          <StatusBadge isActive={details.isActive} />
          {canDelete && details.isActive ? (
            <a
              href={`/buckets/${details.id}?delete=1`}
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "0.375rem 0.75rem",
                borderRadius: "0.5rem",
                border: `1px solid ${BRAND.colors.pink}`,
                color: BRAND.colors.pink,
                textDecoration: "none",
              }}
            >
              Delete bucket
            </a>
          ) : null}
        </div>
      </header>

      {details.description ? (
        <p
          style={{
            margin: "0 0 1.5rem",
            padding: "0.75rem 1rem",
            background: "#FFFFFF",
            border: `1px solid ${BRAND.colors.dark}1A`,
            borderRadius: "0.5rem",
            color: "rgba(30,41,59,0.8)",
          }}
        >
          {details.description}
        </p>
      ) : null}

      <MetricsGrid details={details} />
      <Section title="HIPAA compliance (enforced by design)">
        <ComplianceList compliance={details.hipaaCompliance} />
        {canVerify ? (
          <div style={{ marginTop: "0.75rem" }}>
            <ComplianceVerifier bucketId={details.id} />
          </div>
        ) : null}
      </Section>
      <Section
        title={`Access policies (${details.accessPolicies.length})`}
      >
        {details.accessPolicies.length === 0 ? (
          <EmptyLine message="No bucket-level policies defined." />
        ) : (
          <ul style={listStyle}>
            {details.accessPolicies.map((p) => (
              <li key={p.id} style={rowStyle}>
                <div>
                  <strong>{p.name}</strong>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "rgba(30,41,59,0.64)",
                    }}
                  >
                    TTL {p.linkTtlSeconds}s
                    {p.maxDownloads !== null
                      ? ` • max ${p.maxDownloads} downloads`
                      : ""}
                    {p.requireAuth ? " • requires auth" : ""}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "rgba(30,41,59,0.64)",
                  }}
                >
                  {p.allowedDomains.length
                    ? `${p.allowedDomains.length} domain${p.allowedDomains.length === 1 ? "" : "s"}`
                    : "any domain"}{" "}
                  •{" "}
                  {p.allowedIpRanges.length
                    ? `${p.allowedIpRanges.length} IP range${p.allowedIpRanges.length === 1 ? "" : "s"}`
                    : "any IP"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        title={`Recent documents (${details.recentDocuments.length})`}
      >
        {details.recentDocuments.length === 0 ? (
          <EmptyLine message="No documents uploaded yet." />
        ) : (
          <ul style={listStyle}>
            {details.recentDocuments.map((d) => (
              <li key={d.id} style={rowStyle}>
                <div>
                  <strong style={{ wordBreak: "break-all" }}>
                    {d.filename}
                  </strong>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "rgba(30,41,59,0.64)",
                    }}
                  >
                    {d.contentType ?? "unknown"} • {formatStorage(d.sizeBytes)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "rgba(30,41,59,0.64)",
                    textAlign: "right",
                  }}
                >
                  {d.uploadedAt.toISOString().slice(0, 10)}
                  <br />
                  {d.uploadedByName ?? "unknown"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Shell>
  );
}

function MetricsGrid({ details }: { readonly details: BucketDetails }) {
  return (
    <ul
      role="list"
      style={{
        listStyle: "none",
        padding: 0,
        margin: "0 0 1.5rem",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
        gap: "1rem",
      }}
    >
      <Metric label="Documents" value={String(details.documentCount)} />
      <Metric label="Storage" value={formatStorage(details.storageBytes)} />
      <Metric label="Region" value={details.region} />
      <Metric label="Status" value={details.isActive ? "Active" : "Inactive"} />
    </ul>
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <li
      style={{
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.75rem",
        padding: "1rem",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.6875rem",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: BRAND.colors.blue,
          fontWeight: 600,
        }}
      >
        {label}
      </p>
      <p
        style={{ margin: "0.25rem 0 0", fontSize: "1.25rem", fontWeight: 700 }}
      >
        {value}
      </p>
    </li>
  );
}

function ComplianceList({
  compliance,
}: {
  readonly compliance: BucketDetails["hipaaCompliance"];
}) {
  const items: Array<{ label: string; ok: boolean }> = [
    { label: "SSE-KMS encryption at rest", ok: compliance.sseKms },
    { label: "Versioning enabled", ok: compliance.versioning },
    {
      label: "Public-access block (all 4 blocks)",
      ok: compliance.publicAccessBlock,
    },
    {
      label: "HTTPS-only bucket policy (TLS 1.2+)",
      ok: compliance.httpsOnlyPolicy,
    },
  ];
  return (
    <ul style={listStyle}>
      {items.map((it) => (
        <li key={it.label} style={rowStyle}>
          <span>{it.label}</span>
          <span
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: it.ok ? BRAND.colors.blue : BRAND.colors.pink,
              background: it.ok
                ? `${BRAND.colors.blue}14`
                : `${BRAND.colors.pink}14`,
              padding: "0.25rem 0.5rem",
              borderRadius: "999px",
            }}
          >
            {it.ok ? "Enforced" : "Missing"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <h2
        style={{
          margin: "0 0 0.75rem",
          fontSize: "1.125rem",
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatusBadge({ isActive }: { readonly isActive: boolean }) {
  return (
    <span
      style={{
        background: isActive
          ? `${BRAND.colors.blue}14`
          : `${BRAND.colors.dark}14`,
        color: isActive ? BRAND.colors.blue : BRAND.colors.dark,
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        padding: "0.375rem 0.75rem",
        borderRadius: "999px",
      }}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function EmptyLine({ message }: { readonly message: string }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "1rem",
        background: "#FFFFFF",
        border: `1px dashed ${BRAND.colors.dark}33`,
        borderRadius: "0.5rem",
        color: "rgba(30,41,59,0.64)",
        fontSize: "0.875rem",
      }}
    >
      {message}
    </p>
  );
}

function AccessDenied() {
  return (
    <Shell>
      <p
        role="alert"
        style={{ color: BRAND.colors.pink, textAlign: "center" }}
      >
        You do not have access to this bucket.
      </p>
    </Shell>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <section
      style={{
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      {children}
    </section>
  );
}

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  padding: "0.75rem 1rem",
  background: "#FFFFFF",
  border: `1px solid ${BRAND.colors.dark}1A`,
  borderRadius: "0.5rem",
};
