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
          New access policy
        </h1>
        <p className="text-muted-foreground mt-1">
          Define IP, referrer, expiry, and download restrictions.
        </p>
      </header>
      <PolicyForm
        buckets={buckets}
        mode="create"
        canNeverExpire={isSuperadmin}
      />
    </section>
  );
}
