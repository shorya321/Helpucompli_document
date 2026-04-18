import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asActivityPrisma,
  getRecentActivity,
  type ActivityEntry,
} from "@/lib/activity-feed";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

function json<T>(body: ApiResponse<T>, status: number) {
  return NextResponse.json(body, { status });
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
  if (!hasRole(session, ["superadmin", "admin"])) {
    return json<readonly ActivityEntry[]>(
      { data: null, error: "Forbidden" },
      403,
    );
  }

  try {
    const entries = await getRecentActivity(asActivityPrisma(prisma));
    return json<readonly ActivityEntry[]>(
      { data: entries, error: null },
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
