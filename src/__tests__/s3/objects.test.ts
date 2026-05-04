import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const baseEnv = {
  AUTH0_SECRET: "x".repeat(32),
  APP_BASE_URL: "http://localhost:3000",
  AUTH0_DOMAIN: "tenant.auth0.com",
  AUTH0_CLIENT_ID: "client_id",
  AUTH0_CLIENT_SECRET: "client_secret",
  AUTH0_MGMT_CLIENT_ID: "mgmt_id",
  AUTH0_MGMT_CLIENT_SECRET: "mgmt_secret",
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "AKIA_TEST",
  AWS_SECRET_ACCESS_KEY: "secret_value",
  AWS_KMS_KEY_ID: "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
  AWS_S3_LOGS_BUCKET: "helpucompli-docs-access-logs",
  DATABASE_URL: "postgresql://u:p@host:5432/db",
  NODE_ENV: "test",
};

function stubAll() {
  for (const [k, v] of Object.entries(baseEnv)) vi.stubEnv(k, v);
}

type SendSpy = ReturnType<typeof vi.fn>;

async function importObjects(send: SendSpy = vi.fn().mockResolvedValue({})) {
  vi.resetModules();
  vi.doMock("@/lib/s3", async () => {
    const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");
    return {
      ...actual,
      getS3Client: () =>
        ({ send } as unknown as ReturnType<typeof actual.getS3Client>),
    };
  });
  const mod = await import("@/lib/s3-objects");
  return { ...mod, send };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function commandCalls(send: SendSpy, CommandClass: new (...args: any[]) => object) {
  return send.mock.calls
    .map((args: unknown[]) => args[0] as object)
    .filter((cmd) => cmd instanceof CommandClass) as Array<{
    input: Record<string, unknown>;
  }>;
}

describe("F3.4 — listObjects", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("sends ListObjectsV2 with bucket + prefix + continuation + default delimiter /", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({
      Contents: [
        { Key: "a/1.pdf", Size: 100, LastModified: new Date("2026-01-01"), ETag: '"e1"' },
      ],
      NextContinuationToken: "token-2",
      IsTruncated: true,
      CommonPrefixes: [{ Prefix: "a/sub/" }],
    });
    const { listObjects } = await importObjects(send);
    const result = await listObjects({
      bucket: "b",
      prefix: "a/",
      continuationToken: "token-1",
      maxKeys: 500,
    });
    const [call] = commandCalls(send, ListObjectsV2Command);
    expect(call.input.Bucket).toBe("b");
    expect(call.input.Prefix).toBe("a/");
    expect(call.input.ContinuationToken).toBe("token-1");
    expect(call.input.MaxKeys).toBe(500);
    expect(call.input.Delimiter).toBe("/");
    expect(result.contents[0]).toEqual({
      Key: "a/1.pdf",
      Size: 100,
      LastModified: new Date("2026-01-01"),
      ETag: '"e1"',
    });
    expect(result.commonPrefixes).toEqual(["a/sub/"]);
    expect(result.nextContinuationToken).toBe("token-2");
    expect(result.isTruncated).toBe(true);
  });

  it("allows empty delimiter for flat recursive listings", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({});
    const { listObjects } = await importObjects(send);
    await listObjects({ bucket: "b", delimiter: "" });
    const [call] = commandCalls(send, ListObjectsV2Command);
    expect(call.input.Delimiter).toBe("");
  });

  it("rejects invalid bucket / invalid prefix containing '..'", async () => {
    stubAll();
    const { listObjects } = await importObjects();
    await expect(listObjects({ bucket: "" })).rejects.toThrow(/bucket/i);
    await expect(
      listObjects({ bucket: "b", prefix: "../escape" }),
    ).rejects.toThrow(/prefix/i);
  });

  it("clamps maxKeys to [1, 1000]", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({});
    const { listObjects } = await importObjects(send);
    await listObjects({ bucket: "b", maxKeys: 9999 });
    expect(
      (commandCalls(send, ListObjectsV2Command)[0].input as { MaxKeys: number }).MaxKeys,
    ).toBe(1000);
    await listObjects({ bucket: "b", maxKeys: 0 });
    expect(
      (commandCalls(send, ListObjectsV2Command)[1].input as { MaxKeys: number }).MaxKeys,
    ).toBe(1);
  });
});

describe("F3.4 — listObjectVersions", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("merges Versions + DeleteMarkers into a single versions array", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({
      Versions: [
        { Key: "k", VersionId: "v2", IsLatest: true, Size: 100, LastModified: new Date("2026-04-01") },
        { Key: "k", VersionId: "v1", IsLatest: false, Size: 80, LastModified: new Date("2026-03-01") },
      ],
      DeleteMarkers: [
        { Key: "k", VersionId: "dm1", IsLatest: false, LastModified: new Date("2026-03-15") },
      ],
      NextKeyMarker: "nm",
      NextVersionIdMarker: "nvm",
      IsTruncated: true,
    });
    const { listObjectVersions } = await importObjects(send);
    const result = await listObjectVersions({ bucket: "b", prefix: "k" });
    const [call] = commandCalls(send, ListObjectVersionsCommand);
    expect(call.input.Bucket).toBe("b");
    expect(call.input.Prefix).toBe("k");
    expect(result.versions).toHaveLength(3);
    expect(result.versions.find((v: { isDeleteMarker: boolean }) => v.isDeleteMarker)).toBeDefined();
    expect(
      result.versions.find((v: { versionId?: string }) => v.versionId === "v2")?.isLatest,
    ).toBe(true);
    expect(result.nextKeyMarker).toBe("nm");
    expect(result.isTruncated).toBe(true);
  });
});

describe("F3.4 — headObject", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("returns normalized metadata with allowlist-filtered userMetadata", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({
      ContentLength: 4096,
      ContentType: "application/pdf",
      ETag: '"abc123"',
      LastModified: new Date("2026-03-01"),
      VersionId: "v1",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: baseEnv.AWS_KMS_KEY_ID,
      // Mix of allowed + disallowed keys — disallowed MUST be dropped
      Metadata: {
        uploader: "alice",
        filename: "letter.pdf",
        "tenant-id": "acme",
        "content-type": "application/pdf",
        "phi-ssn": "123-45-6789", // disallowed — must be filtered
        "unauthorized-key": "value", // disallowed — must be filtered
      },
    });
    const { headObject } = await importObjects(send);
    const meta = await headObject({ bucket: "b", key: "k.pdf" });
    expect(meta.userMetadata).toEqual({
      uploader: "alice",
      filename: "letter.pdf",
      "tenant-id": "acme",
      "content-type": "application/pdf",
    });
    expect(meta.userMetadata?.["phi-ssn"]).toBeUndefined();
    expect(meta.userMetadata?.["unauthorized-key"]).toBeUndefined();
    expect(meta.contentLength).toBe(4096);
    expect(meta.sseKmsKeyId).toBe(baseEnv.AWS_KMS_KEY_ID);
  });

  it("rejects empty bucket/key and keys with traversal or empty segments", async () => {
    stubAll();
    const { headObject } = await importObjects();
    await expect(headObject({ bucket: "", key: "k" })).rejects.toThrow(/bucket/i);
    await expect(headObject({ bucket: "b", key: "" })).rejects.toThrow(/key/i);
    await expect(headObject({ bucket: "b", key: "../x" })).rejects.toThrow(/key/i);
    await expect(headObject({ bucket: "b", key: "/leading" })).rejects.toThrow(/key/i);
    await expect(headObject({ bucket: "b", key: "a//b" })).rejects.toThrow(/key/i);
  });
});

describe("F3.4 — copyObject", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("sends CopyObject with URL-encoded CopySource and SSE-KMS on destination", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({});
    const { copyObject } = await importObjects(send);
    await copyObject({
      srcBucket: "a",
      srcKey: "2026/04/letter with space.pdf",
      destBucket: "b",
      destKey: "archive/letter.pdf",
    });
    const [call] = commandCalls(send, CopyObjectCommand);
    expect(call.input.CopySource).toBe("a/2026/04/letter%20with%20space.pdf");
    expect(call.input.Bucket).toBe("b");
    expect(call.input.Key).toBe("archive/letter.pdf");
    expect(call.input.ServerSideEncryption).toBe("aws:kms");
    expect(call.input.SSEKMSKeyId).toBe(baseEnv.AWS_KMS_KEY_ID);
    expect(call.input.BucketKeyEnabled).toBe(true);
    expect(call.input.MetadataDirective).toBe("COPY");
  });

  it("rejects invalid targets (empty bucket/key, traversal, empty segments)", async () => {
    stubAll();
    const { copyObject } = await importObjects();
    await expect(
      copyObject({ srcBucket: "", srcKey: "k", destBucket: "b", destKey: "k" }),
    ).rejects.toThrow(/bucket/i);
    await expect(
      copyObject({ srcBucket: "a", srcKey: "../x", destBucket: "b", destKey: "y" }),
    ).rejects.toThrow(/key/i);
    await expect(
      copyObject({ srcBucket: "a", srcKey: "folder/", destBucket: "b", destKey: "y" }),
    ).rejects.toThrow(/key/i);
  });
});

describe("F3.4 — moveObject", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("copies then deletes the source (in that order)", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({});
    const { moveObject } = await importObjects(send);
    await moveObject({
      srcBucket: "a",
      srcKey: "x.pdf",
      destBucket: "b",
      destKey: "y.pdf",
    });
    const sent = send.mock.calls.map(
      (args: unknown[]) =>
        (args[0] as { constructor: { name: string } }).constructor.name,
    );
    expect(sent).toEqual(["CopyObjectCommand", "DeleteObjectCommand"]);
  });

  it("does NOT delete the source when CopyObject fails", async () => {
    stubAll();
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof CopyObjectCommand) {
        return Promise.reject(new Error("AccessDenied"));
      }
      return Promise.resolve({});
    });
    const { moveObject } = await importObjects(send);
    await expect(
      moveObject({
        srcBucket: "a",
        srcKey: "x",
        destBucket: "b",
        destKey: "y",
      }),
    ).rejects.toThrow(/AccessDenied/);
    expect(commandCalls(send, DeleteObjectCommand)).toHaveLength(0);
  });
});

describe("F3.4 — softDeleteObject / hardDeleteObjectVersion", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("softDeleteObject sends DeleteObject WITHOUT VersionId (delete marker only)", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({ DeleteMarker: true, VersionId: "v2" });
    const { softDeleteObject } = await importObjects(send);
    const res = await softDeleteObject({ bucket: "b", key: "k.pdf" });
    const [call] = commandCalls(send, DeleteObjectCommand);
    expect(call.input.Bucket).toBe("b");
    expect(call.input.Key).toBe("k.pdf");
    expect(call.input.VersionId).toBeUndefined();
    expect(res.deleteMarker).toBe(true);
    expect(res.versionId).toBe("v2");
  });

  it("hardDeleteObjectVersion sends DeleteObject WITH explicit VersionId", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({});
    const { hardDeleteObjectVersion } = await importObjects(send);
    await hardDeleteObjectVersion({ bucket: "b", key: "k", versionId: "v1" });
    const [call] = commandCalls(send, DeleteObjectCommand);
    expect(call.input.VersionId).toBe("v1");
  });

  it("hardDeleteObjectVersion rejects empty versionId", async () => {
    stubAll();
    const { hardDeleteObjectVersion } = await importObjects();
    await expect(
      hardDeleteObjectVersion({ bucket: "b", key: "k", versionId: "" }),
    ).rejects.toThrow(/versionId/);
  });
});

describe("F6.7 — restoreObject", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("removes the latest delete-marker for the key and returns its versionId", async () => {
    stubAll();
    const send = vi.fn(async (cmd: object) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        return {
          Versions: [
            { Key: "k.pdf", VersionId: "v1", IsLatest: false, Size: 100, LastModified: new Date("2026-04-01") },
          ],
          DeleteMarkers: [
            { Key: "k.pdf", VersionId: "dm-latest", IsLatest: true, LastModified: new Date("2026-04-15") },
          ],
          IsTruncated: false,
        };
      }
      if (cmd instanceof DeleteObjectCommand) {
        return { DeleteMarker: false, VersionId: "dm-latest" };
      }
      return {};
    });
    const { restoreObject } = await importObjects(send);
    const res = await restoreObject({ bucket: "b", key: "k.pdf" });
    expect(res.restoredFromVersionId).toBe("dm-latest");
    const deletes = commandCalls(send, DeleteObjectCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.input.Bucket).toBe("b");
    expect(deletes[0]!.input.Key).toBe("k.pdf");
    expect(deletes[0]!.input.VersionId).toBe("dm-latest");
  });

  it("ignores delete markers belonging to sibling keys with the same prefix", async () => {
    stubAll();
    const send = vi.fn(async (cmd: object) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        return {
          Versions: [],
          DeleteMarkers: [
            { Key: "k.pdf.bak", VersionId: "dm-sibling", IsLatest: true, LastModified: new Date("2026-04-15") },
            { Key: "k.pdf", VersionId: "dm-self", IsLatest: true, LastModified: new Date("2026-04-15") },
          ],
          IsTruncated: false,
        };
      }
      return { DeleteMarker: false, VersionId: "dm-self" };
    });
    const { restoreObject } = await importObjects(send);
    const res = await restoreObject({ bucket: "b", key: "k.pdf" });
    expect(res.restoredFromVersionId).toBe("dm-self");
    const deletes = commandCalls(send, DeleteObjectCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.input.VersionId).toBe("dm-self");
  });

  it("throws NotDeletedError when no latest delete-marker exists", async () => {
    stubAll();
    const send = vi.fn(async (cmd: object) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        return {
          Versions: [
            { Key: "k.pdf", VersionId: "v1", IsLatest: true, Size: 100, LastModified: new Date("2026-04-01") },
          ],
          DeleteMarkers: [],
          IsTruncated: false,
        };
      }
      return {};
    });
    const { restoreObject, NotDeletedError } = await importObjects(send);
    await expect(restoreObject({ bucket: "b", key: "k.pdf" })).rejects.toBeInstanceOf(
      NotDeletedError,
    );
    expect(commandCalls(send, DeleteObjectCommand)).toHaveLength(0);
  });

  it("throws NotDeletedError when delete marker is not the latest version", async () => {
    stubAll();
    const send = vi.fn(async (cmd: object) => {
      if (cmd instanceof ListObjectVersionsCommand) {
        return {
          Versions: [
            { Key: "k.pdf", VersionId: "v2", IsLatest: true, Size: 100, LastModified: new Date("2026-04-20") },
          ],
          DeleteMarkers: [
            { Key: "k.pdf", VersionId: "dm-old", IsLatest: false, LastModified: new Date("2026-04-15") },
          ],
          IsTruncated: false,
        };
      }
      return {};
    });
    const { restoreObject, NotDeletedError } = await importObjects(send);
    await expect(restoreObject({ bucket: "b", key: "k.pdf" })).rejects.toBeInstanceOf(
      NotDeletedError,
    );
    expect(commandCalls(send, DeleteObjectCommand)).toHaveLength(0);
  });

  it("rejects empty bucket / key / traversal segments", async () => {
    stubAll();
    const { restoreObject } = await importObjects();
    await expect(restoreObject({ bucket: "", key: "k" })).rejects.toThrow();
    await expect(restoreObject({ bucket: "b", key: "" })).rejects.toThrow();
    await expect(restoreObject({ bucket: "b", key: "../etc" })).rejects.toThrow();
  });
});

describe("F3.4 — deleteObjects (bulk)", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("sends DeleteObjects with up to 1000 keys per request", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({ Deleted: [], Errors: [] });
    const { deleteObjects } = await importObjects(send);
    await deleteObjects({ bucket: "b", keys: ["k1", "k2", "k3"] });
    const [call] = commandCalls(send, DeleteObjectsCommand);
    expect(call.input.Bucket).toBe("b");
    expect(
      (call.input.Delete as { Objects: Array<{ Key: string }> }).Objects,
    ).toEqual([{ Key: "k1" }, { Key: "k2" }, { Key: "k3" }]);
  });

  it("batches + parallelizes input when >1000 keys (single S3 request cap)", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({ Deleted: [], Errors: [] });
    const { deleteObjects } = await importObjects(send);
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`);
    await deleteObjects({ bucket: "b", keys });
    const calls = commandCalls(send, DeleteObjectsCommand);
    expect(calls).toHaveLength(3);
    const lengths = calls.map(
      (c) => (c.input.Delete as { Objects: unknown[] }).Objects.length,
    );
    expect(lengths.sort((a, b) => a - b)).toEqual([500, 1000, 1000]);
  });

  it("aggregates Deleted + Errors across parallel batches", async () => {
    stubAll();
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Deleted: [{ Key: "k1" }],
        Errors: [{ Key: "k2", Code: "AccessDenied", Message: "nope" }],
      })
      .mockResolvedValueOnce({
        Deleted: [{ Key: "k3" }],
        Errors: [],
      });
    const { deleteObjects } = await importObjects(send);
    const keys = Array.from({ length: 1500 }, (_, i) => `key-${i}`);
    const res = await deleteObjects({ bucket: "b", keys });
    expect(res.deleted.map((d: { key: string }) => d.key).sort()).toEqual(["k1", "k3"]);
    expect(res.errors).toEqual([
      { key: "k2", code: "AccessDenied", message: "nope" },
    ]);
  });

  it("rejects empty keys array", async () => {
    stubAll();
    const { deleteObjects } = await importObjects();
    await expect(deleteObjects({ bucket: "b", keys: [] })).rejects.toThrow(/keys/i);
  });

  it("rejects traversal segments in any key", async () => {
    stubAll();
    const { deleteObjects } = await importObjects();
    await expect(
      deleteObjects({ bucket: "b", keys: ["a", "../escape"] }),
    ).rejects.toThrow(/key/i);
  });
});
