import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { ensureUser } from "@/lib/ensure-user";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

// Node runtime — Prisma is not edge-safe.
export const runtime = "nodejs";
// Audit write is per-request; cannot be cached.
export const dynamic = "force-dynamic";

const LOGOUT_REDIRECT = "/auth/logout";

function envEnabled(): boolean {
  return process.env.AUDIT_LOGIN_LOGOUT_ENABLED !== "false";
}

function readSid(session: { internal?: { sid?: unknown } } | null): string | null {
  const sid = session?.internal?.sid;
  return typeof sid === "string" && sid.length > 0 ? sid : null;
}

function redirectToAuth0Logout(request: NextRequest): NextResponse {
  // 307 preserves method (anchor = GET, harmless either way) and tells
  // the browser this is temporary — Auth0 SDK owns /auth/logout.
  return NextResponse.redirect(new URL(LOGOUT_REDIRECT, request.url), 307);
}

// Records LOGOUT audit (best-effort), then hands off to Auth0 SDK's
// /auth/logout to actually clear the session cookie. The audit write
// runs while the session is still valid; redirect happens regardless of
// audit success so users can never get stuck mid-logout.
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!envEnabled()) return redirectToAuth0Logout(request);

  let session: Awaited<ReturnType<typeof auth0.getSession>> = null;
  try {
    session = await auth0.getSession();
  } catch {
    return redirectToAuth0Logout(request);
  }
  if (!session) return redirectToAuth0Logout(request);

  const sid = readSid(session);
  if (!sid) return redirectToAuth0Logout(request);

  try {
    const role = await resolveRole(session);
    if (!role) return redirectToAuth0Logout(request);

    const dbUser = await ensureUser(prisma, { session, role });

    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    await logAudit(prisma, {
      userId: dbUser.id,
      action: "LOGOUT",
      targetType: "session",
      targetId: sid,
      metadata: { sessionId: sid },
      ipAddress,
      userAgent,
    });
  } catch {
    // Swallow — never block logout on audit failure.
  }

  return redirectToAuth0Logout(request);
}
