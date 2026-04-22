import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asAuditQueryPrisma,
  queryAuditLogs,
  type AuditQueryResult,
} from "@/lib/audit-query";
import { ShieldAlert } from "lucide-react";

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
      <header className="flex flex-col gap-1.5">
        <h1 className="text-foreground m-0 text-3xl font-semibold tracking-tight">
          Audit log
        </h1>
        <p className="text-muted-foreground text-sm">
          Append-only HIPAA audit trail. 6-year retention.
        </p>
      </header>
      <div
        role="note"
        className="border-border/70 bg-muted/40 text-muted-foreground flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm"
      >
        <ShieldAlert
          aria-hidden="true"
          className="text-foreground/70 mt-0.5 size-4 shrink-0"
        />
        <span>
          No PHI should appear in audit metadata. Report suspected exposure to
          compliance immediately.
        </span>
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
