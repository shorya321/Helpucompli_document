import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Config module-level call — getConfig() reads process.env on first
// invocation and caches. For tests we stub it via vi.mock so each test
// can declare its own "environment" without juggling env vars.
const configMock = vi.hoisted(() => ({
  AUTH0_DOMAIN: "auth.helpucompli.com",
  AUTH0_TENANT_DOMAIN: "helpucompli.us.auth0.com",
  AUTH0_MGMT_CLIENT_ID: "mgmt-client-id",
  AUTH0_MGMT_CLIENT_SECRET: "mgmt-client-secret",
  AUTH0_DB_CONNECTION: "Username-Password-Authentication",
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => configMock,
}));

import {
  Auth0ConflictError,
  Auth0RateLimitError,
  _resetRoleIdCache,
  _resetTokenCache,
  assignAuth0RoleByName,
  createAuth0User,
  createPasswordChangeTicket,
  getManagementToken,
  getUserRoles,
  listAuth0Roles,
} from "@/lib/auth0-management";

const fetchMock = vi.fn();

beforeEach(() => {
  _resetTokenCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown, init?: { headers?: Record<string, string> }) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(init?.headers),
  };
}

function errJson(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return {
    ok: false,
    status,
    json: async () => body,
    headers: new Headers(headers),
  };
}

describe("getManagementToken", () => {
  it("POSTs client_credentials grant with tenant-domain audience", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn-1", expires_in: 86400 }),
    );
    const tok = await getManagementToken();
    expect(tok).toBe("tkn-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://auth.helpucompli.com/oauth/token");
    const init_ = init as { method: string; body: string; headers: unknown };
    expect(init_.method).toBe("POST");
    const body = JSON.parse(init_.body);
    expect(body).toEqual({
      grant_type: "client_credentials",
      client_id: "mgmt-client-id",
      client_secret: "mgmt-client-secret",
      // audience uses TENANT domain, not the custom AUTH0_DOMAIN
      audience: "https://helpucompli.us.auth0.com/api/v2/",
    });
  });

  it("caches the token and does not refetch within TTL", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn-cached", expires_in: 86400 }),
    );
    await getManagementToken();
    await getManagementToken();
    await getManagementToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the token expires (expires_in - 300s safety margin)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T10:00:00Z"));
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn-old", expires_in: 600 }),
    );
    const first = await getManagementToken();
    expect(first).toBe("tkn-old");

    // 600s - 300s safety = 300s TTL. Advance past that.
    vi.setSystemTime(new Date("2026-04-18T10:05:01Z"));
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn-new", expires_in: 600 }),
    );
    const second = await getManagementToken();
    expect(second).toBe("tkn-new");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("falls back to AUTH0_DOMAIN when AUTH0_TENANT_DOMAIN is unset", async () => {
    configMock.AUTH0_TENANT_DOMAIN = undefined as unknown as string;
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn-fallback", expires_in: 86400 }),
    );
    await getManagementToken();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.audience).toBe("https://auth.helpucompli.com/api/v2/");
    configMock.AUTH0_TENANT_DOMAIN = "helpucompli.us.auth0.com";
  });

  it("throws a descriptive error on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(errJson(500, { error: "server_error" }));
    await expect(getManagementToken()).rejects.toThrow(/500/);
  });
});

describe("getUserRoles", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn", expires_in: 86400 }),
    );
  });

  it("GETs /api/v2/users/{sub}/roles with Bearer token", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson([{ id: "r1", name: "superadmin", description: null }]),
    );
    const roles = await getUserRoles("auth0|abc123");
    expect(roles).toEqual([
      { id: "r1", name: "superadmin", description: null },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe(
      "https://auth.helpucompli.com/api/v2/users/auth0%7Cabc123/roles",
    );
    const init_ = init as {
      method: string;
      headers: Record<string, string>;
    };
    expect(init_.method).toBe("GET");
    expect(init_.headers.Authorization).toBe("Bearer tkn");
  });

  it("encodes userId so | and other reserved chars are safe in the URL", async () => {
    fetchMock.mockResolvedValueOnce(okJson([]));
    await getUserRoles("google-oauth2|117 with spaces");
    const [url] = fetchMock.mock.calls[1] ?? [];
    expect(url as string).toContain(
      encodeURIComponent("google-oauth2|117 with spaces"),
    );
  });

  it("throws Auth0RateLimitError with parsed retry-after on 429", async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(429, { message: "rate limited" }, { "retry-after": "7" }),
    );
    let caught: unknown;
    try {
      await getUserRoles("auth0|x");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Auth0RateLimitError);
    expect((caught as Auth0RateLimitError).retryAfterMs).toBe(7000);
  });

  it("defaults retry-after to 2000ms when header absent or invalid", async () => {
    fetchMock.mockResolvedValueOnce(errJson(429, { message: "rate limited" }));
    let caught: unknown;
    try {
      await getUserRoles("auth0|x");
    } catch (e) {
      caught = e;
    }
    expect((caught as Auth0RateLimitError).retryAfterMs).toBe(2000);
  });

  it("throws a generic error on other non-ok responses (no PII leak)", async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(403, { message: "insufficient_scope" }),
    );
    await expect(getUserRoles("auth0|x")).rejects.toThrow(
      /getUserRoles failed/,
    );
  });
});

describe("createAuth0User", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn", expires_in: 86400 }),
    );
  });

  it("POSTs /api/v2/users with email + name + connection + needsInvitation metadata", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ user_id: "auth0|new123", email: "new@x.com" }),
    );
    const result = await createAuth0User({
      email: "new@x.com",
      name: "New User",
    });
    expect(result).toEqual({ userId: "auth0|new123", email: "new@x.com" });
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe("https://auth.helpucompli.com/api/v2/users");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({
      email: "new@x.com",
      name: "New User",
      connection: "Username-Password-Authentication",
      email_verified: false,
      verify_email: false,
      app_metadata: { needsInvitation: true },
    });
    expect(body).not.toHaveProperty("password");
  });

  it("throws Auth0ConflictError on 409 so callers can surface duplicate-email", async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(409, { message: "user already exists" }),
    );
    await expect(
      createAuth0User({ email: "dup@x.com", name: null }),
    ).rejects.toBeInstanceOf(Auth0ConflictError);
  });

  it("throws generic error on 500 without echoing response body (no PII leak)", async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(500, { secret: "client_id leak" }),
    );
    await expect(
      createAuth0User({ email: "x@y.com", name: null }),
    ).rejects.toThrow(/createAuth0User failed: 500/);
  });

  it("rate-limits via Auth0RateLimitError on 429", async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(429, { message: "slow down" }, { "retry-after": "3" }),
    );
    let caught: unknown;
    try {
      await createAuth0User({ email: "x@y.com", name: null });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Auth0RateLimitError);
    expect((caught as Auth0RateLimitError).retryAfterMs).toBe(3000);
  });
});

describe("createPasswordChangeTicket", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn", expires_in: 86400 }),
    );
  });

  it("POSTs /api/v2/tickets/password-change with user_id + mark_email_as_verified", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ ticket: "https://auth.helpucompli.com/lo/reset?ticket=abc" }),
    );
    const ticket = await createPasswordChangeTicket("auth0|new123");
    expect(ticket).toBe("https://auth.helpucompli.com/lo/reset?ticket=abc");
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe("https://auth.helpucompli.com/api/v2/tickets/password-change");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({
      user_id: "auth0|new123",
      mark_email_as_verified: false,
    });
  });
});

describe("listAuth0Roles + assignAuth0RoleByName", () => {
  beforeEach(() => {
    _resetRoleIdCache();
    fetchMock.mockResolvedValueOnce(
      okJson({ access_token: "tkn", expires_in: 86400 }),
    );
  });

  it("listAuth0Roles GETs /api/v2/roles and caches the result", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson([
        { id: "r-sa", name: "superadmin" },
        { id: "r-ad", name: "admin" },
        { id: "r-vw", name: "viewer" },
      ]),
    );
    const first = await listAuth0Roles();
    const second = await listAuth0Roles();
    expect(first).toHaveLength(3);
    expect(second).toEqual(first);
    // token fetch + roles fetch = 2 calls only; second call served from cache.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("assignAuth0RoleByName POSTs /api/v2/users/{id}/roles with matching role id", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson([
          { id: "r-ad", name: "admin" },
          { id: "r-vw", name: "viewer" },
        ]),
      )
      .mockResolvedValueOnce(okJson({}));
    await assignAuth0RoleByName("auth0|new123", "viewer");
    const [url, init] = fetchMock.mock.calls[2] ?? [];
    expect(url).toBe(
      "https://auth.helpucompli.com/api/v2/users/auth0%7Cnew123/roles",
    );
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toEqual({ roles: ["r-vw"] });
  });

  it("assignAuth0RoleByName throws when role name is not configured in Auth0", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson([{ id: "r-ad", name: "admin" }]),
    );
    await expect(
      assignAuth0RoleByName("auth0|new", "viewer"),
    ).rejects.toThrow(/role.*viewer.*not found/i);
  });
});
