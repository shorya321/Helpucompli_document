import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ShieldCheck } from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeletePolicyButton } from "@/components/policies/delete-policy-button";
import { formatDate } from "@/lib/format-datetime";

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
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-foreground m-0 text-3xl font-semibold tracking-tight">
            Access policies
          </h1>
          <p className="text-muted-foreground text-sm">
            Restrict link sharing by IP, referrer, expiry, and download count.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/policies/new">
            <Plus aria-hidden="true" />
            New policy
          </Link>
        </Button>
      </header>

      {loadError && (
        <p role="alert" className="text-destructive text-sm">
          Unable to load policies. Try again.
        </p>
      )}

      {rows.length === 0 && !loadError ? (
        <div className="border-border bg-card text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </div>
          <p className="text-sm">
            No policies yet. Create one to start restricting link sharing.
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Restrictions</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {row.targetType}:{row.targetValue}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {summarizeRestrictions(row)}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                    {formatDate(row.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/policies/${row.id}`}>Edit</Link>
                      </Button>
                      <DeletePolicyButton id={row.id} name={row.name} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}
