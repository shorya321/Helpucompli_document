import type { Role } from "@/types";
import type { SessionData } from "@/lib/auth-guard";
import { ForbiddenError, getRole, requireRole } from "@/lib/auth-guard";

const MFA_AMR_VALUES: readonly string[] = ["mfa", "otp", "hwk", "sms", "swk"];
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
