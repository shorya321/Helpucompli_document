import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";

const validEnv = () => ({
  AUTH0_SECRET: "x".repeat(32),
  APP_BASE_URL: "http://localhost:3000",
  AUTH0_DOMAIN: "tenant.auth0.com",
  AUTH0_CLIENT_ID: "client_id",
  AUTH0_CLIENT_SECRET: "client_secret",
  AUTH0_MGMT_CLIENT_ID: "mgmt_id",
  AUTH0_MGMT_CLIENT_SECRET: "mgmt_secret",
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "AKIA_TEST",
  AWS_SECRET_ACCESS_KEY: "secret_value",
  AWS_KMS_KEY_ID:
    "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
  AWS_S3_LOGS_BUCKET: "helpucompli-docs-access-logs",
  DATABASE_URL: "postgresql://u:p@host:5432/db",
});

describe("loadConfig — happy path", () => {
  it("parses a fully-populated env and returns typed result", () => {
    const env = loadConfig(validEnv());
    expect(env.AUTH0_DOMAIN).toBe("tenant.auth0.com");
    expect(env.AWS_REGION).toBe("us-east-1");
    expect(env.DATABASE_URL).toContain("postgresql://");
  });
});

describe("loadConfig — validation failures", () => {
  it("rejects AUTH0_SECRET shorter than 32 chars", () => {
    const env = { ...validEnv(), AUTH0_SECRET: "short" };
    expect(() => loadConfig(env)).toThrow(/AUTH0_SECRET/);
  });

  it("rejects a non-URL APP_BASE_URL", () => {
    const env = { ...validEnv(), APP_BASE_URL: "not-a-url" };
    expect(() => loadConfig(env)).toThrow(/APP_BASE_URL/);
  });

  it("rejects APP_BASE_URL with javascript: scheme", () => {
    const env = { ...validEnv(), APP_BASE_URL: "javascript:alert(1)" };
    expect(() => loadConfig(env)).toThrow(/APP_BASE_URL/);
  });

  it("rejects APP_BASE_URL with file: scheme", () => {
    const env = { ...validEnv(), APP_BASE_URL: "file:///etc/passwd" };
    expect(() => loadConfig(env)).toThrow(/APP_BASE_URL/);
  });

  it("rejects APP_BASE_URL with data: scheme", () => {
    const env = { ...validEnv(), APP_BASE_URL: "data:text/html,<script>x</script>" };
    expect(() => loadConfig(env)).toThrow(/APP_BASE_URL/);
  });

  it("rejects NODE_ENV=development paired with https APP_BASE_URL", () => {
    const env = {
      ...validEnv(),
      APP_BASE_URL: "https://docs.helpucompli.com",
      NODE_ENV: "development",
    };
    expect(() => loadConfig(env)).toThrow(/NODE_ENV|APP_BASE_URL/);
  });

  it("accepts NODE_ENV=production paired with https APP_BASE_URL", () => {
    const env = {
      ...validEnv(),
      APP_BASE_URL: "https://docs.helpucompli.com",
      NODE_ENV: "production",
    };
    expect(() => loadConfig(env)).not.toThrow();
  });

  it("rejects empty AUTH0_CLIENT_ID", () => {
    const env = { ...validEnv(), AUTH0_CLIENT_ID: "" };
    expect(() => loadConfig(env)).toThrow(/AUTH0_CLIENT_ID/);
  });

  it("rejects missing AUTH0_MGMT_CLIENT_SECRET", () => {
    const env = { ...validEnv() } as Record<string, string | undefined>;
    delete env.AUTH0_MGMT_CLIENT_SECRET;
    expect(() => loadConfig(env)).toThrow(/AUTH0_MGMT_CLIENT_SECRET/);
  });

  it("rejects missing AWS_REGION", () => {
    const env = { ...validEnv() } as Record<string, string | undefined>;
    delete env.AWS_REGION;
    expect(() => loadConfig(env)).toThrow(/AWS_REGION/);
  });

  it("rejects missing DATABASE_URL", () => {
    const env = { ...validEnv() } as Record<string, string | undefined>;
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  it("aggregates multiple issues into a single error message", () => {
    const env = {
      ...validEnv(),
      AUTH0_SECRET: "short",
      APP_BASE_URL: "not-a-url",
    };
    let caught: Error | null = null;
    try {
      loadConfig(env);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/AUTH0_SECRET/);
    expect(caught!.message).toMatch(/APP_BASE_URL/);
  });

  it("error message starts with an actionable header", () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration/);
  });
});

describe("loadConfig — optional vars tolerated", () => {
  it("accepts env without UPSTASH_* and SENTRY_DSN", () => {
    const env = validEnv();
    expect(() => loadConfig(env)).not.toThrow();
  });

  it("accepts and passes through NODE_ENV when set", () => {
    const env = { ...validEnv(), NODE_ENV: "production" };
    const parsed = loadConfig(env);
    expect(parsed.NODE_ENV).toBe("production");
  });
});
