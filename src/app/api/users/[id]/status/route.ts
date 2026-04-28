import { NextRequest, NextResponse } from "next/server";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import {
  changeUserStatus,
  ForbiddenStatusChangeError,
  userStatusUpdateSchema,
  type StatusChangeResult,
} from "@/lib/user-status";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const writeLimiter = createRateLimiter({
  max: 20,
  windowMs: 60_000,
  prefix: "@helpucompli/users-status",
});

const idSchema = z.string().uuid();

type Resp = ApiResponse<StatusChangeResult>;

function json(body: Resp, status: number, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await writeLimiter.limit(`users-status:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return json({ data: null, error: "Invalid user id" }, 400);
  }

  const ctype = req.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    return json({ data: null, error: "Unsupported Media Type" }, 415);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ data: null, error: "Invalid JSON" }, 400);
  }

  const parsed = userStatusUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }

  const actorRole = await resolveRole(session);
  if (actorRole !== "superadmin" && actorRole !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }
  const actor = await ensureUser(prisma, { session, role: actorRole });

  try {
    const updated = await changeUserStatus(prisma, {
      targetUserId: id,
      newStatus: parsed.data.status,
      actor: {
        userId: actor.id,
        role: actorRole,
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
      },
    });
    if (!updated) return json({ data: null, error: "User not found" }, 404);
    return json({ data: updated, error: null }, 200);
  } catch (err) {
    if (err instanceof ForbiddenStatusChangeError) {
      return json({ data: null, error: err.message }, 403);
    }
    // Surface unexpected errors to the server log so the operator can
    // diagnose Auth0 tenant config issues (missing update:users scope,
    // rate limit, etc) without reading the client response. err.message
    // may echo Auth0 body text — stay server-side, never return verbatim.
    const name = err instanceof Error ? err.name : "Unknown";
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[PATCH /api/users/[id]/status] failed: ${name}: ${message}`,
    );
    return json({ data: null, error: "Failed to update status" }, 500);
  }
}
