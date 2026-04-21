import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { GenerateLinkForm } from "@/components/links/generate-link-form";
import { LinkTable } from "@/components/links/link-table";
import { LinkAnalyticsView } from "@/components/links/link-analytics";
import {
  asLinkListPrisma,
  queryLinks,
  type LinkListResult,
} from "@/lib/link-list";
import {
  asLinkAnalyticsPrisma,
  getLinkAnalytics,
  type LinkAnalytics,
} from "@/lib/link-analytics";

export const dynamic = "force-dynamic";

interface LinksPageProps {
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}

export default async function LinksPage({ searchParams }: LinksPageProps) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await resolveHasRole(session, ["superadmin", "admin", "viewer"]))) {
    redirect("/");
  }

  const isAdminUp = await resolveHasRole(session, ["superadmin", "admin"]);
  // "Never expires" for links is superadmin-gated — both UI and API.
  const isSuperadmin = await resolveHasRole(session, ["superadmin"]);

  const params = await searchParams;
  const fromBucketId =
    typeof params.fromBucketId === "string" ? params.fromBucketId : undefined;
  const fromS3Key =
    typeof params.fromS3Key === "string" ? params.fromS3Key : undefined;

  let documents: Array<{
    id: string;
    name: string;
    bucketName: string;
  }> = [];
  let policies: Array<{
    id: string;
    name: string;
    // null = policy issues "never expires" links — superadmin-gated on write.
    linkTtlSeconds: number | null;
    maxDownloads: number | null;
  }> = [];

  let initialLinks: LinkListResult = { rows: [], nextCursor: null };
  let analytics: LinkAnalytics = {
    total: 0,
    active: 0,
    expired: 0,
    revoked: 0,
    topDocuments: [],
  };
  // Resolve the source document from the context-menu deeplink
  // (?fromBucketId=X&fromS3Key=Y). isDeleted excluded so stale links
  // from the doc browser cannot preselect a hidden row. Failure is
  // silent — the form just opens without a preselection.
  let initialDocumentId: string | undefined;
  if (isAdminUp && fromBucketId && fromS3Key) {
    try {
      const doc = await prisma.document.findFirst({
        where: {
          bucketId: fromBucketId,
          s3Key: fromS3Key,
          isDeleted: false,
        },
        select: { id: true },
      });
      if (doc) initialDocumentId = doc.id;
    } catch {
      initialDocumentId = undefined;
    }
  }

  if (isAdminUp) {
    try {
      const [docRows, polRows, linkRes, analyticsRes] = await Promise.all([
        prisma.document.findMany({
          where: { isDeleted: false },
          include: { bucket: { select: { name: true } } },
          orderBy: { uploadedAt: "desc" },
          take: 200,
        }),
        prisma.accessPolicy.findMany({
          select: {
            id: true,
            name: true,
            linkTtlSeconds: true,
            maxDownloads: true,
          },
          orderBy: { name: "asc" },
        }),
        queryLinks(asLinkListPrisma(prisma), {
          status: "all",
          sort: "createdAt",
          dir: "desc",
        }),
        getLinkAnalytics(asLinkAnalyticsPrisma(prisma)),
      ]);
      initialLinks = linkRes;
      analytics = analyticsRes;
      documents = docRows.map((d) => ({
        id: d.id,
        name: d.filename,
        bucketName: d.bucket.name,
      }));
      policies = polRows.map((p) => ({
        id: p.id,
        name: p.name,
        linkTtlSeconds: p.linkTtlSeconds,
        maxDownloads: p.maxDownloads,
      }));
    } catch {
      documents = [];
      policies = [];
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-foreground m-0 text-2xl font-bold tracking-tight">
          Share links
        </h1>
        <p className="text-muted-foreground mt-1">
          Generate policy-enforced presigned URLs for external sharing.
        </p>
      </header>

      {isAdminUp ? (
        <>
          <LinkAnalyticsView stats={analytics} />
          <GenerateLinkForm
            documents={documents}
            policies={policies}
            canNeverExpire={isSuperadmin}
            initialDocumentId={initialDocumentId}
          />
          <LinkTable initial={initialLinks} />
        </>
      ) : (
        <p className="text-muted-foreground">
          Only admins can generate share links.
        </p>
      )}
    </section>
  );
}
