import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F12.8 — doc-rot guard for the post-launch observation template.

const DOC = readFileSync(
  path.resolve(__dirname, "../../../docs/POST-LAUNCH-OBSERVATIONS.md"),
  "utf8",
);

describe("post-launch observation template (F12.8)", () => {
  it("covers the pre-cutover dry run", () => {
    expect(DOC).toContain("Pre-cutover dry run");
    expect(DOC).toContain("DNS TTL lowered to 60 s");
  });

  it("enumerates the T+0 smoke run across 11 critical flows", () => {
    for (const flow of [
      "Login via Auth0",
      "Create bucket",
      "Upload document",
      "Download document",
      "Create policy",
      "Generate share link",
      "Invite user",
      "Audit log filter",
      "hard-delete document",
      "Disable user",
    ]) {
      expect(DOC).toContain(flow);
    }
  });

  it("defines 48-hour monitoring buckets (error/perf/auth/infra)", () => {
    expect(DOC).toContain("Error spikes");
    expect(DOC).toContain("Performance");
    expect(DOC).toContain("Auth failures");
    expect(DOC).toContain("Infra health");
  });

  it("references measurable perf thresholds from F12.4", () => {
    expect(DOC).toContain("< 500 ms");
    expect(DOC).toContain("< 1 s");
    expect(DOC).toContain("< 2 s");
  });

  it("ships a 6-shift on-call roster across 48 hours", () => {
    for (const shift of [
      "T+00 to T+08",
      "T+08 to T+16",
      "T+16 to T+24",
      "T+24 to T+32",
      "T+32 to T+40",
      "T+40 to T+48",
    ]) {
      expect(DOC).toContain(shift);
    }
  });

  it("documents rollback readiness checklist", () => {
    expect(DOC).toContain("Rollback readiness check");
    expect(DOC).toMatch(/previous release tag/i);
  });

  it("requires IC + Security Officer + Engineering Manager sign-off", () => {
    for (const role of [
      "Incident Commander",
      "Security Officer",
      "Engineering Manager",
    ]) {
      expect(DOC).toContain(role);
    }
  });
});
