import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import {
  bucketAccessUpdateSchema,
  getUserBuckets,
  setUserBuckets,
  type BucketAccessDiff,
  type UserBucketAccessRow,
} from "@/lib/user-bucket-access";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const readLimiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/user-buckets-get",
});

const writeLimiter = createRateLimiter({
  max: 10,
  windowMs: 60_000,
  prefix: "@helpucompli/user-buckets-put",
});

const idSchema = z.string().uuid();

type GetResp = ApiResponse<readonly UserBucketAccessRow[]>;
type PutResp = ApiResponse<BucketAccessDiff>;

function json(
  body: GetResp | PutResp,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

async function ensureTargetExists(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  return Boolean(row);
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await readLimiter.limit(`user-buckets-get:${sub}`);
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

  if (!(await ensureTargetExists(id))) {
    return json({ data: null, error: "User not found" }, 404);
  }

  try {
    const rows = await getUserBuckets(prisma, id);
    return json({ data: rows, error: null }, 200);
  } catch {
    return json({ data: null, error: "Failed to load bucket access" }, 500);
  }
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

  const quota = await writeLimiter.limit(`user-buckets-put:${sub}`);
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

  const parsed = bucketAccessUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }

  const actorRole = await resolveRole(session);
  if (actorRole !== "superadmin" && actorRole !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }
  const actor = await ensureUser(prisma, { session, role: actorRole });

  if (!(await ensureTargetExists(id))) {
    return json({ data: null, error: "User not found" }, 404);
  }

  try {
    const diff = await setUserBuckets(prisma, {
      userId: id,
      bucketIds: parsed.data.bucketIds,
      grantedById: actor.id,
    });
    return json({ data: diff, error: null }, 200);
  } catch {
    return json({ data: null, error: "Failed to update bucket access" }, 500);
  }
}
