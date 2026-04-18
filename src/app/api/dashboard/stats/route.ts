import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asStatsPrisma,
  getDashboardStats,
  type DashboardStats,
} from "@/lib/dashboard-stats";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 10 requests / 30s per authenticated user. Covers the dashboard
// summary card mount + a few manual refreshes without throttling
// normal use. Blocks amplification from stolen tokens or runaway tabs.
const limiter = createRateLimiter({
  max: 10,
  windowMs: 30_000,
  prefix: "@helpucompli/dashboard-stats",
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

export async function GET() {
  const session = await auth0.getSession();
  if (!session) {
    return json<DashboardStats>({ data: null, error: "Unauthorized" }, 401);
  }
  // Aggregate dashboard stats include total document + bucket + user
  // counts across the tenant — viewer must not receive this. Viewer-
  // scoped dashboard home renders without calling this endpoint.
  if (!hasRole(session, ["superadmin", "admin"])) {
    return json<DashboardStats>({ data: null, error: "Forbidden" }, 403);
  }

  const sub = session.user.sub as string | undefined;
  const identifier = `stats:${sub ?? "anon"}`;
  const quota = await limiter.limit(identifier);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json<DashboardStats>(
      { data: null, error: "Too Many Requests" },
      429,
      { "Retry-After": String(retrySec) },
    );
  }

  try {
    const stats = await getDashboardStats(asStatsPrisma(prisma));
    return json<DashboardStats>({ data: stats, error: null }, 200);
  } catch {
    // NEVER pass raw error into the response — engine errors can
    // carry the DATABASE_URL (F2.2 sec-review M2 mitigation).
    return json<DashboardStats>(
      { data: null, error: "Failed to load dashboard stats" },
      500,
    );
  }
}
