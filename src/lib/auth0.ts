import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { buildLoginCallbackResponse } from "@/lib/login-callback-redirect";

export function isSecureCookieOrigin(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const url = process.env.APP_BASE_URL ?? "";
  return url.startsWith("https://");
}

const SECURE_COOKIE = isSecureCookieOrigin();

export const SESSION_CONFIG = {
  rolling: true,
  inactivityDuration: 30 * 60,
  absoluteDuration: 8 * 60 * 60,
  cookie: {
    // Explicit cookie name prevents collision with sibling apps on
    // `*.helpucompli.com` that may also default to `__session`.
    // httpOnly is enforced by the Auth0 SDK internally — not user-
    // configurable (SDK sets it true regardless of this config).
    name: "helpucompli_doc_session",
    sameSite: "lax" as const,
    secure: SECURE_COOKIE,
  },
} as const;

export const TRANSACTION_COOKIE_CONFIG = {
  sameSite: "lax" as const,
  secure: SECURE_COOKIE,
} as const;

const globalForAuth0 = globalThis as unknown as { auth0?: Auth0Client };

export const auth0: Auth0Client =
  globalForAuth0.auth0 ??
  new Auth0Client({
    session: SESSION_CONFIG,
    transactionCookie: TRANSACTION_COOKIE_CONFIG,
    // Override default callback redirect to land on
    // /api/auth/audit-login first — that Node-runtime route writes the
    // LOGIN audit row (Prisma is not available in middleware/edge), then
    // 302s onward to the original returnTo. Audit failures never block
    // the auth flow (route swallows errors). The `LOGOUT` counterpart
    // is wired by flipping the Sign out hrefs to /api/auth/audit-logout.
    async onCallback(error, ctx) {
      return buildLoginCallbackResponse(error ?? null, {
        returnTo: ctx?.returnTo,
        appBaseUrl: ctx?.appBaseUrl,
      });
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForAuth0.auth0 = auth0;
}
