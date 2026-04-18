#!/usr/bin/env tsx
/**
 * Reads + prints GetBucketCORS for every active bucket. Smoke test
 * that the retrofit landed.
 *
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/verify-cors.ts
 */
import { GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";

async function main() {
  const s3 = getS3Client();
  const buckets = await prisma.bucket.findMany({
    where: { isActive: true },
    select: { name: true },
  });
  for (const b of buckets) {
    try {
      const res = await s3.send(new GetBucketCorsCommand({ Bucket: b.name }));
      // eslint-disable-next-line no-console
      console.log(`--- ${b.name} ---`);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(res.CORSRules, null, 2));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `!! ${b.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
