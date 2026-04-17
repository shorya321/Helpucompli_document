import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutBucketEncryptionCommand,
  PutBucketLoggingCommand,
  PutBucketOwnershipControlsCommand,
  PutBucketPolicyCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import {
  type EventSelector,
  GetEventSelectorsCommand,
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
    ],
  });
}

// Merge a bucket's object-level ARN into an existing CloudTrail selector
// list WITHOUT wiping previously registered buckets. Returns a new array
// so tests can diff against input (immutability preserved).
export function mergeBucketIntoSelectors(
  existing: ReadonlyArray<EventSelector> | undefined,
  bucketArn: string,
): EventSelector[] {
  const selectors: EventSelector[] = (existing ?? []).map((s) => ({
    ...s,
    DataResources: s.DataResources?.map((r) => ({ ...r, Values: [...(r.Values ?? [])] })),
  }));

  const s3Selector = selectors.find((s) =>
    s.DataResources?.some((r) => r.Type === "AWS::S3::Object"),
  );
  if (s3Selector?.DataResources) {
    const dr = s3Selector.DataResources.find((r) => r.Type === "AWS::S3::Object");
    if (dr) {
      const values = dr.Values ?? [];
      if (!values.includes(bucketArn)) dr.Values = [...values, bucketArn];
    }
  } else {
    selectors.push({
      ReadWriteType: "All",
      IncludeManagementEvents: false,
      DataResources: [{ Type: "AWS::S3::Object", Values: [bucketArn] }],
    });
  }
  return selectors;
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
//   7. PutBucketPolicy — deny aws:SecureTransport=false.
//   8. CloudTrail: read-modify-write event selectors via
//      GetEventSelectors + PutEventSelectors so we APPEND this bucket's
//      object-ARN to the existing trail selector list (never replace).
//
// If any step 2–7 fails, we attempt a best-effort DeleteBucket rollback
// so a half-configured (possibly unencrypted / HTTP-open) bucket cannot
// be consumed by downstream callers. Rollback failure is logged to
// console.warn with an explicit manual-cleanup message.
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
  } catch (err) {
    // best-effort rollback
    try {
      await s3.send(new DeleteBucketCommand({ Bucket }));
    } catch (deleteErr) {
      // Rollback DeleteBucket fails when the bucket already has objects
      // written between CreateBucket and the failure (unlikely but not
      // impossible). Signal loudly; ops runbook must reconcile.
      console.warn(
        `[s3-buckets] createHipaaBucket rollback FAILED for '${Bucket}'. ` +
          `Bucket exists in AWS without full HIPAA controls. ` +
          `Manual remediation required. Rollback error: ` +
          (deleteErr instanceof Error ? deleteErr.message : String(deleteErr)),
      );
    }
    throw err;
  }

  let cloudTrailConfigured = false;
  if (cfg.AWS_CLOUDTRAIL_NAME) {
    const trail = getCloudTrailClient();
    const existing = await trail.send(
      new GetEventSelectorsCommand({ TrailName: cfg.AWS_CLOUDTRAIL_NAME }),
    );
    const merged = mergeBucketIntoSelectors(
      existing.EventSelectors,
      `arn:aws:s3:::${Bucket}/`,
    );
    await trail.send(
      new PutEventSelectorsCommand({
        TrailName: cfg.AWS_CLOUDTRAIL_NAME,
        EventSelectors: merged,
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
