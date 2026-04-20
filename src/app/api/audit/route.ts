import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asAuditQueryPrisma,
  auditQueryParamsSchema,
  queryAuditLogs,
  type AuditQueryResult,
} from "@/lib/audit-query";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  prefix: "@helpucompli/audit-list",
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

function parseQuery(url: URL): unknown {
  const sp = url.searchParams;
  const actions = sp.getAll("actions").filter((s) => s.length > 0);
  const raw: Record<string, unknown> = {};
  if (actions.length > 0) raw.actions = actions;
  const userId = sp.get("userId");
  if (userId) raw.userId = userId;
  const targetType = sp.get("targetType");
  if (targetType) raw.targetType = targetType;
  const dateFrom = sp.get("dateFrom");
  if (dateFrom) raw.dateFrom = dateFrom;
  const dateTo = sp.get("dateTo");
  if (dateTo) raw.dateTo = dateTo;
  const cursor = sp.get("cursor");
  if (cursor) raw.cursor = cursor;
  const limit = sp.get("limit");
  if (limit) raw.limit = limit;
  return raw;
}

export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return json<AuditQueryResult>({ data: null, error: "Unauthorized" }, 401);
  }
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json<AuditQueryResult>({ data: null, error: "Forbidden" }, 403);
  }

  const sub = (session.user as { sub?: string }).sub ?? "anon";
  const quota = await limiter.limit(`audit:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json<AuditQueryResult>(
      { data: null, error: "Too Many Requests" },
      429,
      { "Retry-After": String(retrySec) },
    );
  }

  const url = new URL(request.url);
  const parsed = auditQueryParamsSchema.safeParse(parseQuery(url));
  if (!parsed.success) {
    return json<AuditQueryResult>(
      { data: null, error: "Invalid query parameters" },
      400,
    );
  }

  try {
    const result = await queryAuditLogs(asAuditQueryPrisma(prisma), parsed.data);
    return json<AuditQueryResult>({ data: result, error: null }, 200);
  } catch {
    return json<AuditQueryResult>(
      { data: null, error: "Failed to load audit log" },
      500,
    );
  }
}
