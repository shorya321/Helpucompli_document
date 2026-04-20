import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// F12.3 — lock in the E2E matrix doc + current smoke spec contract.

const ROOT = path.resolve(__dirname, "../../..");
const MATRIX = readFileSync(
  path.join(ROOT, "docs/E2E-TEST-MATRIX.md"),
  "utf8",
);
const SMOKE = existsSync(path.join(ROOT, "e2e/smoke.spec.ts"))
  ? readFileSync(path.join(ROOT, "e2e/smoke.spec.ts"), "utf8")
  : "";

const REQUIRED_JOURNEYS = [
  "Login via Auth0",
  "Create bucket",
  "Upload document",
  "Download document",
  "Create policy",
  "Generate link",
  "Invite user",
  "Audit log",
  "Hard delete document",
  "Disable user",
];

describe("E2E matrix (F12.3)", () => {
  for (const j of REQUIRED_JOURNEYS) {
    it(`documents critical flow: ${j}`, () => {
      expect(MATRIX).toContain(j);
    });
  }

  it("defines fixture strategy + CI integration", () => {
    expect(MATRIX).toContain("Auth0 storageState");
    expect(MATRIX).toContain("AWS sandbox");
    expect(MATRIX).toContain("CI integration");
  });

  it("defines F12.7 launch readiness criteria", () => {
    expect(MATRIX).toContain("Launch readiness criteria");
    expect(MATRIX).toContain("green for 3 consecutive builds");
  });
});

describe("E2E smoke spec (F12.3)", () => {
  it("exists", () => {
    expect(SMOKE).not.toBe("");
  });

  it("covers /api/health", () => {
    expect(SMOKE).toContain("/api/health");
  });

  it("asserts static security headers", () => {
    expect(SMOKE).toContain("strict-transport-security");
    expect(SMOKE).toContain("x-frame-options");
  });

  it("asserts nonce-based CSP on /dashboard", () => {
    expect(SMOKE).toContain("nonce-");
    expect(SMOKE).toContain("strict-dynamic");
  });

  it("asserts unauthenticated redirect", () => {
    expect(SMOKE).toContain("/auth/login");
  });
});
