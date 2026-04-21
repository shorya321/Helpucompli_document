import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ensureUser } from "@/lib/ensure-user";
import {
  asUserListPrisma,
  listUsers,
  parseUserListQuery,
  type UserListRow,
} from "@/lib/user-list";
import { UserTable } from "@/components/users/user-table";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";

export const dynamic = "force-dynamic";

interface UsersPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const role = await resolveRole(session);
  if (role !== "superadmin" && role !== "admin") {
    redirect("/");
  }

  const params = await searchParams;
  const query = parseUserListQuery(params) ?? {
    page: 1,
    pageSize: 25,
    sort: "createdAt" as const,
    dir: "desc" as const,
  };

  let rows: ReadonlyArray<UserListRow> = [];
  let total = 0;
  let loadError = false;
  let actorId: string | null = null;
  try {
    const [actor, result] = await Promise.all([
      ensureUser(prisma, { session, role }),
      listUsers(asUserListPrisma(prisma), query),
    ]);
    actorId = actor.id;
    rows = result.users;
    total = result.total;
  } catch {
    loadError = true;
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground m-0 text-2xl font-bold tracking-tight">
            Users
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage who can access the document repository.
          </p>
        </div>
        <InviteUserDialog canInviteAdmin={role === "superadmin"} />
      </header>

      {loadError && (
        <p role="alert" className="text-destructive text-sm">
          Unable to load users. Try again.
        </p>
      )}

      <UserTable
        rows={rows}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        query={{ q: query.q, role: query.role, status: query.status }}
        actorRole={role}
        actorId={actorId}
      />
    </section>
  );
}
