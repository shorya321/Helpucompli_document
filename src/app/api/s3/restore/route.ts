import { NextRequest } from "next/server";
import { z } from "zod";

import { json } from "@/lib/api-response";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { logAudit, asAuditPrisma } from "@/lib/audit";
import { ensureUser } from "@/lib/ensure-user";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { NotDeletedError, restoreObject } from "@/lib/s3-objects";

export const dynamic = "force-dynamic";

// 10 restores / 60s per user. Restore is recovery — separate quota
// from /api/s3/delete so an admin alternating delete/restore (testing
// or correcting a mistake) never starves either side.
const limiter = createRateLimiter({
  max: 10,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-restore",
});

const bodySchema = z.object({
  bucketId: z.string().uuid(),
  s3Key: z
    .string()
    .min(1)
    .max(1024)
    .refine((k) => !k.startsWith("/"), "must not start with '/'")
    .refine((k) => !k.split("/").includes(".."), "must not contain '..'"),
});

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (role !== "superadmin" && role !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const ctype = req.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    return json({ data: null, error: "Unsupported Media Type" }, 415);
  }

  const quota = await limiter.limit(`restore:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ data: null, error: "Invalid JSON" }, 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }
  const input = parsed.data;

  const bucket = await prisma.bucket.findUnique({
    where: { id: input.bucketId },
    select: { id: true, name: true, isActive: true },
  });
  if (!bucket) return json({ data: null, error: "Bucket not found" }, 404);

  const doc = await prisma.document.findFirst({
    where: { bucketId: bucket.id, s3Key: input.s3Key },
    select: {
      id: true,
      bucketId: true,
      s3Key: true,
      filename: true,
      isDeleted: true,
    },
  });
  if (!doc) return json({ data: null, error: "Document not found" }, 404);

  const dbUser = await ensureUser(prisma, {
    session,
    role: role === "superadmin" ? "superadmin" : "admin",
  });

  if (role !== "superadmin") {
    const access = await prisma.userBucketAccess.findFirst({
      where: { userId: dbUser.id, bucketId: bucket.id },
      select: { userId: true },
    });
    if (!access) return json({ data: null, error: "Forbidden" }, 403);
  }

  // Restoring into a decommissioned bucket leaves an orphan: the
  // bucket UI hides inactive buckets, so the restored document would
  // remain invisible. Refuse early — superadmin can re-activate the
  // bucket then retry.
  if (!bucket.isActive) {
    return json({ data: null, error: "Bucket is inactive" }, 409);
  }

  if (!doc.isDeleted) {
    return json(
      { data: null, error: "Document is not soft-deleted" },
      409,
    );
  }

  let restored: { restoredFromVersionId: string };
  try {
    restored = await restoreObject({ bucket: bucket.name, key: input.s3Key });
  } catch (err) {
    if (err instanceof NotDeletedError) {
      return json(
        { data: null, error: "Object is not soft-deleted on S3" },
        409,
      );
    }
    return json({ data: null, error: "Failed to restore object" }, 500);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: {
          isDeleted: false,
          deletedAt: null,
          deletedById: null,
        },
        select: { id: true },
      });
      await logAudit(asAuditPrisma(tx), {
        userId: dbUser.id,
        action: "DOCUMENT_RESTORE",
        targetType: "document",
        targetId: doc.id,
        metadata: {
          bucketId: bucket.id,
          bucketName: bucket.name,
          s3Key: input.s3Key,
          filename: doc.filename,
          restoredFromVersionId: restored.restoredFromVersionId,
        },
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
      });
    });
    return json(
      {
        data: {
          ok: true,
          restoredFromVersionId: restored.restoredFromVersionId,
        },
        error: null,
      },
      200,
    );
  } catch {
    return json({ data: null, error: "Failed to record restore" }, 500);
  }
}
