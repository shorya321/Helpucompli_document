import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F11.9 — doc-rot guard for docs/INCIDENT-RESPONSE-PLAN.md.

const DOC = readFileSync(
  path.resolve(__dirname, "../../../docs/INCIDENT-RESPONSE-PLAN.md"),
  "utf8",
);

const REQUIRED_SECTIONS = [
  "Severity Scale",
  "Detection",
  "Containment",
  "Notification",
  "Post-Incident Review",
  "Ownership",
];

const REQUIRED_SEVERITIES = ["P0", "P1", "P2", "P3"];

const REQUIRED_CONTAINMENT_CLASSES = [
  "Compromised credential",
  "Compromised Auth0 user",
  "Public bucket policy",
  "ePHI exposure",
  "Denial of service",
];

describe("Incident response plan (F11.9)", () => {
  for (const s of REQUIRED_SECTIONS) {
    it(`documents section: ${s}`, () => {
      expect(DOC).toContain(s);
    });
  }

  for (const sev of REQUIRED_SEVERITIES) {
    it(`defines severity level: ${sev}`, () => {
      expect(DOC).toContain(sev);
    });
  }

  for (const c of REQUIRED_CONTAINMENT_CLASSES) {
    it(`defines containment class: ${c}`, () => {
      expect(DOC).toContain(c);
    });
  }

  it("cites the HIPAA 60-day breach-notification clock", () => {
    expect(DOC).toContain("60-day");
    expect(DOC).toContain("164.400");
  });

  it("cites the HHS annual < 500-individual filing deadline (March 1)", () => {
    expect(DOC).toContain("March 1");
  });

  it("defines drill cadence + tabletop rotation", () => {
    expect(DOC).toMatch(/Tabletop/i);
    expect(DOC).toMatch(/Semi-annually|Annually/i);
  });

  it("references the app-level user block path (F10.6)", () => {
    expect(DOC).toContain("blocked: true");
  });

  it("references the on-call ack SLA for P0/P1", () => {
    expect(DOC).toMatch(/15 minutes/);
  });
});
