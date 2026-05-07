import { NextRequest } from "next/server";
import { z } from "zod";

import { json } from "@/lib/api-response";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { ensureUser } from "@/lib/ensure-user";
import {
  asFolderRestorePrisma,
  FolderRestoreConflictError,
  FolderRestoreTooLargeError,
  restoreFolder,
} from "@/lib/folder-restore";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";
import { extractIp, extractUserAgent } from "@/lib/request-headers";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  max: 10,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-folders-restore",
});

const bodySchema = z.object({
  bucketId: z.string().uuid(),
  prefix: z
    .string()
    .min(1)
    .max(1024)
    .refine((p) => !p.startsWith("/"), "must not start with '/'")
    .refine((p) => p.endsWith("/"), "must end with '/'")
    .refine((p) => !p.split("/").includes(".."), "must not contain '..'"),
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

  const quota = await limiter.limit(`folder-restore:${sub}`);
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
    const result = await restoreFolder(asFolderRestorePrisma(prisma), {
      bucketId: bucket.id,
      bucketName: bucket.name,
      prefix: input.prefix,
      userId: dbUser.id,
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
    });
    return json({ data: { ok: true, ...result }, error: null }, 200);
  } catch (err) {
    if (err instanceof FolderRestoreTooLargeError) {
      return json({ data: null, error: err.message }, 409);
    }
    if (err instanceof FolderRestoreConflictError) {
      return json({ data: null, error: err.message }, 409);
    }
    console.error("[folders-restore-route] unexpected error", {
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : "Unknown",
      bucketId: input.bucketId,
      prefix: input.prefix,
      userId: dbUser.id,
    });
    return json({ data: null, error: "Failed to restore folder" }, 500);
  }
}
