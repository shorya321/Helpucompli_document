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

// 409 from POST /api/v2/users — callers surface a duplicate-email error
// on the invite flow without leaking the Auth0 response body.
export class Auth0ConflictError extends Error {
  constructor(message = "Auth0 resource conflict") {
    super(message);
    this.name = "Auth0ConflictError";
  }
}

const DEFAULT_DB_CONNECTION = "Username-Password-Authentication";

function dbConnection(): string {
  const config = getConfig() as { AUTH0_DB_CONNECTION?: string };
  const cfg = config.AUTH0_DB_CONNECTION;
  return cfg && cfg.length > 0 ? cfg : DEFAULT_DB_CONNECTION;
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

// POST /api/v2/users — creates a database-connection user without a
// password. The invitation flow (F10.3) uses the password-change ticket
// to let the invitee set their own password on first login. `needsInvitation`
// marks the user for the invitation email template (see Auth0 guide on
// password-reset-as-invitation pattern). 409 surfaces as Auth0ConflictError
// so the invite route can return a 409 to the client without leaking the
// Auth0 response body.
export interface CreateAuth0UserInput {
  readonly email: string;
  readonly name: string | null;
}

export interface CreatedAuth0User {
  readonly userId: string;
  readonly email: string;
}

export async function createAuth0User(
  input: CreateAuth0UserInput,
): Promise<CreatedAuth0User> {
  const config = getConfig();
  const token = await getManagementToken();

  const body: Record<string, unknown> = {
    email: input.email,
    connection: dbConnection(),
    email_verified: false,
    verify_email: false,
    app_metadata: { needsInvitation: true },
  };
  if (input.name && input.name.length > 0) body.name = input.name;

  const response = await fetch(`https://${config.AUTH0_DOMAIN}/api/v2/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 409) {
      throw new Auth0ConflictError("Auth0 user already exists");
    }
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
      );
      throw new Auth0RateLimitError(
        retryAfterMs,
        `Auth0 createAuth0User rate-limited (429); retry after ${retryAfterMs}ms`,
      );
    }
    throw new Error(`Auth0 createAuth0User failed: ${response.status}`);
  }

  const data = (await response.json()) as { user_id: string; email: string };
  return { userId: data.user_id, email: data.email };
}

// POST /api/v2/tickets/password-change — returns a URL the invitee can
// click to set their password and activate the account. We keep
// mark_email_as_verified=false so the invitee still has to click
// through; the Auth0 post-login Action clears `needsInvitation` on
// first successful login per the invitation guide.
export async function createPasswordChangeTicket(
  userId: string,
): Promise<string> {
  const config = getConfig();
  const token = await getManagementToken();

  const response = await fetch(
    `https://${config.AUTH0_DOMAIN}/api/v2/tickets/password-change`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        mark_email_as_verified: false,
      }),
    },
  );

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
      );
      throw new Auth0RateLimitError(
        retryAfterMs,
        `Auth0 createPasswordChangeTicket rate-limited (429); retry after ${retryAfterMs}ms`,
      );
    }
    throw new Error(`Auth0 createPasswordChangeTicket failed: ${response.status}`);
  }

  const data = (await response.json()) as { ticket: string };
  return data.ticket;
}

// Role listing is cached because the tenant's role catalogue is
// effectively static at runtime. Cleared in tests via _resetRoleIdCache.
let cachedRoles: Auth0Role[] | null = null;

export function _resetRoleIdCache(): void {
  cachedRoles = null;
}

export async function listAuth0Roles(): Promise<Auth0Role[]> {
  if (cachedRoles) return cachedRoles;
  const config = getConfig();
  const token = await getManagementToken();

  const response = await fetch(
    `https://${config.AUTH0_DOMAIN}/api/v2/roles`,
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
        `Auth0 listAuth0Roles rate-limited (429); retry after ${retryAfterMs}ms`,
      );
    }
    throw new Error(`Auth0 listAuth0Roles failed: ${response.status}`);
  }

  cachedRoles = (await response.json()) as Auth0Role[];
  return cachedRoles;
}

export async function assignAuth0RoleByName(
  userId: string,
  roleName: string,
): Promise<void> {
  const roles = await listAuth0Roles();
  const match = roles.find((r) => r.name === roleName);
  if (!match) {
    // Tenant misconfigured — the operator must create the role in Auth0
    // before inviting users. Fail loud so the UX surfaces a clear error.
    throw new Error(
      `Auth0 role '${roleName}' not found in tenant — configure via dashboard`,
    );
  }

  const config = getConfig();
  const token = await getManagementToken();
  const response = await fetch(
    `https://${config.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/roles`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roles: [match.id] }),
    },
  );

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
      );
      throw new Auth0RateLimitError(
        retryAfterMs,
        `Auth0 assignAuth0RoleByName rate-limited (429); retry after ${retryAfterMs}ms`,
      );
    }
    throw new Error(`Auth0 assignAuth0RoleByName failed: ${response.status}`);
  }
}
