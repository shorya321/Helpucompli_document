import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import { presignGetUrl } from "@/lib/s3-presign";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 60 downloads / 60s per user. More generous than upload-url because
// viewers pull many documents per working session; the downstream
// audit trail still attributes every one.
const limiter = createRateLimiter({
  max: 60,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-download-url",
});

const schema = z.object({
  bucketId: z.string().uuid(),
  s3Key: z
    .string()
    .min(1)
    .max(1024)
    .refine((k) => !k.startsWith("/"), "must not start with '/'")
    .refine((k) => !k.split("/").includes(".."), "must not contain '..'"),
  // Preview vs attachment. Inline embeds the bytes in a browser tab
  // (PDF iframe, image tag). Attachment triggers the native download
  // flow. Audit row is identical for both — bytes transmit either way.
  disposition: z.enum(["attachment", "inline"]).default("attachment"),
});

type DownloadResponse = { readonly url: string; readonly expiresIn: number };

function json(
  body: ApiResponse<DownloadResponse | null>,
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

// Content-Disposition filename: quote-safe subset matching the
// assertContentDisposition validator in s3-presign.ts (allows unicode
// letters/numbers, dot, hyphen, underscore, space, parens, brackets).
// Anything else is replaced with "_" so the presigner accepts the
// final string deterministically.
function safeDispositionFilename(raw: string): string {
  const stripped = raw.replace(/[^\p{L}\p{N} ._\-()[\]]+/gu, "_");
  return stripped.length > 0 ? stripped : "download";
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (!role) return json({ data: null, error: "Forbidden" }, 403);

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const ctype = req.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    return json({ data: null, error: "Unsupported Media Type" }, 415);
  }

  const quota = await limiter.limit(`download-url:${sub}`);
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

  const bucket = await prisma.bucket.findUnique({
    where: { id: input.bucketId },
    select: { id: true, name: true, isActive: true },
  });
  if (!bucket) return json({ data: null, error: "Bucket not found" }, 404);

  // Only downloads from Document rows are allowed. Orphaned S3 objects
  // (failed upload-complete) are unreachable by design — prevents a
  // caller from pulling bytes that never passed the
  // size/verification/audit gate.
  const doc = await prisma.document.findFirst({
    where: { bucketId: bucket.id, s3Key: input.s3Key },
    select: {
      id: true,
      bucketId: true,
      s3Key: true,
      filename: true,
      contentType: true,
      isDeleted: true,
    },
  });
  if (!doc) return json({ data: null, error: "Document not found" }, 404);
  if (doc.isDeleted) {
    // 410 Gone signals soft-deleted-via-versioning — the caller is
    // authorised but the resource is intentionally hidden. Undelete
    // lives in F6.5 / ops tooling.
    return json({ data: null, error: "Document is deleted" }, 410);
  }

  // Per-bucket access check for every non-superadmin caller. Admins
  // are tenant-scoped via UserBucketAccess just like viewers.
  const dbUser = await ensureUser(prisma, {
    session,
    role: role === "superadmin" ? "superadmin" : role,
  });
  if (role !== "superadmin") {
    const access = await prisma.userBucketAccess.findFirst({
      where: { userId: dbUser.id, bucketId: bucket.id },
      select: { userId: true },
    });
    if (!access) return json({ data: null, error: "Forbidden" }, 403);
  }

  // TODO F8: AccessPolicy engine check here — deny when policy
  // mismatches (domain, IP range, expiry). Until F8 lands, every
  // authenticated in-scope caller can download.

  const expiresIn = 900;
  const filenameSafe = safeDispositionFilename(doc.filename);

  try {
    const url = await presignGetUrl({
      bucket: bucket.name,
      key: input.s3Key,
      ttlSeconds: expiresIn,
      responseContentDisposition: `${input.disposition}; filename="${filenameSafe}"`,
      ...(doc.contentType
        ? { responseContentType: doc.contentType }
        : {}),
    });

    await prisma.auditLog.create({
      data: {
        userId: dbUser.id,
        action: "DOCUMENT_DOWNLOAD",
        targetType: "document",
        targetId: doc.id,
        metadata: {
          bucketId: bucket.id,
          bucketName: bucket.name,
          s3Key: input.s3Key,
          filename: doc.filename,
          contentType: doc.contentType ?? null,
        },
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req).slice(0, 512),
      },
    });

    return json({ data: { url, expiresIn }, error: null }, 200);
  } catch {
    return json({ data: null, error: "Failed to issue download URL" }, 500);
  }
}
