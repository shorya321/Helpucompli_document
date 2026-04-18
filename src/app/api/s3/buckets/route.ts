import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asBucketListPrisma,
  getBucketList,
  parseBucketListQuery,
  type BucketListScope,
  type BucketSummary,
} from "@/lib/bucket-list";
import { createRateLimiter } from "@/lib/rate-limit";
import { toJsonSafe, type JsonValue } from "@/lib/bigint";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 30 requests / 30s per authenticated user. Covers the bucket list
// page load + filter/sort toggles + a few manual refreshes with room
// to spare. Blocks token-amplification abuse.
const limiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/s3-buckets",
});

type RouteResponse = ApiResponse<readonly BucketSummary[] | JsonValue>;

function json(
  body: RouteResponse,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (!role) return json({ data: null, error: "Forbidden" }, 403);

  // Explicit sub guard — `sub ?? "anon"` would turn `""` into a shared
  // rate-limit bucket across every token-misconfigured request, letting
  // one bad client 429 legitimate users.
  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);
  const quota = await limiter.limit(`buckets:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const options = parseBucketListQuery(params);
  if (options === null) {
    return json({ data: null, error: "Invalid query" }, 400);
  }

  let scope: BucketListScope;
  if (role === "viewer") {
    if (!sub) return json({ data: [], error: null }, 200);
    // Map Auth0 sub → internal User.id for the UserBucketAccess join.
    // Viewers without a provisioned DB row simply have no assigned
    // buckets — return an empty list rather than 403, so first-login
    // users see an empty state instead of a permission error page.
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    if (!dbUser) return json({ data: [], error: null }, 200);
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  try {
    const list = await getBucketList(
      asBucketListPrisma(prisma),
      scope,
      options,
    );
    // BigInt storageBytes — serialise safely at the response boundary.
    return json({ data: toJsonSafe(list), error: null }, 200);
  } catch {
    // NEVER pass the raw error — Prisma engine messages can embed the
    // DATABASE_URL (F2.2 sec-review M2).
    return json({ data: null, error: "Failed to load buckets" }, 500);
  }
}
