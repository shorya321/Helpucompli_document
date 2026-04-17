import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type GlobalWithS3 = typeof globalThis & {
  s3?: unknown;
};

const g = globalThis as GlobalWithS3;

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

async function importS3Module() {
  vi.resetModules();
  const mod = await import("@/lib/s3");
  return mod;
}

describe("F3.1 — S3 client singleton", () => {
  beforeEach(() => {
    delete g.s3;
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    const cached = g.s3 as { destroy?: () => void } | undefined;
    if (cached && typeof cached.destroy === "function") cached.destroy();
    delete g.s3;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("getS3Client() returns an S3Client with the configured region", async () => {
    stubAll();
    const { getS3Client } = await importS3Module();
    const client = getS3Client();
    expect(client).toBeDefined();
    expect(typeof (client as { send: unknown }).send).toBe("function");
    const region = await client.config.region();
    expect(region).toBe("us-east-1");
  });

  it("is a singleton: repeated calls return the same instance", async () => {
    stubAll();
    const { getS3Client } = await importS3Module();
    expect(getS3Client()).toBe(getS3Client());
  });

  it("caches on globalThis in non-production (HMR safety)", async () => {
    stubAll({ NODE_ENV: "development" });
    const { getS3Client } = await importS3Module();
    const client = getS3Client();
    expect(g.s3).toBe(client);
  });

  it("does NOT write globalThis in production", async () => {
    stubAll({ NODE_ENV: "production", APP_BASE_URL: "https://docs.helpucompli.com" });
    const { getS3Client } = await importS3Module();
    getS3Client();
    expect(g.s3).toBeUndefined();
  });

  it("resolves credentials from validated config (not raw process.env)", async () => {
    stubAll();
    const { getS3Client } = await importS3Module();
    const creds = await getS3Client().config.credentials();
    expect(creds.accessKeyId).toBe("AKIA_TEST");
    expect(creds.secretAccessKey).toBe("secret_value");
  });

  it("throws ConfigError at import-time consumer if env is incomplete", async () => {
    // leave env empty: config validation must fail when getS3Client is called
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH0_SECRET", "x".repeat(32));
    const { getS3Client } = await importS3Module();
    expect(() => getS3Client()).toThrow(/Invalid environment configuration/);
  });
});

describe("F3.1 — SSE-KMS defaults", () => {
  beforeEach(() => {
    delete g.s3;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    delete g.s3;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sseKmsParams() returns aws:kms + configured CMK ARN + BucketKeyEnabled", async () => {
    stubAll();
    const { sseKmsParams } = await importS3Module();
    const p = sseKmsParams();
    expect(p.ServerSideEncryption).toBe("aws:kms");
    expect(p.SSEKMSKeyId).toBe(
      "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
    );
    expect(p.BucketKeyEnabled).toBe(true);
  });

  it("sseKmsParams() throws ConfigError when AWS_KMS_KEY_ID is absent", async () => {
    vi.unstubAllEnvs();
    // populate everything EXCEPT the KMS key id
    for (const [k, v] of Object.entries(baseEnv)) {
      if (k === "AWS_KMS_KEY_ID") continue;
      vi.stubEnv(k, v as string);
    }
    const { sseKmsParams } = await importS3Module();
    expect(() => sseKmsParams()).toThrow(/AWS_KMS_KEY_ID/);
  });

  it("withSseKms() merges KMS params into any input without mutating the source", async () => {
    stubAll();
    const { withSseKms } = await importS3Module();
    const src = { Bucket: "b", Key: "k" } as const;
    const merged = withSseKms(src);
    expect(merged.Bucket).toBe("b");
    expect(merged.Key).toBe("k");
    expect(merged.ServerSideEncryption).toBe("aws:kms");
    expect(merged.SSEKMSKeyId).toContain("arn:aws:kms:");
    expect(merged.BucketKeyEnabled).toBe(true);
    // immutability: source object unchanged
    expect(src).toEqual({ Bucket: "b", Key: "k" });
  });
});
