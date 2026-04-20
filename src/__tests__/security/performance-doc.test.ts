import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F12.4 — doc-rot guard on docs/PERFORMANCE-TARGETS.md. Ensures the
// budget rows stay present even as individual cells update.

const DOC = readFileSync(
  path.resolve(__dirname, "../../../docs/PERFORMANCE-TARGETS.md"),
  "utf8",
);

describe("performance targets (F12.4)", () => {
  it("lists presigned-URL budget", () => {
    expect(DOC).toMatch(/Presigned URL generation[^|]*\|\s*<\s*500\s*ms/);
  });

  it("lists audit-log query budget", () => {
    expect(DOC).toMatch(/Audit log filtered query[^|]*\|\s*<\s*1\s*s/);
  });

  it("lists dashboard LCP budget", () => {
    expect(DOC).toMatch(/\/dashboard[^|]*\|\s*<\s*2\s*s/);
  });

  it("lists document browser LCP budget", () => {
    expect(DOC).toContain("/documents");
  });

  it("defines realistic volume profile + concurrency", () => {
    expect(DOC).toMatch(/100\+ buckets/);
    expect(DOC).toMatch(/1 000\+ documents|1000\+ documents/);
    expect(DOC).toMatch(/10 000\+ audit rows|10000\+ audit rows/);
    expect(DOC).toMatch(/50\+ active concurrent/);
  });

  it("defines regression gate (20% budget variance rule)", () => {
    expect(DOC.toLowerCase()).toContain("regression gate");
    expect(DOC).toContain("20%");
  });

  it("defines measurement cadence", () => {
    expect(DOC).toContain("Pre-PR");
    expect(DOC).toContain("Pre-launch");
    expect(DOC.toLowerCase()).toContain("weekly");
  });
});
