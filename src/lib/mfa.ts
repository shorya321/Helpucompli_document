import type { Role } from "@/types";
import type { SessionData } from "@/lib/auth-guard";
import { ForbiddenError, getRole, requireRole } from "@/lib/auth-guard";

// RFC 8176 amr values. We accept only the two that Auth0 step-up guidance
// treats as definitive MFA signals:
//   - "mfa"  : Auth0's aggregate signal (any configured second factor)
//   - "otp"  : time-based / HOTP / push OTP
// Explicitly rejected:
//   - "hwk" / "swk" : single-factor proof-of-possession per RFC 8176
//     (WebAuthn usernameless can satisfy these WITHOUT a second factor)
//   - "sms"         : deprecated for AAL2 healthcare / HIPAA-equivalent
//     assurance (NIST SP 800-63B). Re-add only if a compensating control
//     lives in the Auth0 Action (e.g., explicit factor-chain check).
// Ref: https://auth0.com/docs/secure/multi-factor-authentication/step-up-authentication/configure-step-up-authentication-for-web-apps#validate-id-tokens-for-mfa
export const MFA_AMR_VALUES: readonly string[] = ["mfa", "otp"];
const PRIVILEGED_ROLES: readonly Role[] = ["superadmin", "admin"];

export function roleRequiresMfa(role: Role | null): boolean {
  if (!role) return false;
  return (PRIVILEGED_ROLES as readonly string[]).includes(role);
}

export function hasMfa(session: SessionData | null | undefined): boolean {
  if (!session?.user) return false;
  const amr = session.user.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((m) => typeof m === "string" && MFA_AMR_VALUES.includes(m));
}

export function requireMfaForPrivilegedRole(
  session: SessionData | null | undefined,
): void {
  const role = getRole(session);
  if (!roleRequiresMfa(role)) return;
  if (!hasMfa(session)) {
    throw new ForbiddenError(
      `MFA required for role '${role}'. Complete MFA challenge and re-authenticate.`,
    );
  }
}

export function requireRoleWithMfa(
  session: SessionData | null | undefined,
  allowed: Role | readonly Role[],
): void {
  requireRole(session, allowed);
  requireMfaForPrivilegedRole(session);
}
