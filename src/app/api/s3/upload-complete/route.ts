import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import { uploadCompleteRequestSchema } from "@/lib/document-upload";
import { completeMultipartUpload } from "@/lib/s3-multipart";
import { headObject } from "@/lib/s3-objects";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 30 completes / 60s per user. Slightly higher than upload-url because a
// multi-file batch produces one complete-call per file.
const limiter = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-upload-complete",
});

type CompleteResponse = { readonly id: string };

function json(
  body: ApiResponse<CompleteResponse | null>,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
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

  const quota = await limiter.limit(`upload-complete:${sub}`);
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

  const parsed = uploadCompleteRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }
  const input = parsed.data;

  const bucket = await prisma.bucket.findUnique({
    where: { id: input.bucketId },
    select: { id: true, name: true, isActive: true },
  });
  if (!bucket) return json({ data: null, error: "Bucket not found" }, 404);
  if (!bucket.isActive) {
    return json({ data: null, error: "Bucket is inactive" }, 409);
  }

  const dbUser = await ensureUser(prisma, {
    session,
    role: role === "superadmin" ? "superadmin" : "admin",
  });

  // Close out the multipart session FIRST. S3 rejects malformed parts
  // here (wrong order / wrong ETags) so we fail the request before
  // writing any DB state. A failed complete leaves the parts pending,
  // swept by the 7-day lifecycle rule (F3.2).
  if (input.multipart) {
    try {
      await completeMultipartUpload({
        bucket: bucket.name,
        key: input.s3Key,
        uploadId: input.multipart.uploadId,
        parts: input.multipart.parts.map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
        })),
      });
    } catch {
      return json(
        { data: null, error: "Failed to complete multipart upload" },
        422,
      );
    }
  }

  // Verify the object actually landed at the expected key before we
  // write the Document row. Closes the window where a client skips the
  // PUT and calls upload-complete directly to forge a metadata entry
  // without any S3 content. HIPAA integrity — DB rows MUST point at
  // real S3 objects.
  let headContentLength: number | undefined;
  try {
    const head = await headObject({ bucket: bucket.name, key: input.s3Key });
    headContentLength = head.contentLength;
  } catch {
    return json(
      { data: null, error: "Uploaded object not found in S3" },
      422,
    );
  }

  // Declared size MUST match the byte count S3 observed. A mismatch
  // means the client sent a forged or truncated payload; reject rather
  // than store a misleading sizeBytes.
  if (
    typeof headContentLength === "number" &&
    headContentLength !== input.sizeBytes
  ) {
    return json(
      { data: null, error: "Size mismatch between client claim and S3 object" },
      400,
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          bucketId: bucket.id,
          s3Key: input.s3Key,
          filename: input.filename,
          contentType: input.contentType,
          sizeBytes: BigInt(input.sizeBytes),
          uploadedById: dbUser.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: dbUser.id,
          action: "DOCUMENT_UPLOAD",
          targetType: "document",
          targetId: doc.id,
          metadata: {
            bucketId: bucket.id,
            bucketName: bucket.name,
            s3Key: input.s3Key,
            filename: input.filename,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            mode: input.multipart ? "multipart" : "simple",
          },
          ipAddress: extractIp(req),
          userAgent: extractUserAgent(req).slice(0, 512),
        },
      });
      return doc;
    });
    return json({ data: { id: created.id }, error: null }, 201);
  } catch {
    return json({ data: null, error: "Failed to record upload" }, 500);
  }
}
