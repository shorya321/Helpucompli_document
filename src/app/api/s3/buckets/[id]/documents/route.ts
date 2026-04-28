import { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asBucketDetailsPrisma,
  BucketAccessDeniedError,
  BucketNotFoundError,
  BUCKET_DOCUMENTS_PAGE_LIMIT,
  BUCKET_DOCUMENTS_PAGE_LIMIT_MAX,
  getBucketDocumentsPage,
  type BucketDetailsScope,
} from "@/lib/bucket-details";
import { toJsonSafe } from "@/lib/bigint";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 60 / 30s — same envelope as the bucket-details page route. Load
// more is user-driven (one click → one request) so this is comfortable.
let _limiter: ReturnType<typeof createRateLimiter> | null = null;
function getLimiter() {
  if (!_limiter) {
    _limiter = createRateLimiter({
      max: 60,
      windowMs: 30_000,
      prefix: "@helpucompli/s3-buckets-documents",
    });
  }
  return _limiter;
}

const idSchema = z.string().min(1).max(64);

const querySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BUCKET_DOCUMENTS_PAGE_LIMIT_MAX)
    .optional(),
});


export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (!role) return json({ data: null, error: "Forbidden" }, 403);

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await getLimiter().limit(`bucket-documents:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json(
      { data: null, error: "Too Many Requests" },
      429,
      { "Retry-After": String(retrySec) },
    );
  }

  const { id } = await ctx.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return json({ data: null, error: "Not Found" }, 404);
  }

  const url = new URL(req.url);
  const parsedQuery = querySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    return json({ data: null, error: "Invalid query" }, 400);
  }
  const { cursor, limit } = parsedQuery.data;

  // Viewer scope mirrors the page-level resolution — must look up the
  // db user id so the OR-userAccess scope clause inside
  // assertBucketAccess can match. Admin/superadmin skip the lookup.
  let scope: BucketDetailsScope;
  if (role === "viewer") {
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    if (!dbUser) return json({ data: null, error: "Forbidden" }, 403);
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  const isDev = process.env.NODE_ENV !== "production";

  try {
    const page = await getBucketDocumentsPage(
      asBucketDetailsPrisma(prisma),
      scope,
      parsedId.data,
      { cursor, limit: limit ?? BUCKET_DOCUMENTS_PAGE_LIMIT },
    );
    // BigInt sizeBytes is not JSON-serialisable — convert to string via
    // the existing toJsonSafe helper before responding.
    return json(
      {
        data: toJsonSafe({
          entries: page.entries,
          nextCursor: page.nextCursor,
        }),
        error: null,
      },
      200,
    );
  } catch (err) {
    if (err instanceof BucketAccessDeniedError) {
      return json({ data: null, error: "Forbidden" }, 403);
    }
    if (err instanceof BucketNotFoundError) {
      return json({ data: null, error: "Not Found" }, 404);
    }
    if (isDev) {
      console.error("[bucket-documents-route] engine error", err);
    }
    return json(
      { data: null, error: "Failed to load documents" },
      500,
    );
  }
}
