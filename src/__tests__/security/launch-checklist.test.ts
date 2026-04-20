import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F12.7 — doc-rot guard on docs/LAUNCH-CHECKLIST.md. Ensures every
// cutover gate stays present even as individual rows tick.

const DOC = readFileSync(
  path.resolve(__dirname, "../../../docs/LAUNCH-CHECKLIST.md"),
  "utf8",
);

const REQUIRED_GATES = [
  "Code quality gates",
  "E2E gates",
  "Performance gates",
  "Security gates",
  "Infrastructure",
  "Observability",
  "Operations",
  "Product readiness",
  "Sign-off",
];

const REQUIRED_GATE_ITEMS = [
  "CSP",
  "HSTS",
  "rate limiting",
  "DNS",
  "SSL",
  "AWS BAA signed",
  "CloudTrail",
  "KMS key rotation",
  "Sentry",
  "Uptime monitor",
  "Graceful shutdown",
  "Backup strategy",
  "Rollback procedure",
  "On-call rotation",
];

describe("launch checklist (F12.7)", () => {
  for (const gate of REQUIRED_GATES) {
    it(`section present: ${gate}`, () => {
      expect(DOC).toContain(gate);
    });
  }

  for (const item of REQUIRED_GATE_ITEMS) {
    it(`checklist item present: ${item}`, () => {
      expect(DOC).toContain(item);
    });
  }

  it("requires the 4 sign-off rows (Engineering Manager, Security Officer, Product Owner, Legal)", () => {
    for (const role of [
      "Engineering Manager",
      "Security Officer",
      "Product Owner",
      "Legal",
    ]) {
      expect(DOC).toContain(role);
    }
  });

  it("references the post-launch observation window (F12.8)", () => {
    expect(DOC).toContain("F12.8");
    expect(DOC).toContain("48-hour");
  });
});
