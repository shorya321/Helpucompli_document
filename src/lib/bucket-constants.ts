// Client-safe constants — no server-only imports (AWS SDK, Prisma).
// Both the `bucket-create` orchestrator (server) and the
// `CreateBucketDialog` form (client) import from here.

export const HIPAA_BUCKET_NAME_PREFIX = "helpucompli-docs-";

export const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
] as const;

export type AwsRegion = (typeof AWS_REGIONS)[number];

// S3 bucket naming subset we enforce. Same regex as
// s3-buckets.ts:BUCKET_NAME_RE — kept in sync so the client form and
// the server Zod schema never diverge.
export const BUCKET_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
