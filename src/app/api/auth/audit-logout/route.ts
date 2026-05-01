import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { prisma } from "@/lib/prisma";
import { logAudit, asAuditPrisma } from "@/lib/audit";

// Prisma needs Node runtime — explicit opt-in for grep + future readers.
export const runtime = "nodejs";

// Single hop before Auth0 SDK clears the session: read session → write
// LOGOUT audit row → 302 to /auth/logout (Auth0 SDK route). Audit
// failure NEVER blocks the logout flow.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const target = new URL("/auth/logout", request.url);

  if (process.env.AUDIT_LOGIN_LOGOUT_ENABLED !== "false") {
    try {
      const session = await auth0.getSession();
      if (session?.user?.sub) {
        await logAudit(asAuditPrisma(prisma), {
          userId: session.user.sub,
          action: "LOGOUT",
          targetType: "session",
          targetId: session.user.sub,
          metadata: { email: session.user.email ?? null },
          ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
          userAgent: request.headers.get("user-agent") ?? "unknown",
        });
      }
    } catch (err) {
      // Never block logout on audit failure.
      console.error("[audit-logout] failed", err);
    }
  }

  return NextResponse.redirect(target);
}
