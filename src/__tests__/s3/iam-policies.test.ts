import { describe, expect, it } from "vitest";
import {
  BUCKET_ARN_PATTERN,
  BUCKET_OBJECTS_ARN_PATTERN,
  buildAppRolePolicy,
  buildDocumentKmsKeyPolicy,
  buildHipaaBucketPolicy,
  type IamStatement,
} from "@/lib/iam-policies";

const KMS_ARN = "arn:aws:kms:us-east-1:123456789012:key/abcd-1234";
const TRAIL_ARN = "arn:aws:cloudtrail:us-east-1:123456789012:trail/helpucompli";
const ROLE_ARN = "arn:aws:iam::123456789012:role/helpucompli-docs-app-role";

function statement(policy: { Statement: IamStatement[] }, sid: string): IamStatement {
  const s = policy.Statement.find((st) => st.Sid === sid);
  if (!s) throw new Error(`Missing statement ${sid}`);
  return s;
}

function actions(s: IamStatement): string[] {
  return Array.isArray(s.Action) ? s.Action : [s.Action];
}

describe("F3.6 — app role policy (helpucompli-docs-app-role)", () => {
  const policy = buildAppRolePolicy({ kmsKeyArn: KMS_ARN, cloudTrailArn: TRAIL_ARN });

  it("uses the canonical IAM Version", () => {
    expect(policy.Version).toBe("2012-10-17");
  });

  it("scopes S3 object actions to helpucompli-docs-*/*", () => {
    const s = statement(policy, "S3ObjectReadWrite");
    expect(s.Effect).toBe("Allow");
    expect(s.Resource).toBe(BUCKET_OBJECTS_ARN_PATTERN);
    const a = actions(s);
    expect(a).toContain("s3:GetObject");
    expect(a).toContain("s3:PutObject");
    expect(a).toContain("s3:DeleteObject");
    expect(a).toContain("s3:AbortMultipartUpload");
  });

  it("scopes S3 bucket-level actions to helpucompli-docs-*", () => {
    const s = statement(policy, "S3BucketReadAndHipaaProvisioning");
    expect(s.Resource).toBe(BUCKET_ARN_PATTERN);
    const a = actions(s);
    expect(a).toContain("s3:ListBucket");
    expect(a).toContain("s3:GetBucketLocation");
    expect(a).toContain("s3:PutBucketEncryption");
    expect(a).toContain("s3:PutBucketVersioning");
    expect(a).toContain("s3:PutPublicAccessBlock");
    expect(a).toContain("s3:PutBucketOwnershipControls");
    expect(a).toContain("s3:PutBucketPolicy");
    expect(a).toContain("s3:PutBucketLogging");
  });

  it("scopes KMS usage to the configured document CMK only", () => {
    const s = statement(policy, "KmsDocumentCmkUsage");
    expect(s.Resource).toBe(KMS_ARN);
    const a = actions(s);
    expect(a).toEqual(
      expect.arrayContaining(["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]),
    );
  });

  it("scopes CloudTrail selector API to the configured trail only", () => {
    const s = statement(policy, "CloudTrailDataEventWiring");
    expect(s.Resource).toBe(TRAIL_ARN);
    const a = actions(s);
    expect(a).toEqual(
      expect.arrayContaining([
        "cloudtrail:GetEventSelectors",
        "cloudtrail:PutEventSelectors",
      ]),
    );
  });

  it("explicitly DENIES bucket/object ACL writes (BucketOwnerEnforced defense-in-depth)", () => {
    const s = statement(policy, "DenyBucketAclMutation");
    expect(s.Effect).toBe("Deny");
    const a = actions(s);
    expect(a).toContain("s3:PutBucketAcl");
    expect(a).toContain("s3:PutObjectAcl");
  });

  it("explicitly DENIES KMS lifecycle + grant mutations", () => {
    const s = statement(policy, "DenyKmsLifecycle");
    expect(s.Effect).toBe("Deny");
    const a = actions(s);
    expect(a).toContain("kms:ScheduleKeyDeletion");
    expect(a).toContain("kms:CreateKey");
    expect(a).toContain("kms:PutKeyPolicy");
    expect(a).toContain("kms:DisableKey");
  });

  it("explicitly DENIES IAM write actions and CloudTrail trail-lifecycle actions", () => {
    const s = statement(policy, "DenyIamAndCloudTrailAdmin");
    expect(s.Effect).toBe("Deny");
    const a = actions(s);
    // Narrowed from iam:* to the write surface so implicit iam:GetRole
    // / iam:ListRoles reads are still permitted.
    expect(a).toContain("iam:Create*");
    expect(a).toContain("iam:Delete*");
    expect(a).toContain("iam:Put*");
    expect(a).toContain("iam:PassRole");
    expect(a).not.toContain("iam:*");
    expect(a).toContain("cloudtrail:CreateTrail");
    expect(a).toContain("cloudtrail:DeleteTrail");
    expect(a).toContain("cloudtrail:StopLogging");
  });

  it("explicitly DENIES logging reconfiguration on the access-logs bucket itself", () => {
    const s = statement(policy, "DenyLoggingBucketMutation");
    expect(s.Effect).toBe("Deny");
    expect(s.Resource).toBe("arn:aws:s3:::helpucompli-docs-access-logs");
    const a = actions(s);
    expect(a).toContain("s3:PutBucketLogging");
    expect(a).toContain("s3:DeleteBucketLogging");
  });

  it("does NOT grant any Allow action outside the scoped resources", () => {
    const allowAll = policy.Statement.filter(
      (s) => s.Effect === "Allow" && s.Resource === "*",
    );
    // The only `Resource: "*"` Allow is ListAllMyBuckets (unavoidable —
    // AWS only accepts '*' for this action).
    expect(allowAll).toHaveLength(1);
    expect(allowAll[0].Sid).toBe("S3ListAllMyBucketsForAdminUI");
    expect(allowAll[0].Action).toBe("s3:ListAllMyBuckets");
  });

  it("does not grant IAM write permissions via any Allow statement", () => {
    const allAllowActions = policy.Statement.filter((s) => s.Effect === "Allow").flatMap(
      actions,
    );
    expect(allAllowActions.every((a) => !a.startsWith("iam:"))).toBe(true);
  });

  it("does not grant broad s3:* anywhere in an Allow statement", () => {
    const allAllowActions = policy.Statement.filter((s) => s.Effect === "Allow").flatMap(
      actions,
    );
    expect(allAllowActions).not.toContain("s3:*");
  });
});

describe("F3.6 — bucket policy builder matches F3.2 runtime output", () => {
  it("produces DenyNonHttps with Principal '*' and aws:SecureTransport=false", () => {
    const policy = buildHipaaBucketPolicy("helpucompli-docs-acme");
    const s = statement(policy, "DenyNonHttps");
    expect(s.Effect).toBe("Deny");
    expect(s.Principal).toBe("*");
    expect(s.Action).toBe("s3:*");
    expect(s.Condition).toEqual({ Bool: { "aws:SecureTransport": "false" } });
    expect(s.Resource).toEqual([
      "arn:aws:s3:::helpucompli-docs-acme",
      "arn:aws:s3:::helpucompli-docs-acme/*",
    ]);
  });
});

describe("F3.6 — KMS key policy (Principal-based scope, not Condition-based)", () => {
  const policy = buildDocumentKmsKeyPolicy({
    awsAccountId: "123456789012",
    appRoleArn: ROLE_ARN,
  });

  it("root break-glass uses Principal: arn:aws:iam::<account>:root (AWS-canonical)", () => {
    const s = statement(policy, "RootAccountFullControl");
    expect(s.Effect).toBe("Allow");
    expect(s.Action).toBe("kms:*");
    expect(s.Principal).toEqual({ AWS: "arn:aws:iam::123456789012:root" });
    // Critical: scope MUST be via Principal, not Condition
    expect(s.Condition).toBeUndefined();
  });

  it("app-role grant uses Principal: <roleArn> and only encrypt/decrypt/describe", () => {
    const s = statement(policy, "AppRoleEncryptDecrypt");
    expect(s.Effect).toBe("Allow");
    expect(s.Principal).toEqual({ AWS: ROLE_ARN });
    // Critical: scope MUST be via Principal field, not aws:PrincipalArn Condition
    expect(s.Condition).toBeUndefined();
    const a = actions(s);
    expect(a).toEqual(
      expect.arrayContaining(["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]),
    );
    expect(a).not.toContain("kms:*");
    expect(a).not.toContain("kms:CreateGrant");
    expect(a).not.toContain("kms:ScheduleKeyDeletion");
  });
});
