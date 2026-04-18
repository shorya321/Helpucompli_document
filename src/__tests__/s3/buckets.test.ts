import {
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutBucketEncryptionCommand,
  PutBucketLoggingCommand,
  PutBucketOwnershipControlsCommand,
  PutBucketPolicyCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import { PutEventSelectorsCommand } from "@aws-sdk/client-cloudtrail";
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

function stubAll(
  overrides: Partial<typeof baseEnv & { AWS_CLOUDTRAIL_NAME: string }> = {},
) {
  for (const [k, v] of Object.entries({ ...baseEnv, ...overrides })) {
    if (v === undefined) continue;
    vi.stubEnv(k, v as string);
  }
}

type SendSpy = ReturnType<typeof vi.fn>;

async function importBucketsWithMocks(opts: {
  s3Send?: SendSpy;
  cloudTrailSend?: SendSpy;
} = {}) {
  vi.resetModules();
  const s3Send = opts.s3Send ?? vi.fn().mockResolvedValue({});
  const cloudTrailSend = opts.cloudTrailSend ?? vi.fn().mockResolvedValue({});

  vi.doMock("@/lib/s3", async () => {
    const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");
    return {
      ...actual,
      getS3Client: () =>
        ({ send: s3Send } as unknown as ReturnType<typeof actual.getS3Client>),
    };
  });

  vi.doMock("@/lib/cloudtrail", async () => {
    const actual = await vi.importActual<typeof import("@/lib/cloudtrail")>(
      "@/lib/cloudtrail",
    );
    return {
      ...actual,
      getCloudTrailClient: () =>
        ({ send: cloudTrailSend } as unknown as ReturnType<
          typeof actual.getCloudTrailClient
        >),
    };
  });

  const mod = await import("@/lib/s3-buckets");
  return { ...mod, s3Send, cloudTrailSend };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function commandCalls(send: SendSpy, CommandClass: new (...args: any[]) => object) {
  return send.mock.calls
    .map((args: unknown[]) => args[0] as object)
    .filter((cmd) => cmd instanceof CommandClass) as Array<{
    input: Record<string, unknown>;
  }>;
}

describe("F3.2 — createHipaaBucket auto-config", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/cloudtrail");
    vi.resetModules();
  });

  it("sends CreateBucket with LocationConstraint when region is not us-east-1", async () => {
    stubAll({ AWS_REGION: "us-west-2" });
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, CreateBucketCommand);
    expect(call.input.Bucket).toBe("helpucompli-docs-acme");
    expect(call.input.CreateBucketConfiguration).toEqual({
      LocationConstraint: "us-west-2",
    });
  });

  it("sends CreateBucket WITHOUT LocationConstraint when region is us-east-1", async () => {
    stubAll({ AWS_REGION: "us-east-1" });
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, CreateBucketCommand);
    expect(call.input.CreateBucketConfiguration).toBeUndefined();
  });

  it("applies BucketOwnerEnforced ownership (disables ACLs) immediately after CreateBucket", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const sent = s3Send.mock.calls.map(
      (args: unknown[]) =>
        (args[0] as { constructor: { name: string } }).constructor.name,
    );
    expect(sent[0]).toBe("CreateBucketCommand");
    expect(sent[1]).toBe("PutBucketOwnershipControlsCommand");
    const [oc] = commandCalls(s3Send, PutBucketOwnershipControlsCommand);
    expect(oc.input.OwnershipControls).toEqual({
      Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
    });
  });

  it("applies all four Block Public Access flags", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, PutPublicAccessBlockCommand);
    expect(call.input.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    });
  });

  it("enables versioning", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, PutBucketVersioningCommand);
    expect(call.input.VersioningConfiguration).toEqual({ Status: "Enabled" });
  });

  it("applies SSE-KMS default encryption with configured CMK and BucketKeyEnabled", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, PutBucketEncryptionCommand);
    const rules = (call.input.ServerSideEncryptionConfiguration as {
      Rules: unknown[];
    }).Rules;
    expect(rules).toEqual([
      {
        ApplyServerSideEncryptionByDefault: {
          SSEAlgorithm: "aws:kms",
          KMSMasterKeyID: baseEnv.AWS_KMS_KEY_ID,
        },
        BucketKeyEnabled: true,
      },
    ]);
  });

  it("enables server access logging targeting the logs bucket with per-bucket prefix", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, PutBucketLoggingCommand);
    const logging = (call.input.BucketLoggingStatus as {
      LoggingEnabled: { TargetBucket: string; TargetPrefix: string };
    }).LoggingEnabled;
    expect(logging.TargetBucket).toBe(baseEnv.AWS_S3_LOGS_BUCKET);
    expect(logging.TargetPrefix).toContain("helpucompli-docs-acme");
  });

  it("applies bucket policy denying non-HTTPS access", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, PutBucketPolicyCommand);
    const policy = JSON.parse(call.input.Policy as string);
    const deny = policy.Statement.find(
      (s: { Sid?: string }) => s.Sid === "DenyNonHttps",
    );
    expect(deny).toBeDefined();
    expect(deny.Effect).toBe("Deny");
    expect(deny.Action).toBe("s3:*");
    expect(deny.Principal).toBe("*");
    expect(deny.Condition.Bool["aws:SecureTransport"]).toBe("false");
    expect(deny.Resource).toEqual([
      "arn:aws:s3:::helpucompli-docs-acme",
      "arn:aws:s3:::helpucompli-docs-acme/*",
    ]);
  });

  it("applies bucket policy denying TLS versions below 1.2 (HIPAA posture)", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, PutBucketPolicyCommand);
    const policy = JSON.parse(call.input.Policy as string);
    const deny = policy.Statement.find(
      (s: { Sid?: string }) => s.Sid === "DenyTls11OrBelow",
    );
    expect(deny).toBeDefined();
    expect(deny.Effect).toBe("Deny");
    expect(deny.Principal).toBe("*");
    expect(deny.Condition.NumericLessThan["s3:TlsVersion"]).toBe("1.2");
  });

  it("applies CORS policy allowing APP_BASE_URL + SSE-KMS headers + ETag exposure", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, PutBucketCorsCommand);
    expect(call).toBeDefined();
    const cfg = call.input.CORSConfiguration as {
      CORSRules: Array<{
        AllowedOrigins: string[];
        AllowedMethods: string[];
        AllowedHeaders: string[];
        ExposeHeaders: string[];
        MaxAgeSeconds: number;
      }>;
    };
    expect(cfg.CORSRules).toHaveLength(1);
    const r = cfg.CORSRules[0]!;
    expect(r.AllowedOrigins).toEqual(["http://localhost:3000"]);
    expect(r.AllowedMethods).toEqual(expect.arrayContaining(["PUT", "GET", "HEAD"]));
    expect(r.AllowedHeaders).toEqual(
      expect.arrayContaining([
        "content-type",
        "x-amz-server-side-encryption",
        "x-amz-server-side-encryption-aws-kms-key-id",
        "x-amz-server-side-encryption-bucket-key-enabled",
      ]),
    );
    expect(r.ExposeHeaders).toEqual(expect.arrayContaining(["ETag"]));
    expect(r.MaxAgeSeconds).toBeGreaterThan(0);
  });

  it("CORS AllowedOrigins never wildcards '*' (HIPAA origin scoping)", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [call] = commandCalls(s3Send, PutBucketCorsCommand);
    const cfg = call.input.CORSConfiguration as {
      CORSRules: Array<{ AllowedOrigins: string[] }>;
    };
    expect(cfg.CORSRules[0]!.AllowedOrigins).not.toContain("*");
  });

  it("applies AbortIncompleteMultipartUpload lifecycle rule (7 days)", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const calls = s3Send.mock.calls.filter(
      (args: unknown[]) =>
        (args[0] as { constructor: { name: string } }).constructor.name ===
        "PutBucketLifecycleConfigurationCommand",
    );
    expect(calls).toHaveLength(1);
    const input = (calls[0][0] as { input: Record<string, unknown> }).input;
    const rules = (input.LifecycleConfiguration as {
      Rules: Array<{
        ID: string;
        Status: string;
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: number };
      }>;
    }).Rules;
    expect(rules[0].Status).toBe("Enabled");
    expect(rules[0].AbortIncompleteMultipartUpload.DaysAfterInitiation).toBe(7);
  });

  it("orders setup: Create → OwnershipControls → PublicAccessBlock → … → BucketPolicy", async () => {
    stubAll();
    const { createHipaaBucket, s3Send } = await importBucketsWithMocks();
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const sent = s3Send.mock.calls.map(
      (args: unknown[]) =>
        (args[0] as { constructor: { name: string } }).constructor.name,
    );
    const createIdx = sent.indexOf("CreateBucketCommand");
    const ownershipIdx = sent.indexOf("PutBucketOwnershipControlsCommand");
    const pabIdx = sent.indexOf("PutPublicAccessBlockCommand");
    const policyIdx = sent.indexOf("PutBucketPolicyCommand");
    expect(createIdx).toBe(0);
    expect(ownershipIdx).toBe(1);
    expect(pabIdx).toBeGreaterThan(ownershipIdx);
    expect(policyIdx).toBeGreaterThan(pabIdx);
  });

  it("rejects invalid bucket names (uppercase, too-short, invalid chars)", async () => {
    stubAll();
    const { createHipaaBucket } = await importBucketsWithMocks();
    await expect(createHipaaBucket({ name: "AB" })).rejects.toThrow(/bucket name/i);
    await expect(createHipaaBucket({ name: "UPPER-CASE" })).rejects.toThrow(
      /bucket name/i,
    );
    await expect(createHipaaBucket({ name: "has_underscore" })).rejects.toThrow(
      /bucket name/i,
    );
    await expect(createHipaaBucket({ name: "-leading" })).rejects.toThrow(
      /bucket name/i,
    );
    await expect(createHipaaBucket({ name: "a".repeat(64) })).rejects.toThrow(
      /bucket name/i,
    );
  });

  it("rejects AWS-reserved 'xn--' prefixes and '-s3alias' suffixes", async () => {
    stubAll();
    const { createHipaaBucket } = await importBucketsWithMocks();
    await expect(createHipaaBucket({ name: "xn--mydomain" })).rejects.toThrow(
      /bucket name/i,
    );
    await expect(createHipaaBucket({ name: "my-bucket-s3alias" })).rejects.toThrow(
      /bucket name/i,
    );
  });
});

describe("F3.2 — rollback on partial failure", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/cloudtrail");
    vi.resetModules();
  });

  it("DeleteBucket is issued when PutBucketEncryption fails mid-setup", async () => {
    stubAll();
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof PutBucketEncryptionCommand) {
        return Promise.reject(new Error("KMS access denied"));
      }
      return Promise.resolve({});
    });
    const { createHipaaBucket } = await importBucketsWithMocks({ s3Send: send });
    await expect(createHipaaBucket({ name: "helpucompli-docs-rbx" })).rejects.toThrow(
      /KMS access denied/,
    );
    const deletes = commandCalls(send, DeleteBucketCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].input.Bucket).toBe("helpucompli-docs-rbx");
  });

  it("logs an error (structured payload, still re-throws original) when rollback DeleteBucket fails", async () => {
    stubAll();
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof PutBucketPolicyCommand) {
        return Promise.reject(new Error("policy apply failed"));
      }
      if (cmd instanceof DeleteBucketCommand) {
        return Promise.reject(new Error("bucket not empty during rollback"));
      }
      return Promise.resolve({});
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { createHipaaBucket } = await importBucketsWithMocks({ s3Send: send });
    await expect(createHipaaBucket({ name: "helpucompli-docs-rbx" })).rejects.toThrow(
      /policy apply failed/,
    );
    expect(err).toHaveBeenCalled();
    expect(err.mock.calls[0][0]).toMatch(/rollback FAILED/);
    err.mockRestore();
  });

  it("tags the bucket hipaa:provisioning=failed before attempting rollback", async () => {
    stubAll();
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof PutBucketEncryptionCommand) {
        return Promise.reject(new Error("KMS access denied"));
      }
      return Promise.resolve({});
    });
    const { createHipaaBucket } = await importBucketsWithMocks({ s3Send: send });
    await expect(createHipaaBucket({ name: "helpucompli-docs-rbx" })).rejects.toThrow(
      /KMS access denied/,
    );
    const tagCall = send.mock.calls.find(
      (args: unknown[]) =>
        (args[0] as { constructor: { name: string } }).constructor.name ===
        "PutBucketTaggingCommand",
    );
    expect(tagCall).toBeDefined();
    const input = (tagCall![0] as { input: Record<string, unknown> }).input;
    const tags = (input.Tagging as { TagSet: Array<{ Key: string; Value: string }> })
      .TagSet;
    expect(tags).toEqual(
      expect.arrayContaining([{ Key: "hipaa:provisioning", Value: "failed" }]),
    );
  });

  it("does NOT rollback when the initial CreateBucket itself fails (nothing to delete)", async () => {
    stubAll();
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof CreateBucketCommand) {
        return Promise.reject(new Error("BucketAlreadyExists"));
      }
      return Promise.resolve({});
    });
    const { createHipaaBucket } = await importBucketsWithMocks({ s3Send: send });
    await expect(createHipaaBucket({ name: "helpucompli-docs-rbx" })).rejects.toThrow(
      /BucketAlreadyExists/,
    );
    expect(commandCalls(send, DeleteBucketCommand)).toHaveLength(0);
  });
});

describe("F3.2 — CloudTrail data events (AdvancedEventSelectors)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/cloudtrail");
    vi.resetModules();
  });

  it("issues exactly one PutEventSelectors call with AdvancedEventSelectors (no read-modify-write)", async () => {
    stubAll({ AWS_CLOUDTRAIL_NAME: "helpucompli-trail" });
    const ct = vi.fn().mockResolvedValue({});
    const { createHipaaBucket } = await importBucketsWithMocks({ cloudTrailSend: ct });
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const sent = ct.mock.calls.map(
      (args: unknown[]) =>
        (args[0] as { constructor: { name: string } }).constructor.name,
    );
    // Advanced selector pattern is idempotent — single PutEventSelectors,
    // no GetEventSelectors round-trip.
    expect(sent).toEqual(["PutEventSelectorsCommand"]);
  });

  it("builds AdvancedEventSelector with StartsWith on helpucompli-docs- prefix", async () => {
    stubAll({ AWS_CLOUDTRAIL_NAME: "helpucompli-trail" });
    const ct = vi.fn().mockResolvedValue({});
    const { createHipaaBucket } = await importBucketsWithMocks({ cloudTrailSend: ct });
    await createHipaaBucket({ name: "helpucompli-docs-acme" });
    const [put] = commandCalls(ct, PutEventSelectorsCommand);
    expect(put.input.TrailName).toBe("helpucompli-trail");
    expect(put.input.EventSelectors).toBeUndefined();
    const adv = put.input.AdvancedEventSelectors as Array<{
      Name: string;
      FieldSelectors: Array<{ Field: string; Equals?: string[]; StartsWith?: string[] }>;
    }>;
    expect(adv).toHaveLength(1);
    const fs = adv[0].FieldSelectors;
    expect(fs).toEqual(
      expect.arrayContaining([
        { Field: "eventCategory", Equals: ["Data"] },
        { Field: "resources.type", Equals: ["AWS::S3::Object"] },
        { Field: "resources.ARN", StartsWith: ["arn:aws:s3:::helpucompli-docs-"] },
      ]),
    );
  });

  it("skips CloudTrail wiring when AWS_CLOUDTRAIL_NAME is absent, returning carry-forward flag", async () => {
    stubAll();
    const { createHipaaBucket, cloudTrailSend } = await importBucketsWithMocks();
    const result = await createHipaaBucket({ name: "helpucompli-docs-acme" });
    expect(cloudTrailSend).not.toHaveBeenCalled();
    expect(result.cloudTrailConfigured).toBe(false);
  });

  it("propagates CloudTrail send() rejections (does not swallow)", async () => {
    stubAll({ AWS_CLOUDTRAIL_NAME: "helpucompli-trail" });
    const ct = vi.fn().mockRejectedValue(new Error("trail access denied"));
    const { createHipaaBucket } = await importBucketsWithMocks({ cloudTrailSend: ct });
    await expect(createHipaaBucket({ name: "helpucompli-docs-acme" })).rejects.toThrow(
      /trail access denied/,
    );
  });
});

describe("F3.2 — buildHipaaDataEventSelectors (unit)", () => {
  it("returns a single selector with Data category + S3 Object + prefix StartsWith", async () => {
    const { buildHipaaDataEventSelectors, HIPAA_BUCKET_PREFIX } = await import(
      "@/lib/s3-buckets"
    );
    const sel = buildHipaaDataEventSelectors();
    expect(sel).toHaveLength(1);
    expect(sel[0].FieldSelectors).toEqual(
      expect.arrayContaining([
        { Field: "eventCategory", Equals: ["Data"] },
        { Field: "resources.type", Equals: ["AWS::S3::Object"] },
        {
          Field: "resources.ARN",
          StartsWith: [`arn:aws:s3:::${HIPAA_BUCKET_PREFIX}`],
        },
      ]),
    );
  });
});

describe("F3.2 — listHipaaBuckets", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/cloudtrail");
    vi.resetModules();
  });

  it("returns a normalized bucket list", async () => {
    stubAll();
    const send = vi.fn().mockResolvedValue({
      Buckets: [
        { Name: "b1", CreationDate: new Date("2026-01-01") },
        { Name: "b2", CreationDate: new Date("2026-02-01") },
      ],
    });
    const { listHipaaBuckets, s3Send } = await importBucketsWithMocks({ s3Send: send });
    const result = await listHipaaBuckets();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ Name: "b1", CreationDate: new Date("2026-01-01") });
    const [call] = commandCalls(s3Send, ListBucketsCommand);
    expect(call).toBeDefined();
  });
});

describe("F3.2 — deleteEmptyHipaaBucket", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/cloudtrail");
    vi.resetModules();
  });

  it("refuses to delete a non-empty bucket (BucketNotEmptyError)", async () => {
    stubAll();
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) return Promise.resolve({ KeyCount: 3 });
      return Promise.resolve({});
    });
    const { deleteEmptyHipaaBucket, BucketNotEmptyError } =
      await importBucketsWithMocks({ s3Send: send });
    await expect(deleteEmptyHipaaBucket("non-empty")).rejects.toBeInstanceOf(
      BucketNotEmptyError,
    );
  });

  it("deletes an empty bucket", async () => {
    stubAll();
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) return Promise.resolve({ KeyCount: 0 });
      return Promise.resolve({});
    });
    const { deleteEmptyHipaaBucket, s3Send } = await importBucketsWithMocks({
      s3Send: send,
    });
    await deleteEmptyHipaaBucket("empty-bucket");
    const [call] = commandCalls(s3Send, DeleteBucketCommand);
    expect(call.input.Bucket).toBe("empty-bucket");
  });

  it("refuses to delete when in-flight multipart uploads exist (sec-review F5.4 H2)", async () => {
    stubAll();
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) return Promise.resolve({ KeyCount: 0 });
      if (cmd instanceof ListMultipartUploadsCommand)
        return Promise.resolve({ Uploads: [{ UploadId: "u-1", Key: "x" }] });
      return Promise.resolve({});
    });
    const { deleteEmptyHipaaBucket, BucketNotEmptyError } =
      await importBucketsWithMocks({ s3Send: send });
    await expect(deleteEmptyHipaaBucket("mpu-pending")).rejects.toBeInstanceOf(
      BucketNotEmptyError,
    );
  });

  it("rewraps AWS BucketNotEmpty (TOCTOU race) as BucketNotEmptyError", async () => {
    stubAll();
    const awsError = Object.assign(new Error("The bucket you tried to delete is not empty"), {
      name: "BucketNotEmpty",
    });
    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) return Promise.resolve({ KeyCount: 0 });
      if (cmd instanceof DeleteBucketCommand) return Promise.reject(awsError);
      return Promise.resolve({});
    });
    const { deleteEmptyHipaaBucket, BucketNotEmptyError } =
      await importBucketsWithMocks({ s3Send: send });
    await expect(deleteEmptyHipaaBucket("race-bucket")).rejects.toBeInstanceOf(
      BucketNotEmptyError,
    );
  });
});
