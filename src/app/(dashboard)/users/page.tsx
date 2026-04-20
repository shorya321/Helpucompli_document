import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/prisma";
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
  try {
    const result = await listUsers(asUserListPrisma(prisma), query);
    rows = result.users;
    total = result.total;
  } catch {
    loadError = true;
  }

  return (
    <main
      style={{
        padding: "2rem",
        maxWidth: "80rem",
        margin: "0 auto",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Users</h1>
          <p style={{ color: "rgba(30,41,59,0.64)", margin: "0.25rem 0 0" }}>
            Manage who can access the document repository.
          </p>
        </div>
        <InviteUserDialog canInviteAdmin={role === "superadmin"} />
      </header>

      {loadError && (
        <p role="alert" style={{ color: BRAND.colors.pink }}>
          Unable to load users. Try again.
        </p>
      )}

      <UserTable
        rows={rows}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        query={{ q: query.q, role: query.role, status: query.status }}
      />
    </main>
  );
}
