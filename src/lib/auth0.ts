import { Auth0Client } from "@auth0/nextjs-auth0/server";

const globalForAuth0 = globalThis as unknown as { auth0?: Auth0Client };

export const auth0: Auth0Client = globalForAuth0.auth0 ?? new Auth0Client();

if (process.env.NODE_ENV !== "production") {
  globalForAuth0.auth0 = auth0;
}
