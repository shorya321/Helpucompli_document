import type { Role } from "@/types";

export const ROLE_CLAIM = "https://docs.helpucompli.com/role" as const;
export const BUCKETS_CLAIM = "https://docs.helpucompli.com/assigned_buckets" as const;

const VALID_ROLES: readonly Role[] = ["super_admin", "admin", "viewer"] as const;

export interface SessionUser {
  readonly sub: string;
  readonly email?: string;
  readonly [key: string]: unknown;
}

export interface SessionData {
  readonly user: SessionUser;
  readonly [key: string]: unknown;
}

export class ForbiddenError extends Error {
  public readonly status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (VALID_ROLES as readonly string[]).includes(value);

export function getRole(session: SessionData | null | undefined): Role | null {
  if (!session?.user) return null;
  const claim = session.user[ROLE_CLAIM];
  return isRole(claim) ? claim : null;
}

export function getAssignedBuckets(
  session: SessionData | null | undefined,
): readonly string[] {
  if (!session?.user) return [];
  const claim = session.user[BUCKETS_CLAIM];
  if (!Array.isArray(claim)) return [];
  return claim.filter((b): b is string => typeof b === "string");
}

export function hasRole(
  session: SessionData | null | undefined,
  allowed: Role | readonly Role[],
): boolean {
  const role = getRole(session);
  if (!role) return false;
  const list = Array.isArray(allowed) ? allowed : [allowed as Role];
  return list.includes(role);
}

export function hasAccessToBucket(
  session: SessionData | null | undefined,
  bucketId: string,
): boolean {
  const role = getRole(session);
  if (!role) return false;
  if (role === "super_admin") return true;
  return getAssignedBuckets(session).includes(bucketId);
}

export function requireRole(
  session: SessionData | null | undefined,
  allowed: Role | readonly Role[],
): void {
  if (!hasRole(session, allowed)) {
    throw new ForbiddenError(
      `Requires role: ${Array.isArray(allowed) ? allowed.join("|") : allowed}`,
    );
  }
}
