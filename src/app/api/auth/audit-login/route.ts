import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { prisma } from "@/lib/prisma";
import { logAudit, asAuditPrisma } from "@/lib/audit";

// Prisma needs Node runtime — explicit opt-in for grep + future readers.
export const runtime = "nodejs";

// Single hop after Auth0 callback: read session → write LOGIN audit row →
// 302 to ?to=<original returnTo>. Audit failure NEVER blocks the redirect.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawTo = request.nextUrl.searchParams.get("to") ?? "/";
  const safeTo =
    rawTo.startsWith("/") && !rawTo.startsWith("//") ? rawTo : "/";
  const target = new URL(safeTo, request.url);

  if (process.env.AUDIT_LOGIN_LOGOUT_ENABLED !== "false") {
    try {
      const session = await auth0.getSession();
      if (session?.user?.sub) {
        await logAudit(asAuditPrisma(prisma), {
          userId: session.user.sub,
          action: "LOGIN",
          targetType: "session",
          targetId: session.user.sub,
          metadata: { email: session.user.email ?? null },
          ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
          userAgent: request.headers.get("user-agent") ?? "unknown",
        });
      }
    } catch (err) {
      // Never block login on audit failure.
      console.error("[audit-login] failed", err);
    }
  }

  return NextResponse.redirect(target);
}
