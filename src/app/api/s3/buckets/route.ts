import { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asBucketListPrisma,
  getBucketList,
  parseBucketListQuery,
  type BucketListScope,
} from "@/lib/bucket-list";
import {
  asBucketCreatePrisma,
  bucketCreateInputSchema,
  createBucketForTenant,
  defaultS3Runner,
  DuplicateBucketNameError,
} from "@/lib/bucket-create";
import { createRateLimiter } from "@/lib/rate-limit";
import { toJsonSafe } from "@/lib/bigint";
import { ensureUser } from "@/lib/ensure-user";

export const dynamic = "force-dynamic";

// GET: 30 requests / 30s per authenticated user. Covers the bucket list
// page load + filter/sort toggles + a few manual refreshes with room
// to spare. Blocks token-amplification abuse.
const limiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/s3-buckets",
});

// POST: 5 creates / 60s per authenticated user. Tighter than GET
// because a create burns AWS + DB writes + audit; five in a minute is
// far past any legitimate superadmin workflow.
const createLimiter = createRateLimiter({
  max: 5,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-buckets-create",
});

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (!role) return json({ data: null, error: "Forbidden" }, 403);

  // Explicit sub guard — `sub ?? "anon"` would turn `""` into a shared
  // rate-limit bucket across every token-misconfigured request, letting
  // one bad client 429 legitimate users.
  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);
  const quota = await limiter.limit(`buckets:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const options = parseBucketListQuery(params);
  if (options === null) {
    return json({ data: null, error: "Invalid query" }, 400);
  }

  let scope: BucketListScope;
  if (role === "viewer") {
    if (!sub) return json({ data: [], error: null }, 200);
    // Map Auth0 sub → internal User.id for the UserBucketAccess join.
    // Viewers without a provisioned DB row simply have no assigned
    // buckets — return an empty list rather than 403, so first-login
    // users see an empty state instead of a permission error page.
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    if (!dbUser) return json({ data: [], error: null }, 200);
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  try {
    const list = await getBucketList(
      asBucketListPrisma(prisma),
      scope,
      options,
    );
    // BigInt storageBytes — serialise safely at the response boundary.
    return json({ data: toJsonSafe(list), error: null }, 200);
  } catch {
    // NEVER pass the raw error — Prisma engine messages can embed the
    // DATABASE_URL (F2.2 sec-review M2).
    return json({ data: null, error: "Failed to load buckets" }, 500);
  }
}

// Prefer x-real-ip (set by trusted LB/CDN, attacker cannot spoof when
// the proxy strips it first). Fall back to the first hop of XFF then
// to a literal token so the audit row always has a non-empty string
// (HIPAA 164.312(b)). Runbook MUST document that the LB strips
// attacker-supplied XFF — otherwise the audit value is forgeable.
export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  // Only superadmin can provision buckets — bucket creation touches
  // global AWS resources + CloudTrail selector state and must not be
  // delegated. Admin + viewer both 403 here.
  if (role !== "superadmin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await createLimiter.limit(`buckets-create:${sub}`);
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

  const parsed = bucketCreateInputSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }

  // Map Auth0 sub → internal User.id. First-time superadmins are
  // auto-provisioned here: they are already authenticated by Auth0 and
  // authorized as superadmin by resolveRole() above, so it is safe to
  // create the row on demand rather than require an out-of-band
  // provisioning step (Module 10 will own ongoing user management).
  const dbUser = await ensureUser(prisma, { session, role: "superadmin" });

  try {
    const created = await createBucketForTenant(
      asBucketCreatePrisma(prisma),
      defaultS3Runner,
      parsed.data,
      {
        createdById: dbUser.id,
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
      },
    );
    return json({ data: created, error: null }, 201);
  } catch (err) {
    if (err instanceof DuplicateBucketNameError) {
      // Distinguish active conflict vs decommissioned-name reuse.
      // Decommissioned bucket rows survive with isActive=false (audit
      // history preservation) and the @unique constraint on name still
      // blocks reuse. AWS S3 also enforces ~24h DNS propagation before a
      // deleted bucket name can be re-claimed, so even dropping the row
      // would not unblock reuse — surface the constraint clearly.
      try {
        const existing = await prisma.bucket.findUnique({
          where: { name: parsed.data.name },
          select: { isActive: true },
        });
        if (existing && !existing.isActive) {
          return json(
            {
              data: null,
              error:
                "This name was used by a previously decommissioned bucket and cannot be reused. Pick a different name.",
            },
            409,
          );
        }
      } catch {
        // Fall through to generic duplicate message — never leak engine
        // errors (could embed DATABASE_URL).
      }
      return json(
        { data: null, error: "Bucket with that name already exists" },
        409,
      );
    }
    // NEVER echo raw err.message — S3/Prisma errors can embed
    // DATABASE_URL or AWS ARN + account ID.
    return json({ data: null, error: "Failed to create bucket" }, 500);
  }
}
