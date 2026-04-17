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

function stubAll(overrides: Partial<typeof baseEnv> = {}) {
  for (const [k, v] of Object.entries({ ...baseEnv, ...overrides })) {
    if (v === undefined) continue;
    vi.stubEnv(k, v as string);
  }
}

async function importPresign() {
  vi.resetModules();
  return await import("@/lib/s3-presign");
}

describe("F3.3 — presignPutUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns an https URL including bucket + key path", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    const url = await presignPutUrl({
      bucket: "helpucompli-docs-acme",
      key: "2026/04/letter.pdf",
    });
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("helpucompli-docs-acme");
    expect(url).toContain("2026/04/letter.pdf");
  });

  it("pins SSE-KMS headers to X-Amz-SignedHeaders via unhoistableHeaders (upload client MUST resend)", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    const url = await presignPutUrl({
      bucket: "b",
      key: "k",
    });
    // Parse SignedHeaders query param directly — asserts that the three
    // SSE-KMS headers are in the signature, not hoisted to the query
    // string where a stolen URL could drop them.
    const signedHeadersMatch = decodeURIComponent(url)
      .toLowerCase()
      .match(/x-amz-signedheaders=([^&]+)/);
    expect(signedHeadersMatch).not.toBeNull();
    const signed = signedHeadersMatch![1].split(";");
    expect(signed).toContain("x-amz-server-side-encryption");
    expect(signed).toContain("x-amz-server-side-encryption-aws-kms-key-id");
    expect(signed).toContain("x-amz-server-side-encryption-bucket-key-enabled");
  });

  it("uses 900s (15 min) as default TTL", async () => {
    stubAll();
    const { presignPutUrl, DEFAULT_TTL_SECONDS } = await importPresign();
    expect(DEFAULT_TTL_SECONDS).toBe(900);
    const url = await presignPutUrl({ bucket: "b", key: "k" });
    expect(url).toContain("X-Amz-Expires=900");
  });

  it("honours explicit ttlSeconds within the allowed 900..604800 range", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    const url = await presignPutUrl({ bucket: "b", key: "k", ttlSeconds: 3600 });
    expect(url).toContain("X-Amz-Expires=3600");
  });

  it("rejects ttlSeconds below 900 (minimum 15 min)", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    await expect(
      presignPutUrl({ bucket: "b", key: "k", ttlSeconds: 60 }),
    ).rejects.toThrow(/ttl/i);
  });

  it("rejects ttlSeconds above 3600 on PUT (HIPAA write-bearer cap)", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    await expect(
      presignPutUrl({ bucket: "b", key: "k", ttlSeconds: 3601 }),
    ).rejects.toThrow(/ttl/i);
  });

  it("rejects NaN / Infinity / negative ttlSeconds", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    await expect(
      presignPutUrl({ bucket: "b", key: "k", ttlSeconds: Number.NaN }),
    ).rejects.toThrow(/ttl/i);
    await expect(
      presignPutUrl({ bucket: "b", key: "k", ttlSeconds: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow(/ttl/i);
    await expect(
      presignPutUrl({ bucket: "b", key: "k", ttlSeconds: -1 }),
    ).rejects.toThrow(/ttl/i);
  });

  it("rejects empty bucket and empty key", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    await expect(presignPutUrl({ bucket: "", key: "k" })).rejects.toThrow(
      /bucket/i,
    );
    await expect(presignPutUrl({ bucket: "b", key: "" })).rejects.toThrow(/key/i);
  });

  it("rejects keys with traversal segments or leading slash", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    await expect(
      presignPutUrl({ bucket: "b", key: "/leading" }),
    ).rejects.toThrow(/key/i);
    await expect(
      presignPutUrl({ bucket: "b", key: "a/../b" }),
    ).rejects.toThrow(/key/i);
    await expect(
      presignPutUrl({ bucket: "b", key: "../escape" }),
    ).rejects.toThrow(/key/i);
  });

  it("rejects malformed contentType (MIME confusion guard)", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    await expect(
      presignPutUrl({ bucket: "b", key: "k", contentType: "not-a-mime" }),
    ).rejects.toThrow(/contenttype/i);
    await expect(
      presignPutUrl({ bucket: "b", key: "k", contentType: "text/html;<script>" }),
    ).rejects.toThrow(/contenttype/i);
  });

  it("accepts optional contentType and signs it", async () => {
    stubAll();
    const { presignPutUrl } = await importPresign();
    const url = await presignPutUrl({
      bucket: "b",
      key: "k",
      contentType: "application/pdf",
    });
    const decoded = decodeURIComponent(url);
    expect(decoded.toLowerCase()).toContain("content-type");
  });
});

describe("F3.3 — presignGetUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns an https URL with the X-Amz-Signature query param", async () => {
    stubAll();
    const { presignGetUrl } = await importPresign();
    const url = await presignGetUrl({
      bucket: "helpucompli-docs-acme",
      key: "2026/04/letter.pdf",
    });
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("helpucompli-docs-acme");
  });

  it("uses 900s default TTL and honours explicit ttlSeconds", async () => {
    stubAll();
    const { presignGetUrl } = await importPresign();
    const d = await presignGetUrl({ bucket: "b", key: "k" });
    expect(d).toContain("X-Amz-Expires=900");
    const e = await presignGetUrl({ bucket: "b", key: "k", ttlSeconds: 7200 });
    expect(e).toContain("X-Amz-Expires=7200");
  });

  it("rejects out-of-range TTL", async () => {
    stubAll();
    const { presignGetUrl } = await importPresign();
    await expect(
      presignGetUrl({ bucket: "b", key: "k", ttlSeconds: 100 }),
    ).rejects.toThrow(/ttl/i);
    await expect(
      presignGetUrl({ bucket: "b", key: "k", ttlSeconds: 604801 }),
    ).rejects.toThrow(/ttl/i);
  });

  it("supports ResponseContentDisposition for download filename override", async () => {
    stubAll();
    const { presignGetUrl } = await importPresign();
    const url = await presignGetUrl({
      bucket: "b",
      key: "docs/x.pdf",
      responseContentDisposition: 'attachment; filename="Letter.pdf"',
    });
    const decoded = decodeURIComponent(url);
    expect(decoded).toMatch(/response-content-disposition/i);
    expect(decoded).toContain("Letter.pdf");
  });

  it("rejects malformed responseContentDisposition (injection guard)", async () => {
    stubAll();
    const { presignGetUrl } = await importPresign();
    await expect(
      presignGetUrl({
        bucket: "b",
        key: "k",
        responseContentDisposition: 'attachment; filename="a\\"b.pdf"',
      }),
    ).rejects.toThrow(/disposition/i);
    await expect(
      presignGetUrl({
        bucket: "b",
        key: "k",
        responseContentDisposition: "inline; filename=../evil.html",
      }),
    ).rejects.toThrow(/disposition/i);
    await expect(
      presignGetUrl({
        bucket: "b",
        key: "k",
        responseContentDisposition: "download",
      }),
    ).rejects.toThrow(/disposition/i);
  });

  it("rejects malformed responseContentType (MIME override guard)", async () => {
    stubAll();
    const { presignGetUrl } = await importPresign();
    await expect(
      presignGetUrl({
        bucket: "b",
        key: "k",
        responseContentType: "not/a/mime/type",
      }),
    ).rejects.toThrow(/responsecontenttype/i);
    await expect(
      presignGetUrl({
        bucket: "b",
        key: "k",
        responseContentType: "text/<script>",
      }),
    ).rejects.toThrow(/responsecontenttype/i);
  });
});

describe("F3.3 — TTL constants exported", () => {
  it("exports MIN_TTL_SECONDS=900, MAX_PUT_TTL_SECONDS=3600, MAX_GET_TTL_SECONDS=604800", async () => {
    stubAll();
    const {
      MIN_TTL_SECONDS,
      MAX_PUT_TTL_SECONDS,
      MAX_GET_TTL_SECONDS,
      MAX_TTL_SECONDS,
      DEFAULT_TTL_SECONDS,
    } = await importPresign();
    expect(MIN_TTL_SECONDS).toBe(900);
    expect(MAX_PUT_TTL_SECONDS).toBe(3600);
    expect(MAX_GET_TTL_SECONDS).toBe(604800);
    expect(MAX_TTL_SECONDS).toBe(604800); // alias
    expect(DEFAULT_TTL_SECONDS).toBe(900);
  });
});
