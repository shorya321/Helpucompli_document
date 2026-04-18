import { z } from "zod";

const nonEmpty = (field: string) =>
  z
    .string({
      required_error: `${field} is required`,
      invalid_type_error: `${field} must be a string`,
    })
    .min(1, `${field} must not be empty`);

const envSchema = z.object({
  AUTH0_SECRET: z
    .string({ required_error: "AUTH0_SECRET is required" })
    .min(32, "AUTH0_SECRET must be at least 32 characters (use `openssl rand -hex 32`)"),
  APP_BASE_URL: z
    .string({ required_error: "APP_BASE_URL is required" })
    .url("APP_BASE_URL must be a valid URL (e.g. http://localhost:3000)")
    .refine(
      (u) => /^https?:\/\//i.test(u),
      "APP_BASE_URL must use http or https scheme (javascript:, data:, file: are rejected)",
    ),
  AUTH0_DOMAIN: nonEmpty("AUTH0_DOMAIN"),
  // Raw tenant domain (e.g. dev-xxx.us.auth0.com). Only needed when
  // AUTH0_DOMAIN is a custom domain and the Management API audience
  // must still point at the underlying tenant. Falls back to
  // AUTH0_DOMAIN when unset.
  AUTH0_TENANT_DOMAIN: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  AUTH0_CLIENT_ID: nonEmpty("AUTH0_CLIENT_ID"),
  AUTH0_CLIENT_SECRET: nonEmpty("AUTH0_CLIENT_SECRET"),
  AUTH0_MGMT_CLIENT_ID: nonEmpty("AUTH0_MGMT_CLIENT_ID"),
  AUTH0_MGMT_CLIENT_SECRET: nonEmpty("AUTH0_MGMT_CLIENT_SECRET"),
  AWS_REGION: nonEmpty("AWS_REGION"),
  AWS_ACCESS_KEY_ID: nonEmpty("AWS_ACCESS_KEY_ID"),
  AWS_SECRET_ACCESS_KEY: nonEmpty("AWS_SECRET_ACCESS_KEY"),
  AWS_KMS_KEY_ID: nonEmpty("AWS_KMS_KEY_ID"),
  AWS_S3_LOGS_BUCKET: nonEmpty("AWS_S3_LOGS_BUCKET"),
  DATABASE_URL: nonEmpty("DATABASE_URL"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // CloudTrail trail name that receives S3 data-event selectors for
  // document buckets (F3.2). Optional: when unset, createHipaaBucket()
  // still applies every S3-level HIPAA control but skips the trail
  // update and surfaces a carry-forward so the deploy pipeline wires
  // it before go-live. Empty string is treated as unset.
  AWS_CLOUDTRAIL_NAME: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Empty string in .env.local must be treated as unset — Zod's
  // `.url().optional()` otherwise runs the url check on "" and errors
  // ("Invalid url"). Same idiom as AUTH0_TENANT_DOMAIN and
  // AWS_CLOUDTRAIL_NAME above.
  UPSTASH_REDIS_REST_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url().optional(),
  ),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  ),
  SENTRY_DSN: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(
      `Invalid environment configuration:\n${issues}\n\n` +
        `Check .env.local against .env.example and ensure every required variable is set.`,
    );
  }

  // HIPAA guard: https origin MUST pair with NODE_ENV=production so the
  // cookie `secure` flag is enforced. Catches prod deployments that ship
  // with a stale NODE_ENV=development.
  if (
    parsed.data.NODE_ENV !== "production" &&
    parsed.data.APP_BASE_URL.startsWith("https://")
  ) {
    throw new ConfigError(
      "Invalid environment configuration:\n" +
        "  - NODE_ENV: must be 'production' when APP_BASE_URL is https:// " +
        "(otherwise session cookies ship without the Secure flag over TLS)\n",
    );
  }

  return parsed.data;
}

let cached: Env | undefined;

export function getConfig(): Env {
  if (!cached) cached = loadConfig();
  return cached;
}

// Test hook: drop the cached validated env so a subsequent `getConfig()`
// call re-parses `process.env`. Used by vitest `afterEach` blocks that
// mutate env between test cases. Production code MUST NOT call this —
// env is frozen at boot.
export function resetConfigCache(): void {
  cached = undefined;
}
