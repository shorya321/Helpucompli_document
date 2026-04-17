import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { loadConfig } from "./config";

export type { CloudTrailClient };

// Mirrors src/lib/s3.ts: singleton cached on globalThis in dev/test so
// Next.js HMR does not construct a fresh client on every reload.
// Production skips the cache so the SDK's default credential provider
// chain refreshes IAM role credentials per process lifetime.

const globalForCloudTrail = globalThis as unknown as {
  cloudTrail?: CloudTrailClient;
};

function buildCloudTrailClient(): CloudTrailClient {
  // Region only — credentials resolved by the SDK default provider chain
  // (matches src/lib/s3.ts). Keeps IAM role refresh behaviour consistent
  // across both SDK clients.
  const cfg = loadConfig();
  return new CloudTrailClient({ region: cfg.AWS_REGION });
}

export function getCloudTrailClient(): CloudTrailClient {
  if (globalForCloudTrail.cloudTrail) return globalForCloudTrail.cloudTrail;
  const client = buildCloudTrailClient();
  if (process.env.NODE_ENV !== "production") {
    globalForCloudTrail.cloudTrail = client;
  }
  return client;
}
