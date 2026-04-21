// F11.3 vitest setup — stub every env key validated by src/lib/config.ts
// so any code path that transitively calls getConfig() (e.g. prisma,
// auth0-management, proxy CSP builder) does not blow up on cache-populate
// in tests. Individual test files may still `vi.mock("@/lib/config")` to
// override specific values.
//
// Module 11 spec step:
//   "FOLLOW-UP: create vitest.setup.ts with beforeAll env stubs for every
//    validated key (AUTH0_*, AWS_*, DATABASE_URL, APP_BASE_URL, NODE_ENV)"

import { beforeAll, beforeEach, vi } from "vitest";
import { resetConfigCache } from "@/lib/config";

const ENV_STUBS: Record<string, string> = {
  AUTH0_SECRET: "a".repeat(64),
  APP_BASE_URL: "http://localhost:3000",
  AUTH0_DOMAIN: "test.auth0.com",
  AUTH0_CLIENT_ID: "test-client-id",
  AUTH0_CLIENT_SECRET: "test-client-secret",
  AUTH0_MGMT_CLIENT_ID: "test-mgmt-id",
  AUTH0_MGMT_CLIENT_SECRET: "test-mgmt-secret",
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
  AWS_KMS_KEY_ID: "test-kms-key",
  AWS_S3_LOGS_BUCKET: "test-logs-bucket",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  NODE_ENV: "test",
};

// Re-stub before every test. Many test files call vi.unstubAllEnvs()
// in afterEach — if we only stubbed in beforeAll, the second test in
// those files would see a bare env and getConfig() would throw
// ConfigError. beforeEach guarantees a known-good baseline per test.
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV_STUBS)) {
    vi.stubEnv(k, v);
  }
  resetConfigCache();
});

beforeAll(() => {
  // Default fetch rejector. Before this setup existed, many tests
  // relied on env being unset so auth0-management helpers would throw
  // synchronously instead of reaching for a real network. Now that env
  // is stubbed, we install a fetch that rejects fast by default — tests
  // that need fetch override via vi.stubGlobal("fetch", fetchMock) in
  // their own beforeEach.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.reject(
        new Error("[vitest.setup] fetch called without a per-test stub"),
      ),
    ),
  );

  // matchMedia polyfill — jsdom does not implement it, so the shadcn
  // use-mobile hook (consumed by Sidebar/NavUser/etc.) crashes on mount
  // during component tests. Stub returns a never-matching MediaQueryList
  // so components default to the desktop code path.
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia !== "function"
  ) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});
