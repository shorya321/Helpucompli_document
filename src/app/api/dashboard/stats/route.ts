import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asStatsPrisma,
  getDashboardStats,
  type DashboardStats,
} from "@/lib/dashboard-stats";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

function json<T>(body: ApiResponse<T>, status: number) {
  return NextResponse.json(body, { status });
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
