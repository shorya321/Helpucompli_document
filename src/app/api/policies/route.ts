import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asPolicyListPrisma,
  getPolicyList,
  type PolicyListRow,
} from "@/lib/policy-list";
import {
  asPolicyCrudPrisma,
  createPolicy,
  type PolicyRow,
} from "@/lib/policy-crud";
import { policyInputSchema } from "@/lib/policy-schema";
import { ensureUser } from "@/lib/ensure-user";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const listLimiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/policies-list",
});

const createLimiter = createRateLimiter({
  max: 10,
  windowMs: 60_000,
  prefix: "@helpucompli/policies-create",
});

type Resp = ApiResponse<readonly PolicyListRow[] | PolicyRow>;

function json(body: Resp, status: number, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

function extractIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

function extractUserAgent(req: NextRequest): string {
  const ua = req.headers.get("user-agent");
  return ua && ua.length > 0 ? ua : "unknown";
}

export async function GET(_req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);
  const quota = await listLimiter.limit(`policies-list:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  try {
    const list = await getPolicyList(asPolicyListPrisma(prisma));
    return json({ data: list, error: null }, 200);
  } catch {
    return json({ data: null, error: "Failed to load policies" }, 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);
  const quota = await createLimiter.limit(`policies-create:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const ctype = req.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    return json({ data: null, error: "Unsupported Media Type" }, 415);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ data: null, error: "Invalid JSON" }, 400);
  }

  const parsed = policyInputSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }

  const role = await resolveRole(session);
  if (role !== "superadmin" && role !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }
  const dbUser = await ensureUser(prisma, { session, role });

  try {
    const created = await createPolicy(asPolicyCrudPrisma(prisma), parsed.data, {
      userId: dbUser.id,
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
    });
    return json({ data: created, error: null }, 201);
  } catch {
    return json({ data: null, error: "Failed to create policy" }, 500);
  }
}
