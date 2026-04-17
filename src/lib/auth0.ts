import { Auth0Client } from "@auth0/nextjs-auth0/server";

const SECURE_COOKIE = process.env.NODE_ENV === "production";

export const SESSION_CONFIG = {
  rolling: true,
  inactivityDuration: 30 * 60,
  absoluteDuration: 8 * 60 * 60,
  cookie: {
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
  });

if (process.env.NODE_ENV !== "production") {
  globalForAuth0.auth0 = auth0;
}
