import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// F11.7 — dependency security scanning contract.

const REPO_ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

describe("Dependabot configuration (F11.7)", () => {
  const yml = read(".github/dependabot.yml");

  it("targets npm + github-actions ecosystems", () => {
    expect(yml).toMatch(/package-ecosystem:\s*npm/);
    expect(yml).toMatch(/package-ecosystem:\s*github-actions/);
  });

  it("runs on a weekly cadence", () => {
    expect(yml).toMatch(/interval:\s*weekly/);
  });

  it("labels security-relevant PRs", () => {
    expect(yml).toContain("security");
  });
});

describe("CI security-scan workflow (F11.7)", () => {
  const yml = read(".github/workflows/security-scan.yml");

  it("runs on PRs and on main branch pushes", () => {
    expect(yml).toMatch(/pull_request/);
    expect(yml).toMatch(/push/);
  });

  it("has a daily scheduled cron", () => {
    expect(yml).toMatch(/cron:/);
  });

  it("fails on HIGH or CRITICAL advisories", () => {
    expect(yml).toContain("--audit-level=high");
  });

  it("runs npm ci with --ignore-scripts (audit-mode install)", () => {
    expect(yml).toContain("--ignore-scripts");
  });
});

describe("npm audit baseline (F11.7 deploy-time gate)", () => {
  // Only run when explicitly requested; `npm audit` may hit the
  // registry and slow down the suite unpredictably on air-gapped
  // runners. Default path trusts the CI workflow above.
  const RUN_LIVE = process.env.RUN_NPM_AUDIT === "1";

  it.skipIf(!RUN_LIVE)(
    "has zero HIGH or CRITICAL advisories",
    () => {
      const output = execSync("npm audit --json", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      const report = JSON.parse(output) as {
        metadata: { vulnerabilities: Record<string, number> };
      };
      const { high = 0, critical = 0 } = report.metadata.vulnerabilities;
      expect(high + critical).toBe(0);
    },
    60_000,
  );
});
