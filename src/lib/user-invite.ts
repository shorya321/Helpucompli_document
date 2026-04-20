import { z } from "zod";
import type { PrismaClient, Role as DbRole } from "@prisma/client";
import type { Role } from "@/types";
import {
  assignAuth0RoleByName,
  createAuth0User,
  createPasswordChangeTicket,
} from "@/lib/auth0-management";
import { sendInviteEmail } from "@/lib/email";
import { logAudit, type AuditPrisma } from "@/lib/audit";

// Invite payload schema — email is required and validated, name is
// optional (Auth0 fills from profile at first login if omitted), role
// is constrained to the app's Role union. No free-form scopes permitted
// here; role hierarchy enforcement is handled by canInviteWithRole.
export const inviteUserInputSchema = z.object({
  email: z.string().trim().min(1).email().max(254),
  name: z
    .string()
    .trim()
    .max(150)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  role: z.enum(["superadmin", "admin", "viewer"]),
});

export type InviteUserInput = z.infer<typeof inviteUserInputSchema>;

// Hierarchy rule: superadmin can grant any role; admin can only grant
// viewer. Viewer cannot invite at all. Called by the POST /api/users
// route AFTER role resolution and BEFORE any Auth0 side-effect so a
// would-be escalation is rejected without creating an Auth0 user.
export function canInviteWithRole(
  actorRole: Role,
  targetRole: Role,
): boolean {
  if (actorRole === "superadmin") return true;
  if (actorRole === "admin") return targetRole === "viewer";
  return false;
}

export interface InviteActor {
  readonly userId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly displayName: string | null;
}

export interface InviteUserResult {
  readonly id: string;
  readonly auth0Id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
  readonly ticket: string;
  // Whether the Resend-sent invitation email actually left the server.
  // False when RESEND_API_KEY / RESEND_FROM_EMAIL unset OR when Resend
  // returned a non-ok status. UI shows the ticket URL as a manual
  // fallback so operators can forward it out-of-band.
  readonly emailSent: boolean;
}

type InvitePrisma = Pick<PrismaClient, "user"> & AuditPrisma;

export async function inviteUser(
  prisma: InvitePrisma,
  args: { readonly input: InviteUserInput; readonly actor: InviteActor },
): Promise<InviteUserResult> {
  const { input, actor } = args;

  // Auth0 side-effects first. If createAuth0User throws (e.g. 409 dup
  // email or 429 rate limit) we abort without touching the DB or audit
  // — the invite was never created.
  const created = await createAuth0User({
    email: input.email,
    name: input.name,
  });

  // Role assignment is idempotent on Auth0's side but we only attempt
  // once per invite. If this throws we surface the error — operator
  // can re-invite or fix the role catalogue; the orphan Auth0 user is
  // acceptable since the ticket was never issued.
  await assignAuth0RoleByName(created.userId, input.role);

  const ticket = await createPasswordChangeTicket(created.userId);

  // Resend email delivery is non-fatal: if it fails (missing env,
  // Resend 4xx/5xx, network), we still return the ticket URL in the
  // API response so the operator can forward it manually. sendInviteEmail
  // itself swallows all errors and just reports {sent, reason}.
  const emailResult = await sendInviteEmail({
    to: created.email,
    activationUrl: ticket,
    inviterName: args.actor.displayName,
  });

  // Local DB upsert — keyed by Auth0 sub, so a re-invite of an
  // already-synced user still lands on the same row. status defaults
  // to 'active' per schema; F10.6 handles disable.
  const dbUser = await prisma.user.upsert({
    where: { auth0Id: created.userId },
    update: {
      email: created.email,
      name: input.name,
      role: input.role as DbRole,
    },
    create: {
      auth0Id: created.userId,
      email: created.email,
      name: input.name,
      role: input.role as DbRole,
    },
    select: { id: true },
  });

  await logAudit(prisma, {
    userId: actor.userId,
    action: "USER_INVITE",
    targetType: "user",
    targetId: dbUser.id,
    metadata: {
      auth0Id: created.userId,
      email: created.email,
      role: input.role,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return {
    id: dbUser.id,
    auth0Id: created.userId,
    email: created.email,
    name: input.name,
    role: input.role,
    ticket,
    emailSent: emailResult.sent,
  };
}
