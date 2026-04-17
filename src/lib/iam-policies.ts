// Canonical IAM policy documents for the HelpUcompli document repository.
// Exported as runtime values so they can be validated by unit tests
// AND emitted verbatim by deploy tooling (CDK / Terraform / aws cli)
// without documentation drift.
//
// Role: helpucompli-docs-app-role
//   Attached to the Next.js runtime (ECS task role / Vercel role ARN /
//   EC2 instance profile). Least-privilege surface: read/write/delete
//   objects in the helpucompli-docs-* bucket family, list bucket
//   contents, decrypt/generate data keys with the document CMK,
//   enumerate + update CloudTrail event selectors for the trail that
//   receives document-bucket data events.
//
// NEVER grant: s3:PutBucketPolicy, s3:DeleteBucketPolicy,
// s3:PutBucketAcl, iam:*, kms:CreateKey, kms:ScheduleKeyDeletion,
// cloudtrail:CreateTrail, cloudtrail:DeleteTrail. Those live in the
// deploy / break-glass role, not the app role.

export interface IamStatement {
  Sid: string;
  Effect: "Allow" | "Deny";
  // Principal is required on resource-based policies (bucket / KMS key
  // policies). Optional on identity-based (IAM role) policies — an
  // undefined Principal there means "this role".
  Principal?: string | { AWS: string | string[] };
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

export interface IamPolicyDocument {
  Version: "2012-10-17";
  Statement: IamStatement[];
}

export const BUCKET_ARN_PATTERN = "arn:aws:s3:::helpucompli-docs-*";
export const BUCKET_OBJECTS_ARN_PATTERN = "arn:aws:s3:::helpucompli-docs-*/*";

export function buildAppRolePolicy(args: {
  kmsKeyArn: string;
  cloudTrailArn: string;
}): IamPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "S3ObjectReadWrite",
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
          "s3:RestoreObject",
        ],
        Resource: BUCKET_OBJECTS_ARN_PATTERN,
      },
      {
        Sid: "S3BucketReadAndHipaaProvisioning",
        Effect: "Allow",
        Action: [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:ListBucket",
          "s3:ListBucketVersions",
          "s3:ListBucketMultipartUploads",
          "s3:GetBucketLocation",
          "s3:GetBucketVersioning",
          "s3:PutBucketVersioning",
          "s3:GetBucketEncryption",
          "s3:PutBucketEncryption",
          "s3:GetBucketLogging",
          "s3:PutBucketLogging",
          "s3:GetPublicAccessBlock",
          "s3:PutPublicAccessBlock",
          "s3:GetBucketOwnershipControls",
          "s3:PutBucketOwnershipControls",
          "s3:PutBucketPolicy",
          "s3:GetBucketPolicy",
        ],
        Resource: BUCKET_ARN_PATTERN,
      },
      {
        Sid: "S3ListAllMyBucketsForAdminUI",
        Effect: "Allow",
        Action: "s3:ListAllMyBuckets",
        // ListAllMyBuckets only accepts '*' — scoped by the list
        // response filter in listHipaaBuckets (F3.2). Carry-forward
        // F5.1: add DB-side filter to show only managed buckets to
        // admin UI.
        Resource: "*",
      },
      {
        Sid: "KmsDocumentCmkUsage",
        Effect: "Allow",
        Action: ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
        Resource: args.kmsKeyArn,
      },
      {
        Sid: "CloudTrailDataEventWiring",
        Effect: "Allow",
        Action: [
          "cloudtrail:GetEventSelectors",
          "cloudtrail:PutEventSelectors",
        ],
        Resource: args.cloudTrailArn,
      },
      {
        Sid: "DenyLoggingBucketMutation",
        Effect: "Deny",
        // The access-logs bucket name matches helpucompli-docs-* (see
        // docs/IAM-POLICIES.md). Explicitly deny the app role from
        // ever reconfiguring that bucket's own logging destination —
        // otherwise a compromised runtime could silently redirect the
        // audit trail to an attacker-controlled bucket.
        Action: ["s3:PutBucketLogging", "s3:DeleteBucketLogging"],
        Resource: "arn:aws:s3:::helpucompli-docs-access-logs",
      },
      {
        Sid: "DenyBucketAclMutation",
        Effect: "Deny",
        // Defense in depth: even with the broad s3:* not granted, be
        // explicit — BucketOwnerEnforced (F3.2) means ACLs are already
        // disabled, but deny the write path outright so an accidental
        // policy widening cannot re-enable ACL attack surface.
        Action: ["s3:PutBucketAcl", "s3:PutObjectAcl"],
        Resource: [BUCKET_ARN_PATTERN, BUCKET_OBJECTS_ARN_PATTERN],
      },
      {
        Sid: "DenyKmsLifecycle",
        Effect: "Deny",
        Action: [
          "kms:CreateKey",
          "kms:ScheduleKeyDeletion",
          "kms:CancelKeyDeletion",
          "kms:DisableKey",
          "kms:PutKeyPolicy",
          "kms:CreateGrant",
          "kms:RevokeGrant",
        ],
        Resource: "*",
      },
      {
        Sid: "DenyIamAndCloudTrailAdmin",
        Effect: "Deny",
        // Narrow to IAM write surface only — a blanket iam:* Deny
        // blocks implicit iam:GetRole / iam:ListRoles that some SDK
        // clients issue when resolving role ARNs for CloudTrail wiring.
        Action: [
          "iam:Create*",
          "iam:Delete*",
          "iam:Attach*",
          "iam:Detach*",
          "iam:Put*",
          "iam:Update*",
          "iam:PassRole",
          "cloudtrail:CreateTrail",
          "cloudtrail:DeleteTrail",
          "cloudtrail:StartLogging",
          "cloudtrail:StopLogging",
          "cloudtrail:UpdateTrail",
        ],
        Resource: "*",
      },
    ],
  };
}

// Bucket policy applied by createHipaaBucket (F3.2). Re-exported here
// so deploy tooling / audit scripts can validate the exact contents
// without reaching into s3-buckets.ts.
export function buildHipaaBucketPolicy(bucket: string): IamPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "DenyNonHttps",
        Effect: "Deny",
        // Bucket policies are resource-based — Principal is REQUIRED
        // in the JSON sent to AWS; "*" blanket-denies every requester
        // (including the bucket owner) that talks over non-HTTPS.
        Principal: "*",
        Action: "s3:*",
        Resource: [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/*`,
        ],
        Condition: { Bool: { "aws:SecureTransport": "false" } },
      },
    ],
  };
}

// KMS key policy for the document-encryption CMK. Uses the AWS-
// recommended pattern of scoping access via the Principal field
// (resource-based policy) rather than Condition keys — the
// Condition-based approach is unreliable for KMS key policies
// because role-session ARNs don't always match aws:PrincipalArn.
export function buildDocumentKmsKeyPolicy(args: {
  awsAccountId: string;
  appRoleArn: string;
}): IamPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "RootAccountFullControl",
        Effect: "Allow",
        // AWS-canonical root break-glass pattern — scope is enforced
        // via the Principal field, not a Condition. The account root
        // is trusted to further delegate via IAM policies.
        Principal: { AWS: `arn:aws:iam::${args.awsAccountId}:root` },
        Action: "kms:*",
        Resource: "*",
      },
      {
        Sid: "AppRoleEncryptDecrypt",
        Effect: "Allow",
        // Scope to the role ARN directly via Principal — this also
        // matches any session-role assumed from this role, which the
        // aws:PrincipalArn Condition key does NOT reliably do.
        Principal: { AWS: args.appRoleArn },
        Action: ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
        Resource: "*",
      },
    ],
  };
}
