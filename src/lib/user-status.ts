import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { Role } from "@/types";
import {
  Auth0UserNotFoundError,
  setAuth0UserBlocked,
} from "@/lib/auth0-management";
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
  // False when the corresponding Auth0 account could not be updated
  // (e.g. 404 — operator deleted it in the dashboard). Local DB + audit
  // write still proceed because disable/enable intent is satisfied: the
  // missing Auth0 user cannot authenticate regardless of our flag. UI
  // surfaces a warning so the operator knows the DB is out of sync.
  readonly auth0Synced: boolean;
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
      auth0Synced: true,
    };
  }

  // Auth0 first — the `blocked` flag on Auth0 is what actually stops
  // the user from authenticating. A non-404 Auth0 failure aborts the
  // whole op so status never lies about access. A 404 (user deleted in
  // Auth0 dashboard, orphan local row) is handled explicitly: the user
  // is already effectively blocked upstream, so we still flip the local
  // mirror + audit, but mark auth0Synced=false so the UI can surface
  // the drift to the operator.
  const blocked = args.newStatus === "disabled";
  let auth0Synced = true;
  try {
    await setAuth0UserBlocked(target.auth0Id, blocked);
  } catch (err) {
    if (err instanceof Auth0UserNotFoundError) {
      auth0Synced = false;
    } else {
      throw err;
    }
  }

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
      auth0Synced,
    },
    ipAddress: args.actor.ipAddress,
    userAgent: args.actor.userAgent,
  });

  return { ...updated, auth0Synced };
}
