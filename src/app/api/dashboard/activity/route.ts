import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  activityFeedPayloadSchema,
  asActivityPrisma,
  getRecentActivity,
  type ActivityEntry,
} from "@/lib/activity-feed";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 10 requests / 30s per authenticated user. With a 30s client-side
// poll interval the quota covers normal use (~1 hit per window) with
// headroom for tab refreshes; blocks compromised-token amplification.
// Lazy singleton — construction deferred to first request so `next build`
// never evaluates Upstash env vars during page-data-collection.
let _limiter: ReturnType<typeof createRateLimiter> | null = null;
function getLimiter() {
  if (!_limiter) {
    _limiter = createRateLimiter({
      max: 10,
      windowMs: 30_000,
      prefix: "@helpucompli/dashboard-activity",
    });
  }
  return _limiter;
}

function json<T>(
  body: ApiResponse<T>,
  status: number,
  extraHeaders?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extraHeaders },
  });
}

export async function GET() {
  const session = await auth0.getSession();
  if (!session) {
    return json<readonly ActivityEntry[]>(
      { data: null, error: "Unauthorized" },
      401,
    );
  }
  // Recent audit-log feed spans the whole tenant — admin+ only.
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json<readonly ActivityEntry[]>(
      { data: null, error: "Forbidden" },
      403,
    );
  }

  const sub = session.user.sub as string | undefined;
  const identifier = `activity:${sub ?? "anon"}`;
  const quota = await getLimiter().limit(identifier);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json<readonly ActivityEntry[]>(
      { data: null, error: "Too Many Requests" },
      429,
      { "Retry-After": String(retrySec) },
    );
  }

  try {
    const entries = await getRecentActivity(asActivityPrisma(prisma));
    // Validate shape at the boundary — belt + braces against malformed
    // rows from a buggy writer (e.g. oversized targetId injected by a
    // future API route without length checks). Parse failure surfaces
    // as a 500 with generic error — NEVER echo z.error to the client.
    const parsed = activityFeedPayloadSchema.safeParse(entries);
    if (!parsed.success) {
      return json<readonly ActivityEntry[]>(
        { data: null, error: "Failed to load activity feed" },
        500,
      );
    }
    return json<readonly ActivityEntry[]>(
      { data: parsed.data, error: null },
      200,
    );
  } catch {
    // Engine errors can embed DATABASE_URL (F2.2 sec-review M2).
    return json<readonly ActivityEntry[]>(
      { data: null, error: "Failed to load activity feed" },
      500,
    );
  }
}
