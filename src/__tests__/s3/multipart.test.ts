import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
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

async function importMultipart(send: SendSpy = vi.fn().mockResolvedValue({})) {
  vi.resetModules();
  vi.doMock("@/lib/s3", async () => {
    const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");
    return {
      ...actual,
      getS3Client: () =>
        ({ send } as unknown as ReturnType<typeof actual.getS3Client>),
    };
  });
  const mod = await import("@/lib/s3-multipart");
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

describe("F3.5 — constants", () => {
  it("exports the multipart threshold (100 MB) and max file size (5 GB)", async () => {
    stubAll();
    const { MULTIPART_THRESHOLD_BYTES, MAX_FILE_SIZE_BYTES, MIN_PART_SIZE_BYTES } =
      await importMultipart();
    expect(MULTIPART_THRESHOLD_BYTES).toBe(100 * 1024 * 1024);
    expect(MAX_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024 * 1024);
    expect(MIN_PART_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("F3.5 — initiateMultipartUpload", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("sends CreateMultipartUpload with SSE-KMS baked in and returns uploadId", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({ UploadId: "upload-123" });
    const { initiateMultipartUpload } = await importMultipart(send);
    const res = await initiateMultipartUpload({
      bucket: "b",
      key: "big.pdf",
      contentType: "application/pdf",
    });
    expect(res.uploadId).toBe("upload-123");
    const [call] = commandCalls(send, CreateMultipartUploadCommand);
    expect(call.input.Bucket).toBe("b");
    expect(call.input.Key).toBe("big.pdf");
    expect(call.input.ContentType).toBe("application/pdf");
    expect(call.input.ServerSideEncryption).toBe("aws:kms");
    expect(call.input.SSEKMSKeyId).toBe(baseEnv.AWS_KMS_KEY_ID);
    expect(call.input.BucketKeyEnabled).toBe(true);
  });

  it("rejects empty bucket/key + keys with traversal or empty segments", async () => {
    stubAll();
    const { initiateMultipartUpload } = await importMultipart();
    await expect(initiateMultipartUpload({ bucket: "", key: "k" })).rejects.toThrow(
      /bucket/i,
    );
    await expect(
      initiateMultipartUpload({ bucket: "b", key: "../x" }),
    ).rejects.toThrow(/key/i);
    await expect(
      initiateMultipartUpload({ bucket: "b", key: "a//b" }),
    ).rejects.toThrow(/key/i);
  });

  it("rejects malformed contentType", async () => {
    stubAll();
    const { initiateMultipartUpload } = await importMultipart();
    await expect(
      initiateMultipartUpload({ bucket: "b", key: "k", contentType: "bad<mime>" }),
    ).rejects.toThrow(/contenttype/i);
  });

  it("throws when S3 response is missing UploadId", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({}); // no UploadId
    const { initiateMultipartUpload } = await importMultipart(send);
    await expect(
      initiateMultipartUpload({ bucket: "b", key: "k" }),
    ).rejects.toThrow(/uploadid/i);
  });

  it("rejects declaredSizeBytes > 5 GB at init time (server-side HIPAA cap gate)", async () => {
    stubAll();
    const { initiateMultipartUpload, MAX_FILE_SIZE_BYTES } = await importMultipart();
    await expect(
      initiateMultipartUpload({
        bucket: "b",
        key: "k",
        declaredSizeBytes: MAX_FILE_SIZE_BYTES + 1,
      }),
    ).rejects.toThrow(/size/i);
  });

  it("initiates without contentType (optional field omitted path)", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({ UploadId: "u" });
    const { initiateMultipartUpload } = await importMultipart(send);
    await initiateMultipartUpload({ bucket: "b", key: "k" });
    const [call] = commandCalls(send, CreateMultipartUploadCommand);
    expect(call.input.ContentType).toBeUndefined();
    expect(call.input.ServerSideEncryption).toBe("aws:kms");
  });

  it("rejects keys that start with '/' (aligned with presign/objects siblings)", async () => {
    stubAll();
    const { initiateMultipartUpload } = await importMultipart();
    await expect(
      initiateMultipartUpload({ bucket: "b", key: "/etc/passwd" }),
    ).rejects.toThrow(/key/i);
  });
});

// presignUploadPart tests use the REAL S3 client (not the mock) because
// getSignedUrl reaches into client.config.endpointProvider.
async function importMultipartRealClient() {
  vi.resetModules();
  return await import("@/lib/s3-multipart");
}

describe("F3.5 — presignUploadPart", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns an https URL for the given partNumber", async () => {
    stubAll();
    const { presignUploadPart } = await importMultipartRealClient();
    const url = await presignUploadPart({
      bucket: "b",
      key: "big.pdf",
      uploadId: "upload-123",
      partNumber: 1,
    });
    expect(url).toMatch(/^https:\/\//);
    const lower = url.toLowerCase();
    expect(lower).toContain("partnumber=1");
    expect(lower).toContain("uploadid=upload-123");
  });

  it("rejects partNumber outside [1, 10000]", async () => {
    stubAll();
    const { presignUploadPart } = await importMultipartRealClient();
    await expect(
      presignUploadPart({ bucket: "b", key: "k", uploadId: "u", partNumber: 0 }),
    ).rejects.toThrow(/part/i);
    await expect(
      presignUploadPart({ bucket: "b", key: "k", uploadId: "u", partNumber: 10001 }),
    ).rejects.toThrow(/part/i);
    await expect(
      presignUploadPart({
        bucket: "b",
        key: "k",
        uploadId: "u",
        partNumber: Number.NaN,
      }),
    ).rejects.toThrow(/part/i);
  });

  it("rejects empty uploadId", async () => {
    stubAll();
    const { presignUploadPart } = await importMultipartRealClient();
    await expect(
      presignUploadPart({ bucket: "b", key: "k", uploadId: "", partNumber: 1 }),
    ).rejects.toThrow(/uploadid/i);
  });

  it("rejects ttl above the PUT max (1 hour)", async () => {
    stubAll();
    const { presignUploadPart } = await importMultipartRealClient();
    await expect(
      presignUploadPart({
        bucket: "b",
        key: "k",
        uploadId: "u",
        partNumber: 1,
        ttlSeconds: 3601,
      }),
    ).rejects.toThrow(/ttl/i);
  });
});

describe("F3.5 — completeMultipartUpload", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("sends CompleteMultipartUpload with sorted parts and returns location/etag/versionId", async () => {
    stubAll();
    const validEtag = (hex: string) => `"${hex.padEnd(32, "0").slice(0, 32)}"`;
    const send = vi
      .fn()
      .mockResolvedValue({
        Location: "https://s3/...",
        ETag: validEtag("abc"),
        VersionId: "v1",
      });
    const { completeMultipartUpload } = await importMultipart(send);
    const result = await completeMultipartUpload({
      bucket: "b",
      key: "k",
      uploadId: "u",
      parts: [
        { PartNumber: 2, ETag: validEtag("22") },
        { PartNumber: 1, ETag: validEtag("11") },
        { PartNumber: 3, ETag: validEtag("33") },
      ],
    });
    const [call] = commandCalls(send, CompleteMultipartUploadCommand);
    expect(call.input.UploadId).toBe("u");
    const parts = (call.input.MultipartUpload as {
      Parts: Array<{ PartNumber: number; ETag: string }>;
    }).Parts;
    expect(parts.map((p: { PartNumber: number }) => p.PartNumber)).toEqual([1, 2, 3]);
    expect(result.etag).toBe(validEtag("abc"));
    expect(result.location).toBe("https://s3/...");
    expect(result.versionId).toBe("v1");
  });

  it("rejects empty parts array", async () => {
    stubAll();
    const { completeMultipartUpload } = await importMultipart();
    await expect(
      completeMultipartUpload({ bucket: "b", key: "k", uploadId: "u", parts: [] }),
    ).rejects.toThrow(/parts/i);
  });

  it("rejects duplicate PartNumber entries", async () => {
    stubAll();
    const validEtag = '"' + "a".repeat(32) + '"';
    const { completeMultipartUpload } = await importMultipart();
    await expect(
      completeMultipartUpload({
        bucket: "b",
        key: "k",
        uploadId: "u",
        parts: [
          { PartNumber: 1, ETag: validEtag },
          { PartNumber: 1, ETag: validEtag },
        ],
      }),
    ).rejects.toThrow(/duplicate/i);
  });

  it("rejects malformed ETag strings (not quoted 32-hex)", async () => {
    stubAll();
    const { completeMultipartUpload } = await importMultipart();
    await expect(
      completeMultipartUpload({
        bucket: "b",
        key: "k",
        uploadId: "u",
        parts: [{ PartNumber: 1, ETag: "not-an-etag" }],
      }),
    ).rejects.toThrow(/etag/i);
  });

  it("rejects non-contiguous PartNumber sequences (gap before N)", async () => {
    stubAll();
    const validEtag = '"' + "a".repeat(32) + '"';
    const { completeMultipartUpload } = await importMultipart();
    await expect(
      completeMultipartUpload({
        bucket: "b",
        key: "k",
        uploadId: "u",
        parts: [
          { PartNumber: 1, ETag: validEtag },
          { PartNumber: 2, ETag: validEtag },
          { PartNumber: 5, ETag: validEtag }, // gap: 3, 4 missing
        ],
      }),
    ).rejects.toThrow(/contiguous|sequence/i);
  });
});

describe("F3.5 — abortMultipartUpload", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.resetModules();
  });

  it("sends AbortMultipartUpload with the uploadId", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({});
    const { abortMultipartUpload } = await importMultipart(send);
    await abortMultipartUpload({ bucket: "b", key: "k", uploadId: "upload-abc" });
    const [call] = commandCalls(send, AbortMultipartUploadCommand);
    expect(call.input).toEqual({
      Bucket: "b",
      Key: "k",
      UploadId: "upload-abc",
    });
  });

  it("rejects empty uploadId", async () => {
    stubAll();
    const { abortMultipartUpload } = await importMultipart();
    await expect(
      abortMultipartUpload({ bucket: "b", key: "k", uploadId: "" }),
    ).rejects.toThrow(/uploadid/i);
  });
});

describe("F3.5 — size helpers", () => {
  it("shouldUseMultipart() returns true for sizes > 100 MB", async () => {
    stubAll();
    const { shouldUseMultipart, MULTIPART_THRESHOLD_BYTES } = await importMultipart();
    expect(shouldUseMultipart(MULTIPART_THRESHOLD_BYTES)).toBe(false);
    expect(shouldUseMultipart(MULTIPART_THRESHOLD_BYTES + 1)).toBe(true);
    expect(shouldUseMultipart(50 * 1024 * 1024)).toBe(false);
  });

  it("assertFileSize() rejects >5 GB and non-positive sizes", async () => {
    stubAll();
    const { assertFileSize, MAX_FILE_SIZE_BYTES } = await importMultipart();
    expect(() => assertFileSize(1)).not.toThrow();
    expect(() => assertFileSize(MAX_FILE_SIZE_BYTES)).not.toThrow();
    expect(() => assertFileSize(MAX_FILE_SIZE_BYTES + 1)).toThrow(/size/i);
    expect(() => assertFileSize(0)).toThrow(/size/i);
    expect(() => assertFileSize(-1)).toThrow(/size/i);
    expect(() => assertFileSize(Number.NaN)).toThrow(/size/i);
  });

  it("planMultipartParts() splits exact-multiple size into equal parts", async () => {
    stubAll();
    const { planMultipartParts } = await importMultipart();
    const plan = planMultipartParts(250 * 1024 * 1024); // 250 MB (exact multiple of 10 MB)
    expect(plan.partCount).toBe(25);
    const total = plan.parts.reduce(
      (acc: number, p: { size: number }) => acc + p.size,
      0,
    );
    expect(total).toBe(250 * 1024 * 1024);
    // All 25 parts at exactly 10 MB, no remainder part.
    for (const p of plan.parts) {
      expect(p.size).toBe(10 * 1024 * 1024);
    }
  });

  it("planMultipartParts() handles non-multiple size with a smaller final remainder", async () => {
    stubAll();
    const { planMultipartParts } = await importMultipart();
    const size = 255 * 1024 * 1024 + 123; // 255 MB + 123 B
    const plan = planMultipartParts(size);
    expect(plan.partCount).toBe(26); // 25 * 10 MB + 1 remainder
    const total = plan.parts.reduce(
      (acc: number, p: { size: number }) => acc + p.size,
      0,
    );
    expect(total).toBe(size);
    const last = plan.parts[plan.parts.length - 1];
    expect(last.size).toBeLessThan(10 * 1024 * 1024);
    // every part except the last MUST be >= 5 MB (S3 requirement)
    for (const p of plan.parts.slice(0, -1)) {
      expect(p.size).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    }
  });
});
