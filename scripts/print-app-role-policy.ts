#!/usr/bin/env tsx
/**
 * Prints the IAM app-role policy JSON so it can be pasted into the
 * AWS IAM console (policy name: helpucompli-docs-policy). Re-run after
 * src/lib/iam-policies.ts changes.
 *
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/print-app-role-policy.ts
 */
import { buildAppRolePolicy } from "@/lib/iam-policies";
import { getConfig } from "@/lib/config";

function main() {
  const cfg = getConfig();
  const kmsKeyArn = cfg.AWS_KMS_KEY_ID;
  // Synthetic CloudTrail ARN — if AWS_CLOUDTRAIL_NAME is unset, the
  // policy still needs SOME ARN for the statement. Deploy runbook:
  // replace with real trail ARN before pushing to AWS.
  const cloudTrailArn = cfg.AWS_CLOUDTRAIL_NAME
    ? `arn:aws:cloudtrail:${cfg.AWS_REGION}:*:trail/${cfg.AWS_CLOUDTRAIL_NAME}`
    : "arn:aws:cloudtrail:*:*:trail/REPLACE_WITH_TRAIL_NAME";
  const policy = buildAppRolePolicy({ kmsKeyArn, cloudTrailArn });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(policy, null, 2));
}

main();
