import type { Prisma, PrismaClient } from "@prisma/client";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import { getS3Client } from "@/lib/s3";
import { listObjectVersions, restoreObject } from "@/lib/s3-objects";
import { asAuditPrisma, logAudit } from "@/lib/audit";

const FOLDER_RESTORE_MAX_OBJECTS = 500;

export interface DeletedFolderMarker {
  readonly key: string;
  readonly versionId: string;
  readonly deletedAt: Date | null;
}

export class FolderRestoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderRestoreConflictError";
  }
}

export class FolderRestoreTooLargeError extends Error {
  constructor(public readonly count: number) {
    super(
      `Folder contains ${count} deleted document(s), exceeding the restore cap of ${FOLDER_RESTORE_MAX_OBJECTS}`,
    );
    this.name = "FolderRestoreTooLargeError";
  }
}

function assertFolderMarkerPrefix(prefix: string): void {
  if (prefix === "") return;
  if (prefix.startsWith("/") || !prefix.endsWith("/") || prefix.split("/").includes("..")) {
    throw new FolderRestoreConflictError("Invalid folder prefix");
  }
}

function assertRestorableFolderPrefix(prefix: string): void {
  assertFolderMarkerPrefix(prefix);
  if (prefix === "") {
    throw new FolderRestoreConflictError("Folder prefix must not be empty");
  }
}

function collapseNestedMarkers(
  markers: ReadonlyArray<DeletedFolderMarker>,
): DeletedFolderMarker[] {
  const sorted = [...markers].sort((a, b) => a.key.localeCompare(b.key));
  const collapsed: DeletedFolderMarker[] = [];
  for (const marker of sorted) {
    const parentAlreadyShown = collapsed.some(
      (existing) => marker.key !== existing.key && marker.key.startsWith(existing.key),
    );
    if (!parentAlreadyShown) collapsed.push(marker);
  }
  return collapsed;
}

export async function listDeletedFolderMarkers({
  bucket,
  prefix,
  collapseNested = true,
}: {
  readonly bucket: string;
  readonly prefix?: string;
  readonly collapseNested?: boolean;
}): Promise<DeletedFolderMarker[]> {
  if (!bucket) throw new FolderRestoreConflictError("Bucket name is required");
  if (prefix !== undefined) assertFolderMarkerPrefix(prefix);

  const markers: DeletedFolderMarker[] = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const versions = await listObjectVersions({
      bucket,
      ...(prefix !== undefined ? { prefix } : {}),
      ...(keyMarker ? { keyMarker } : {}),
      ...(versionIdMarker ? { versionIdMarker } : {}),
      maxKeys: 1000,
    });

    for (const version of versions.versions) {
      if (
        version.key.endsWith("/") &&
        version.isDeleteMarker &&
        version.isLatest &&
        version.versionId
      ) {
        markers.push({
          key: version.key,
          versionId: version.versionId,
          deletedAt: version.lastModified ?? null,
        });
      }
    }

    if (!versions.isTruncated) break;
    keyMarker = versions.nextKeyMarker;
    versionIdMarker = versions.nextVersionIdMarker;
    if (!keyMarker && !versionIdMarker) break;
  }

  return collapseNested ? collapseNestedMarkers(markers) : markers;
}

export async function restoreFolderMarker({
  bucket,
  key,
  versionId,
}: {
  readonly bucket: string;
  readonly key: string;
  readonly versionId: string;
}): Promise<{ restoredFromVersionId: string }> {
  if (!bucket) throw new FolderRestoreConflictError("Bucket name is required");
  assertRestorableFolderPrefix(key);
  if (!versionId) throw new FolderRestoreConflictError("VersionId is required");

  const res = await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: versionId,
    }),
  );

  return { restoredFromVersionId: res.VersionId ?? versionId };
}

export interface FolderRestoreContext {
  readonly bucketId: string;
  readonly bucketName: string;
  readonly prefix: string;
  readonly userId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface FolderRestoreResult {
  readonly filesRestored: number;
  readonly folderMarkersRestored: number;
}

export interface FolderRestorePrisma {
  readonly document: {
    findMany(args: {
      where: Prisma.DocumentWhereInput;
      select: { id: true; s3Key: true; isDeleted: true; filename: true };
    }): Promise<
      Array<{ id: string; s3Key: string; isDeleted: boolean; filename: string }>
    >;
  };
  $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

export function asFolderRestorePrisma(client: PrismaClient): FolderRestorePrisma {
  return client as unknown as FolderRestorePrisma;
}

export async function restoreFolder(
  prisma: FolderRestorePrisma,
  ctx: FolderRestoreContext,
): Promise<FolderRestoreResult> {
  assertRestorableFolderPrefix(ctx.prefix);

  const [markers, docs] = await Promise.all([
    listDeletedFolderMarkers({
      bucket: ctx.bucketName,
      prefix: ctx.prefix,
      collapseNested: false,
    }),
    prisma.document.findMany({
      where: {
        bucketId: ctx.bucketId,
        isDeleted: true,
        s3Key: { startsWith: ctx.prefix },
      },
      select: { id: true, s3Key: true, isDeleted: true, filename: true },
    }),
  ]);

  if (markers.length === 0) {
    throw new FolderRestoreConflictError("Folder is not soft-deleted");
  }
  if (docs.length > FOLDER_RESTORE_MAX_OBJECTS) {
    throw new FolderRestoreTooLargeError(docs.length);
  }

  let filesRestored = 0;
  for (const doc of docs) {
    await restoreObject({ bucket: ctx.bucketName, key: doc.s3Key });
    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: { isDeleted: false, deletedAt: null, deletedById: null },
        select: { id: true },
      });
      await logAudit(asAuditPrisma(tx), {
        userId: ctx.userId,
        action: "DOCUMENT_RESTORE",
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
    filesRestored += 1;
  }

  let folderMarkersRestored = 0;
  for (const marker of markers) {
    await restoreFolderMarker({
      bucket: ctx.bucketName,
      key: marker.key,
      versionId: marker.versionId,
    });
    folderMarkersRestored += 1;
  }

  await prisma.$transaction(async (tx) => {
    await logAudit(asAuditPrisma(tx), {
      userId: ctx.userId,
      action: "DOCUMENT_RESTORE",
      targetType: "folder",
      targetId: ctx.prefix,
      metadata: {
        bucketId: ctx.bucketId,
        bucketName: ctx.bucketName,
        folderPrefix: ctx.prefix,
        filesRestored,
        folderMarkersRestored,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return { filesRestored, folderMarkersRestored };
}
