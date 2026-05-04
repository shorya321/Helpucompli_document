import type { SessionData } from "@auth0/nextjs-auth0/types";
import { logAudit, type AuditPrisma } from "@/lib/audit";

// Narrow Prisma surface for the dedup query. Bivariant method syntax
// keeps both real PrismaClient and test stubs assignable (same pattern
// used in src/lib/audit.ts and src/lib/dashboard-stats.ts).
export interface LoginAuditPrisma extends AuditPrisma {
  readonly auditLog: AuditPrisma["auditLog"] & {
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<{ id: string } | null>;
  };
}

export interface LogLoginOnceOptions {
  readonly userDbId: string;
  readonly headers: Headers;
}

function envEnabled(): boolean {
  return process.env.AUDIT_LOGIN_LOGOUT_ENABLED !== "false";
}

function readSid(session: SessionData): string | null {
  const sid = (session as { internal?: { sid?: unknown } }).internal?.sid;
  return typeof sid === "string" && sid.length > 0 ? sid : null;
}

// Idempotent LOGIN audit writer. Called from the dashboard server-
// component layout AFTER getSession() + ensureUser(). Dedup key is
// session.internal.sid (Auth0 v4 — unique per session). Errors are
// swallowed so a failing audit never blocks dashboard render.
export async function logLoginOnce(
  prisma: LoginAuditPrisma,
  session: SessionData,
  opts: LogLoginOnceOptions,
): Promise<void> {
  if (!envEnabled()) return;
  const sid = readSid(session);
  if (!sid) return;

  try {
    const existing = await prisma.auditLog.findFirst({
      where: {
        userId: opts.userDbId,
        action: "LOGIN",
        metadata: { path: ["sessionId"], equals: sid },
      },
    });
    if (existing) return;

    const ipAddress =
      opts.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = opts.headers.get("user-agent") || "unknown";

    await logAudit(prisma, {
      userId: opts.userDbId,
      action: "LOGIN",
      targetType: "session",
      targetId: sid,
      metadata: { sessionId: sid },
      ipAddress,
      userAgent,
    });
  } catch {
    // Never block the dashboard render on audit failure. Pino logging
    // would be ideal but we don't have a request-scoped logger here;
    // failures are visible via the missing audit row.
  }
}
