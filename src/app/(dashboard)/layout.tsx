import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

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

  const user = {
    name: (session.user.name as string | null | undefined) ?? null,
    email: (session.user.email as string | null | undefined) ?? null,
  };

  return (
    <SidebarProvider>
      <Sidebar role={role} />
      <SidebarInset>
        <Topbar user={user} role={role} />
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
