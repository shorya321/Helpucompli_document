import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/prisma";
import { PolicyForm } from "@/components/policies/policy-form";

export const dynamic = "force-dynamic";

export default async function NewPolicyPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    redirect("/");
  }

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
          New access policy
        </h1>
        <p style={{ color: "rgba(30,41,59,0.64)", margin: "0.25rem 0 0" }}>
          Define IP, referrer, expiry, and download restrictions.
        </p>
      </header>
      <PolicyForm buckets={buckets} mode="create" />
    </main>
  );
}
