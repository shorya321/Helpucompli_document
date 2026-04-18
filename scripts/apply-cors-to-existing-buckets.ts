#!/usr/bin/env tsx
/**
 * One-shot retrofit: apply the HIPAA CORS policy to every active bucket
 * in the database. Idempotent — PutBucketCors is a replace op, so
 * re-running is safe.
 *
 * Run with:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/apply-cors-to-existing-buckets.ts
 */
import { PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { buildHipaaCorsConfiguration } from "@/lib/s3-buckets";
import { getConfig } from "@/lib/config";

async function main() {
  const cfg = getConfig();
  const s3 = getS3Client();
  const cors = buildHipaaCorsConfiguration(cfg.APP_BASE_URL);

  const buckets = await prisma.bucket.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (buckets.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No active buckets found.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Applying CORS (AllowedOrigins=${cfg.APP_BASE_URL}) to ${buckets.length} bucket(s)…`,
  );

  let ok = 0;
  let failed = 0;
  for (const b of buckets) {
    try {
      await s3.send(
        new PutBucketCorsCommand({
          Bucket: b.name,
          CORSConfiguration: cors,
        }),
      );
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${b.name}`);
      ok += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(
        `  ✗ ${b.name} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Done. ${ok} succeeded, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);
  process.exit(1);
});
