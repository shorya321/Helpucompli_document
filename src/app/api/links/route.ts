import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  asLinkCreatePrisma,
  createLink,
  DocumentNotFoundError,
  PolicyMismatchError,
} from "@/lib/link-create";
import { linkCreateSchema } from "@/lib/link-schema";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  prefix: "@helpucompli/links-create",
});

interface CreateResponseBody {
  readonly id: string;
  readonly token: string;
  readonly shareableUrl: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
  readonly maxDownloads: number | null;
}

function json(
  body: ApiResponse<CreateResponseBody | null>,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

// Sec-review C2 (Module 08): x-real-ip / x-forwarded-for trust requires
// LB strip at the edge. Otherwise client-controlled. Same pattern as
// buckets and policies routes; runbook captures the LB requirement.
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

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);
  const quota = await limiter.limit(`links-create:${sub}`);
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

  const parsed = linkCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }

  const role = await resolveRole(session);
  if (role !== "superadmin" && role !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }
  const dbUser = await ensureUser(prisma, { session, role });

  try {
    const result = await createLink(asLinkCreatePrisma(prisma), parsed.data, {
      userId: dbUser.id,
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
    });
    // Build the shareable URL relative to the *request origin* so test
    // and production hosts both work without a hard-coded domain.
    const origin = new URL(req.url).origin;
    return json(
      {
        data: {
          id: result.id,
          token: result.token,
          shareableUrl: `${origin}/api/links/${result.token}`,
          expiresAt: result.expiresAt.toISOString(),
          ttlSeconds: result.ttlSeconds,
          maxDownloads: result.maxDownloads,
        },
        error: null,
      },
      201,
    );
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return json({ data: null, error: "Document not found" }, 404);
    }
    if (err instanceof PolicyMismatchError) {
      return json({ data: null, error: "Policy not found" }, 404);
    }
    return json({ data: null, error: "Failed to create link" }, 500);
  }
}
