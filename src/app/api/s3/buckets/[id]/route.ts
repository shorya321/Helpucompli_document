import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asBucketDetailsPrisma,
  BucketAccessDeniedError,
  BucketNotFoundError,
  getBucketDetails,
  type BucketDetailsScope,
} from "@/lib/bucket-details";
import { createRateLimiter } from "@/lib/rate-limit";
import { toJsonSafe, type JsonValue } from "@/lib/bigint";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/s3-buckets-details",
});

// Path-param guard. UUIDs are 36 chars — 64 is headroom for any
// legacy id format. Reject payload-style abuse at the boundary.
const idSchema = z.string().min(1).max(64);

function json(
  body: ApiResponse<JsonValue>,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (!role) return json({ data: null, error: "Forbidden" }, 403);

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await limiter.limit(`bucket-details:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const { id } = await ctx.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return json({ data: null, error: "Invalid id" }, 400);

  let scope: BucketDetailsScope;
  if (role === "viewer") {
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    // Viewer without a DB row → 403 (same shape as "not granted"). A
    // 404 here would leak that the bucket exists to un-provisioned
    // viewers.
    if (!dbUser) return json({ data: null, error: "Forbidden" }, 403);
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  try {
    const details = await getBucketDetails(
      asBucketDetailsPrisma(prisma),
      scope,
      parsedId.data,
    );
    return json({ data: toJsonSafe(details), error: null }, 200);
  } catch (err) {
    if (err instanceof BucketAccessDeniedError) {
      return json({ data: null, error: "Forbidden" }, 403);
    }
    if (err instanceof BucketNotFoundError) {
      return json({ data: null, error: "Not Found" }, 404);
    }
    // Prisma engine errors can embed DATABASE_URL — never echo raw.
    return json({ data: null, error: "Failed to load bucket" }, 500);
  }
}
