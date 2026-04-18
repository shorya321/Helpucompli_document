import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asBucketDetailsPrisma,
  BucketAccessDeniedError,
  BucketNotFoundError,
  getBucketDetails,
  type BucketDetailsScope,
} from "@/lib/bucket-details";
import {
  asBucketDeletePrisma,
  BucketAlreadyDeletedError,
  BucketHasActiveDocumentsError,
  BucketNotFoundForDeleteError,
  defaultS3DeleteRunner,
  deleteBucketForTenant,
} from "@/lib/bucket-delete";
import { createRateLimiter } from "@/lib/rate-limit";
import { toJsonSafe, type JsonValue } from "@/lib/bigint";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/s3-buckets-details",
});

// Destructive op — tight cap. 5/60s is the same as bucket-create.
const deleteLimiter = createRateLimiter({
  max: 5,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-buckets-delete",
});

const deleteBodySchema = z
  .object({ confirmName: z.string().min(1).max(63) })
  .strict();

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

// Path-param guard. UUIDs are 36 chars — 64 is headroom for any
// legacy id format. Reject payload-style abuse at the boundary.
const idSchema = z.string().min(1).max(64);

type DeleteResultShape = { id: string; name: string; isActive: boolean };

function json(
  body: ApiResponse<JsonValue | DeleteResultShape>,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (!role) return json({ data: null, error: "Forbidden" }, 403);

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await limiter.limit(`bucket-details:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const { id } = await ctx.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return json({ data: null, error: "Invalid id" }, 400);

  let scope: BucketDetailsScope;
  if (role === "viewer") {
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    // Viewer without a DB row → 403 (same shape as "not granted"). A
    // 404 here would leak that the bucket exists to un-provisioned
    // viewers.
    if (!dbUser) return json({ data: null, error: "Forbidden" }, 403);
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  try {
    const details = await getBucketDetails(
      asBucketDetailsPrisma(prisma),
      scope,
      parsedId.data,
    );
    return json({ data: toJsonSafe(details), error: null }, 200);
  } catch (err) {
    if (err instanceof BucketAccessDeniedError) {
      return json({ data: null, error: "Forbidden" }, 403);
    }
    if (err instanceof BucketNotFoundError) {
      return json({ data: null, error: "Not Found" }, 404);
    }
    // Prisma engine errors can embed DATABASE_URL — never echo raw.
    return json({ data: null, error: "Failed to load bucket" }, 500);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  // Destructive op — superadmin only. Admin + viewer both 403.
  if (role !== "superadmin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

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
  const parsedBody = deleteBodySchema.safeParse(payload);
  if (!parsedBody.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }

  const { id } = await ctx.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return json({ data: null, error: "Invalid id" }, 400);
  const bucketId = parsedId.data;

  // Must have a DB user row to attribute the audit log entry to.
  const dbUser = await prisma.user.findUnique({
    where: { auth0Id: sub },
    select: { id: true },
  });
  if (!dbUser) return json({ data: null, error: "Unauthorized" }, 401);

  // Rate-limit AFTER DB user resolution so a deprovisioned Auth0 sub
  // cannot exhaust quota under a stale token (sec-review M3). Key
  // on the DB user id so the limit bucket matches audit attribution.
  const quota = await deleteLimiter.limit(`buckets-delete:${dbUser.id}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  // Lookup name BEFORE calling the orchestrator — confirmName must
  // match the actual stored name (prevents an operator from typing the
  // wrong id and accidentally deleting the wrong bucket). Case-
  // normalize both sides — AWS S3 names are lowercase, so operators
  // typing a mixed-case name should not 400 (sec-review M2).
  const row = await prisma.bucket.findUnique({
    where: { id: bucketId },
    select: { name: true },
  });
  if (!row) return json({ data: null, error: "Not Found" }, 404);
  if (
    row.name.toLowerCase() !== parsedBody.data.confirmName.toLowerCase()
  ) {
    return json(
      { data: null, error: "Confirmation name does not match" },
      400,
    );
  }

  try {
    const result = await deleteBucketForTenant(
      asBucketDeletePrisma(prisma),
      defaultS3DeleteRunner,
      bucketId,
      {
        userId: dbUser.id,
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
      },
    );
    return json({ data: result, error: null }, 200);
  } catch (err) {
    if (err instanceof BucketNotFoundForDeleteError) {
      return json({ data: null, error: "Not Found" }, 404);
    }
    if (err instanceof BucketHasActiveDocumentsError) {
      // Fixed string — err.message embeds the bucketId and would
      // confirm internal IDs to the caller (sec-review H1).
      return json(
        { data: null, error: "Bucket has active documents" },
        409,
      );
    }
    if (err instanceof BucketAlreadyDeletedError) {
      return json({ data: null, error: "Bucket already deleted" }, 409);
    }
    return json({ data: null, error: "Failed to delete bucket" }, 500);
  }
}
