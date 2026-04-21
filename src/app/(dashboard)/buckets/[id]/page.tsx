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
        <p role="alert" className="text-destructive text-center">
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
        <p role="alert" className="text-destructive">
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
      <nav className="mb-4 text-sm">
        <Link
          href="/buckets"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 no-underline"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          All buckets
        </Link>
      </nav>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground m-0 break-all text-2xl font-bold tracking-tight">
            {details.name}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm tabular-nums">
            Created {details.createdAt.toISOString().slice(0, 10)} •{" "}
            {details.region}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={details.isActive ? "secondary" : "outline"}>
            {details.isActive ? "Active" : "Inactive"}
          </Badge>
          {canDelete && details.isActive ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/buckets/${details.id}?delete=1`}>Delete bucket</a>
            </Button>
          ) : null}
        </div>
      </header>

      {details.description ? (
        <Card className="mb-6">
          <CardContent className="text-muted-foreground px-4 py-3 text-sm">
            {details.description}
          </CardContent>
        </Card>
      ) : null}

      <MetricsGrid details={details} />
      <Section title="HIPAA compliance (enforced by design)">
        <ComplianceList compliance={details.hipaaCompliance} />
        {canVerify ? (
          <div className="mt-3">
            <ComplianceVerifier bucketId={details.id} />
          </div>
        ) : null}
      </Section>
      <Section title={`Access policies (${details.accessPolicies.length})`}>
        {details.accessPolicies.length === 0 ? (
          <EmptyLine message="No bucket-level policies defined." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {details.accessPolicies.map((p) => (
              <li key={p.id}>
                <Card>
                  <CardContent className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <strong className="text-foreground">{p.name}</strong>
                      <div className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                        TTL {p.linkTtlSeconds}s
                        {p.maxDownloads !== null
                          ? ` • max ${p.maxDownloads} downloads`
                          : ""}
                        {p.requireAuth ? " • requires auth" : ""}
                      </div>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {p.allowedDomains.length
                        ? `${p.allowedDomains.length} domain${p.allowedDomains.length === 1 ? "" : "s"}`
                        : "any domain"}{" "}
                      •{" "}
                      {p.allowedIpRanges.length
                        ? `${p.allowedIpRanges.length} IP range${p.allowedIpRanges.length === 1 ? "" : "s"}`
                        : "any IP"}
                    </div>
                  </CardContent>
                </Card>
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
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {details.recentDocuments.map((d) => (
              <li key={d.id}>
                <Card>
                  <CardContent className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <strong className="text-foreground break-all">
                        {d.filename}
                      </strong>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {d.contentType ?? "unknown"} •{" "}
                        {formatStorage(d.sizeBytes)}
                      </div>
                    </div>
                    <div className="text-muted-foreground text-right text-xs tabular-nums">
                      {d.uploadedAt.toISOString().slice(0, 10)}
                      <br />
                      {d.uploadedByName ?? "unknown"}
                    </div>
                  </CardContent>
                </Card>
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
      className="m-0 mb-6 grid list-none grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4 p-0"
    >
      <Metric
        label="Documents"
        value={String(details.documentCount)}
        icon={FileText}
      />
      <Metric
        label="Storage"
        value={formatStorage(details.storageBytes)}
        icon={HardDrive}
      />
      <Metric label="Region" value={details.region} icon={Globe} />
      <Metric
        label="Status"
        value={details.isActive ? "Active" : "Inactive"}
        icon={Activity}
      />
    </ul>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly icon: LucideIcon;
}) {
  return (
    <li>
      <Card className="h-full gap-2 py-5">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
          <Icon
            aria-hidden="true"
            className="text-muted-foreground h-4 w-4"
          />
        </CardHeader>
        <CardContent>
          <div className="text-foreground text-2xl font-bold tabular-nums">
            {value}
          </div>
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
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((it) => {
        const Icon = it.ok ? CheckCircle2 : XCircle;
        return (
          <li key={it.label}>
            <Card>
              <CardContent className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="flex items-center gap-2 text-sm">
                  <Icon
                    aria-hidden="true"
                    className={
                      it.ok
                        ? "text-foreground h-4 w-4"
                        : "text-destructive h-4 w-4"
                    }
                  />
                  {it.label}
                </span>
                <Badge variant={it.ok ? "secondary" : "destructive"}>
                  {it.ok ? "Enforced" : "Missing"}
                </Badge>
              </CardContent>
            </Card>
          </li>
        );
      })}
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
    <section className="mb-6">
      <h2 className="text-foreground mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function EmptyLine({ message }: { readonly message: string }) {
  return (
    <p className="border-border bg-card text-muted-foreground m-0 rounded-md border border-dashed px-4 py-3 text-sm">
      {message}
    </p>
  );
}

function AccessDenied() {
  return (
    <Shell>
      <p role="alert" className="text-destructive text-center">
        You do not have access to this bucket.
      </p>
    </Shell>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return <section className="text-foreground">{children}</section>;
}
