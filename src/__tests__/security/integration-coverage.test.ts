import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// F12.2 — Integration-test coverage guard. Every API route under
// src/app/api/**/route.ts MUST have at least one Vitest file that
// imports from it, OR be explicitly exempt (liveness probe,
// dynamic catch-alls). Prevents a new route from shipping without
// role / rate-limit / happy-path coverage.

const ROOT = path.resolve(__dirname, "../../..");
const API_ROOT = path.join(ROOT, "src/app/api");
const TEST_ROOT = path.join(ROOT, "src/__tests__");

const EXEMPT: ReadonlyArray<string> = [
  // Liveness probe — pre-auth, rate-limit skipped, trivial 200.
  // Any behaviour here is covered by F12.5 health-check assertions.
  "src/app/api/health/route.ts",
];

function walkRoutes(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkRoutes(p, acc);
    else if (entry === "route.ts") acc.push(p);
  }
  return acc;
}

function walkTests(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkTests(p, acc);
    else if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx"))
      acc.push(p);
  }
  return acc;
}

const ROUTE_FILES = walkRoutes(API_ROOT).map((p) =>
  path.relative(ROOT, p).replace(/\\/g, "/"),
);
const TEST_CONTENTS = walkTests(TEST_ROOT).map((p) => readFileSync(p, "utf8"));

describe("F12.2 API route integration-test coverage", () => {
  it("found at least one API route (sanity)", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(0);
  });

  for (const rel of ROUTE_FILES) {
    if (EXEMPT.includes(rel)) continue;
    it(`has an integration test importing ${rel}`, () => {
      // Map the filesystem path to the `@/...` alias the tests use to
      // import the route module.
      const alias = `@/${rel.replace(/^src\//, "").replace(/\.ts$/, "")}`;
      const hit = TEST_CONTENTS.some((t) => t.includes(alias));
      expect(hit, `no test imports "${alias}"`).toBe(true);
    });
  }
});
