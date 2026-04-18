import type { PrismaClient, Role as DbRole } from "@prisma/client";
import type { Role } from "@/types";
import type { SessionData } from "@/lib/auth-guard";

export interface EnsureUserInput {
  readonly session: SessionData;
  readonly role: Role;
}

// Upsert the User row keyed by Auth0 sub. Caller MUST have already
// authenticated the session and resolved the role via resolveRole() —
// this helper is the DB-side of that resolution, not an auth check.
// Returns { id } for use as a FK (e.g. Bucket.createdBy).
//
// Intentionally only touches lastLoginAt on update: once a user exists
// their role + email are owned by the user-management module, not by
// whichever Auth0 claim happens to be present on the next request.
export async function ensureUser(
  prisma: Pick<PrismaClient, "user">,
  { session, role }: EnsureUserInput,
): Promise<{ id: string }> {
  const sub = session.user.sub;
  const rawEmail = session.user.email;
  const rawName = session.user.name;

  if (typeof rawEmail !== "string" || rawEmail.length === 0) {
    // Auth0 issues `email` whenever the `email` scope is in the auth
    // request (our Auth0Client config does). A missing email here means
    // a misconfigured tenant or a synthetic session — fail loud rather
    // than silently insert NULL into a UNIQUE NOT NULL column.
    throw new Error("Session missing email claim; cannot provision user");
  }
  const email = rawEmail;
  const name = typeof rawName === "string" && rawName.length > 0 ? rawName : null;

  return prisma.user.upsert({
    where: { auth0Id: sub },
    update: { lastLoginAt: new Date() },
    create: {
      auth0Id: sub,
      email,
      name,
      role: role as DbRole,
    },
    select: { id: true },
  });
}
