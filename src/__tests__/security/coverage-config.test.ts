import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F12.1 — lock in the 80% coverage floor on src/lib/. The actual
// coverage run happens via `npm run test:coverage`; this test just
// guards the config from silent relaxation.

const ROOT = path.resolve(__dirname, "../../..");
const VITEST_CONFIG = readFileSync(
  path.join(ROOT, "vitest.config.ts"),
  "utf8",
);
const PACKAGE_JSON = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
);

describe("coverage configuration (F12.1)", () => {
  it("scopes coverage include to src/lib/**", () => {
    expect(VITEST_CONFIG).toMatch(/include:\s*\[\s*["']src\/lib\/\*\*["']/);
  });

  it("sets an 80% line-coverage floor", () => {
    expect(VITEST_CONFIG).toMatch(/lines:\s*80/);
  });

  it("sets 80% function and statement floors", () => {
    expect(VITEST_CONFIG).toMatch(/functions:\s*80/);
    expect(VITEST_CONFIG).toMatch(/statements:\s*80/);
  });

  it("sets a 80% branch-coverage floor", () => {
    expect(VITEST_CONFIG).toMatch(/branches:\s*80/);
  });

  it("uses the v8 provider", () => {
    expect(VITEST_CONFIG).toContain('provider: "v8"');
  });

  it("exposes the test:coverage npm script", () => {
    expect(PACKAGE_JSON.scripts["test:coverage"]).toBe(
      "vitest run --coverage",
    );
  });
});
