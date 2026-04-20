import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// F11.5 — CSRF protection + cookie security contract tests.
// SameSite=Lax + Secure + httpOnly session cookies are the primary
// CSRF defense. Plus static guards that no AWS SDK / secret leaks
// into client bundles.

describe("F11.5 session cookie config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadAuth0Module() {
    vi.resetModules();
    return import("@/lib/auth0");
  }

  it("SESSION_CONFIG declares SameSite=Lax", async () => {
    const { SESSION_CONFIG } = await loadAuth0Module();
    expect(SESSION_CONFIG.cookie.sameSite).toBe("lax");
  });

  it("TRANSACTION_COOKIE_CONFIG declares SameSite=Lax", async () => {
    const { TRANSACTION_COOKIE_CONFIG } = await loadAuth0Module();
    expect(TRANSACTION_COOKIE_CONFIG.sameSite).toBe("lax");
  });

  it("rolling session enabled with 30-min inactivity + 8-hour absolute cap", async () => {
    const { SESSION_CONFIG } = await loadAuth0Module();
    expect(SESSION_CONFIG.rolling).toBe(true);
    expect(SESSION_CONFIG.inactivityDuration).toBe(30 * 60);
    expect(SESSION_CONFIG.absoluteDuration).toBe(8 * 60 * 60);
  });

  it("uses an explicit non-default cookie name (no __session collision)", async () => {
    const { SESSION_CONFIG } = await loadAuth0Module();
    expect(SESSION_CONFIG.cookie.name).toBe("helpucompli_doc_session");
  });

  it("isSecureCookieOrigin() returns true in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { isSecureCookieOrigin } = await loadAuth0Module();
    expect(isSecureCookieOrigin()).toBe(true);
  });

  it("isSecureCookieOrigin() returns true for https APP_BASE_URL in dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_BASE_URL", "https://docs.example.com");
    const { isSecureCookieOrigin } = await loadAuth0Module();
    expect(isSecureCookieOrigin()).toBe(true);
  });

  it("isSecureCookieOrigin() returns false for http APP_BASE_URL in dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    const { isSecureCookieOrigin } = await loadAuth0Module();
    expect(isSecureCookieOrigin()).toBe(false);
  });
});

// ----- Static-analysis guards -----

const SRC = path.resolve(__dirname, "../..");

function walkTsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkTsxFiles(p, acc);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const ALL_SOURCE_FILES = walkTsxFiles(SRC).filter(
  (p) => !p.includes("__tests__") && !p.includes(".test."),
);

describe("F11.5 no AWS SDK in client components", () => {
  const clientComponents = ALL_SOURCE_FILES.filter((p) => {
    if (!p.endsWith(".tsx")) return false;
    const text = readFileSync(p, "utf8");
    return /^\s*["']use client["']/m.test(text);
  });

  it("found at least one client component (sanity)", () => {
    expect(clientComponents.length).toBeGreaterThan(0);
  });

  for (const file of clientComponents) {
    it(`no @aws-sdk import in ${path.relative(SRC, file)}`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/from ["']@aws-sdk/);
      expect(text).not.toMatch(/from ["']@prisma\/client/);
    });
  }
});

describe("F11.5 no NEXT_PUBLIC_ secret leaks", () => {
  const leakPatterns = [
    /NEXT_PUBLIC_[A-Z_]*SECRET/,
    /NEXT_PUBLIC_[A-Z_]*TOKEN/,
    /NEXT_PUBLIC_[A-Z_]*PASSWORD/,
    /NEXT_PUBLIC_AWS_/,
    /NEXT_PUBLIC_DATABASE/,
    /NEXT_PUBLIC_AUTH0_CLIENT_SECRET/,
  ];

  it("no source file references a NEXT_PUBLIC_* variable that looks like a secret", () => {
    const hits: string[] = [];
    for (const file of ALL_SOURCE_FILES) {
      const text = readFileSync(file, "utf8");
      for (const pat of leakPatterns) {
        if (pat.test(text)) hits.push(`${path.relative(SRC, file)} :: ${pat}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
