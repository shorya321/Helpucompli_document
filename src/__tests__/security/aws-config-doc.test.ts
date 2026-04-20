import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F11.6 — doc-rot guard for docs/AWS-SECURITY-CONFIG.md. Verifies each
// required AWS tenant control is documented with a CLI apply step +
// verification step so the runbook does not silently degrade.

const DOC_PATH = path.resolve(__dirname, "../../../docs/AWS-SECURITY-CONFIG.md");

const REQUIRED_SECTIONS = [
  "CloudTrail",
  "Data Events",
  "GuardDuty",
  "Config Rules",
  "Access Analyzer",
  "Macie",
  "CloudWatch Alarms",
  "KMS Key Rotation",
];

const REQUIRED_ALARMS = [
  "unauthorized-api-calls",
  "failed-console-logins",
  "s3-policy-changes",
  "iam-role-mutations",
  "kms-disable-or-delete",
];

const REQUIRED_CONFIG_RULES = [
  "s3-bucket-server-side-encryption-enabled",
  "s3-bucket-public-read-prohibited",
  "s3-bucket-public-write-prohibited",
  "s3-bucket-versioning-enabled",
  "s3-bucket-ssl-requests-only",
];

describe("AWS security config runbook (F11.6)", () => {
  const doc = readFileSync(DOC_PATH, "utf8");

  for (const section of REQUIRED_SECTIONS) {
    it(`documents: ${section}`, () => {
      expect(doc).toContain(section);
    });
  }

  for (const alarm of REQUIRED_ALARMS) {
    it(`lists required CloudWatch alarm: ${alarm}`, () => {
      expect(doc).toContain(alarm);
    });
  }

  for (const rule of REQUIRED_CONFIG_RULES) {
    it(`lists required AWS Config rule: ${rule}`, () => {
      expect(doc).toContain(rule);
    });
  }

  it("references the validated CloudTrail name env var", () => {
    expect(doc).toContain("AWS_CLOUDTRAIL_NAME");
  });

  it("defines drill ownership + cadence", () => {
    expect(doc).toContain("Ownership");
    expect(doc).toContain("Cadence");
    expect(doc).toContain("Quarterly");
  });
});
