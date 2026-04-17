import { describe, expect, it } from "vitest";
import type { SessionData } from "@/lib/auth-guard";
import { ROLE_CLAIM } from "@/lib/auth-guard";
import { hasMfa, requireMfaForPrivilegedRole, roleRequiresMfa } from "@/lib/mfa";

const makeSession = (
  claims: Record<string, unknown> = {},
): SessionData =>
  ({
    user: { sub: "auth0|test", ...claims },
  }) as SessionData;

describe("roleRequiresMfa", () => {
  it("requires MFA for superadmin and admin", () => {
    expect(roleRequiresMfa("superadmin")).toBe(true);
    expect(roleRequiresMfa("admin")).toBe(true);
  });

  it("does not require MFA for viewer", () => {
    expect(roleRequiresMfa("viewer")).toBe(false);
  });

  it("does not require MFA for null role", () => {
    expect(roleRequiresMfa(null)).toBe(false);
  });
});

describe("hasMfa", () => {
  it("true when amr contains 'mfa'", () => {
    const s = makeSession({ amr: ["pwd", "mfa"] });
    expect(hasMfa(s)).toBe(true);
  });

  it("true when amr contains 'otp'", () => {
    const s = makeSession({ amr: ["pwd", "otp"] });
    expect(hasMfa(s)).toBe(true);
  });

  it("false when amr missing mfa methods", () => {
    expect(hasMfa(makeSession({ amr: ["pwd"] }))).toBe(false);
  });

  it("false when amr missing entirely", () => {
    expect(hasMfa(makeSession())).toBe(false);
  });

  it("false for null session", () => {
    expect(hasMfa(null)).toBe(false);
  });

  it("false when amr is a truthy non-array value (fail-closed)", () => {
    // security review: Auth0 always emits amr as an array per OIDC.
    // A scalar string must not satisfy the MFA check.
    const s = makeSession({ amr: "mfa" });
    expect(hasMfa(s)).toBe(false);
  });

  it("false when amr contains ONLY 'hwk' (single-factor WebAuthn per RFC 8176)", () => {
    const s = makeSession({ amr: ["pwd", "hwk"] });
    expect(hasMfa(s)).toBe(false);
  });

  it("false when amr contains ONLY 'swk' (single-factor software proof-of-possession)", () => {
    const s = makeSession({ amr: ["pwd", "swk"] });
    expect(hasMfa(s)).toBe(false);
  });

  it("false when amr contains ONLY 'sms' (deprecated for HIPAA-equivalent assurance)", () => {
    const s = makeSession({ amr: ["pwd", "sms"] });
    expect(hasMfa(s)).toBe(false);
  });
});

describe("requireMfaForPrivilegedRole", () => {
  it("passes for viewer without MFA", () => {
    const s = makeSession({ [ROLE_CLAIM]: "viewer" });
    expect(() => requireMfaForPrivilegedRole(s)).not.toThrow();
  });

  it("passes for admin with MFA", () => {
    const s = makeSession({ [ROLE_CLAIM]: "admin", amr: ["pwd", "mfa"] });
    expect(() => requireMfaForPrivilegedRole(s)).not.toThrow();
  });

  it("throws for admin without MFA", () => {
    const s = makeSession({ [ROLE_CLAIM]: "admin", amr: ["pwd"] });
    expect(() => requireMfaForPrivilegedRole(s)).toThrow(/MFA/i);
  });

  it("throws for superadmin without MFA", () => {
    const s = makeSession({ [ROLE_CLAIM]: "superadmin" });
    expect(() => requireMfaForPrivilegedRole(s)).toThrow(/MFA/i);
  });

  it("passes for null session (no role to gate)", () => {
    expect(() => requireMfaForPrivilegedRole(null)).not.toThrow();
  });
});
