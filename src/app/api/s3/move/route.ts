import { NextRequest, NextResponse } from "next/server";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import { copyObject, moveObject } from "@/lib/s3-objects";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  assertFolderPrefix,
  sanitizeFilename,
} from "@/lib/document-upload";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 15 moves/copies / 60s per user. Each call fans to 1–2 S3 API calls
// + 2 Prisma reads + 1 $transaction — tighter cap than download.
const limiter = createRateLimiter({
  max: 15,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-move",
});

const schema = z
  .object({
    mode: z.enum(["move", "copy"]),
    sourceBucketId: z.string().uuid(),
    sourceS3Key: z
      .string()
      .min(1)
      .max(1024)
      .refine((k) => !k.startsWith("/"), "must not start with '/'")
      .refine((k) => !k.split("/").includes(".."), "must not contain '..'"),
    destBucketId: z.string().uuid(),
    destFolderPrefix: z
      .string()
      .max(512)
      .default("")
      .refine((v) => {
        if (v === "") return true;
        try {
          assertFolderPrefix(v);
          return true;
        } catch {
          return false;
        }
      }, "invalid folder prefix"),
  })
  .refine(
    (d) => !(d.mode === "move" && d.sourceBucketId === d.destBucketId && d.destFolderPrefix === ""),
    "source and destination are identical",
  );

type MoveResponse = {
  readonly id: string;
  readonly bucketId: string;
  readonly s3Key: string;
};

function json(
  body: ApiResponse<MoveResponse | null>,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

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

  const quota = await limiter.limit(`move:${sub}`);
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
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }
  const input = parsed.data;

  // Source + destination buckets resolved in parallel. Both must exist
  // and the destination must be active; source being inactive is not
  // a hard block because an archived bucket's docs can still be moved
  // OUT (never IN — that is what the dest-active check enforces).
  const [sourceBucket, destBucket] =
    input.sourceBucketId === input.destBucketId
      ? await Promise.all([
          prisma.bucket.findUnique({
            where: { id: input.sourceBucketId },
            select: { id: true, name: true, isActive: true },
          }),
        ]).then(([b]) => [b, b] as const)
      : await Promise.all([
          prisma.bucket.findUnique({
            where: { id: input.sourceBucketId },
            select: { id: true, name: true, isActive: true },
          }),
          prisma.bucket.findUnique({
            where: { id: input.destBucketId },
            select: { id: true, name: true, isActive: true },
          }),
        ]);

  if (!sourceBucket || !destBucket) {
    return json({ data: null, error: "Bucket not found" }, 404);
  }
  if (!destBucket.isActive) {
    return json({ data: null, error: "Destination bucket is inactive" }, 409);
  }

  const doc = await prisma.document.findFirst({
    where: { bucketId: sourceBucket.id, s3Key: input.sourceS3Key },
    select: {
      id: true,
      bucketId: true,
      s3Key: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      isDeleted: true,
    },
  });
  if (!doc) return json({ data: null, error: "Document not found" }, 404);
  if (doc.isDeleted) {
    return json({ data: null, error: "Document is deleted" }, 410);
  }

  const dbUser = await ensureUser(prisma, {
    session,
    role: role === "superadmin" ? "superadmin" : "admin",
  });

  // Per-bucket access check on BOTH ends — admin must have
  // UserBucketAccess for source AND destination. Superadmin is
  // tenant-wide by design.
  if (role !== "superadmin") {
    const [srcAccess, dstAccess] = await Promise.all([
      prisma.userBucketAccess.findFirst({
        where: { userId: dbUser.id, bucketId: sourceBucket.id },
        select: { userId: true },
      }),
      sourceBucket.id === destBucket.id
        ? Promise.resolve({ userId: dbUser.id })
        : prisma.userBucketAccess.findFirst({
            where: { userId: dbUser.id, bucketId: destBucket.id },
            select: { userId: true },
          }),
    ]);
    if (!srcAccess || !dstAccess) {
      return json({ data: null, error: "Forbidden" }, 403);
    }
  }

  // New uuid-prefixed dest key. Prevents overwrite collisions with
  // prior uploads under the same filename + matches the convention
  // established in F6.2 buildUploadKey.
  const destS3Key = `${input.destFolderPrefix}${randomUUID()}-${sanitizeFilename(doc.filename)}`;

  try {
    if (input.mode === "move") {
      await moveObject({
        srcBucket: sourceBucket.name,
        srcKey: doc.s3Key,
        destBucket: destBucket.name,
        destKey: destS3Key,
      });
    } else {
      await copyObject({
        srcBucket: sourceBucket.name,
        srcKey: doc.s3Key,
        destBucket: destBucket.name,
        destKey: destS3Key,
      });
    }
  } catch {
    // Never echo — AWS SDK errors can embed ARN + account ID.
    return json({ data: null, error: "Failed to relocate document" }, 500);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (input.mode === "move") {
        // Move in DB = same row, new (bucketId, s3Key). Document.id
        // stable so downstream references (audit, policies, generated
        // links) keep working.
        const updated = await tx.document.update({
          where: { id: doc.id },
          data: { bucketId: destBucket.id, s3Key: destS3Key },
          select: { id: true, bucketId: true, s3Key: true },
        });
        await tx.auditLog.create({
          data: {
            userId: dbUser.id,
            action: "DOCUMENT_MOVE",
            targetType: "document",
            targetId: updated.id,
            metadata: {
              fromBucketId: sourceBucket.id,
              fromBucketName: sourceBucket.name,
              fromS3Key: doc.s3Key,
              toBucketId: destBucket.id,
              toBucketName: destBucket.name,
              toS3Key: destS3Key,
              filename: doc.filename,
            },
            ipAddress: extractIp(req),
            userAgent: extractUserAgent(req).slice(0, 512),
          },
        });
        return updated;
      }
      // copy mode: new Document row pointing at the new key in the
      // destination bucket.
      const created = await tx.document.create({
        data: {
          bucketId: destBucket.id,
          s3Key: destS3Key,
          filename: doc.filename,
          contentType: doc.contentType,
          sizeBytes: doc.sizeBytes,
          uploadedById: dbUser.id,
        },
        select: { id: true, bucketId: true, s3Key: true },
      });
      await tx.auditLog.create({
        data: {
          userId: dbUser.id,
          action: "DOCUMENT_COPY",
          targetType: "document",
          targetId: created.id,
          metadata: {
            fromDocumentId: doc.id,
            fromBucketId: sourceBucket.id,
            fromBucketName: sourceBucket.name,
            fromS3Key: doc.s3Key,
            toBucketId: destBucket.id,
            toBucketName: destBucket.name,
            toS3Key: destS3Key,
            filename: doc.filename,
          },
          ipAddress: extractIp(req),
          userAgent: extractUserAgent(req).slice(0, 512),
        },
      });
      return created;
    });
    return json(
      { data: { id: result.id, bucketId: result.bucketId, s3Key: result.s3Key }, error: null },
      201,
    );
  } catch {
    // Degraded state: S3 move/copy succeeded but DB write failed. For
    // MOVE, source key is already deleted on S3 and destination is in
    // place, but the Document row still points at the (now-gone) old
    // key — ops reconciliation via audit trail needed. Log this path
    // as a carry-forward for the Module 11/12 reconciliation sweep.
    return json({ data: null, error: "Failed to record relocation" }, 500);
  }
}
