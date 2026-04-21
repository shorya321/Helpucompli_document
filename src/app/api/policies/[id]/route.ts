import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asPolicyCrudPrisma,
  deletePolicy,
  getPolicy,
  PolicyNotFoundError,
  updatePolicy,
  type PolicyRow,
} from "@/lib/policy-crud";
import { policyUpdateSchema } from "@/lib/policy-schema";
import { ensureUser } from "@/lib/ensure-user";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/policies-id",
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(
  body: ApiResponse<PolicyRow | null>,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

function noContent() {
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store, private" },
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

interface RouteCtx {
  readonly params: Promise<{ id: string }>;
}

async function preflight(req: NextRequest, ctx: RouteCtx) {
  const session = await auth0.getSession();
  if (!session) {
    return { error: json({ data: null, error: "Unauthorized" }, 401) };
  }
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return { error: json({ data: null, error: "Forbidden" }, 403) };
  }
  const sub = (session.user as { sub?: string }).sub;
  if (!sub) {
    return { error: json({ data: null, error: "Unauthorized" }, 401) };
  }
  const quota = await limiter.limit(`policies-id:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return {
      error: json({ data: null, error: "Too Many Requests" }, 429, {
        "Retry-After": String(retrySec),
      }),
    };
  }
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return { error: json({ data: null, error: "Invalid policy id" }, 400) };
  }
  return { session, id };
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const pre = await preflight(req, ctx);
  if ("error" in pre) return pre.error;
  try {
    const policy = await getPolicy(asPolicyCrudPrisma(prisma), pre.id);
    if (!policy) {
      return json({ data: null, error: "Not Found" }, 404);
    }
    return json({ data: policy, error: null }, 200);
  } catch {
    return json({ data: null, error: "Failed to load policy" }, 500);
  }
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const pre = await preflight(req, ctx);
  if ("error" in pre) return pre.error;

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

  const parsed = policyUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }

  const role = await resolveRole(pre.session);
  if (role !== "superadmin" && role !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  // Sec-review: flipping a policy to linkTtlSeconds=null converts every
  // future link under it to perpetual. Gate to superadmin on UPDATE too.
  if (parsed.data.linkTtlSeconds === null && role !== "superadmin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const dbUser = await ensureUser(prisma, { session: pre.session, role });

  try {
    const updated = await updatePolicy(
      asPolicyCrudPrisma(prisma),
      pre.id,
      parsed.data,
      {
        userId: dbUser.id,
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
      },
    );
    return json({ data: updated, error: null }, 200);
  } catch (err) {
    if (err instanceof PolicyNotFoundError) {
      return json({ data: null, error: "Not Found" }, 404);
    }
    return json({ data: null, error: "Failed to update policy" }, 500);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const pre = await preflight(req, ctx);
  if ("error" in pre) return pre.error;

  const role = await resolveRole(pre.session);
  if (role !== "superadmin" && role !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }
  const dbUser = await ensureUser(prisma, { session: pre.session, role });

  try {
    await deletePolicy(asPolicyCrudPrisma(prisma), pre.id, {
      userId: dbUser.id,
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
    });
    return noContent();
  } catch (err) {
    if (err instanceof PolicyNotFoundError) {
      return json({ data: null, error: "Not Found" }, 404);
    }
    return json({ data: null, error: "Failed to delete policy" }, 500);
  }
}
