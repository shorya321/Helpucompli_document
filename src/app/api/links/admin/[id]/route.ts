import { NextRequest, NextResponse } from "next/server";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { ensureUser } from "@/lib/ensure-user";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const limiter = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  prefix: "@helpucompli/link-revoke-byid",
});

interface RouteCtx {
  readonly params: Promise<{ id: string }>;
}

function jsonError(status: number, msg: string) {
  return NextResponse.json(
    { data: null, error: msg },
    {
      status,
      headers: { "Cache-Control": "no-store, private" },
    },
  );
}

// Sec-review C1: revoke is keyed on link.id (UUID), NEVER the bearer
// token. Tokens are returned only once at create time and never appear
// in admin list payloads or audit metadata. This route replaces the
// old DELETE /api/links/[hash] semantics.
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const session = await auth0.getSession();
  if (!session) return jsonError(401, "Unauthorized");
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return jsonError(403, "Forbidden");
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError(400, "Invalid id");

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return jsonError(401, "Unauthorized");
  const quota = await limiter.limit(`link-revoke-byid:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return NextResponse.json(
      { data: null, error: "Too Many Requests" },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store, private",
          "Retry-After": String(retrySec),
        },
      },
    );
  }

  const role = await resolveRole(session);
  if (role !== "superadmin" && role !== "admin") {
    return jsonError(403, "Forbidden");
  }
  const dbUser = await ensureUser(prisma, { session, role });

  const ipAddress = extractIp(req);
  const userAgent = extractUserAgent(req);

  const link = await prisma.generatedLink.findUnique({
    where: { id },
    select: {
      id: true,
      documentId: true,
      policyId: true,
      isRevoked: true,
    },
  });
  if (!link) return jsonError(404, "Not Found");

  const wasAlreadyRevoked = link.isRevoked;
  if (!wasAlreadyRevoked) {
    try {
      await prisma.generatedLink.update({
        where: { id: link.id },
        data: { isRevoked: true },
      });
    } catch {
      return jsonError(500, "Failed to revoke link");
    }
  }

  // Sec-review C2: ALWAYS write a LINK_REVOKE audit row, even on the
  // idempotent path. Tag with reason so compliance can distinguish a
  // first revoke from a redundant one.
  try {
    await prisma.auditLog.create({
      data: {
        userId: dbUser.id,
        action: "LINK_REVOKE",
        targetType: "link",
        targetId: link.id,
        metadata: {
          documentId: link.documentId,
          policyId: link.policyId,
          ...(wasAlreadyRevoked ? { reason: "already-revoked" } : {}),
        },
        ipAddress,
        userAgent,
      },
    });
  } catch {
    // Audit failure is non-fatal — revoke already committed.
  }

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store, private" },
  });
}
