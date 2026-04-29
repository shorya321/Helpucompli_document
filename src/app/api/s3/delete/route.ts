import { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import {
  hardDeleteObjectVersion,
  listObjectVersions,
  softDeleteObject,
} from "@/lib/s3-objects";
import { createRateLimiter } from "@/lib/rate-limit";
import { logAudit, asAuditPrisma } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 10 deletes / 60s per user. Delete is destructive — tight cap. Soft
// and hard share the quota because a hard-delete attempt preceded by
// a soft-delete should still count.
const limiter = createRateLimiter({
  max: 10,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-delete",
});

const softSchema = z.object({
  mode: z.literal("soft"),
  bucketId: z.string().uuid(),
  s3Key: z
    .string()
    .min(1)
    .max(1024)
    .refine((k) => !k.startsWith("/"), "must not start with '/'")
    .refine((k) => !k.split("/").includes(".."), "must not contain '..'"),
});

const hardSchema = z.object({
  mode: z.literal("hard"),
  bucketId: z.string().uuid(),
  s3Key: z
    .string()
    .min(1)
    .max(1024)
    .refine((k) => !k.startsWith("/"), "must not start with '/'")
    .refine((k) => !k.split("/").includes(".."), "must not contain '..'"),
  confirmName: z.string().min(1).max(255),
});

const bodySchema = z.discriminatedUnion("mode", [softSchema, hardSchema]);

// Regulatory-hold check — placeholder until Module 08 wires the
// AccessPolicy engine. Today every document is treated as NOT under
// hold so hard-delete is permissible once the confirm-name gate + link
// count gate pass. Module 08 will swap this for a real policy lookup
// against AccessPolicy rows with a `retention`-style field.
// TODO F8: replace body with real policy lookup.
function isUnderRegulatoryHold(_doc: { id: string }): Promise<boolean> {
  return Promise.resolve(false);
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

  const quota = await limiter.limit(`delete:${sub}`);
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

  // Hard delete is superadmin-only. The mode-level guard runs BEFORE
  // any DB I/O so admins can't enumerate bucket/document existence
  // through the hard-delete surface.
  if (input.mode === "hard" && role !== "superadmin") {
    return json({ data: null, error: "Forbidden" }, 403);
  }

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

  if (input.mode === "soft") {
    if (doc.isDeleted) {
      // 410 Gone — idempotent soft-delete. Prevents a second call from
      // writing a duplicate audit row + second delete marker.
      return json({ data: null, error: "Document already deleted" }, 410);
    }
    try {
      await softDeleteObject({ bucket: bucket.name, key: input.s3Key });
    } catch {
      return json({ data: null, error: "Failed to soft-delete" }, 500);
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.document.update({
          where: { id: doc.id },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedById: dbUser.id,
          },
          select: { id: true },
        });
        await logAudit(asAuditPrisma(tx), {
          userId: dbUser.id,
          action: "DOCUMENT_SOFT_DELETE",
          targetType: "document",
          targetId: doc.id,
          metadata: {
            bucketId: bucket.id,
            bucketName: bucket.name,
            s3Key: input.s3Key,
            filename: doc.filename,
          },
          ipAddress: extractIp(req),
          userAgent: extractUserAgent(req),
        });
      });
      return json({ data: { ok: true }, error: null }, 200);
    } catch {
      return json({ data: null, error: "Failed to record deletion" }, 500);
    }
  }

  // ---- HARD DELETE PATH (superadmin only, pre-gated above) ----

  // Typed-name confirmation — case-normalised. Matches F5.4
  // delete-bucket-dialog pattern: operator must type the filename,
  // but MixedCase vs lowercase should not 400.
  if (input.confirmName.trim().toLowerCase() !== doc.filename.toLowerCase()) {
    return json(
      { data: null, error: "Confirmation does not match filename" },
      400,
    );
  }

  // Hard-delete is already gated by superadmin role + typed-filename
  // confirm. Generated links for this document — active or revoked —
  // are dropped inside the delete transaction below. Active links
  // become 404s after deletion, which is the correct semantic for
  // hard-delete (the underlying object is gone). The audit trail of
  // CREATE/REVOKE actions lives in audit_logs and is retained.

  if (await isUnderRegulatoryHold(doc)) {
    return json(
      { data: null, error: "Document is under regulatory hold" },
      409,
    );
  }

  // Enumerate every version (including delete markers). S3 versioning
  // is enabled on every bucket (F3.2), so even a soft-deleted object
  // has at least one non-marker version to purge.
  let versionsRemoved = 0;
  try {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
     
    while (true) {
      const page = await listObjectVersions({
        bucket: bucket.name,
        prefix: input.s3Key,
        ...(keyMarker ? { keyMarker } : {}),
        ...(versionIdMarker ? { versionIdMarker } : {}),
        maxKeys: 1000,
      });
      for (const v of page.versions) {
        // prefix match can surface sibling keys that start with our
        // exact key string — skip those.
        if (v.key !== input.s3Key) continue;
        if (!v.versionId) continue;
        await hardDeleteObjectVersion({
          bucket: bucket.name,
          key: input.s3Key,
          versionId: v.versionId,
        });
        versionsRemoved += 1;
      }
      if (!page.isTruncated) break;
      keyMarker = page.nextKeyMarker;
      versionIdMarker = page.nextVersionIdMarker;
      if (!keyMarker && !versionIdMarker) break;
    }
     
  } catch {
    return json({ data: null, error: "Failed to purge object versions" }, 500);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Drop every generated link row for this document — schema keeps
      // the FK as RESTRICT, so this must run before document.delete or
      // Prisma will throw P2003. CREATE/REVOKE audit rows live in
      // audit_logs and are retained for the 6-year window.
      await tx.generatedLink.deleteMany({
        where: { documentId: doc.id },
      });
      await tx.document.delete({
        where: { id: doc.id },
        select: { id: true },
      });
      await logAudit(asAuditPrisma(tx), {
        userId: dbUser.id,
        action: "DOCUMENT_HARD_DELETE",
        targetType: "document",
        targetId: doc.id,
        metadata: {
          bucketId: bucket.id,
          bucketName: bucket.name,
          s3Key: input.s3Key,
          filename: doc.filename,
          versionsRemoved,
        },
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
      });
    });
    return json({ data: { ok: true, versionsRemoved }, error: null }, 200);
  } catch {
    // Degraded state: S3 versions gone, DB row still present. Ops
    // reconciliation via audit trail — flagged as carry-forward for
    // Module 11/12 sweep.
    return json({ data: null, error: "Failed to record hard-delete" }, 500);
  }
}
