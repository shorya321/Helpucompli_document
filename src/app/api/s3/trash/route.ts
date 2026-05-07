import { NextRequest } from "next/server";
import { z } from "zod";

import { json } from "@/lib/api-response";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { toJsonSafe } from "@/lib/bigint";
import { ensureUser } from "@/lib/ensure-user";
import { listDeletedFolderMarkers } from "@/lib/folder-restore";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const PAGE_SIZE_MAX = 200;

const limiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/s3-trash",
});

const querySchema = z.object({
  bucketId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_SIZE_MAX)
    .optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (role !== "superadmin" && role !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await limiter.limit(`trash:${sub}`);
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
  const { bucketId, page = 1, pageSize = PAGE_SIZE } = parsed.data;

  const dbUser = await ensureUser(prisma, {
    session,
    role: role === "superadmin" ? "superadmin" : "admin",
  });

  // Build the bucket filter. Superadmin sees all buckets. Admin is
  // scoped strictly to UserBucketAccess rows — same contract as the
  // soft-delete route at /api/s3/delete (admins can't delete from a
  // bucket they don't have access to, so they shouldn't see its trash
  // either).
  let bucketFilter: { in: string[] } | undefined;
  if (role === "admin") {
    const accessRows = await prisma.userBucketAccess.findMany({
      where: { userId: dbUser.id },
      select: { bucketId: true },
    });
    const allowed = accessRows.map((r) => r.bucketId);
    if (allowed.length === 0) {
      return json(
        {
          data: toJsonSafe({
            documents: [],
            folders: [],
            total: 0,
            page,
            pageSize,
          }),
          error: null,
        },
        200,
      );
    }
    if (bucketId !== undefined) {
      if (!allowed.includes(bucketId)) {
        return json({ data: null, error: "Forbidden" }, 403);
      }
      bucketFilter = { in: [bucketId] };
    } else {
      bucketFilter = { in: allowed };
    }
  } else if (bucketId !== undefined) {
    bucketFilter = { in: [bucketId] };
  }

  const where = {
    isDeleted: true,
    ...(bucketFilter ? { bucketId: bucketFilter } : {}),
  };

  const [rows, total, buckets] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { deletedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        bucketId: true,
        s3Key: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        uploadedAt: true,
        deletedAt: true,
        bucket: { select: { name: true } },
        deletedBy: { select: { email: true } },
      },
    }),
    prisma.document.count({ where }),
    prisma.bucket.findMany({
      where: bucketFilter ? { id: bucketFilter } : {},
      select: { id: true, name: true },
    }),
  ]);

  const folders = (
    await Promise.all(
      buckets.map(async (bucket) => {
        const markers = await listDeletedFolderMarkers({ bucket: bucket.name }).catch(
          () => [],
        );
        return markers.map((marker) => ({
          bucketId: bucket.id,
          bucketName: bucket.name,
          prefix: marker.key,
          deletedAt: marker.deletedAt,
        }));
      }),
    )
  ).flat();

  return json(
    {
      data: toJsonSafe({
        documents: rows,
        folders,
        total,
        page,
        pageSize,
      }),
      error: null,
    },
    200,
  );
}
