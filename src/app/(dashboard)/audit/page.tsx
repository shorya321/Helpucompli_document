import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asAuditQueryPrisma,
  queryAuditLogs,
  type AuditQueryResult,
} from "@/lib/audit-query";
import { AuditTable } from "@/components/audit/audit-table";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    redirect("/");
  }

  let initial: AuditQueryResult = { rows: [], nextCursor: null };
  let loadError = false;
  try {
    initial = await queryAuditLogs(asAuditQueryPrisma(prisma), { limit: 50 });
  } catch {
    loadError = true;
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-foreground m-0 text-2xl font-bold tracking-tight">
          Audit log
        </h1>
        <p className="text-muted-foreground mt-1">
          Append-only HIPAA audit trail. 6-year retention.
        </p>
      </header>
      <div className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-xs">
        No PHI should appear in audit metadata. Report suspected exposure to
        compliance immediately.
      </div>
      {loadError ? (
        <p role="alert" className="text-destructive text-sm">
          Unable to load audit log. Check service status and try again.
        </p>
      ) : (
        <AuditTable initial={initial} />
      )}
    </section>
  );
}
