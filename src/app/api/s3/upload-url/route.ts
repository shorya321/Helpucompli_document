import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  buildUploadKey,
  chooseUploadMode,
  uploadUrlRequestSchema,
} from "@/lib/document-upload";
import { presignPutUrl } from "@/lib/s3-presign";
import {
  initiateMultipartUpload,
  planMultipartParts,
  presignUploadPart,
} from "@/lib/s3-multipart";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// Presign URLs are write bearer tokens — cap the issuance rate tightly.
// 20 URLs / 60s per authenticated user covers legitimate multi-file
// upload batches (each file = 1 request) but blocks abuse where a token
// is replayed to harvest presigned URLs for later offline write abuse.
const limiter = createRateLimiter({
  max: 20,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-upload-url",
});

type UploadUrlResponse =
  | {
      readonly mode: "simple";
      readonly s3Key: string;
      readonly url: string;
      readonly expiresIn: number;
    }
  | {
      readonly mode: "multipart";
      readonly s3Key: string;
      readonly uploadId: string;
      readonly parts: ReadonlyArray<{ readonly partNumber: number; readonly url: string }>;
      readonly expiresIn: number;
    };

function json(body: ApiResponse<UploadUrlResponse | null>, status: number, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  // Upload creates new tenant data — gated to admin + superadmin. Viewers
  // are read-only.
  if (role !== "superadmin" && role !== "admin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const ctype = req.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    return json({ data: null, error: "Unsupported Media Type" }, 415);
  }

  const quota = await limiter.limit(`upload-url:${sub}`);
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

  const parsed = uploadUrlRequestSchema.safeParse(payload);
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
    // 409 rather than 404 because the row DOES exist — returning 404
    // would conflate missing + inactive and confuse the UX; the caller
    // is authorised and allowed to know the bucket has been deactivated.
    return json({ data: null, error: "Bucket is inactive" }, 409);
  }

  // UUID-prefixed key prevents overwrite collisions when the same
  // filename is uploaded twice. Filename is sanitized before being
  // embedded in the key to avoid traversal + control-char issues.
  const s3Key = buildUploadKey({
    folderPrefix: input.folderPrefix ?? "",
    filename: input.filename,
    uuid: randomUUID(),
  });

  const mode = chooseUploadMode(input.sizeBytes);
  const expiresIn = 900;

  try {
    if (mode === "simple") {
      const url = await presignPutUrl({
        bucket: bucket.name,
        key: s3Key,
        contentType: input.contentType,
        ttlSeconds: expiresIn,
      });
      return json(
        {
          data: { mode: "simple", s3Key, url, expiresIn },
          error: null,
        },
        200,
      );
    }

    const init = await initiateMultipartUpload({
      bucket: bucket.name,
      key: s3Key,
      contentType: input.contentType,
      declaredSizeBytes: input.sizeBytes,
    });
    const plan = planMultipartParts(input.sizeBytes);
    const parts = await Promise.all(
      plan.parts.map(async (p) => ({
        partNumber: p.partNumber,
        url: await presignUploadPart({
          bucket: bucket.name,
          key: s3Key,
          uploadId: init.uploadId,
          partNumber: p.partNumber,
          ttlSeconds: expiresIn,
        }),
      })),
    );
    return json(
      {
        data: {
          mode: "multipart",
          s3Key,
          uploadId: init.uploadId,
          parts,
          expiresIn,
        },
        error: null,
      },
      200,
    );
  } catch {
    // NEVER echo — AWS SDK errors can embed ARN + account ID.
    return json({ data: null, error: "Failed to issue upload URL" }, 500);
  }
}
