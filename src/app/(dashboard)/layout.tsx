import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { ensureUser } from "@/lib/ensure-user";
import { logLoginOnce } from "@/lib/log-login-once";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { SearchProvider } from "@/components/layout/search-provider";
import { CommandPalette } from "@/components/layout/command-palette";

export const dynamic = "force-dynamic";

interface LayoutProps {
  readonly children: React.ReactNode;
}

export default async function DashboardLayout({ children }: LayoutProps) {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  const role = await resolveRole(session);
  if (!role) {
    redirect("/access-denied");
  }
  // redirect() returns `never` (typed by next/navigation), so role is
  // correctly narrowed from `Role | null` to `Role` at this point.
  if (!role) throw new Error("unreachable: role narrowed by redirect");

  // ensureUser upserts the DB row keyed by Auth0 sub. The DB id is
  // passed to NavUser so the Account dropdown link can route to the
  // canonical user detail page (/users/[id]).
  const dbUser = await ensureUser(prisma, { session, role });

  // Best-effort, idempotent LOGIN audit row keyed by session.internal.sid.
  // Helper swallows errors and respects AUDIT_LOGIN_LOGOUT_ENABLED=false
  // kill-switch; never blocks render.
  await logLoginOnce(prisma, session, {
    userDbId: dbUser.id,
    headers: await headers(),
  });

  const user = {
    id: dbUser.id,
    name: (session.user.name as string | null | undefined) ?? null,
    email: (session.user.email as string | null | undefined) ?? null,
  };

  return (
    <SidebarProvider>
      <SearchProvider>
        <Sidebar role={role} user={user} />
        <SidebarInset>
          <Topbar user={user} role={role} />
          <main className="flex-1 p-6">{children}</main>
        </SidebarInset>
        <CommandPalette role={role} />
      </SearchProvider>
    </SidebarProvider>
  );
}
