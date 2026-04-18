// Auth0 Management API client — M2M client-credentials grant +
// GET /api/v2/users/{sub}/roles. Ported from the sibling project
// /Volumes/shorya/apps/circleso/lib/auth0-management.ts (same pattern).
//
// Used by resolveRole() in auth-guard.ts to look up RBAC roles WITHOUT
// requiring a Post-Login Action / custom claim. Role assignment happens
// in the Auth0 Dashboard (Roles → Users). The M2M app needs
// `read:roles` + `read:role_members` scopes on the Management API.

import { getConfig } from "./config";

export interface Auth0Role {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
}

// Thrown when Management API returns 429. `retryAfterMs` parsed from
// the `Retry-After` header per RFC 6585. Caller may choose to apply
// the delay before retrying; resolveRole treats it as a hard fail
// (closes door + does not cache).
export class Auth0RateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message: string) {
    super(message);
    this.name = "Auth0RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

const DEFAULT_RETRY_AFTER_MS = 2_000;

function parseRetryAfterMs(headerValue: string | null): number {
  if (!headerValue) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number.parseInt(headerValue, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_MS;
  return seconds * 1000;
}

// Module-level M2M token cache. Token is tenant-wide, not per-user.
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// Test hook — MUST NOT be called from production code paths.
export function _resetTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

function tenantDomainFor(config: {
  readonly AUTH0_DOMAIN: string;
  readonly AUTH0_TENANT_DOMAIN?: string;
}): string {
  // Audience MUST use the raw tenant domain. Management API does not
  // honour the custom-domain alias for machine-to-machine tokens.
  return config.AUTH0_TENANT_DOMAIN ?? config.AUTH0_DOMAIN;
}

export async function getManagementToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const config = getConfig();
  const response = await fetch(`https://${config.AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.AUTH0_MGMT_CLIENT_ID,
      client_secret: config.AUTH0_MGMT_CLIENT_SECRET,
      audience: `https://${tenantDomainFor(config)}/api/v2/`,
    }),
  });

  if (!response.ok) {
    // Raw status only — response body can echo client_secret back on
    // certain Auth0 error shapes, never surface it.
    throw new Error(`Failed to fetch Auth0 M2M token: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = data.access_token;
  // 300s safety margin so the token never expires mid-request.
  tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}

export async function getUserRoles(userId: string): Promise<Auth0Role[]> {
  const config = getConfig();
  const token = await getManagementToken();

  const response = await fetch(
    `https://${config.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/roles`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
      );
      throw new Auth0RateLimitError(
        retryAfterMs,
        `Auth0 getUserRoles rate-limited (429); retry after ${retryAfterMs}ms`,
      );
    }
    // Do not echo response body — Auth0 errors can include the client_id.
    throw new Error(`Auth0 getUserRoles failed: ${response.status}`);
  }

  return (await response.json()) as Auth0Role[];
}
