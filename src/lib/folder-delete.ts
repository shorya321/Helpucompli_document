import type { Prisma, PrismaClient } from "@prisma/client";
import {
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3";
import {
  hardDeleteObjectVersion,
  listObjects,
  listObjectVersions,
  softDeleteObject,
} from "@/lib/s3-objects";
import { assertFolderPrefix } from "@/lib/document-upload";
import { logAudit, asAuditPrisma } from "@/lib/audit";

// Synchronous folder delete is bounded — bigger folders MUST be deleted
// individually until a background-job pipeline exists. 500 keeps a hard
// cap on S3 calls + Prisma writes per request to roughly:
//   soft: 500 S3 deletes + 500 DB updates + 500 audit rows
//   hard: <=500 listVersions + N×versions S3 deletes + 500 DB deletes + 500 audit rows
// Both stay well inside the 10s default route timeout for typical sizes.
export const FOLDER_DELETE_MAX_OBJECTS = 500;

export class FolderTooLargeError extends Error {
  constructor(public readonly count: number) {
    super(
      `Folder contains ${count} objects which exceeds the synchronous-delete cap of ${FOLDER_DELETE_MAX_OBJECTS}`,
    );
    this.name = "FolderTooLargeError";
  }
}

export class FolderEmptyError extends Error {
  constructor() {
    super("Folder contains no objects");
    this.name = "FolderEmptyError";
  }
}

export class FolderHasActiveLinksError extends Error {
  constructor(public readonly count: number) {
    super(
      `Folder has ${count} document(s) with active generated links — revoke them before hard-delete`,
    );
    this.name = "FolderHasActiveLinksError";
  }
}

interface ListedKey {
  readonly key: string;
  readonly isFolderMarker: boolean;
}

async function listAllKeys(
  bucket: string,
  prefix: string,
): Promise<ReadonlyArray<ListedKey>> {
  const keys: ListedKey[] = [];
  let continuationToken: string | undefined;
  // Hard-cap iteration too — defense in depth in case S3 returns more
  // than expected (paranoia: prevent an unbounded loop on a misbehaving
  // S3 endpoint).
  for (let i = 0; i < 10; i += 1) {
    const page = await listObjects({
      bucket,
      prefix,
      delimiter: "",
      maxKeys: 1000,
      ...(continuationToken ? { continuationToken } : {}),
    });
    for (const c of page.contents) {
      if (typeof c.Key !== "string") continue;
      keys.push({
        key: c.Key,
        isFolderMarker: c.Key.endsWith("/"),
      });
      if (keys.length > FOLDER_DELETE_MAX_OBJECTS) {
        throw new FolderTooLargeError(keys.length);
      }
    }
    if (!page.isTruncated) break;
    continuationToken = page.nextContinuationToken;
    if (!continuationToken) break;
  }
  return keys;
}

export interface FolderDeleteContext {
  readonly bucketId: string;
  readonly bucketName: string;
  readonly prefix: string; // must end with "/"
  readonly userId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface FolderDeleteResult {
  readonly filesDeleted: number;
  readonly folderMarkersDeleted: number;
}

// Narrow Prisma surface so tests can stub.
export interface FolderDeletePrisma {
  readonly document: {
    findMany(args: {
      where: Prisma.DocumentWhereInput;
      select: { id: true; s3Key: true; isDeleted: true; filename: true };
      take?: number;
    }): Promise<
      Array<{ id: string; s3Key: string; isDeleted: boolean; filename: string }>
    >;
  };
  readonly generatedLink: {
    count(args: { where: Prisma.GeneratedLinkWhereInput }): Promise<number>;
  };
  $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

export function asFolderDeletePrisma(client: PrismaClient): FolderDeletePrisma {
  return client as unknown as FolderDeletePrisma;
}

// Soft-delete every file inside the folder + remove every folder-marker
// object inside the prefix. Each non-deleted document gets:
//   - S3 delete marker (versioned)
//   - DB row updated (isDeleted=true, deletedAt, deletedById)
//   - DOCUMENT_SOFT_DELETE audit row with metadata.viaFolder=true
// Already-soft-deleted documents are skipped (no double audit). Folder
// markers under the prefix are deleted from S3 only — they have no DB
// row.
export async function softDeleteFolder(
  prisma: FolderDeletePrisma,
  ctx: FolderDeleteContext,
): Promise<FolderDeleteResult> {
  assertFolderPrefix(ctx.prefix);
  if (ctx.prefix === "") {
    throw new Error("softDeleteFolder: prefix must not be empty (would target bucket root)");
  }

  const keys = await listAllKeys(ctx.bucketName, ctx.prefix);
  if (keys.length === 0) throw new FolderEmptyError();

  const fileKeys = keys.filter((k) => !k.isFolderMarker).map((k) => k.key);
  const markerKeys = keys.filter((k) => k.isFolderMarker).map((k) => k.key);

  const docs = await prisma.document.findMany({
    where: { bucketId: ctx.bucketId, s3Key: { in: fileKeys } },
    select: { id: true, s3Key: true, isDeleted: true, filename: true },
  });
  const docByKey = new Map(docs.map((d) => [d.s3Key, d]));

  let filesDeleted = 0;

  for (const fileKey of fileKeys) {
    const doc = docByKey.get(fileKey);
    if (!doc) continue; // S3 object with no DB row — skip (legacy / orphan)
    if (doc.isDeleted) continue; // idempotent

    await softDeleteObject({ bucket: ctx.bucketName, key: fileKey });

    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedById: ctx.userId,
        },
        select: { id: true },
      });
      await logAudit(asAuditPrisma(tx), {
        userId: ctx.userId,
        action: "DOCUMENT_SOFT_DELETE",
        targetType: "document",
        targetId: doc.id,
        metadata: {
          bucketId: ctx.bucketId,
          bucketName: ctx.bucketName,
          s3Key: fileKey,
          filename: doc.filename,
          viaFolder: true,
          folderPrefix: ctx.prefix,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    });
    filesDeleted += 1;
  }

  // Folder markers — pure S3, no DB row. Delete after files so a partial
  // failure leaves the folder still browsable.
  let folderMarkersDeleted = 0;
  for (const markerKey of markerKeys) {
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: ctx.bucketName, Key: markerKey }),
    );
    folderMarkersDeleted += 1;
  }

  return { filesDeleted, folderMarkersDeleted };
}

// Hard-delete every DB document under the folder prefix + remove every
// currently listed folder marker. DB is the document source of truth here:
// a document row can outlive its current S3 object if an upload/delete
// path partially completed, and those rows must not keep bucket deletion
// blocked after a folder hard-delete.
// For each document:
//   - all S3 versions purged (including delete markers from prior soft-deletes)
//   - DB row deleted
//   - DOCUMENT_HARD_DELETE audit row with metadata.viaFolder=true
export async function hardDeleteFolder(
  prisma: FolderDeletePrisma,
  ctx: FolderDeleteContext,
): Promise<FolderDeleteResult> {
  assertFolderPrefix(ctx.prefix);
  if (ctx.prefix === "") {
    throw new Error("hardDeleteFolder: prefix must not be empty (would target bucket root)");
  }

  const keys = await listAllKeys(ctx.bucketName, ctx.prefix);
  const markerKeys = keys.filter((k) => k.isFolderMarker).map((k) => k.key);

  const docs = await prisma.document.findMany({
    where: { bucketId: ctx.bucketId, s3Key: { startsWith: ctx.prefix } },
    select: { id: true, s3Key: true, isDeleted: true, filename: true },
    take: FOLDER_DELETE_MAX_OBJECTS + 1,
  });
  if (keys.length === 0 && docs.length === 0) throw new FolderEmptyError();
  if (docs.length + markerKeys.length > FOLDER_DELETE_MAX_OBJECTS) {
    throw new FolderTooLargeError(docs.length + markerKeys.length);
  }

  // Generated links for every document in the folder — active or
  // revoked — are dropped inside each per-doc transaction below. Hard-
  // delete is already gated by superadmin + typed folder-name confirm
  // upstream; a separate "revoke first" gate adds friction without a
  // matching UI affordance and produces the same end-state regardless.

  let filesDeleted = 0;

  for (const doc of docs) {
    // Purge all versions including delete markers from prior soft-delete.
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const v = await listObjectVersions({
        bucket: ctx.bucketName,
        prefix: doc.s3Key,
        ...(keyMarker ? { keyMarker } : {}),
        ...(versionIdMarker ? { versionIdMarker } : {}),
        maxKeys: 1000,
      });
      for (const ver of v.versions) {
        if (ver.key !== doc.s3Key) continue;
        if (!ver.versionId) continue;
        await hardDeleteObjectVersion({
          bucket: ctx.bucketName,
          key: doc.s3Key,
          versionId: ver.versionId,
        });
      }
      if (!v.isTruncated) break;
      keyMarker = v.nextKeyMarker;
      versionIdMarker = v.nextVersionIdMarker;
      if (!keyMarker && !versionIdMarker) break;
    }

    await prisma.$transaction(async (tx) => {
      // Purge revoked link rows the active-link guard skipped — must
      // run before document.delete because the FK is RESTRICT.
      await tx.generatedLink.deleteMany({
        where: { documentId: doc.id },
      });
      await tx.document.delete({
        where: { id: doc.id },
        select: { id: true },
      });
      await logAudit(asAuditPrisma(tx), {
        userId: ctx.userId,
        action: "DOCUMENT_HARD_DELETE",
        targetType: "document",
        targetId: doc.id,
        metadata: {
          bucketId: ctx.bucketId,
          bucketName: ctx.bucketName,
          s3Key: doc.s3Key,
          filename: doc.filename,
          viaFolder: true,
          folderPrefix: ctx.prefix,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    });
    filesDeleted += 1;
  }

  // Folder markers — purge every version (versioning enabled bucket-wide).
  let folderMarkersDeleted = 0;
  for (const markerKey of markerKeys) {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const v = await listObjectVersions({
        bucket: ctx.bucketName,
        prefix: markerKey,
        ...(keyMarker ? { keyMarker } : {}),
        ...(versionIdMarker ? { versionIdMarker } : {}),
        maxKeys: 1000,
      });
      for (const ver of v.versions) {
        if (ver.key !== markerKey) continue;
        if (!ver.versionId) continue;
        // Folder marker keys end with "/" which assertKey() rejects.
        // Use raw SDK call to bypass — mirrors the soft-delete folder
        // path that does the same for marker objects.
        await getS3Client().send(
          new DeleteObjectCommand({
            Bucket: ctx.bucketName,
            Key: markerKey,
            VersionId: ver.versionId,
          }),
        );
      }
      if (!v.isTruncated) break;
      keyMarker = v.nextKeyMarker;
      versionIdMarker = v.nextVersionIdMarker;
      if (!keyMarker && !versionIdMarker) break;
    }
    folderMarkersDeleted += 1;
  }

  return { filesDeleted, folderMarkersDeleted };
}
