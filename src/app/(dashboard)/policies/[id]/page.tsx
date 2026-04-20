import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/prisma";
import { PolicyForm } from "@/components/policies/policy-form";
import { asPolicyCrudPrisma, getPolicy } from "@/lib/policy-crud";
import type { PolicyTargetType } from "@/types";

export const dynamic = "force-dynamic";

export default async function EditPolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    redirect("/");
  }

  const { id } = await params;
  // Match the API route's UUID guard (sec-review C1) — refuse to query
  // the DB with arbitrary URL segments. Prevents 404-vs-500 oracle on
  // malformed ids and keeps Prisma engine errors out of the page.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    notFound();
  }
  const policy = await getPolicy(asPolicyCrudPrisma(prisma), id);
  if (!policy) notFound();

  let buckets: Array<{ id: string; name: string }> = [];
  try {
    buckets = await prisma.bucket.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  } catch {
    buckets = [];
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
          Edit policy
        </h1>
        <p
          style={{
            color: "rgba(30,41,59,0.64)",
            margin: "0.25rem 0 0",
            fontFamily: "ui-monospace, monospace",
            fontSize: "0.85rem",
          }}
        >
          {policy.id}
        </p>
      </header>
      <PolicyForm
        buckets={buckets}
        mode="edit"
        initial={{
          id: policy.id,
          name: policy.name,
          targetType: policy.targetType as PolicyTargetType,
          targetValue: policy.targetValue,
          allowedDomains: [...policy.allowedDomains],
          allowedIpRanges: [...policy.allowedIpRanges],
          linkTtlSeconds: policy.linkTtlSeconds,
          maxDownloads: policy.maxDownloads,
          requireAuth: policy.requireAuth,
        }}
      />
    </main>
  );
}
