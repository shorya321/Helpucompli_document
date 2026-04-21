import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
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
import { RoleBadge, StatusBadge } from "@/components/users/user-table";
import { formatDate, formatDateTime } from "@/lib/format-datetime";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@/types";

export const dynamic = "force-dynamic";

interface UserDetailsPageProps {
  readonly params: Promise<{ id: string }>;
}

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

  return (
    <section className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/users">
          <ArrowLeft aria-hidden="true" /> Back to users
        </Link>
      </Button>

      <header>
        <h1 className="text-foreground m-0 text-2xl font-bold tracking-tight">
          {target.name ?? target.email}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{target.email}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <DtDd label="Role">
              <RoleBadge role={target.role} />
            </DtDd>
            <DtDd label="Status">
              <StatusBadge status={target.status} />
            </DtDd>
            <DtDd label="Last login">
              <span className="tabular-nums">
                {target.lastLoginAt
                  ? formatDateTime(target.lastLoginAt)
                  : "Never"}
              </span>
            </DtDd>
            <DtDd label="Created">
              <span className="tabular-nums">
                {formatDate(target.createdAt)}
              </span>
            </DtDd>
            <DtDd label="Auth0 ID">
              <code className="text-xs">{target.auth0Id}</code>
            </DtDd>
          </dl>
        </CardContent>
      </Card>

      {target.role === "viewer" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bucket access</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-3 text-xs">
              Only the buckets selected below are visible to this viewer.
            </p>
            <BucketAccess
              userId={target.id}
              allBuckets={allBuckets.map((b) => ({ id: b.id, name: b.name }))}
              initialAssignedIds={assignedBuckets.map((b) => b.bucketId)}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No audited activity for this user yet.
            </p>
          ) : (
            <ul role="list" className="m-0 list-none p-0">
              {audit.rows.map((row) => (
                <ActivityItem key={row.id} row={row} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function DtDd({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        {label}
      </dt>
      <dd className="m-0">{children}</dd>
    </>
  );
}

function ActivityItem({ row }: { readonly row: AuditQueryRow }) {
  return (
    <li className="border-border grid grid-cols-[9rem_1fr_auto] gap-3 border-b py-2 text-xs last:border-b-0">
      <span className="text-muted-foreground tabular-nums">
        {formatDateTime(row.createdAt)}
      </span>
      <span className="text-foreground font-semibold">{row.action}</span>
      <span className="text-muted-foreground text-xs">
        {row.targetType}:{row.targetId}
      </span>
    </li>
  );
}
