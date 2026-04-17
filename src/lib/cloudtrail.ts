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
  const cfg = loadConfig();
  return new CloudTrailClient({
    region: cfg.AWS_REGION,
    credentials: {
      accessKeyId: cfg.AWS_ACCESS_KEY_ID,
      secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY,
    },
  });
}

export function getCloudTrailClient(): CloudTrailClient {
  if (globalForCloudTrail.cloudTrail) return globalForCloudTrail.cloudTrail;
  const client = buildCloudTrailClient();
  if (process.env.NODE_ENV !== "production") {
    globalForCloudTrail.cloudTrail = client;
  }
  return client;
}
