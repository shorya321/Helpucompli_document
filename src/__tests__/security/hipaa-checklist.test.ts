import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F11.4 — doc-rot guard for docs/HIPAA-COMPLIANCE-CHECKLIST.md. This
// test fails when a required HIPAA evidence section is missing. Each
// section maps to a Technical Safeguard the module spec mandates.

const CHECKLIST_PATH = path.resolve(
  __dirname,
  "../../../docs/HIPAA-COMPLIANCE-CHECKLIST.md",
);

function loadChecklist(): string {
  return readFileSync(CHECKLIST_PATH, "utf8");
}

const REQUIRED_SAFEGUARD_ROWS = [
  "Access Control",
  "Audit Controls",
  "Integrity",
  "Transmission Security",
  "Encryption at Rest",
  "Person",
] as const;

const REQUIRED_SECTION_HEADINGS = [
  "Technical Safeguard Mapping",
  "Data Classification",
  "BAA Status",
] as const;

const REQUIRED_EVIDENCE_KEYWORDS = [
  "SSE-KMS",
  "Block Public Access",
  "aws:SecureTransport",
  "Versioning",
  "CloudTrail",
  "MFA",
  "session timeout",
  "no PHI",
] as const;

describe("HIPAA compliance checklist (F11.4)", () => {
  const doc = loadChecklist();

  for (const heading of REQUIRED_SECTION_HEADINGS) {
    it(`contains section heading: ${heading}`, () => {
      expect(doc).toContain(heading);
    });
  }

  for (const row of REQUIRED_SAFEGUARD_ROWS) {
    it(`Technical Safeguard Mapping mentions: ${row}`, () => {
      expect(doc).toContain(row);
    });
  }

  for (const kw of REQUIRED_EVIDENCE_KEYWORDS) {
    it(`cites control evidence keyword: ${kw}`, () => {
      expect(doc.toLowerCase()).toContain(kw.toLowerCase());
    });
  }

  it("cites the s3-buckets.ts implementation path (SSE-KMS, TLS-only, BPA, versioning)", () => {
    expect(doc).toContain("src/lib/s3-buckets.ts");
  });

  it("references the audit_logs append-only triggers (Audit Controls 164.312(b))", () => {
    expect(doc).toContain("audit_logs_no_update");
  });
});
