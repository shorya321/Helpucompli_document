import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
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

export default async function LinksPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await resolveHasRole(session, ["superadmin", "admin", "viewer"]))) {
    redirect("/");
  }

  const isAdminUp = await resolveHasRole(session, ["superadmin", "admin"]);

  let documents: Array<{
    id: string;
    name: string;
    bucketName: string;
  }> = [];
  let policies: Array<{
    id: string;
    name: string;
    linkTtlSeconds: number;
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
    <main
      style={{
        padding: "2rem",
        maxWidth: "80rem",
        margin: "0 auto",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Share links
        </h1>
        <p style={{ color: "rgba(30,41,59,0.64)", margin: "0.25rem 0 0" }}>
          Generate policy-enforced presigned URLs for external sharing.
        </p>
      </header>

      {isAdminUp ? (
        <>
          <LinkAnalyticsView stats={analytics} />
          <GenerateLinkForm documents={documents} policies={policies} />
          <LinkTable initial={initialLinks} />
        </>
      ) : (
        <p style={{ color: "rgba(30,41,59,0.64)" }}>
          Only admins can generate share links.
        </p>
      )}
    </main>
  );
}
