import {
  type BucketLocationConstraint,
  type CORSConfiguration,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketLoggingCommand,
  PutBucketOwnershipControlsCommand,
  PutBucketPolicyCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import {
  type AdvancedEventSelector,
  PutEventSelectorsCommand,
} from "@aws-sdk/client-cloudtrail";
import { getS3Client } from "./s3";
import { getCloudTrailClient } from "./cloudtrail";
import { loadConfig } from "./config";

// AWS S3 naming rules (subset we enforce): lowercase letters, digits, hyphen
// only; 3–63 chars; must start and end with alphanumeric. Dots disallowed
// (breaks TLS cert wildcard path for virtual-hosted-style access). Also
// reject AWS-reserved prefixes/suffixes: `xn--` (IDN ACE prefix reserved)
// and `-s3alias` (access-point aliases reserved).
const BUCKET_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

// Prefix every managed bucket MUST start with. Matches the IAM policy
// resource scope in src/lib/iam-policies.ts (BUCKET_ARN_PATTERN) and the
// CloudTrail AdvancedEventSelectors StartsWith filter below.
export const HIPAA_BUCKET_PREFIX = "helpucompli-docs-";

function assertValidBucketName(name: string): void {
  if (!BUCKET_NAME_RE.test(name)) throw new InvalidBucketNameError(name);
  if (name.startsWith("xn--")) throw new InvalidBucketNameError(name);
  if (name.endsWith("-s3alias")) throw new InvalidBucketNameError(name);
}

export class InvalidBucketNameError extends Error {
  constructor(name: string) {
    super(
      `Invalid bucket name: '${name}'. Must be 3–63 chars, lowercase ` +
        `alphanumeric + hyphens (no dots, underscores, leading/trailing ` +
        `hyphen, 'xn--' prefix, or '-s3alias' suffix).`,
    );
    this.name = "InvalidBucketNameError";
  }
}

export class BucketNotEmptyError extends Error {
  constructor(bucket: string) {
    super(`Bucket '${bucket}' is not empty — refusing to delete`);
    this.name = "BucketNotEmptyError";
  }
}

export interface CreateHipaaBucketInput {
  name: string;
  region?: BucketLocationConstraint | string;
}

export interface CreateHipaaBucketResult {
  name: string;
  region: string;
  cloudTrailConfigured: boolean;
}

export const HIPAA_LOG_PREFIX = "s3-access-logs/";

// CORS configuration shared by createHipaaBucket + the retrofit script +
// the compliance verifier. Kept as a pure builder so every surface agrees
// on the exact rule set — drift between provisioning and drift-check
// would produce false-positive "drift" reports.
//
// Browser upload flow signs SSE-KMS headers via presignPutUrl, so the
// CORS rule MUST allow those headers on preflight or the PUT never
// leaves the browser (XHR.onerror fires as "Network error during
// upload"). ExposeHeaders=ETag is required for multipart upload parts
// to report their ETag back to the client for CompleteMultipartUpload.
// AllowedOrigins is pinned to APP_BASE_URL — never '*' because the
// bucket holds PHI and the browser-credentials model relies on origin
// scoping.
export function buildHipaaCorsConfiguration(appBaseUrl: string): CORSConfiguration {
  return {
    CORSRules: [
      {
        AllowedOrigins: [appBaseUrl],
        AllowedMethods: ["PUT", "GET", "HEAD"],
        AllowedHeaders: [
          "content-type",
          "authorization",
          "x-amz-content-sha256",
          "x-amz-date",
          "x-amz-server-side-encryption",
          "x-amz-server-side-encryption-aws-kms-key-id",
          "x-amz-server-side-encryption-bucket-key-enabled",
          "x-amz-user-agent",
          "x-amz-checksum-crc32",
          "x-amz-checksum-crc32c",
          "x-amz-checksum-sha1",
          "x-amz-checksum-sha256",
        ],
        ExposeHeaders: ["ETag", "x-amz-version-id"],
        MaxAgeSeconds: 3000,
      },
    ],
  };
}

// AbortIncompleteMultipartUpload lifecycle rule — safety net for F3.5
// abandoned multipart uploads (client disconnects, server crashes). 7 days
// is AWS's common recommendation; any shorter risks user-facing upload
// failures on slow networks.
// Ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html
const MULTIPART_ABORT_DAYS = 7;

export function httpsOnlyBucketPolicy(bucket: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "DenyNonHttps",
        Effect: "Deny",
        Principal: "*",
        Action: "s3:*",
        Resource: [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/*`,
        ],
        Condition: { Bool: { "aws:SecureTransport": "false" } },
      },
      {
        // HIPAA posture: TLS 1.2 minimum. aws:SecureTransport only ensures
        // *some* TLS; without this condition a legacy TLS 1.0 / 1.1 client
        // still passes. s3:TlsVersion is the S3-specific condition key.
        // Ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html#example-object-tls-version
        Sid: "DenyTls11OrBelow",
        Effect: "Deny",
        Principal: "*",
        Action: "s3:*",
        Resource: [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/*`,
        ],
        Condition: { NumericLessThan: { "s3:TlsVersion": "1.2" } },
      },
    ],
  });
}

// AdvancedEventSelector covering every managed bucket via one StartsWith
// rule on the object-ARN prefix. Replaces the per-bucket merge of basic
// EventSelectors which would hit the 5-ARN cap on large accounts.
// Ref: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html#creating-data-event-selectors-advanced
export function buildHipaaDataEventSelectors(): AdvancedEventSelector[] {
  return [
    {
      Name: "helpucompli-docs-s3-data-events",
      FieldSelectors: [
        { Field: "eventCategory", Equals: ["Data"] },
        { Field: "resources.type", Equals: ["AWS::S3::Object"] },
        {
          Field: "resources.ARN",
          StartsWith: [`arn:aws:s3:::${HIPAA_BUCKET_PREFIX}`],
        },
      ],
    },
  ];
}

// Orchestrates every HIPAA S3 bucket control in a specific order:
//   1. CreateBucket
//   2. PutBucketOwnershipControls = BucketOwnerEnforced — disables ACLs
//      entirely so no ACL-based public-access vector survives the window
//      before PutPublicAccessBlock runs.
//   3. PutPublicAccessBlock — all 4 blocks.
//   4. PutBucketVersioning.
//   5. PutBucketEncryption — SSE-KMS + BucketKeyEnabled.
//   6. PutBucketLogging — to AWS_S3_LOGS_BUCKET with per-bucket prefix.
//   7. PutBucketPolicy — deny non-HTTPS + deny TLS < 1.2.
//   8. PutBucketLifecycleConfiguration — AbortIncompleteMultipartUpload
//      safety net for F3.5 abandoned uploads.
//   9. PutBucketCors — allow browser direct-PUT uploads from
//      APP_BASE_URL with SSE-KMS headers + content-type signed. Without
//      this the browser preflight fails and uploads error as
//      "Network error" (F6.2 bug fix).
//  10. CloudTrail: PutEventSelectorsCommand with AdvancedEventSelectors
//      covering the entire helpucompli-docs-* prefix — idempotent across
//      bucket creations (no per-bucket merge needed).
//
// If any step 2–8 fails, we tag the bucket hipaa:provisioning=failed for
// audit discoverability, then attempt a best-effort DeleteBucket rollback
// so a half-configured (possibly unencrypted / HTTP-open) bucket cannot
// be consumed by downstream callers. Rollback failure is logged with a
// structured payload; ops runbook must reconcile.
export async function createHipaaBucket(
  input: CreateHipaaBucketInput,
): Promise<CreateHipaaBucketResult> {
  assertValidBucketName(input.name);

  const cfg = loadConfig();
  const region = input.region ?? cfg.AWS_REGION;
  const s3 = getS3Client();
  const Bucket = input.name;

  await s3.send(
    new CreateBucketCommand({
      Bucket,
      ...(region !== "us-east-1"
        ? {
            CreateBucketConfiguration: {
              LocationConstraint: region as BucketLocationConstraint,
            },
          }
        : {}),
    }),
  );

  try {
    await s3.send(
      new PutBucketOwnershipControlsCommand({
        Bucket,
        OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
      }),
    );

    await s3.send(
      new PutPublicAccessBlockCommand({
        Bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }),
    );

    await s3.send(
      new PutBucketVersioningCommand({
        Bucket,
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );

    await s3.send(
      new PutBucketEncryptionCommand({
        Bucket,
        ServerSideEncryptionConfiguration: {
          Rules: [
            {
              ApplyServerSideEncryptionByDefault: {
                SSEAlgorithm: "aws:kms",
                KMSMasterKeyID: cfg.AWS_KMS_KEY_ID,
              },
              BucketKeyEnabled: true,
            },
          ],
        },
      }),
    );

    await s3.send(
      new PutBucketLoggingCommand({
        Bucket,
        BucketLoggingStatus: {
          LoggingEnabled: {
            TargetBucket: cfg.AWS_S3_LOGS_BUCKET,
            TargetPrefix: `${HIPAA_LOG_PREFIX}${Bucket}/`,
          },
        },
      }),
    );

    await s3.send(
      new PutBucketPolicyCommand({
        Bucket,
        Policy: httpsOnlyBucketPolicy(Bucket),
      }),
    );

    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: "abort-incomplete-multipart-uploads",
              Status: "Enabled",
              // Filter with empty Prefix applies to every object in bucket.
              Filter: { Prefix: "" },
              AbortIncompleteMultipartUpload: {
                DaysAfterInitiation: MULTIPART_ABORT_DAYS,
              },
            },
          ],
        },
      }),
    );

    // F6.2 fix: browser direct-PUT uploads rely on S3 CORS. Preflight
    // for PUT with SSE-KMS headers and content-type MUST be allowed
    // from APP_BASE_URL or the upload fails with XHR "Network error".
    await s3.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: buildHipaaCorsConfiguration(cfg.APP_BASE_URL),
      }),
    );
  } catch (err) {
    // Tag the bucket so orphans after a failed rollback are discoverable
    // by ops (aws s3api get-bucket-tagging). Best-effort: if tagging
    // fails we still attempt rollback + warn.
    try {
      await s3.send(
        new PutBucketTaggingCommand({
          Bucket,
          Tagging: {
            TagSet: [
              { Key: "hipaa:provisioning", Value: "failed" },
              { Key: "hipaa:provisioned-at", Value: new Date().toISOString() },
            ],
          },
        }),
      );
    } catch {
      // swallow — tagging is best-effort diagnostics
    }

    // best-effort rollback
    try {
      await s3.send(new DeleteBucketCommand({ Bucket }));
    } catch (deleteErr) {
      // eslint-disable-next-line no-console
      console.error("[s3-buckets] createHipaaBucket rollback FAILED", {
        bucket: Bucket,
        rollbackError:
          deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
        remediation: "Manual cleanup required; bucket tagged hipaa:provisioning=failed",
      });
    }
    throw err;
  }

  let cloudTrailConfigured = false;
  if (cfg.AWS_CLOUDTRAIL_NAME) {
    const trail = getCloudTrailClient();
    // AdvancedEventSelectors are idempotent across calls — overwriting
    // with the same selector set produces the same configuration. We
    // still issue the call on every bucket create so a tenant that
    // manually reset the trail selectors is auto-healed.
    await trail.send(
      new PutEventSelectorsCommand({
        TrailName: cfg.AWS_CLOUDTRAIL_NAME,
        AdvancedEventSelectors: buildHipaaDataEventSelectors(),
      }),
    );
    cloudTrailConfigured = true;
  }

  return { name: Bucket, region: String(region), cloudTrailConfigured };
}

export async function listHipaaBuckets(): Promise<
  Array<{ Name: string; CreationDate?: Date }>
> {
  const res = await getS3Client().send(new ListBucketsCommand({}));
  return (res.Buckets ?? []).map((b) => ({
    Name: b.Name ?? "",
    CreationDate: b.CreationDate,
  }));
}

export async function deleteEmptyHipaaBucket(name: string): Promise<void> {
  assertValidBucketName(name);
  const s3 = getS3Client();
  const listing = await s3.send(
    new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 }),
  );
  if ((listing.KeyCount ?? 0) > 0) {
    throw new BucketNotEmptyError(name);
  }
  // Multipart uploads initiated but not completed do NOT surface in
  // ListObjectsV2 — deleting a bucket with live multipart uploads
  // orphans the parts and can produce orphaned storage charges.
  // (sec-review F5.4 H2)
  const multipart = await s3.send(
    new ListMultipartUploadsCommand({ Bucket: name, MaxUploads: 1 }),
  );
  if ((multipart.Uploads ?? []).length > 0) {
    throw new BucketNotEmptyError(name);
  }
  // TOCTOU: concurrent writer may race between ListObjectsV2 and
  // DeleteBucket. If S3 rejects with BucketNotEmpty we rewrap so callers
  // see a consistent error surface.
  try {
    await s3.send(new DeleteBucketCommand({ Bucket: name }));
  } catch (err) {
    const code =
      err && typeof err === "object" && "name" in err
        ? (err as { name?: string }).name
        : undefined;
    if (code === "BucketNotEmpty" || code === "BucketNotEmptyException") {
      throw new BucketNotEmptyError(name);
    }
    throw err;
  }
}
