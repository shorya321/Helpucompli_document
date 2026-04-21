import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import { listObjects } from "@/lib/s3-objects";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 60 list calls / 30s per user. Listing is read-only and cheap at S3
// but we cap to shield Prisma bucket lookup + UserBucketAccess join
// from reload-spam. Matches the `documents-page` SSR limit (which fans
// out to the same listObjects call).
const limiter = createRateLimiter({
  max: 60,
  windowMs: 30_000,
  prefix: "@helpucompli/s3-objects-list",
});

const querySchema = z.object({
  bucketId: z.string().uuid(),
  // Prefix may be empty (root of bucket). Reject leading slash + `..`
  // segments so path traversal cannot escape the bucket root.
  prefix: z
    .string()
    .max(1024)
    .default("")
    .refine((p) => !p.startsWith("/"), "must not start with '/'")
    .refine((p) => !p.split("/").includes(".."), "must not contain '..'"),
  // "/" folder view (default) versus "" flat recursive listing. Keep
  // the spec's default narrow — callers who want recursive listings
  // must pass delimiter=none explicitly.
  delimiter: z.enum(["/", "none"]).default("/"),
  maxKeys: z.coerce.number().int().min(1).max(1000).default(200),
  continuationToken: z.string().max(4096).optional(),
});

type ObjectsListResponse = {
  readonly contents: ReadonlyArray<{
    readonly key: string;
    readonly size: number;
    readonly lastModified: string | null;
    readonly etag: string | null;
  }>;
  readonly commonPrefixes: ReadonlyArray<string>;
  readonly nextContinuationToken?: string;
  readonly isTruncated: boolean;
};

function json(
  body: ApiResponse<ObjectsListResponse | null>,
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
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (!role) return json({ data: null, error: "Forbidden" }, 403);

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await limiter.limit(`s3-objects-list:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid query" }, 400);
  }
  const input = parsed.data;

  const bucket = await prisma.bucket.findUnique({
    where: { id: input.bucketId },
    select: { id: true, name: true, isActive: true },
  });
  if (!bucket) return json({ data: null, error: "Bucket not found" }, 404);
  if (!bucket.isActive) {
    return json({ data: null, error: "Bucket not found" }, 404);
  }

  // Per-bucket access check. Superadmin bypasses UserBucketAccess, admin
  // and viewer are both tenant-scoped via the junction table (matches
  // download-url and move routes).
  const dbUser = await ensureUser(prisma, {
    session,
    role,
  });
  if (role !== "superadmin") {
    const access = await prisma.userBucketAccess.findFirst({
      where: { userId: dbUser.id, bucketId: bucket.id },
      select: { userId: true },
    });
    if (!access) return json({ data: null, error: "Forbidden" }, 403);
  }

  try {
    const res = await listObjects({
      bucket: bucket.name,
      prefix: input.prefix === "" ? undefined : input.prefix,
      delimiter: input.delimiter === "none" ? "" : "/",
      maxKeys: input.maxKeys,
      ...(input.continuationToken
        ? { continuationToken: input.continuationToken }
        : {}),
    });

    const contents = res.contents
      .filter((c) => typeof c.Key === "string")
      .map((c) => ({
        key: c.Key!,
        size: Number(c.Size ?? 0),
        lastModified: c.LastModified ? c.LastModified.toISOString() : null,
        etag: c.ETag ?? null,
      }));

    const body: ObjectsListResponse = {
      contents,
      commonPrefixes: res.commonPrefixes,
      isTruncated: res.isTruncated,
      ...(res.nextContinuationToken
        ? { nextContinuationToken: res.nextContinuationToken }
        : {}),
    };

    return json({ data: body, error: null }, 200);
  } catch {
    // Never surface SDK errors — they can embed AWS ARNs / bucket-region
    // details that help an attacker probe the infrastructure.
    return json({ data: null, error: "Failed to list objects" }, 500);
  }
}
