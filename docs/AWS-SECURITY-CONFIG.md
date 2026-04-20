# AWS Security Configuration

Tenant-level AWS controls that back the application's HIPAA posture. Provisioning steps live here because they are infrastructure-owned, not code-owned — `terraform/` or a manual runbook applies them. Every row in `docs/HIPAA-COMPLIANCE-CHECKLIST.md` that lists an AWS service traces back here.

---

## 1. CloudTrail — Data Events on document buckets (F11.6 / §164.312(b))

**Why:** Management events alone do not capture object-level reads/writes. Without data events, a presigned-URL download has no AWS-side audit row — we only see it in `audit_logs`.

**Apply (AWS CLI):**

```bash
TRAIL_NAME="$AWS_CLOUDTRAIL_NAME"      # from src/lib/config.ts
BUCKETS=$(aws s3api list-buckets \
  --query "Buckets[?starts_with(Name, 'helpucompli-docs-')].Name" \
  --output text)

aws cloudtrail put-event-selectors \
  --trail-name "$TRAIL_NAME" \
  --event-selectors "$(cat <<JSON
[
  {
    "ReadWriteType": "All",
    "IncludeManagementEvents": true,
    "DataResources": [
      {
        "Type": "AWS::S3::Object",
        "Values": [$(printf '"arn:aws:s3:::%s/"\n' $BUCKETS | paste -sd, -)]
      }
    ]
  }
]
JSON
)"
```

**Verify:**
- `aws cloudtrail get-event-selectors --trail-name "$TRAIL_NAME"` returns `DataResources` containing every document bucket ARN.
- CloudTrail Lake or S3 log bucket receives `s3.amazonaws.com` `GetObject` / `PutObject` events within 15 minutes of a test upload.

## 2. GuardDuty — account-wide threat detection

```bash
aws guardduty create-detector --enable --finding-publishing-frequency FIFTEEN_MINUTES
```

**Verify:**
- `aws guardduty list-detectors` returns a detector id.
- Findings stream to EventBridge → Slack alerts channel.

## 3. AWS Config Rules — bucket compliance drift

Enable the following managed rules (terraform or Config console):

| Rule | Purpose |
|------|---------|
| `s3-bucket-server-side-encryption-enabled` | Fail-fast if SSE off on any doc bucket |
| `s3-bucket-public-read-prohibited` | Block-public-access drift |
| `s3-bucket-public-write-prohibited` | Block-public-access drift |
| `s3-bucket-versioning-enabled` | Versioning drift |
| `s3-bucket-ssl-requests-only` | `aws:SecureTransport` policy drift |
| `s3-bucket-logging-enabled` | Access-log bucket active |

**Verify:** `aws configservice describe-compliance-by-config-rule` — every rule returns `COMPLIANT`.

## 4. S3 Access Analyzer

```bash
aws accessanalyzer create-analyzer --analyzer-name helpucompli-prod --type ACCOUNT
```

**Verify:** `aws accessanalyzer list-findings --analyzer-arn <arn>` returns 0 `ACTIVE` findings for S3 resources. Any finding against a `helpucompli-docs-*` bucket is a P1 incident.

## 5. Amazon Macie — PHI/PII discovery (defense-in-depth)

Platform policy is **no PHI collected**; Macie is the canary.

```bash
aws macie2 enable-macie
aws macie2 create-classification-job \
  --job-type ONE_TIME \
  --name "helpucompli-phi-canary" \
  --s3-job-definition "$(cat <<JSON
{"bucketDefinitions":[{"accountId":"$AWS_ACCOUNT_ID","buckets":$BUCKET_JSON}]}
JSON
)"
```

**Verify:** Any PHI finding (SSN, MRN, financial identifiers) triggers an EventBridge alert. First finding = RCA: upstream input validation regression.

## 6. CloudWatch Alarms

Provision alarms for each of the following, routed to the on-call SNS topic:

| Alarm | Source metric | Threshold |
|-------|---------------|-----------|
| `unauthorized-api-calls` | `AWS/CloudTrail` `UnauthorizedAPICall` | ≥ 1 in 5 min |
| `failed-console-logins` | CloudWatch metric filter on CloudTrail `ConsoleLogin` with `errorMessage = "Failed authentication"` | ≥ 3 in 5 min |
| `s3-policy-changes` | CloudTrail metric filter `PutBucketPolicy` / `DeleteBucketPolicy` on `helpucompli-docs-*` | ≥ 1 in 1 min |
| `iam-role-mutations` | CloudTrail metric filter `AttachRolePolicy` / `DetachRolePolicy` / `DeleteRole` | ≥ 1 in 1 min |
| `kms-disable-or-delete` | CloudTrail metric filter `DisableKey` / `ScheduleKeyDeletion` | ≥ 1 in 1 min |

**Test procedure:** Run a harmless `aws iam attach-role-policy` against a dedicated sandbox role while watching the SNS subscription; expect an alert within 5 minutes.

## 7. KMS Key Rotation

- Per-tenant CMK used for SSE-KMS on `helpucompli-docs-*` MUST have automatic rotation enabled.

```bash
aws kms enable-key-rotation --key-id "$AWS_KMS_KEY_ID"
```

**Verify:** `aws kms get-key-rotation-status --key-id "$AWS_KMS_KEY_ID"` → `KeyRotationEnabled: true`.

## 8. IAM Baseline

- No long-lived access keys for human users — only federated SSO via Auth0 → IAM Identity Center.
- Service accounts (CI, application) rotate keys quarterly.
- `docs/IAM-POLICIES.md` is the authoritative policy catalog.

---

## Ownership + Cadence

| Activity | Owner | Cadence |
|----------|-------|---------|
| Review CloudTrail event selectors | Infra | Monthly |
| Review GuardDuty findings | Security | Weekly |
| Review Config rule compliance | Infra | Weekly |
| Review Access Analyzer findings | Security | Weekly |
| Run Macie scan | Security | Monthly |
| Audit CloudWatch alarm subscriptions | Infra | Quarterly |
| Rotate service-account access keys | Infra | Quarterly |
| Validate KMS rotation status | Infra | Quarterly |
| Full drill (trigger alarm + verify SNS) | Security | Quarterly |

All drill artifacts (screenshots, SNS message ids) attach to the corresponding quarterly compliance review.
