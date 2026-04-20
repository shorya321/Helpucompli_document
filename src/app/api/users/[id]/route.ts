import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import {
  changeUserRole,
  ForbiddenRoleChangeError,
  userRoleUpdateSchema,
  type RoleChangeResult,
} from "@/lib/user-role-change";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const writeLimiter = createRateLimiter({
  max: 20,
  windowMs: 60_000,
  prefix: "@helpucompli/users-update",
});

const idSchema = z.string().uuid();

type Resp = ApiResponse<RoleChangeResult>;

function json(body: Resp, status: number, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

function extractIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

function extractUserAgent(req: NextRequest): string {
  const ua = req.headers.get("user-agent");
  return ua && ua.length > 0 ? ua : "unknown";
}

export async function PUT(
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

  const quota = await writeLimiter.limit(`users-update:${sub}`);
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

  const parsed = userRoleUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }

  const actorRole = await resolveRole(session);
  if (actorRole !== "superadmin" && actorRole !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const dbUser = await ensureUser(prisma, { session, role: actorRole });

  try {
    const updated = await changeUserRole(prisma, {
      targetUserId: id,
      newRole: parsed.data.role,
      actor: {
        userId: dbUser.id,
        auth0Id: sub,
        role: actorRole,
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
      },
    });
    if (!updated) return json({ data: null, error: "User not found" }, 404);
    return json({ data: updated, error: null }, 200);
  } catch (err) {
    if (err instanceof ForbiddenRoleChangeError) {
      return json({ data: null, error: err.message }, 403);
    }
    return json({ data: null, error: "Failed to update user" }, 500);
  }
}
