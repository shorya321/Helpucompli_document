import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import {
  assertFolderName,
  createFolderMarker,
  InvalidFolderNameError,
  MAX_FOLDER_NAME_LENGTH,
} from "@/lib/s3-folders";
import { assertFolderPrefix } from "@/lib/document-upload";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 20 creates / 60s per user. Matches upload-url cadence — folder
// create is cheaper than file upload but still a write + audit row.
const limiter = createRateLimiter({
  max: 20,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-folders",
});

const schema = z.object({
  bucketId: z.string().uuid(),
  parentPrefix: z
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
    }, "invalid parentPrefix"),
  name: z
    .string()
    .min(1)
    .max(MAX_FOLDER_NAME_LENGTH)
    .refine((v) => {
      try {
        assertFolderName(v);
        return true;
      } catch {
        return false;
      }
    }, "invalid folder name"),
});

type FolderResponse = { readonly key: string };

function json(
  body: ApiResponse<FolderResponse | null>,
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

  const quota = await limiter.limit(`folders:${sub}`);
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
  if (!bucket.isActive) {
    return json({ data: null, error: "Bucket is inactive" }, 409);
  }

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

  try {
    const result = await createFolderMarker({
      bucket: bucket.name,
      parentPrefix: input.parentPrefix,
      name: input.name,
    });

    // Reuse DOCUMENT_UPLOAD for HIPAA audit — metadata.mode + targetType
    // distinguish folder markers from real document uploads. A
    // dedicated FOLDER_CREATE enum value is carry-forward for Module 11
    // (audit UI will filter on metadata.mode until the migration lands).
    await prisma.auditLog.create({
      data: {
        userId: dbUser.id,
        action: "DOCUMENT_UPLOAD",
        targetType: "folder",
        targetId: result.key,
        metadata: {
          mode: "folder_marker",
          bucketId: bucket.id,
          bucketName: bucket.name,
          parentPrefix: input.parentPrefix,
          name: input.name,
          s3Key: result.key,
        },
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req).slice(0, 512),
      },
    });

    return json({ data: { key: result.key }, error: null }, 201);
  } catch (err) {
    if (err instanceof InvalidFolderNameError) {
      return json({ data: null, error: "Invalid folder name" }, 400);
    }
    return json({ data: null, error: "Failed to create folder" }, 500);
  }
}
