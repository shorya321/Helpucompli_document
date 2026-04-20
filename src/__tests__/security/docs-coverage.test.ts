import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// F12.6 — doc-set coverage. Asserts every required doc exists +
// covers the required topics.

const ROOT = path.resolve(__dirname, "../../..");
const DOCS = path.join(ROOT, "docs");

function read(rel: string): string {
  const p = path.join(DOCS, rel);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

const REQUIRED_DOCS = [
  "ADMIN-GUIDE.md",
  "API-REFERENCE.md",
  "RUNBOOK.md",
  "INCIDENT-RESPONSE-PLAN.md",
  "HIPAA-COMPLIANCE-CHECKLIST.md",
  "AWS-SECURITY-CONFIG.md",
  "PERFORMANCE-TARGETS.md",
  "E2E-TEST-MATRIX.md",
];

describe("F12.6 required docs exist", () => {
  for (const d of REQUIRED_DOCS) {
    it(`${d} exists`, () => {
      const body = read(d);
      expect(body.length).toBeGreaterThan(100);
    });
  }
});

describe("F12.6 admin guide coverage", () => {
  const g = read("ADMIN-GUIDE.md");
  for (const op of [
    "Create a bucket",
    "Upload a document",
    "Generate a share link",
    "Invite a user",
    "Disable a user",
    "Filter audit logs",
    "Change bucket access",
  ]) {
    it(`documents operation: ${op}`, () => {
      expect(g).toContain(op);
    });
  }
  it("documents all 3 roles", () => {
    expect(g).toMatch(/superadmin[^|]*\|/);
    expect(g).toMatch(/admin[^|]*\|/);
    expect(g).toMatch(/viewer[^|]*\|/);
  });
});

describe("F12.6 API reference coverage", () => {
  const a = read("API-REFERENCE.md");
  for (const path of [
    "/api/health",
    "/api/s3/buckets",
    "/api/s3/upload-url",
    "/api/s3/download-url",
    "/api/policies",
    "/api/links",
    "/api/users",
    "/api/audit",
    "/api/dashboard/stats",
  ]) {
    it(`documents endpoint: ${path}`, () => {
      expect(a).toContain(path);
    });
  }
  it("documents the common response envelope + status code table", () => {
    expect(a).toContain("Common response envelope");
    expect(a).toMatch(/\b401\b[^|]*\|/);
    expect(a).toMatch(/\b429\b[^|]*\|/);
  });
});
