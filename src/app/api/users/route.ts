import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asUserListPrisma,
  listUsers,
  parseUserListQuery,
  type UserListResult,
} from "@/lib/user-list";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const listLimiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/users-list",
});

type Resp = ApiResponse<UserListResult> & { readonly total?: number };

function json(body: Resp, status: number, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await listLimiter.limit(`users-list:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  const query = parseUserListQuery(params);
  if (!query) return json({ data: null, error: "Invalid query" }, 400);

  try {
    const result = await listUsers(asUserListPrisma(prisma), query);
    return json({ data: result, error: null, total: result.total }, 200);
  } catch {
    return json({ data: null, error: "Failed to load users" }, 500);
  }
}
