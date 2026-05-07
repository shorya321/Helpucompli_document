import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listObjects: vi.fn(),
  listObjectVersions: vi.fn(),
  hardDeleteObjectVersion: vi.fn(),
  getS3Client: vi.fn(),
}));

vi.mock("@/lib/s3-objects", async () => {
  const actual = await vi.importActual<typeof import("@/lib/s3-objects")>(
    "@/lib/s3-objects",
  );
  return {
    ...actual,
    listObjects: mocks.listObjects,
    listObjectVersions: mocks.listObjectVersions,
    hardDeleteObjectVersion: mocks.hardDeleteObjectVersion,
  };
});

vi.mock("@/lib/s3", () => ({
  getS3Client: mocks.getS3Client,
}));

import {
  FOLDER_DELETE_MAX_OBJECTS,
  hardDeleteFolder,
  type FolderDeletePrisma,
} from "@/lib/folder-delete";

afterEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

function makePrisma() {
  const doc = {
    id: "doc-orphan",
    s3Key: "docs/q1/orphan.pdf",
    isDeleted: false,
    filename: "orphan.pdf",
  };
  const documentFindMany = vi.fn(async (args) => {
    const s3Key = args.where?.s3Key;
    if (s3Key?.startsWith === "docs/q1/") return [doc];
    if (Array.isArray(s3Key?.in) && s3Key.in.includes(doc.s3Key)) return [doc];
    return [];
  });
  const generatedLinkDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const documentDelete = vi.fn().mockResolvedValue({ id: "doc-orphan" });
  const auditLogCreate = vi.fn().mockResolvedValue({ id: "audit-1" });

  const prisma = {
    document: { findMany: documentFindMany },
    generatedLink: { count: vi.fn() },
    $transaction: vi.fn(async (fn) =>
      fn({
        generatedLink: { deleteMany: generatedLinkDeleteMany },
        document: { delete: documentDelete },
        auditLog: { create: auditLogCreate },
      }),
    ),
  } as unknown as FolderDeletePrisma;

  return {
    prisma,
    documentFindMany,
    generatedLinkDeleteMany,
    documentDelete,
    auditLogCreate,
  };
}

describe("hardDeleteFolder", () => {
  it("removes active DB documents under the prefix even when S3 current listing only has a folder marker", async () => {
    const send = vi.fn().mockResolvedValue({ VersionId: "marker-v1" });
    mocks.getS3Client.mockReturnValue({ send });
    mocks.listObjects.mockResolvedValueOnce({
      contents: [{ Key: "docs/q1/" }],
      commonPrefixes: [],
      isTruncated: false,
      nextContinuationToken: undefined,
    });
    mocks.listObjectVersions
      .mockResolvedValueOnce({
        versions: [],
        isTruncated: false,
        nextKeyMarker: undefined,
        nextVersionIdMarker: undefined,
      })
      .mockResolvedValueOnce({
        versions: [
          {
            key: "docs/q1/",
            versionId: "marker-v1",
            isLatest: true,
            isDeleteMarker: false,
          },
        ],
        isTruncated: false,
        nextKeyMarker: undefined,
        nextVersionIdMarker: undefined,
      });

    const prisma = makePrisma();

    const result = await hardDeleteFolder(prisma.prisma, {
      bucketId: "bucket-id",
      bucketName: "helpucompli-docs-acme",
      prefix: "docs/q1/",
      userId: "user-id",
      ipAddress: "10.0.0.1",
      userAgent: "vitest",
    });

    expect(result).toEqual({ filesDeleted: 1, folderMarkersDeleted: 1 });
    expect(prisma.documentFindMany).toHaveBeenCalledWith({
      where: { bucketId: "bucket-id", s3Key: { startsWith: "docs/q1/" } },
      select: { id: true, s3Key: true, isDeleted: true, filename: true },
      take: FOLDER_DELETE_MAX_OBJECTS + 1,
    });
    expect(mocks.hardDeleteObjectVersion).not.toHaveBeenCalled();
    expect(prisma.generatedLinkDeleteMany).toHaveBeenCalledWith({
      where: { documentId: "doc-orphan" },
    });
    expect(prisma.documentDelete).toHaveBeenCalledWith({
      where: { id: "doc-orphan" },
      select: { id: true },
    });
    const [cmd] = send.mock.calls[0] as [DeleteObjectCommand];
    expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    expect(cmd.input).toEqual({
      Bucket: "helpucompli-docs-acme",
      Key: "docs/q1/",
      VersionId: "marker-v1",
    });
  });

  it("purges every S3 version for matching DB documents before deleting their rows", async () => {
    const send = vi.fn().mockResolvedValue({ VersionId: "marker-v1" });
    mocks.getS3Client.mockReturnValue({ send });
    mocks.listObjects.mockResolvedValueOnce({
      contents: [{ Key: "docs/q1/orphan.pdf" }, { Key: "docs/q1/" }],
      commonPrefixes: [],
      isTruncated: false,
      nextContinuationToken: undefined,
    });
    mocks.listObjectVersions
      .mockResolvedValueOnce({
        versions: [
          {
            key: "docs/q1/orphan.pdf",
            versionId: "doc-v1",
            isLatest: true,
            isDeleteMarker: false,
          },
          {
            key: "docs/q1/orphan.pdf",
            versionId: "doc-dm",
            isLatest: false,
            isDeleteMarker: true,
          },
        ],
        isTruncated: false,
        nextKeyMarker: undefined,
        nextVersionIdMarker: undefined,
      })
      .mockResolvedValueOnce({
        versions: [
          {
            key: "docs/q1/",
            versionId: "marker-v1",
            isLatest: true,
            isDeleteMarker: false,
          },
        ],
        isTruncated: false,
        nextKeyMarker: undefined,
        nextVersionIdMarker: undefined,
      });

    const prisma = makePrisma();

    const result = await hardDeleteFolder(prisma.prisma, {
      bucketId: "bucket-id",
      bucketName: "helpucompli-docs-acme",
      prefix: "docs/q1/",
      userId: "user-id",
      ipAddress: "10.0.0.1",
      userAgent: "vitest",
    });

    expect(result).toEqual({ filesDeleted: 1, folderMarkersDeleted: 1 });
    expect(mocks.hardDeleteObjectVersion).toHaveBeenCalledTimes(2);
    expect(mocks.hardDeleteObjectVersion).toHaveBeenNthCalledWith(1, {
      bucket: "helpucompli-docs-acme",
      key: "docs/q1/orphan.pdf",
      versionId: "doc-v1",
    });
    expect(mocks.hardDeleteObjectVersion).toHaveBeenNthCalledWith(2, {
      bucket: "helpucompli-docs-acme",
      key: "docs/q1/orphan.pdf",
      versionId: "doc-dm",
    });
    expect(prisma.auditLogCreate).toHaveBeenCalledOnce();
  });
});
