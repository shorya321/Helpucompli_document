import { notFound, redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
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
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-foreground m-0 text-2xl font-bold tracking-tight">
          Edit policy
        </h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm tabular-nums">
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
    </section>
  );
}
