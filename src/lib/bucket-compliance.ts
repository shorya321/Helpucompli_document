import {
  GetBucketEncryptionCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3";

// Live-S3 drift check for a managed HIPAA bucket. Used by the
// /api/s3/buckets/[id]/compliance endpoint AND a periodic ops sweep
// (Module 11/12). Every getter returns a neutral shape — the caller
// can diff expected vs observed. Errors are trapped per-field so a
// partial AWS outage produces a report with per-field ok=false rather
// than throwing the whole check.

export interface ComplianceFieldOk {
  readonly ok: true;
}

export interface ComplianceFieldDrift {
  readonly ok: false;
  readonly errorReason?: string;
}

export interface SseKmsField {
  readonly ok: boolean;
  readonly algorithm: string | null;
  readonly bucketKeyEnabled: boolean;
  readonly errorReason?: string;
}

export interface VersioningField {
  readonly ok: boolean;
  readonly status: string | null;
  readonly errorReason?: string;
}

export interface PublicAccessBlockField {
  readonly ok: boolean;
  readonly blockPublicAcls: boolean;
  readonly ignorePublicAcls: boolean;
  readonly blockPublicPolicy: boolean;
  readonly restrictPublicBuckets: boolean;
  readonly errorReason?: string;
}

export interface HttpsOnlyPolicyField {
  readonly ok: boolean;
  readonly denyNonHttpsPresent: boolean;
  readonly denyTlsBelow12Present: boolean;
  readonly errorReason?: string;
}

export interface BucketComplianceReport {
  readonly bucketName: string;
  readonly compliant: boolean;
  readonly sseKms: SseKmsField;
  readonly versioning: VersioningField;
  readonly publicAccessBlock: PublicAccessBlockField;
  readonly httpsOnlyPolicy: HttpsOnlyPolicyField;
  readonly checkedAt: Date;
}

// Abstract runner — lets tests inject hand-rolled stubs, and lets
// a future module swap in a LocalStack or mock runner.
export interface BucketComplianceRunner {
  getEncryption(bucketName: string): Promise<{
    rules: Array<{
      ApplyServerSideEncryptionByDefault?: {
        SSEAlgorithm?: string;
        KMSMasterKeyID?: string;
      };
      BucketKeyEnabled?: boolean;
    }>;
  }>;
  getVersioning(bucketName: string): Promise<{ status?: string }>;
  getPublicAccessBlock(bucketName: string): Promise<{
    blockPublicAcls?: boolean;
    ignorePublicAcls?: boolean;
    blockPublicPolicy?: boolean;
    restrictPublicBuckets?: boolean;
  }>;
  getPolicy(bucketName: string): Promise<string | undefined>;
}

// Default runner backed by the real S3 client — thin adapter over the
// AWS SDK so the `checkBucketCompliance` logic is SDK-independent
// (swap for a mock / LocalStack in tests).
export const defaultComplianceRunner: BucketComplianceRunner = {
  async getEncryption(bucketName) {
    const out = await getS3Client().send(
      new GetBucketEncryptionCommand({ Bucket: bucketName }),
    );
    return {
      rules: (out.ServerSideEncryptionConfiguration?.Rules ?? []).map((r) => ({
        ApplyServerSideEncryptionByDefault: r.ApplyServerSideEncryptionByDefault,
        BucketKeyEnabled: r.BucketKeyEnabled,
      })),
    };
  },
  async getVersioning(bucketName) {
    const out = await getS3Client().send(
      new GetBucketVersioningCommand({ Bucket: bucketName }),
    );
    return { status: out.Status };
  },
  async getPublicAccessBlock(bucketName) {
    const out = await getS3Client().send(
      new GetPublicAccessBlockCommand({ Bucket: bucketName }),
    );
    const c = out.PublicAccessBlockConfiguration ?? {};
    return {
      blockPublicAcls: c.BlockPublicAcls ?? false,
      ignorePublicAcls: c.IgnorePublicAcls ?? false,
      blockPublicPolicy: c.BlockPublicPolicy ?? false,
      restrictPublicBuckets: c.RestrictPublicBuckets ?? false,
    };
  },
  async getPolicy(bucketName) {
    const out = await getS3Client().send(
      new GetBucketPolicyCommand({ Bucket: bucketName }),
    );
    return out.Policy;
  },
};

// Never echo raw AWS / Prisma error messages — they can embed ARNs
// with account IDs or other sensitive identifiers (F2.2 sec-review
// M2 principle). Map per-field to a generic reason.
function maskError(field: string): string {
  return `Failed to read ${field}`;
}

async function checkSseKms(
  runner: BucketComplianceRunner,
  bucketName: string,
): Promise<SseKmsField> {
  try {
    const { rules } = await runner.getEncryption(bucketName);
    const rule = rules[0];
    const algorithm =
      rule?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm ?? null;
    const ok = algorithm === "aws:kms";
    return {
      ok,
      algorithm,
      bucketKeyEnabled: rule?.BucketKeyEnabled ?? false,
    };
  } catch (err) {
    return {
      ok: false,
      algorithm: null,
      bucketKeyEnabled: false,
      errorReason:
        err instanceof Error && err.message.includes("ConfigurationNotFound")
          ? "ServerSideEncryptionConfigurationNotFound"
          : maskError("encryption"),
    };
  }
}

async function checkVersioning(
  runner: BucketComplianceRunner,
  bucketName: string,
): Promise<VersioningField> {
  try {
    const { status } = await runner.getVersioning(bucketName);
    return {
      ok: status === "Enabled",
      status: status ?? null,
    };
  } catch {
    return {
      ok: false,
      status: null,
      errorReason: maskError("versioning"),
    };
  }
}

async function checkPublicAccessBlock(
  runner: BucketComplianceRunner,
  bucketName: string,
): Promise<PublicAccessBlockField> {
  try {
    const c = await runner.getPublicAccessBlock(bucketName);
    const flags = {
      blockPublicAcls: c.blockPublicAcls ?? false,
      ignorePublicAcls: c.ignorePublicAcls ?? false,
      blockPublicPolicy: c.blockPublicPolicy ?? false,
      restrictPublicBuckets: c.restrictPublicBuckets ?? false,
    };
    const ok =
      flags.blockPublicAcls &&
      flags.ignorePublicAcls &&
      flags.blockPublicPolicy &&
      flags.restrictPublicBuckets;
    return { ok, ...flags };
  } catch {
    return {
      ok: false,
      blockPublicAcls: false,
      ignorePublicAcls: false,
      blockPublicPolicy: false,
      restrictPublicBuckets: false,
      errorReason: maskError("public access block"),
    };
  }
}

async function checkHttpsOnlyPolicy(
  runner: BucketComplianceRunner,
  bucketName: string,
): Promise<HttpsOnlyPolicyField> {
  try {
    const raw = await runner.getPolicy(bucketName);
    if (!raw) {
      return {
        ok: false,
        denyNonHttpsPresent: false,
        denyTlsBelow12Present: false,
        errorReason: "Policy not set",
      };
    }
    const parsed = JSON.parse(raw) as {
      Statement?: Array<{
        Sid?: string;
        Condition?: Record<string, unknown>;
      }>;
    };
    const statements = parsed.Statement ?? [];
    const denyNonHttpsPresent = statements.some((s) => {
      const cond = s.Condition as
        | { Bool?: Record<string, string> }
        | undefined;
      return cond?.Bool?.["aws:SecureTransport"] === "false";
    });
    const denyTlsBelow12Present = statements.some((s) => {
      const cond = s.Condition as
        | { NumericLessThan?: Record<string, string> }
        | undefined;
      return cond?.NumericLessThan?.["s3:TlsVersion"] === "1.2";
    });
    return {
      ok: denyNonHttpsPresent && denyTlsBelow12Present,
      denyNonHttpsPresent,
      denyTlsBelow12Present,
    };
  } catch {
    return {
      ok: false,
      denyNonHttpsPresent: false,
      denyTlsBelow12Present: false,
      errorReason: maskError("bucket policy"),
    };
  }
}

export async function checkBucketCompliance(
  runner: BucketComplianceRunner,
  bucketName: string,
): Promise<BucketComplianceReport> {
  // Sequence (not parallel) — four small reads; the SDK already
  // keeps its own connection pool but sequential reads keep the log
  // order deterministic for the test suite.
  const sseKms = await checkSseKms(runner, bucketName);
  const versioning = await checkVersioning(runner, bucketName);
  const publicAccessBlock = await checkPublicAccessBlock(runner, bucketName);
  const httpsOnlyPolicy = await checkHttpsOnlyPolicy(runner, bucketName);

  return {
    bucketName,
    compliant:
      sseKms.ok &&
      versioning.ok &&
      publicAccessBlock.ok &&
      httpsOnlyPolicy.ok,
    sseKms,
    versioning,
    publicAccessBlock,
    httpsOnlyPolicy,
    checkedAt: new Date(),
  };
}
