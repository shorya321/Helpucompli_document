import { NextRequest } from "next/server";
import { z } from "zod";
import { json } from "@/lib/api-response";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  asFolderDeletePrisma,
  FolderEmptyError,
  FolderHasActiveLinksError,
  FolderTooLargeError,
  hardDeleteFolder,
  softDeleteFolder,
} from "@/lib/folder-delete";

export const dynamic = "force-dynamic";

// 5 folder-deletes / 60s per user. Tighter than per-file delete because
// each call fans out to up to 500 files. Soft + hard share the bucket.
const limiter = createRateLimiter({
  max: 5,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-folders-delete",
});

const softSchema = z.object({
  mode: z.literal("soft"),
  bucketId: z.string().uuid(),
  prefix: z
    .string()
    .min(1)
    .max(1024)
    .refine((p) => !p.startsWith("/"), "must not start with '/'")
    .refine((p) => p.endsWith("/"), "must end with '/'")
    .refine((p) => !p.split("/").includes(".."), "must not contain '..'"),
});

const hardSchema = z.object({
  mode: z.literal("hard"),
  bucketId: z.string().uuid(),
  prefix: z
    .string()
    .min(1)
    .max(1024)
    .refine((p) => !p.startsWith("/"), "must not start with '/'")
    .refine((p) => p.endsWith("/"), "must end with '/'")
    .refine((p) => !p.split("/").includes(".."), "must not contain '..'"),
  confirmName: z.string().min(1).max(255),
});

const bodySchema = z.discriminatedUnion("mode", [softSchema, hardSchema]);

// Last path segment of a "a/b/c/" prefix. Used for typed-name confirm
// on hard-delete (operator types the visible folder name).
function folderNameFromPrefix(prefix: string): string {
  const parts = prefix.split("/").filter((s) => s !== "");
  return parts[parts.length - 1] ?? "";
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

  const quota = await limiter.limit(`folder-delete:${sub}`);
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

  // Hard mode is superadmin-only — guard runs BEFORE any DB / S3 I/O so
  // admins cannot enumerate folder existence via the hard path.
  if (input.mode === "hard" && role !== "superadmin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const bucket = await prisma.bucket.findUnique({
    where: { id: input.bucketId },
    select: { id: true, name: true, isActive: true },
  });
  if (!bucket) return json({ data: null, error: "Bucket not found" }, 404);

  const dbUser = await ensureUser(prisma, {
    session,
    role: role === "superadmin" ? "superadmin" : "admin",
  });

  // Admins must hold UserBucketAccess for this bucket. Superadmins skip.
  if (role !== "superadmin") {
    const access = await prisma.userBucketAccess.findFirst({
      where: { userId: dbUser.id, bucketId: bucket.id },
      select: { userId: true },
    });
    if (!access) return json({ data: null, error: "Forbidden" }, 403);
  }

  if (input.mode === "hard") {
    const expected = folderNameFromPrefix(input.prefix);
    if (input.confirmName.trim().toLowerCase() !== expected.toLowerCase()) {
      return json(
        { data: null, error: "Confirmation does not match folder name" },
        400,
      );
    }
  }

  try {
    const result =
      input.mode === "soft"
        ? await softDeleteFolder(asFolderDeletePrisma(prisma), {
            bucketId: bucket.id,
            bucketName: bucket.name,
            prefix: input.prefix,
            userId: dbUser.id,
            ipAddress: extractIp(req),
            userAgent: extractUserAgent(req),
          })
        : await hardDeleteFolder(asFolderDeletePrisma(prisma), {
            bucketId: bucket.id,
            bucketName: bucket.name,
            prefix: input.prefix,
            userId: dbUser.id,
            ipAddress: extractIp(req),
            userAgent: extractUserAgent(req),
          });
    return json({ data: { ok: true, ...result }, error: null }, 200);
  } catch (err) {
    if (err instanceof FolderTooLargeError) {
      return json({ data: null, error: err.message }, 409);
    }
    if (err instanceof FolderEmptyError) {
      return json({ data: null, error: "Folder is empty" }, 404);
    }
    if (err instanceof FolderHasActiveLinksError) {
      return json({ data: null, error: err.message }, 409);
    }
    // Never leak engine messages — could embed DATABASE_URL or AWS ARNs.
    return json({ data: null, error: "Failed to delete folder" }, 500);
  }
}
