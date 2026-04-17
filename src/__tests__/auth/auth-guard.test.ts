import { describe, expect, it } from "vitest";
import type { SessionData } from "@/lib/auth-guard";
import {
  BUCKETS_CLAIM,
  ForbiddenError,
  ROLE_CLAIM,
  getAssignedBuckets,
  getRole,
  hasAccessToBucket,
  hasRole,
  requireRole,
} from "@/lib/auth-guard";

const makeSession = (
  claims: Record<string, unknown> = {},
): SessionData =>
  ({
    user: { sub: "auth0|test", email: "t@example.com", ...claims },
    tokenSet: {
      accessToken: "t",
      audience: "a",
      expiresAt: Date.now() / 1000 + 3600,
    },
    internal: { sid: "s1", createdAt: Date.now() / 1000 },
  }) as unknown as SessionData;

describe("getRole", () => {
  it("returns the role from the custom claim", () => {
    const s = makeSession({ [ROLE_CLAIM]: "admin" });
    expect(getRole(s)).toBe("admin");
  });

  it("returns null when no session", () => {
    expect(getRole(null)).toBeNull();
    expect(getRole(undefined)).toBeNull();
  });

  it("returns null when claim missing", () => {
    expect(getRole(makeSession())).toBeNull();
  });

  it("returns null when claim value is not a known Role", () => {
    const s = makeSession({ [ROLE_CLAIM]: "hacker" });
    expect(getRole(s)).toBeNull();
  });
});

describe("getAssignedBuckets", () => {
  it("returns the bucket list from the custom claim", () => {
    const s = makeSession({ [BUCKETS_CLAIM]: ["b1", "b2"] });
    expect(getAssignedBuckets(s)).toEqual(["b1", "b2"]);
  });

  it("returns empty array when session null", () => {
    expect(getAssignedBuckets(null)).toEqual([]);
  });

  it("returns empty array when claim missing or non-array", () => {
    expect(getAssignedBuckets(makeSession())).toEqual([]);
    expect(getAssignedBuckets(makeSession({ [BUCKETS_CLAIM]: "b1" }))).toEqual([]);
  });

  it("filters out non-string entries", () => {
    const s = makeSession({ [BUCKETS_CLAIM]: ["b1", 42, null, "b2"] });
    expect(getAssignedBuckets(s)).toEqual(["b1", "b2"]);
  });
});

describe("hasRole", () => {
  it("matches single role", () => {
    const s = makeSession({ [ROLE_CLAIM]: "admin" });
    expect(hasRole(s, "admin")).toBe(true);
    expect(hasRole(s, "super_admin")).toBe(false);
  });

  it("matches any in role list", () => {
    const s = makeSession({ [ROLE_CLAIM]: "viewer" });
    expect(hasRole(s, ["admin", "viewer"])).toBe(true);
    expect(hasRole(s, ["admin", "super_admin"])).toBe(false);
  });

  it("returns false for null session", () => {
    expect(hasRole(null, "admin")).toBe(false);
  });
});

describe("hasAccessToBucket", () => {
  it("super_admin has access to any bucket (bypass)", () => {
    const s = makeSession({ [ROLE_CLAIM]: "super_admin", [BUCKETS_CLAIM]: [] });
    expect(hasAccessToBucket(s, "any-bucket")).toBe(true);
  });

  it("admin/viewer only have access to assigned buckets", () => {
    const s = makeSession({
      [ROLE_CLAIM]: "admin",
      [BUCKETS_CLAIM]: ["b1", "b2"],
    });
    expect(hasAccessToBucket(s, "b1")).toBe(true);
    expect(hasAccessToBucket(s, "b3")).toBe(false);
  });

  it("returns false for null session", () => {
    expect(hasAccessToBucket(null, "b1")).toBe(false);
  });
});

describe("requireRole", () => {
  it("passes silently when role matches", () => {
    const s = makeSession({ [ROLE_CLAIM]: "admin" });
    expect(() => requireRole(s, "admin")).not.toThrow();
    expect(() => requireRole(s, ["admin", "super_admin"])).not.toThrow();
  });

  it("throws ForbiddenError when role missing", () => {
    const s = makeSession();
    expect(() => requireRole(s, "admin")).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when role mismatches", () => {
    const s = makeSession({ [ROLE_CLAIM]: "viewer" });
    expect(() => requireRole(s, "admin")).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when session null", () => {
    expect(() => requireRole(null, "admin")).toThrow(ForbiddenError);
  });
});
