import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { Role } from "@/types";
import { setAuth0UserBlocked } from "@/lib/auth0-management";
import { logAudit, type AuditPrisma } from "@/lib/audit";

export type UserStatus = "active" | "disabled";

export const userStatusUpdateSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

export type UserStatusUpdateInput = z.infer<typeof userStatusUpdateSchema>;

export interface CanChangeStatusArgs {
  readonly actorRole: Role;
  readonly targetCurrentRole: Role;
  readonly newStatus: UserStatus;
  readonly isSelf: boolean;
}

// Hierarchy mirrors F10.4 role-change:
// - Self-disable is blocked (cannot lock yourself out of the platform).
// - admin cannot touch a superadmin target.
// - viewer cannot change any status.
// Re-enable follows the same rules as disable — symmetry is intentional
// because an admin who can disable a user must also be able to undo it.
export function canChangeStatus({
  actorRole,
  targetCurrentRole,
  newStatus: _newStatus,
  isSelf,
}: CanChangeStatusArgs): boolean {
  if (isSelf) return false;
  if (actorRole === "superadmin") return true;
  if (actorRole === "admin") {
    return targetCurrentRole !== "superadmin";
  }
  return false;
}

export class ForbiddenStatusChangeError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenStatusChangeError";
  }
}

export interface StatusChangeActor {
  readonly userId: string;
  readonly role: Role;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface StatusChangeArgs {
  readonly targetUserId: string;
  readonly newStatus: UserStatus;
  readonly actor: StatusChangeActor;
}

export interface StatusChangeResult {
  readonly id: string;
  readonly auth0Id: string;
  readonly status: UserStatus;
}

type StatusChangePrisma = Pick<PrismaClient, "user"> & AuditPrisma;

export async function changeUserStatus(
  prisma: StatusChangePrisma,
  args: StatusChangeArgs,
): Promise<StatusChangeResult | null> {
  const target = (await prisma.user.findUnique({
    where: { id: args.targetUserId },
    select: { id: true, auth0Id: true, role: true, status: true },
  })) as
    | { id: string; auth0Id: string; role: Role; status: UserStatus }
    | null;
  if (!target) return null;

  const isSelf = target.id === args.actor.userId;
  if (
    !canChangeStatus({
      actorRole: args.actor.role,
      targetCurrentRole: target.role,
      newStatus: args.newStatus,
      isSelf,
    })
  ) {
    throw new ForbiddenStatusChangeError(
      isSelf ? "Forbidden: cannot disable yourself" : "Forbidden: role hierarchy",
    );
  }

  if (target.status === args.newStatus) {
    return {
      id: target.id,
      auth0Id: target.auth0Id,
      status: target.status,
    };
  }

  // Auth0 first — the `blocked` flag on Auth0 is what actually stops
  // the user from authenticating. If Auth0 PATCH fails, do not update
  // the local mirror (status would lie about access).
  const blocked = args.newStatus === "disabled";
  await setAuth0UserBlocked(target.auth0Id, blocked);

  const updated = (await prisma.user.update({
    where: { id: target.id },
    data: { status: args.newStatus },
    select: { id: true, auth0Id: true, status: true },
  })) as { id: string; auth0Id: string; status: UserStatus };

  await logAudit(prisma, {
    userId: args.actor.userId,
    action: blocked ? "USER_DISABLE" : "USER_ENABLE",
    targetType: "user",
    targetId: target.id,
    metadata: {
      fromStatus: target.status,
      toStatus: args.newStatus,
    },
    ipAddress: args.actor.ipAddress,
    userAgent: args.actor.userAgent,
  });

  return updated;
}
