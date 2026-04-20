import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import { getUserBuckets } from "@/lib/user-bucket-access";
import {
  asBucketListPrisma,
  getBucketList,
  type BucketSummary,
} from "@/lib/bucket-list";
import {
  asAuditQueryPrisma,
  queryAuditLogs,
  type AuditQueryRow,
} from "@/lib/audit-query";
import { BucketAccess } from "@/components/users/bucket-access";
import type { Role } from "@/types";

export const dynamic = "force-dynamic";

interface UserDetailsPageProps {
  readonly params: Promise<{ id: string }>;
}

const ROLE_STYLES: Record<Role, { bg: string; fg: string }> = {
  superadmin: { bg: "#E91E8C", fg: "#FFFFFF" },
  admin: { bg: "#2563EB", fg: "#FFFFFF" },
  viewer: { bg: "#E2E8F0", fg: "#1E293B" },
};

export default async function UserDetailsPage({
  params,
}: UserDetailsPageProps) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const actorRole = await resolveRole(session);
  if (actorRole !== "superadmin" && actorRole !== "admin") {
    redirect("/");
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  await ensureUser(prisma, { session, role: actorRole });

  const target = (await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      auth0Id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
    },
  })) as
    | {
        id: string;
        auth0Id: string;
        email: string;
        name: string | null;
        role: Role;
        status: "active" | "disabled";
        createdAt: Date;
        lastLoginAt: Date | null;
      }
    | null;

  if (!target) notFound();

  const [assignedBuckets, allBuckets, audit] = await Promise.all([
    target.role === "viewer" ? getUserBuckets(prisma, target.id) : Promise.resolve([]),
    target.role === "viewer"
      ? getBucketList(asBucketListPrisma(prisma), { role: "superadmin" })
      : Promise.resolve<ReadonlyArray<BucketSummary>>([]),
    queryAuditLogs(asAuditQueryPrisma(prisma), {
      userId: target.id,
      limit: 25,
    }),
  ]);

  const roleStyle = ROLE_STYLES[target.role];

  return (
    <main
      style={{
        padding: "2rem",
        maxWidth: "72rem",
        margin: "0 auto",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <Link
        href="/users"
        style={{
          color: BRAND.colors.blue,
          fontSize: "0.85rem",
          textDecoration: "none",
        }}
      >
        ← Back to users
      </Link>

      <header style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          {target.name ?? target.email}
        </h1>
        <p
          style={{
            color: "rgba(30,41,59,0.64)",
            margin: "0.25rem 0 0",
            fontSize: "0.85rem",
          }}
        >
          {target.email}
        </p>
      </header>

      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.5rem",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={headingStyle}>Profile</h2>
        <dl style={dlStyle}>
          <DtDd label="Role">
            <span
              style={{
                background: roleStyle.bg,
                color: roleStyle.fg,
                padding: "0.15rem 0.55rem",
                borderRadius: "999px",
                fontSize: "0.7rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {target.role}
            </span>
          </DtDd>
          <DtDd label="Status">
            <span
              style={{
                background:
                  target.status === "active" ? "#16A34A" : "#DC2626",
                color: "#FFFFFF",
                padding: "0.15rem 0.55rem",
                borderRadius: "999px",
                fontSize: "0.7rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {target.status}
            </span>
          </DtDd>
          <DtDd label="Last login">
            {target.lastLoginAt
              ? target.lastLoginAt.toLocaleString()
              : "Never"}
          </DtDd>
          <DtDd label="Created">
            {target.createdAt.toLocaleDateString()}
          </DtDd>
          <DtDd label="Auth0 ID">
            <code style={{ fontSize: "0.75rem" }}>{target.auth0Id}</code>
          </DtDd>
        </dl>
      </section>

      {target.role === "viewer" && (
        <section
          style={{
            background: "#FFFFFF",
            border: `1px solid ${BRAND.colors.dark}1A`,
            borderRadius: "0.5rem",
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={headingStyle}>Bucket access</h2>
          <p
            style={{
              color: "rgba(30,41,59,0.64)",
              fontSize: "0.8rem",
              margin: "0 0 0.75rem",
            }}
          >
            Only the buckets selected below are visible to this viewer.
          </p>
          <BucketAccess
            userId={target.id}
            allBuckets={allBuckets.map((b) => ({ id: b.id, name: b.name }))}
            initialAssignedIds={assignedBuckets.map((b) => b.bucketId)}
          />
        </section>
      )}

      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.5rem",
          padding: "1rem 1.25rem",
        }}
      >
        <h2 style={headingStyle}>Recent activity</h2>
        {audit.rows.length === 0 ? (
          <p style={{ color: "rgba(30,41,59,0.64)", fontSize: "0.85rem" }}>
            No audited activity for this user yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {audit.rows.map((row) => (
              <ActivityItem key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

const headingStyle: React.CSSProperties = {
  fontSize: "0.95rem",
  fontWeight: 700,
  margin: "0 0 0.75rem",
};

const dlStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "9rem 1fr",
  gap: "0.35rem 0.75rem",
  margin: 0,
  fontSize: "0.85rem",
};

function DtDd({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <>
      <dt
        style={{
          color: "rgba(30,41,59,0.56)",
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </>
  );
}

function ActivityItem({ row }: { readonly row: AuditQueryRow }) {
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "9rem 1fr auto",
        gap: "0.75rem",
        padding: "0.55rem 0",
        borderBottom: `1px solid ${BRAND.colors.dark}0F`,
        fontSize: "0.8rem",
      }}
    >
      <span
        style={{
          color: "rgba(30,41,59,0.56)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {row.createdAt.toLocaleString()}
      </span>
      <span style={{ fontWeight: 600 }}>{row.action}</span>
      <span
        style={{
          color: "rgba(30,41,59,0.56)",
          fontFamily: "ui-monospace, monospace",
          fontSize: "0.75rem",
        }}
      >
        {row.targetType}:{row.targetId}
      </span>
    </li>
  );
}
