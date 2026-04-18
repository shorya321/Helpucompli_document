import { getUserRoles } from "@/lib/auth0-management";
import type { Role } from "@/types";

export const ROLE_CLAIM = "https://docs.helpucompli.com/role" as const;
export const BUCKETS_CLAIM = "https://docs.helpucompli.com/assigned_buckets" as const;

const VALID_ROLES: readonly Role[] = ["superadmin", "admin", "viewer"] as const;

const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
const roleCache = new Map<string, { role: Role | null; expiresAt: number }>();

// Test hook — resets the per-user role cache. Production paths must
// not call this. Used to keep resolve-role tests hermetic.
export function _resetRoleCache(): void {
  roleCache.clear();
}

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
  if (role === "superadmin") return true;
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

// Async role resolver. Claim-first (backward compat w/ Auth0 Action if
// the tenant has one configured), Management API fallback otherwise.
//
// Returns a Role-typed value only when the Auth0 assignment maps onto
// the app's Role union (superadmin | admin | viewer). Unknown role
// names from Auth0 yield null — the /access-denied flow handles that.
//
// Errors (Management API down, 429, invalid creds) fail closed: null,
// NOT cached, so recovery is possible once the API is reachable again.
export async function resolveRole(
  session: SessionData | null | undefined,
): Promise<Role | null> {
  // 1. Claim path — zero-cost when present. Kept for testing + future
  // Auth0 Action support without code changes.
  const claim = getRole(session);
  if (claim) return claim;

  const sub = session?.user?.sub;
  if (!sub || typeof sub !== "string") return null;

  // 2. Per-user cache lookup.
  const cached = roleCache.get(sub);
  if (cached && Date.now() < cached.expiresAt) return cached.role;

  // 3. Management API lookup. Any error path returns null without
  // caching, so a transient Auth0 outage does not lock the user out
  // for 5 minutes after the blip resolves.
  try {
    const roles = await getUserRoles(sub);
    const matched =
      roles
        .map((r) => r.name)
        .find((name): name is Role =>
          (VALID_ROLES as readonly string[]).includes(name),
        ) ?? null;
    roleCache.set(sub, {
      role: matched,
      expiresAt: Date.now() + ROLE_CACHE_TTL_MS,
    });
    return matched;
  } catch {
    return null;
  }
}

export async function resolveHasRole(
  session: SessionData | null | undefined,
  allowed: Role | readonly Role[],
): Promise<boolean> {
  const role = await resolveRole(session);
  if (!role) return false;
  const list = Array.isArray(allowed) ? allowed : [allowed as Role];
  return list.includes(role);
}
