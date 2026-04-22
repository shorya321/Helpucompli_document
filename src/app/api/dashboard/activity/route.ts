import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  ACTIVITY_FEED_LIMIT,
  ACTIVITY_FEED_PAGE_LIMIT_MAX,
  activityFeedPageSchema,
  activityFeedPayloadSchema,
  asActivityPrisma,
  getRecentActivity,
  getRecentActivityPage,
  type ActivityEntry,
  type ActivityFeedPage,
} from "@/lib/activity-feed";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

// Query schema — bounded sizes prevent a malicious or buggy client from
// triggering pathological cursor lookups or oversized DB scans.
const querySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ACTIVITY_FEED_PAGE_LIMIT_MAX)
    .optional(),
});

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

type ActivityResponse = readonly ActivityEntry[] | ActivityFeedPage;

export async function GET(request?: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return json<ActivityResponse>(
      { data: null, error: "Unauthorized" },
      401,
    );
  }
  // Recent audit-log feed spans the whole tenant — admin+ only.
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json<ActivityResponse>(
      { data: null, error: "Forbidden" },
      403,
    );
  }

  const sub = session.user.sub as string | undefined;
  const identifier = `activity:${sub ?? "anon"}`;
  const quota = await getLimiter().limit(identifier);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json<ActivityResponse>(
      { data: null, error: "Too Many Requests" },
      429,
      { "Retry-After": String(retrySec) },
    );
  }

  // Parse query — generic 400 on failure; never echo Zod issues.
  // Tests sometimes invoke GET() without a request arg (old contract);
  // treat that as "no params" so the array-shaped response is returned.
  let cursorParam: string | undefined;
  let limitParam: string | undefined;
  if (request) {
    try {
      const url = new URL(request.url);
      cursorParam = url.searchParams.get("cursor") ?? undefined;
      limitParam = url.searchParams.get("limit") ?? undefined;
    } catch {
      // Malformed request URL — treat as no params.
    }
  }
  const parsedQuery = querySchema.safeParse({
    cursor: cursorParam,
    limit: limitParam,
  });
  if (!parsedQuery.success) {
    return json<ActivityResponse>(
      { data: null, error: "Invalid query" },
      400,
    );
  }
  const { cursor, limit } = parsedQuery.data;
  // "Paged" mode is opt-in via either query param. Without params we
  // preserve the original array-shaped response so existing callers
  // (older clients, the F4.3 contract tests) keep working unchanged.
  const paged = cursor !== undefined || limit !== undefined;

  const isDev = process.env.NODE_ENV !== "production";

  try {
    if (paged) {
      const page = await getRecentActivityPage(asActivityPrisma(prisma), {
        cursor,
        limit: limit ?? ACTIVITY_FEED_LIMIT,
      });
      const validated = activityFeedPageSchema.safeParse(page);
      if (!validated.success) {
        if (isDev) {
          // Dev-only surface — lets operators see WHY validation failed
          // (e.g. a legit audit row with a longer-than-expected
          // targetId). Never reaches production.
          console.error(
            "[activity-route] paged payload validation failed",
            validated.error.flatten(),
          );
        }
        return json<ActivityResponse>(
          { data: null, error: "Failed to load activity feed" },
          500,
        );
      }
      return json<ActivityResponse>(
        { data: validated.data, error: null },
        200,
      );
    }

    const entries = await getRecentActivity(asActivityPrisma(prisma));
    // Validate shape at the boundary — belt + braces against malformed
    // rows from a buggy writer (e.g. oversized targetId injected by a
    // future API route without length checks). Parse failure surfaces
    // as a 500 with generic error — NEVER echo z.error to the client.
    const parsed = activityFeedPayloadSchema.safeParse(entries);
    if (!parsed.success) {
      if (isDev) {
        console.error(
          "[activity-route] array payload validation failed",
          parsed.error.flatten(),
        );
      }
      return json<ActivityResponse>(
        { data: null, error: "Failed to load activity feed" },
        500,
      );
    }
    return json<ActivityResponse>(
      { data: parsed.data, error: null },
      200,
    );
  } catch (err) {
    if (isDev) {
      // Dev-only: log the engine error so the operator can see the real
      // cause (Prisma query failure, missing column, etc). Never return
      // the message — it may embed DATABASE_URL (F2.2 sec-review M2).
      console.error("[activity-route] engine error", err);
    }
    return json<ActivityResponse>(
      { data: null, error: "Failed to load activity feed" },
      500,
    );
  }
}
