import { NextRequest, NextResponse } from "next/server";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
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

// Sec-review C2: x-real-ip / x-forwarded-for are user-supplied unless
// the load balancer strips them at the edge before re-injecting the
// trusted client IP. Runbook MUST document the LB config; without it
// the value is forgeable and IP-range policies can be bypassed by
// sending an attacker-controlled XFF header. We still record it on the
// audit trail (HIPAA 164.312(b)) but DO NOT trust it for IP-range
// enforcement — that decision lives in policy-engine.ts and uses the
// same value, so the LB strip is the single point of trust.
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

  // Sec-review: a policy with linkTtlSeconds=null issues perpetual
  // bearer tokens for every link it governs. Gate to superadmin only.
  // Server enforces regardless of what the client sends.
  if (parsed.data.linkTtlSeconds === null && role !== "superadmin") {
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
