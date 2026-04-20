import { z } from "zod";
import type { PrismaClient, Role as DbRole } from "@prisma/client";
import type { Role } from "@/types";
import { replaceAuth0RoleByName } from "@/lib/auth0-management";
import { logAudit, type AuditPrisma } from "@/lib/audit";

export const userRoleUpdateSchema = z.object({
  role: z.enum(["superadmin", "admin", "viewer"]),
});

export type UserRoleUpdateInput = z.infer<typeof userRoleUpdateSchema>;

export interface CanChangeRoleArgs {
  readonly actorRole: Role;
  readonly targetCurrentRole: Role;
  readonly newRole: Role;
  readonly isSelf: boolean;
}

// Hierarchy rule (F10.4):
// - No actor can change their own role (self-demotion block).
// - superadmin can change any other user to any role.
// - admin can only change NON-superadmin targets AND only set newRole
//   to viewer (never promote to admin or superadmin).
// - viewer cannot change any role.
// Last-superadmin protection is NOT enforced here — deferred to F11
// security hardening; operator runbook must document it.
export function canChangeRole({
  actorRole,
  targetCurrentRole,
  newRole,
  isSelf,
}: CanChangeRoleArgs): boolean {
  if (isSelf) return false;
  if (actorRole === "superadmin") return true;
  if (actorRole === "admin") {
    if (targetCurrentRole === "superadmin") return false;
    return newRole === "viewer";
  }
  return false;
}

export class ForbiddenRoleChangeError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenRoleChangeError";
  }
}

export interface RoleChangeActor {
  readonly userId: string;
  readonly auth0Id: string;
  readonly role: Role;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface RoleChangeArgs {
  readonly targetUserId: string;
  readonly newRole: Role;
  readonly actor: RoleChangeActor;
}

export interface RoleChangeResult {
  readonly id: string;
  readonly auth0Id: string;
  readonly role: Role;
}

type RoleChangePrisma = Pick<PrismaClient, "user"> & AuditPrisma;

// Returns null when targetUserId does not exist (caller surfaces 404).
// Throws ForbiddenRoleChangeError on hierarchy violations.
export async function changeUserRole(
  prisma: RoleChangePrisma,
  args: RoleChangeArgs,
): Promise<RoleChangeResult | null> {
  const target = await prisma.user.findUnique({
    where: { id: args.targetUserId },
    select: { id: true, auth0Id: true, role: true },
  });
  if (!target) return null;

  const isSelf = target.id === args.actor.userId;

  if (
    !canChangeRole({
      actorRole: args.actor.role,
      targetCurrentRole: target.role as Role,
      newRole: args.newRole,
      isSelf,
    })
  ) {
    throw new ForbiddenRoleChangeError(
      isSelf ? "Forbidden: cannot change your own role" : "Forbidden: role hierarchy",
    );
  }

  // No-op fast path — identical role requires neither Auth0 write nor
  // audit entry. Keeps audit trail signal-to-noise high.
  if (target.role === args.newRole) {
    return {
      id: target.id,
      auth0Id: target.auth0Id,
      role: target.role as Role,
    };
  }

  // Auth0 first so a failure there aborts the DB + audit write. Once
  // DB is mutated the audit is on the success path only.
  await replaceAuth0RoleByName(target.auth0Id, args.newRole);

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { role: args.newRole as DbRole },
    select: { id: true, auth0Id: true, role: true },
  });

  await logAudit(prisma, {
    userId: args.actor.userId,
    action: "USER_ROLE_CHANGE",
    targetType: "user",
    targetId: target.id,
    metadata: {
      fromRole: target.role,
      toRole: args.newRole,
    },
    ipAddress: args.actor.ipAddress,
    userAgent: args.actor.userAgent,
  });

  return {
    id: updated.id,
    auth0Id: updated.auth0Id,
    role: updated.role as Role,
  };
}
