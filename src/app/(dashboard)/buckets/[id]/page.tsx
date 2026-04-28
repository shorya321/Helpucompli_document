import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Globe,
  HardDrive,
  Trash2,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
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
import { RecentDocsList } from "@/components/buckets/recent-docs-list";
import { createRateLimiter } from "@/lib/rate-limit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

  // Missing sub must not bypass the rate-limit.
  const sub = session?.user.sub as string | undefined;
  if (!sub) return <AccessDenied />;

  const quota = await pageLimiter.limit(`bucket-details-page:${sub}`);
  if (!quota.success) {
    return (
      <Shell>
        <Card>
          <CardContent className="py-6">
            <p role="alert" className="text-destructive text-center text-sm">
              You are refreshing too fast. Please wait a moment.
            </p>
          </CardContent>
        </Card>
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
        <Card>
          <CardContent className="py-6">
            <p role="alert" className="text-destructive text-center text-sm">
              Unable to load bucket details. Please try again.
            </p>
          </CardContent>
        </Card>
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

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function DetailsView({
  details,
  canDelete,
  canVerify,
}: {
  readonly details: BucketDetails;
  readonly canDelete: boolean;
  readonly canVerify: boolean;
}) {
  const subtitleParts: string[] = [
    `Created ${DATE_FORMAT.format(details.createdAt)}`,
    details.region,
  ];
  if (details.description) subtitleParts.push(details.description);

  return (
    <Shell>
      <header className="flex flex-col gap-1.5">
        <Link
          href="/buckets"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs no-underline transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="size-3" />
          All buckets
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-foreground m-0 break-all text-3xl font-semibold tracking-tight">
              {details.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {subtitleParts.map((part, i) => (
                <span key={i}>
                  {i > 0 ? <span className="px-2">·</span> : null}
                  <span className={i === 1 ? "font-mono tabular-nums" : ""}>
                    {part}
                  </span>
                </span>
              ))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={details.isActive ? "secondary" : "outline"}>
              {details.isActive ? "Active" : "Inactive"}
            </Badge>
            {canDelete && details.isActive ? (
              <Button variant="outline" size="sm" asChild>
                <a href={`/buckets/${details.id}?delete=1`}>
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Decommission bucket
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <MetricsGrid details={details} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-foreground m-0 text-base font-semibold tracking-tight">
              HIPAA compliance
            </h2>
            <p className="text-muted-foreground m-0 text-xs">
              Enforced by infrastructure design — verified live by an admin.
            </p>
          </div>
        </div>
        <ComplianceList compliance={details.hipaaCompliance} />
        {canVerify ? <ComplianceVerifier bucketId={details.id} /> : null}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-foreground m-0 text-base font-semibold tracking-tight">
            Access policies
          </h2>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {details.accessPolicies.length}
            {details.accessPolicies.length === 1 ? " policy" : " policies"}
          </span>
        </div>
        <PoliciesList policies={details.accessPolicies} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-foreground m-0 text-base font-semibold tracking-tight">
            Recent documents
          </h2>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {details.documentCount} total
          </span>
        </div>
        <RecentDocsList
          bucketId={details.id}
          initial={details.recentDocuments}
          initialNextCursor={
            details.documentCount > details.recentDocuments.length &&
            details.recentDocuments.length > 0
              ? details.recentDocuments[details.recentDocuments.length - 1]!.id
              : null
          }
        />
      </section>
    </Shell>
  );
}

function MetricsGrid({ details }: { readonly details: BucketDetails }) {
  return (
    <ul
      role="list"
      className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4 p-0 md:gap-5"
    >
      <KpiCard
        label="Documents"
        value={String(details.documentCount)}
        icon={FileText}
        sub="uploaded all-time"
      />
      <KpiCard
        label="Storage"
        value={formatStorage(details.storageBytes)}
        icon={HardDrive}
        sub={`across ${details.documentCount} document${details.documentCount === 1 ? "" : "s"}`}
      />
      <KpiCard
        label="Region"
        value={details.region}
        valueClassName="text-2xl"
        icon={Globe}
        sub="AWS S3"
      />
      <KpiCard
        label="Status"
        value={details.isActive ? "Active" : "Inactive"}
        valueClassName="text-2xl"
        icon={Activity}
        statusDot={details.isActive ? "active" : "inactive"}
      />
    </ul>
  );
}

interface KpiCardProps {
  readonly label: string;
  readonly value: string;
  readonly icon: LucideIcon;
  readonly sub?: string;
  readonly valueClassName?: string;
  readonly statusDot?: "active" | "inactive";
}

function KpiCard({
  label,
  value,
  icon: Icon,
  sub,
  valueClassName,
  statusDot,
}: KpiCardProps) {
  return (
    <li>
      <Card className="group h-full gap-3 py-5 hover:shadow-md">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-0">
          <CardTitle className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            {label}
          </CardTitle>
          <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </CardHeader>
        <CardContent>
          <div
            className={`text-foreground flex items-center gap-2 font-mono font-semibold tracking-tight tabular-nums ${valueClassName ?? "text-3xl"}`}
          >
            {statusDot ? (
              <span
                aria-hidden="true"
                className={`inline-block size-2 rounded-full ${statusDot === "active" ? "bg-foreground" : "bg-muted-foreground"}`}
              />
            ) : null}
            {value}
          </div>
          {sub ? (
            <p className="text-muted-foreground mt-1.5 text-xs">{sub}</p>
          ) : null}
        </CardContent>
      </Card>
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
    <Card className="overflow-hidden py-0">
      <ul
        role="list"
        className="m-0 flex list-none flex-col divide-y divide-border/60 p-0"
      >
        {items.map((it) => {
          const Icon = it.ok ? CheckCircle2 : XCircle;
          return (
            <li
              key={it.label}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
            >
              <Icon
                aria-hidden="true"
                className={`size-4 ${it.ok ? "text-foreground" : "text-destructive"}`}
              />
              <span className="text-foreground text-sm font-medium">
                {it.label}
              </span>
              <Badge
                variant={it.ok ? "secondary" : "destructive"}
                className="ml-auto whitespace-nowrap text-[10px] uppercase tracking-wide"
              >
                {it.ok ? "Enforced" : "Missing"}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PoliciesList({
  policies,
}: {
  readonly policies: BucketDetails["accessPolicies"];
}) {
  if (policies.length === 0) {
    return <EmptyCard message="No bucket-level policies defined." />;
  }
  return (
    <Card className="overflow-hidden py-0">
      <ul
        role="list"
        className="m-0 flex list-none flex-col divide-y divide-border/60 p-0"
      >
        {policies.map((p) => {
          const meta: string[] = [`TTL ${p.linkTtlSeconds}s`];
          if (p.maxDownloads !== null)
            meta.push(`max ${p.maxDownloads} downloads`);
          if (p.requireAuth) meta.push("requires auth");
          const restriction =
            p.allowedDomains.length === 0 && p.allowedIpRanges.length === 0
              ? "any source"
              : [
                  p.allowedDomains.length > 0
                    ? `${p.allowedDomains.length} domain${p.allowedDomains.length === 1 ? "" : "s"}`
                    : null,
                  p.allowedIpRanges.length > 0
                    ? `${p.allowedIpRanges.length} IP range${p.allowedIpRanges.length === 1 ? "" : "s"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
          return (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-foreground truncate text-sm font-medium">
                  {p.name}
                </span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {meta.join(" · ")}
                </span>
              </div>
              <Badge
                variant="outline"
                className="ml-auto whitespace-nowrap text-[10px] uppercase tracking-wide"
              >
                {restriction}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function EmptyCard({ message }: { readonly message: string }) {
  return (
    <Card>
      <CardContent className="py-6 text-center">
        <p className="text-muted-foreground m-0 text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}

function AccessDenied() {
  return (
    <Shell>
      <Card>
        <CardContent className="py-6">
          <p role="alert" className="text-destructive text-center text-sm">
            You do not have access to this bucket.
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return <section className="flex flex-col gap-8">{children}</section>;
}
