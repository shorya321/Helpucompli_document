import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { PolicyForm } from "@/components/policies/policy-form";

export const dynamic = "force-dynamic";

export default async function NewPolicyPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    redirect("/");
  }
  const isSuperadmin = await resolveHasRole(session, ["superadmin"]);

  let buckets: Array<{ id: string; name: string }> = [];
  let documents: Array<{
    id: string;
    filename: string;
    s3Key: string;
    bucketName: string;
  }> = [];
  try {
    [buckets, documents] = await Promise.all([
      prisma.bucket.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.document
        .findMany({
          where: { isDeleted: false },
          include: { bucket: { select: { name: true } } },
          orderBy: { uploadedAt: "desc" },
          take: 200,
        })
        .then((rows) =>
          rows.map((d) => ({
            id: d.id,
            filename: d.filename,
            s3Key: d.s3Key,
            bucketName: d.bucket.name,
          })),
        ),
    ]);
  } catch {
    buckets = [];
    documents = [];
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-foreground m-0 text-2xl font-bold tracking-tight">
          New access policy
        </h1>
        <p className="text-muted-foreground mt-1">
          Define IP, referrer, expiry, and download restrictions.
        </p>
      </header>
      <PolicyForm
        buckets={buckets}
        documents={documents}
        mode="create"
        canNeverExpire={isSuperadmin}
      />
    </section>
  );
}
