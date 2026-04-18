import { describe, expect, it, vi } from "vitest";
import {
  BucketComplianceReport,
  checkBucketCompliance,
  type BucketComplianceRunner,
} from "@/lib/bucket-compliance";

interface RunnerOpts {
  readonly encryption?: {
    rules: Array<{
      ApplyServerSideEncryptionByDefault?: {
        SSEAlgorithm?: string;
        KMSMasterKeyID?: string;
      };
      BucketKeyEnabled?: boolean;
    }>;
  };
  readonly versioning?: { status?: string };
  readonly publicAccessBlock?: {
    blockPublicAcls?: boolean;
    ignorePublicAcls?: boolean;
    blockPublicPolicy?: boolean;
    restrictPublicBuckets?: boolean;
  };
  readonly policy?: string;
  readonly encryptionError?: unknown;
  readonly versioningError?: unknown;
  readonly publicAccessBlockError?: unknown;
  readonly policyError?: unknown;
}

function makeRunner(opts: RunnerOpts = {}): {
  runner: BucketComplianceRunner;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    runner: {
      getEncryption: vi.fn(async (name: string) => {
        calls.push(`enc:${name}`);
        if (opts.encryptionError) throw opts.encryptionError;
        return opts.encryption ?? { rules: [] };
      }),
      getVersioning: vi.fn(async (name: string) => {
        calls.push(`ver:${name}`);
        if (opts.versioningError) throw opts.versioningError;
        return opts.versioning ?? {};
      }),
      getPublicAccessBlock: vi.fn(async (name: string) => {
        calls.push(`pab:${name}`);
        if (opts.publicAccessBlockError) throw opts.publicAccessBlockError;
        return opts.publicAccessBlock ?? {};
      }),
      getPolicy: vi.fn(async (name: string) => {
        calls.push(`pol:${name}`);
        if (opts.policyError) throw opts.policyError;
        return opts.policy;
      }),
    },
  };
}

const COMPLIANT_OPTS: RunnerOpts = {
  encryption: {
    rules: [
      {
        ApplyServerSideEncryptionByDefault: {
          SSEAlgorithm: "aws:kms",
          KMSMasterKeyID: "arn:aws:kms:us-east-1:1:key/abc",
        },
        BucketKeyEnabled: true,
      },
    ],
  },
  versioning: { status: "Enabled" },
  publicAccessBlock: {
    blockPublicAcls: true,
    ignorePublicAcls: true,
    blockPublicPolicy: true,
    restrictPublicBuckets: true,
  },
  policy: JSON.stringify({
    Statement: [
      { Sid: "DenyNonHttps", Condition: { Bool: { "aws:SecureTransport": "false" } } },
      {
        Sid: "DenyTls11OrBelow",
        Condition: { NumericLessThan: { "s3:TlsVersion": "1.2" } },
      },
    ],
  }),
};

describe("checkBucketCompliance — fully compliant bucket", () => {
  it("returns all four fields ok + compliant=true", async () => {
    const { runner, calls } = makeRunner(COMPLIANT_OPTS);
    const report: BucketComplianceReport = await checkBucketCompliance(
      runner,
      "helpucompli-docs-x",
    );
    expect(report.compliant).toBe(true);
    expect(report.sseKms.ok).toBe(true);
    expect(report.sseKms.algorithm).toBe("aws:kms");
    expect(report.versioning.ok).toBe(true);
    expect(report.publicAccessBlock.ok).toBe(true);
    expect(report.httpsOnlyPolicy.ok).toBe(true);
    expect(calls).toEqual([
      "enc:helpucompli-docs-x",
      "ver:helpucompli-docs-x",
      "pab:helpucompli-docs-x",
      "pol:helpucompli-docs-x",
    ]);
  });
});

describe("checkBucketCompliance — drift detection", () => {
  it("flags non-KMS encryption as drift", async () => {
    const { runner } = makeRunner({
      ...COMPLIANT_OPTS,
      encryption: {
        rules: [
          {
            ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
          },
        ],
      },
    });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.sseKms.ok).toBe(false);
    expect(report.sseKms.algorithm).toBe("AES256");
    expect(report.compliant).toBe(false);
  });

  it("flags no-encryption configured as drift (empty rules)", async () => {
    const { runner } = makeRunner({ ...COMPLIANT_OPTS, encryption: { rules: [] } });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.sseKms.ok).toBe(false);
    expect(report.compliant).toBe(false);
  });

  it("flags versioning=Suspended as drift", async () => {
    const { runner } = makeRunner({
      ...COMPLIANT_OPTS,
      versioning: { status: "Suspended" },
    });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.versioning.ok).toBe(false);
    expect(report.versioning.status).toBe("Suspended");
    expect(report.compliant).toBe(false);
  });

  it("flags versioning-never-enabled (empty status field) as drift", async () => {
    const { runner } = makeRunner({ ...COMPLIANT_OPTS, versioning: {} });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.versioning.ok).toBe(false);
    expect(report.compliant).toBe(false);
  });

  it("flags ANY single PAB flag being false as drift", async () => {
    const { runner } = makeRunner({
      ...COMPLIANT_OPTS,
      publicAccessBlock: {
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: true,
        restrictPublicBuckets: false, // one flag off
      },
    });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.publicAccessBlock.ok).toBe(false);
    expect(report.publicAccessBlock.restrictPublicBuckets).toBe(false);
    expect(report.compliant).toBe(false);
  });

  it("flags missing bucket policy as drift", async () => {
    const { runner } = makeRunner({ ...COMPLIANT_OPTS, policy: undefined });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.httpsOnlyPolicy.ok).toBe(false);
    expect(report.compliant).toBe(false);
  });

  it("flags policy without DenyNonHttps as drift", async () => {
    const { runner } = makeRunner({
      ...COMPLIANT_OPTS,
      policy: JSON.stringify({
        Statement: [
          {
            Sid: "DenyTls11OrBelow",
            Condition: { NumericLessThan: { "s3:TlsVersion": "1.2" } },
          },
        ],
      }),
    });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.httpsOnlyPolicy.ok).toBe(false);
    expect(report.compliant).toBe(false);
  });

  it("flags policy without s3:TlsVersion 1.2 as drift", async () => {
    const { runner } = makeRunner({
      ...COMPLIANT_OPTS,
      policy: JSON.stringify({
        Statement: [
          { Sid: "DenyNonHttps", Condition: { Bool: { "aws:SecureTransport": "false" } } },
        ],
      }),
    });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.httpsOnlyPolicy.ok).toBe(false);
    expect(report.compliant).toBe(false);
  });
});

describe("checkBucketCompliance — error handling", () => {
  it("returns ok=false on encryption API error (not throwing out)", async () => {
    const { runner } = makeRunner({
      ...COMPLIANT_OPTS,
      encryptionError: new Error("ServerSideEncryptionConfigurationNotFoundError"),
    });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.sseKms.ok).toBe(false);
    expect(report.sseKms.errorReason).toMatch(/configurationnotfound/i);
    expect(report.compliant).toBe(false);
  });

  it("returns ok=false on PAB API error", async () => {
    const { runner } = makeRunner({
      ...COMPLIANT_OPTS,
      publicAccessBlockError: new Error("NoSuchPublicAccessBlockConfiguration"),
    });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.publicAccessBlock.ok).toBe(false);
    expect(report.compliant).toBe(false);
  });

  it("never echoes the raw error.message when it could embed ARN / account id", async () => {
    const leaky = new Error(
      "AccessDenied on arn:aws:s3:::sensitive-bucket — caller arn:aws:iam::123456789012:user/alice",
    );
    const { runner } = makeRunner({ ...COMPLIANT_OPTS, versioningError: leaky });
    const report = await checkBucketCompliance(runner, "h-x");
    expect(report.versioning.errorReason).not.toContain("123456789012");
    expect(report.versioning.errorReason).not.toContain("sensitive-bucket");
    expect(report.versioning.errorReason).toBe("Failed to read versioning");
  });
});
