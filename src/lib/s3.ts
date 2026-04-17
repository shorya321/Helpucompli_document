import { S3Client } from "@aws-sdk/client-s3";
import { loadConfig } from "./config";

export type { S3Client };

// Deployment assumption: long-lived Node.js process (EC2/ECS/Vercel Node
// runtime). globalThis cache deduplicates the S3Client across Next.js HMR in
// dev. The module-level `s3Client` const provides the production singleton
// guarantee via Node's module cache (single evaluation), matching the
// prisma.ts pattern. For isolate-per-request runtimes (Lambda, Edge),
// revisit this strategy so IAM role credentials refresh per invocation.

const globalForS3 = globalThis as unknown as { s3?: S3Client };

function buildClient(): S3Client {
  // loadConfig (uncached) validates env at boot. We only pass `region`
  // explicitly — credentials are resolved by the SDK default provider
  // chain (env → shared config → ECS task role → EC2 IMDSv2). This lets
  // IAM-role-based deployments refresh session credentials automatically
  // and still works for local dev via AWS_ACCESS_KEY_ID / AWS_SECRET_*
  // env vars.
  // Ref: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html
  const cfg = loadConfig();
  return new S3Client({ region: cfg.AWS_REGION });
}

export function getS3Client(): S3Client {
  if (globalForS3.s3) return globalForS3.s3;
  const client = buildClient();
  if (process.env.NODE_ENV !== "production") {
    globalForS3.s3 = client;
  }
  return client;
}

export interface SseKmsParams {
  ServerSideEncryption: "aws:kms";
  SSEKMSKeyId: string;
  // literal `true`: every SSE-KMS payload must enable Bucket Keys (cost
  // control + CloudTrail audit parity). Constructing a param object with
  // BucketKeyEnabled=false is a type error, not a runtime bug.
  BucketKeyEnabled: true;
}

// HIPAA §164.312(a)(2)(iv) — encryption of ePHI at rest. Every Put/Copy/
// CreateMultipartUpload request MUST carry these headers so S3 encrypts
// with the customer-managed CMK (not the AWS-managed alias).
// BucketKeyEnabled cuts KMS API costs ~99% while preserving the CMK audit
// trail on CloudTrail (GenerateDataKey logged per bucket-key, not per
// object).
export function sseKmsParams(): SseKmsParams {
  return {
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: loadConfig().AWS_KMS_KEY_ID,
    BucketKeyEnabled: true,
  };
}

export function withSseKms<T extends object>(
  input: Readonly<T>,
): T & SseKmsParams {
  // Spread input first, KMS params last — so a caller cannot downgrade
  // ServerSideEncryption to 'AES256' or swap SSEKMSKeyId to a foreign CMK.
  return { ...input, ...sseKmsParams() };
}
