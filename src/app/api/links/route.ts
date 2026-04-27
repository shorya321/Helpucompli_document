import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  asLinkCreatePrisma,
  createLink,
  DocumentNotFoundError,
  PerpetualLinkForbiddenError,
  PolicyMismatchError,
} from "@/lib/link-create";
import {
  asLinkListPrisma,
  queryLinks,
  type LinkListResult,
} from "@/lib/link-list";
import { linkCreateSchema, linkListQuerySchema } from "@/lib/link-schema";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// F11.2 HIPAA rate-limit: link generation capped at 10 req/min per
// authenticated user. Generated links are presigned bearer credentials
// — aggressive cap blunts credential-harvesting + enumeration. Module
// spec docs/modules/11-security-hipaa-module.md#F11.3.
const limiter = createRateLimiter({
  max: 10,
  windowMs: 60_000,
  prefix: "@helpucompli/links-create",
});

const listLimiter = createRateLimiter({
  max: 60,
  windowMs: 30_000,
  prefix: "@helpucompli/links-list",
});

function json<T>(
  body: ApiResponse<T>,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return json<LinkListResult | null>(
      { data: null, error: "Unauthorized" },
      401,
    );
  }
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json<LinkListResult | null>(
      { data: null, error: "Forbidden" },
      403,
    );
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) {
    return json<LinkListResult | null>(
      { data: null, error: "Unauthorized" },
      401,
    );
  }
  const quota = await listLimiter.limit(`links-list:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json<LinkListResult | null>(
      { data: null, error: "Too Many Requests" },
      429,
      { "Retry-After": String(retrySec) },
    );
  }

  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = linkListQuerySchema.safeParse(params);
  if (!parsed.success) {
    return json<LinkListResult | null>(
      { data: null, error: "Invalid query parameters" },
      400,
    );
  }

  try {
    const result = await queryLinks(asLinkListPrisma(prisma), parsed.data);
    return json<LinkListResult>({ data: result, error: null }, 200);
  } catch {
    return json<LinkListResult | null>(
      { data: null, error: "Failed to load links" },
      500,
    );
  }
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

  // Sec-review: neverExpires produces a perpetual bearer token. Gate to
  // superadmin only — admins must pick a finite TTL. Server enforces
  // this regardless of what the client sends.
  if (parsed.data.neverExpires === true && role !== "superadmin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const dbUser = await ensureUser(prisma, { session, role });

  try {
    const result = await createLink(asLinkCreatePrisma(prisma), parsed.data, {
      userId: dbUser.id,
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      callerRole: role,
    });
    // Use validated APP_BASE_URL so the link host matches the public
    // domain even when the Next.js server binds to 0.0.0.0 behind a
    // reverse proxy. Strip trailing slash to avoid `//l/...`.
    //
    // The canonical shareable URL points at the embeddable HTML viewer
    // (/l/<token>). The viewer handles browser direct-view, embed
    // crawlers (OpenGraph unfurl), and iframe rendering with the
    // policy's allowedDomains wired into CSP frame-ancestors. The
    // legacy /api/links/<token> route still exists for programmatic
    // clients that need the raw 302 to a presigned URL; it remains
    // unchanged in behavior so previously-distributed links keep
    // working.
    const origin = getConfig().APP_BASE_URL.replace(/\/+$/, "");
    return json(
      {
        data: {
          id: result.id,
          token: result.token,
          shareableUrl: `${origin}/l/${result.token}`,
          expiresAt:
            result.expiresAt === null ? null : result.expiresAt.toISOString(),
          ttlSeconds: result.ttlSeconds,
          maxDownloads: result.maxDownloads,
          allowPublicEmbed: result.allowPublicEmbed,
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
    if (err instanceof PerpetualLinkForbiddenError) {
      return json({ data: null, error: "Forbidden" }, 403);
    }
    // Log server-side for diagnosis. Response body stays generic so no
    // sensitive info (DB URL, Prisma internals, stack) leaks to the
    // client. If you see this firing in prod logs, check for Prisma
    // client drift (schema ↔ generated client) or a NOT NULL violation.
    console.error("[POST /api/links] unexpected error:", err);
    return json({ data: null, error: "Failed to create link" }, 500);
  }
}
