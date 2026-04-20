import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
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
          Audit log
        </h1>
        <p style={{ color: "rgba(30,41,59,0.64)", margin: "0.25rem 0 0" }}>
          Append-only HIPAA audit trail. 6-year retention.
        </p>
      </header>
      {loadError ? (
        <p role="alert" style={{ color: BRAND.colors.pink }}>
          Unable to load audit log. Check service status and try again.
        </p>
      ) : (
        <AuditTable initial={initial} />
      )}
    </main>
  );
}
