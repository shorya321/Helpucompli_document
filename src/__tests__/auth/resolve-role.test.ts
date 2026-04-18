import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Management API client. resolveRole is the only caller that
// needs it; we stub at module level so tests are hermetic.
const mocks = vi.hoisted(() => ({
  getUserRoles: vi.fn(),
}));

vi.mock("@/lib/auth0-management", () => ({
  getUserRoles: mocks.getUserRoles,
  Auth0RateLimitError: class extends Error {},
}));

import {
  _resetRoleCache,
  resolveHasRole,
  resolveRole,
} from "@/lib/auth-guard";

beforeEach(() => {
  _resetRoleCache();
  mocks.getUserRoles.mockReset();
});

afterEach(() => {
  _resetRoleCache();
});

const withSub = (sub: string, extra: Record<string, unknown> = {}) => ({
  user: { sub, email: `${sub}@x.com`, ...extra },
});

describe("resolveRole — claim-first path (backward compat)", () => {
  it("returns the claim value without hitting Management API", async () => {
    const session = withSub("auth0|a", {
      "https://docs.helpucompli.com/role": "admin",
    });
    const role = await resolveRole(session);
    expect(role).toBe("admin");
    expect(mocks.getUserRoles).not.toHaveBeenCalled();
  });

  it("ignores an invalid claim string and falls through to Management API", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([
      { id: "r1", name: "viewer" },
    ]);
    const session = withSub("auth0|b", {
      "https://docs.helpucompli.com/role": "root_admin", // not a valid Role
    });
    const role = await resolveRole(session);
    expect(role).toBe("viewer");
    expect(mocks.getUserRoles).toHaveBeenCalledWith("auth0|b");
  });
});

describe("resolveRole — Management API fallback", () => {
  it("returns first matching Role name from the assigned roles list", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([
      { id: "r1", name: "superadmin" },
      { id: "r2", name: "admin" },
    ]);
    const role = await resolveRole(withSub("auth0|c"));
    expect(role).toBe("superadmin");
  });

  it("returns null when no assigned role maps to a valid Role", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([
      { id: "r1", name: "auditor" }, // not a Role union member
    ]);
    const role = await resolveRole(withSub("auth0|d"));
    expect(role).toBeNull();
  });

  it("returns null when the user has no roles assigned", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([]);
    const role = await resolveRole(withSub("auth0|e"));
    expect(role).toBeNull();
  });

  it("returns null when session has no user.sub", async () => {
    const role = await resolveRole({ user: { sub: "" } });
    expect(role).toBeNull();
    expect(mocks.getUserRoles).not.toHaveBeenCalled();
  });

  it("returns null and does NOT cache on Management API error (fail closed)", async () => {
    mocks.getUserRoles.mockRejectedValueOnce(new Error("boom"));
    const first = await resolveRole(withSub("auth0|f"));
    expect(first).toBeNull();

    // If error had been cached, the second call would skip fetch and
    // keep returning null without a second call. Assert we DO fetch
    // again so recovery is possible within the window.
    mocks.getUserRoles.mockResolvedValueOnce([{ id: "r1", name: "admin" }]);
    const second = await resolveRole(withSub("auth0|f"));
    expect(second).toBe("admin");
  });
});

describe("resolveRole — per-user 5min cache", () => {
  it("caches a successful result — second call within TTL skips fetch", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([{ id: "r1", name: "admin" }]);
    const first = await resolveRole(withSub("auth0|g"));
    const second = await resolveRole(withSub("auth0|g"));
    expect(first).toBe("admin");
    expect(second).toBe("admin");
    expect(mocks.getUserRoles).toHaveBeenCalledTimes(1);
  });

  it("refetches after the 5-minute TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T10:00:00Z"));
    mocks.getUserRoles.mockResolvedValueOnce([{ id: "r1", name: "viewer" }]);
    const first = await resolveRole(withSub("auth0|h"));
    expect(first).toBe("viewer");

    vi.setSystemTime(new Date("2026-04-18T10:05:01Z"));
    mocks.getUserRoles.mockResolvedValueOnce([
      { id: "r2", name: "superadmin" },
    ]);
    const second = await resolveRole(withSub("auth0|h"));
    expect(second).toBe("superadmin");
    expect(mocks.getUserRoles).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("caches per-sub — distinct users maintain independent cache entries", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([{ id: "r1", name: "admin" }]);
    await resolveRole(withSub("auth0|i"));
    mocks.getUserRoles.mockResolvedValueOnce([{ id: "r2", name: "viewer" }]);
    await resolveRole(withSub("auth0|j"));
    expect(mocks.getUserRoles).toHaveBeenCalledTimes(2);
    // Subsequent reads of each sub hit the cache, not the network.
    expect(await resolveRole(withSub("auth0|i"))).toBe("admin");
    expect(await resolveRole(withSub("auth0|j"))).toBe("viewer");
    expect(mocks.getUserRoles).toHaveBeenCalledTimes(2);
  });

  it("prefers claim on a fresh session even if a different role is cached", async () => {
    // Warm cache via Management API
    mocks.getUserRoles.mockResolvedValueOnce([{ id: "r1", name: "viewer" }]);
    await resolveRole(withSub("auth0|k"));
    // Same sub, now with claim — should take claim path without a fetch.
    const session = withSub("auth0|k", {
      "https://docs.helpucompli.com/role": "admin",
    });
    const role = await resolveRole(session);
    expect(role).toBe("admin");
    // No second fetch — claim short-circuits
    expect(mocks.getUserRoles).toHaveBeenCalledTimes(1);
  });
});

describe("resolveHasRole", () => {
  it("true when resolved role is in allowed list", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([{ id: "r1", name: "admin" }]);
    const ok = await resolveHasRole(withSub("auth0|m"), ["superadmin", "admin"]);
    expect(ok).toBe(true);
  });

  it("false when role absent", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([]);
    const ok = await resolveHasRole(withSub("auth0|n"), "admin");
    expect(ok).toBe(false);
  });

  it("accepts single Role literal as well as array", async () => {
    mocks.getUserRoles.mockResolvedValueOnce([
      { id: "r1", name: "superadmin" },
    ]);
    const ok = await resolveHasRole(withSub("auth0|o"), "superadmin");
    expect(ok).toBe(true);
  });
});
