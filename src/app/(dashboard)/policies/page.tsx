import Link from "next/link";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asPolicyListPrisma,
  getPolicyList,
  summarizeRestrictions,
  type PolicyListRow,
} from "@/lib/policy-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeletePolicyButton } from "@/components/policies/delete-policy-button";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    redirect("/");
  }

  let rows: readonly PolicyListRow[] = [];
  let loadError = false;
  try {
    rows = await getPolicyList(asPolicyListPrisma(prisma));
  } catch {
    loadError = true;
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground m-0 text-2xl font-bold tracking-tight">
            Access policies
          </h1>
          <p className="text-muted-foreground mt-1">
            Restrict link sharing by IP, referrer, expiry, and download count.
          </p>
        </div>
        <Button asChild>
          <Link href="/policies/new">+ New policy</Link>
        </Button>
      </header>

      {loadError && (
        <p role="alert" className="text-destructive text-sm">
          Unable to load policies. Try again.
        </p>
      )}

      {rows.length === 0 && !loadError ? (
        <div className="border-border bg-card text-muted-foreground rounded-lg border border-dashed p-6 text-center">
          No policies yet. Create one to start restricting link sharing.
        </div>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50">
                {["Name", "Target", "Restrictions", "Updated", ""].map((h) => (
                  <th
                    key={h}
                    className="text-muted-foreground border-border border-b px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-border/50 border-b">
                  <td className="text-foreground px-4 py-2.5 font-semibold">
                    {row.name}
                  </td>
                  <td className="text-foreground px-4 py-2.5 font-mono text-sm tabular-nums">
                    {row.targetType}:{row.targetValue}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    {summarizeRestrictions(row)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 font-mono tabular-nums">
                    {row.updatedAt.toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/policies/${row.id}`}>Edit</Link>
                    </Button>
                    <DeletePolicyButton id={row.id} name={row.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
