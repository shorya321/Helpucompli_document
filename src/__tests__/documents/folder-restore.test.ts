import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listObjectVersions: vi.fn(),
  restoreObject: vi.fn(),
  getS3Client: vi.fn(),
}));

vi.mock("@/lib/s3-objects", async () => {
  const actual = await vi.importActual<typeof import("@/lib/s3-objects")>(
    "@/lib/s3-objects",
  );
  return {
    ...actual,
    listObjectVersions: mocks.listObjectVersions,
    restoreObject: mocks.restoreObject,
  };
});

vi.mock("@/lib/s3", () => ({
  getS3Client: mocks.getS3Client,
}));

import {
  listDeletedFolderMarkers,
  restoreFolder,
  restoreFolderMarker,
} from "@/lib/folder-restore";

afterEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("folder restore helpers", () => {
  it("lists only latest folder-marker delete markers and collapses nested markers", async () => {
    mocks.listObjectVersions.mockResolvedValueOnce({
      versions: [
        {
          key: "docs/live/",
          versionId: "v-live",
          isLatest: true,
          isDeleteMarker: false,
          lastModified: new Date("2026-05-01"),
        },
      ],
      isTruncated: true,
      nextKeyMarker: "docs/live/",
      nextVersionIdMarker: "v-live",
    });
    mocks.listObjectVersions.mockResolvedValueOnce({
      versions: [
        {
          key: "docs/",
          versionId: "dm-docs",
          isLatest: true,
          isDeleteMarker: true,
          lastModified: new Date("2026-05-02"),
        },
        {
          key: "docs/q1/",
          versionId: "dm-q1",
          isLatest: true,
          isDeleteMarker: true,
          lastModified: new Date("2026-05-03"),
        },
        {
          key: "docs/readme.pdf",
          versionId: "dm-file",
          isLatest: true,
          isDeleteMarker: true,
          lastModified: new Date("2026-05-04"),
        },
        {
          key: "archive/",
          versionId: "dm-archive-old",
          isLatest: false,
          isDeleteMarker: true,
          lastModified: new Date("2026-05-05"),
        },
      ],
      isTruncated: false,
      nextKeyMarker: undefined,
      nextVersionIdMarker: undefined,
    });

    const folders = await listDeletedFolderMarkers({
      bucket: "helpucompli-docs-acme",
    });

    expect(folders).toEqual([
      {
        key: "docs/",
        versionId: "dm-docs",
        deletedAt: new Date("2026-05-02"),
      },
    ]);
  });

  it("restores a folder marker by deleting its latest delete-marker version", async () => {
    const send = vi.fn().mockResolvedValue({ VersionId: "dm-folder" });
    mocks.getS3Client.mockReturnValue({ send });

    const result = await restoreFolderMarker({
      bucket: "helpucompli-docs-acme",
      key: "docs/",
      versionId: "dm-folder",
    });

    expect(result.restoredFromVersionId).toBe("dm-folder");
    const [cmd] = send.mock.calls[0] as [DeleteObjectCommand];
    expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    expect(cmd.input).toEqual({
      Bucket: "helpucompli-docs-acme",
      Key: "docs/",
      VersionId: "dm-folder",
    });
  });

  it("allows Unicode folder marker keys created by the folder API", async () => {
    const send = vi.fn().mockResolvedValue({ VersionId: "dm-folder" });
    mocks.getS3Client.mockReturnValue({ send });

    await restoreFolderMarker({
      bucket: "helpucompli-docs-acme",
      key: "études/",
      versionId: "dm-folder",
    });

    const [cmd] = send.mock.calls[0] as [DeleteObjectCommand];
    expect(cmd.input.Key).toBe("études/");
  });

  it("restores folder marker and every deleted document under the prefix", async () => {
    const send = vi.fn().mockResolvedValue({ VersionId: "dm-folder" });
    mocks.getS3Client.mockReturnValue({ send });
    mocks.listObjectVersions.mockResolvedValueOnce({
      versions: [
        {
          key: "docs/",
          versionId: "dm-folder",
          isLatest: true,
          isDeleteMarker: true,
          lastModified: new Date("2026-05-02"),
        },
        {
          key: "docs/q1/",
          versionId: "dm-q1",
          isLatest: true,
          isDeleteMarker: true,
          lastModified: new Date("2026-05-03"),
        },
      ],
      isTruncated: false,
      nextKeyMarker: undefined,
      nextVersionIdMarker: undefined,
    });
    mocks.restoreObject.mockResolvedValueOnce({ restoredFromVersionId: "dm-a" });

    const documentFindMany = vi.fn().mockResolvedValue([
      {
        id: "doc-a",
        s3Key: "docs/a.pdf",
        filename: "a.pdf",
        isDeleted: true,
      },
    ]);
    const documentUpdate = vi.fn().mockResolvedValue({ id: "doc-a" });
    const auditLogCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      document: { findMany: documentFindMany },
      $transaction: vi.fn(async (fn) =>
        fn({
          document: { update: documentUpdate },
          auditLog: { create: auditLogCreate },
        }),
      ),
    };

    const result = await restoreFolder(prisma, {
      bucketId: "bucket-id",
      bucketName: "helpucompli-docs-acme",
      prefix: "docs/",
      userId: "user-id",
      ipAddress: "10.0.0.1",
      userAgent: "vitest",
    });

    expect(result).toEqual({ filesRestored: 1, folderMarkersRestored: 2 });
    expect(mocks.restoreObject).toHaveBeenCalledWith({
      bucket: "helpucompli-docs-acme",
      key: "docs/a.pdf",
    });
    expect(documentUpdate).toHaveBeenCalledWith({
      where: { id: "doc-a" },
      data: { isDeleted: false, deletedAt: null, deletedById: null },
      select: { id: true },
    });
    expect(auditLogCreate).toHaveBeenCalledTimes(2);
  });
});
