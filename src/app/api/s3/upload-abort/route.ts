import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { uploadAbortRequestSchema } from "@/lib/document-upload";
import { abortMultipartUpload } from "@/lib/s3-multipart";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  InvalidUploadReceiptError,
  verifyUploadReceipt,
} from "@/lib/upload-receipt";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-upload-abort",
});

function json(
  body: ApiResponse<{ readonly aborted: true } | null>,
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

  const quota = await limiter.limit(`upload-abort:${sub}`);
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
  const parsed = uploadAbortRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ data: null, error: "Invalid input" }, 400);
  }
  const input = parsed.data;

  try {
    verifyUploadReceipt(input.receipt, {
      sub,
      bucketId: input.bucketId,
      s3Key: input.s3Key,
      uploadId: input.uploadId,
    });
  } catch (err) {
    if (err instanceof InvalidUploadReceiptError) {
      return json({ data: null, error: "Invalid upload receipt" }, 401);
    }
    return json({ data: null, error: "Invalid upload receipt" }, 401);
  }

  const bucket = await prisma.bucket.findUnique({
    where: { id: input.bucketId },
    select: { id: true, name: true, isActive: true },
  });
  if (!bucket) return json({ data: null, error: "Bucket not found" }, 404);

  try {
    await abortMultipartUpload({
      bucket: bucket.name,
      key: input.s3Key,
      uploadId: input.uploadId,
    });
    return json({ data: { aborted: true }, error: null }, 200);
  } catch {
    // Lifecycle rule (F3.2) sweeps orphans after 7 days even if abort
    // fails. Don't leak the underlying AWS error.
    return json({ data: null, error: "Failed to abort upload" }, 500);
  }
}
