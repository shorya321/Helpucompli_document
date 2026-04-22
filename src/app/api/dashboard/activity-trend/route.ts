import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  ACTIVITY_TREND_DAYS_DEFAULT,
  ACTIVITY_TREND_DAYS_MAX,
  ACTIVITY_TREND_DAYS_MIN,
  activityTrendSchema,
  asTrendPrisma,
  getActivityTrend,
  type ActivityTrend,
} from "@/lib/activity-trend";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 10 / 30s — same envelope as the rest of the dashboard family. Chart
// is server-prefetched on first paint and only re-queried on window
// focus or manual refresh, so the budget is comfortable.
let _limiter: ReturnType<typeof createRateLimiter> | null = null;
function getLimiter() {
  if (!_limiter) {
    _limiter = createRateLimiter({
      max: 10,
      windowMs: 30_000,
      prefix: "@helpucompli/dashboard-trend",
    });
  }
  return _limiter;
}

const querySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(ACTIVITY_TREND_DAYS_MIN)
    .max(ACTIVITY_TREND_DAYS_MAX)
    .optional(),
});

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

export async function GET(request?: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return json<ActivityTrend>({ data: null, error: "Unauthorized" }, 401);
  }
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json<ActivityTrend>({ data: null, error: "Forbidden" }, 403);
  }

  const sub = session.user.sub as string | undefined;
  const identifier = `trend:${sub ?? "anon"}`;
  const quota = await getLimiter().limit(identifier);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json<ActivityTrend>(
      { data: null, error: "Too Many Requests" },
      429,
      { "Retry-After": String(retrySec) },
    );
  }

  let daysParam: string | undefined;
  if (request) {
    try {
      daysParam = new URL(request.url).searchParams.get("days") ?? undefined;
    } catch {
      // malformed URL — fall through to default
    }
  }
  const parsed = querySchema.safeParse({ days: daysParam });
  if (!parsed.success) {
    return json<ActivityTrend>({ data: null, error: "Invalid query" }, 400);
  }
  const days = parsed.data.days ?? ACTIVITY_TREND_DAYS_DEFAULT;

  try {
    const trend = await getActivityTrend(asTrendPrisma(prisma), { days });
    const validated = activityTrendSchema.safeParse(trend);
    if (!validated.success) {
      return json<ActivityTrend>(
        { data: null, error: "Failed to load activity trend" },
        500,
      );
    }
    return json<ActivityTrend>({ data: validated.data, error: null }, 200);
  } catch {
    // Engine errors can embed DATABASE_URL — never surface raw err.
    return json<ActivityTrend>(
      { data: null, error: "Failed to load activity trend" },
      500,
    );
  }
}
