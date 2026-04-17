import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getRole } from "@/lib/auth-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

interface LayoutProps {
  readonly children: React.ReactNode;
}

export default async function DashboardLayout({ children }: LayoutProps) {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  const role = getRole(session);
  if (!role) {
    redirect("/access-denied");
  }

  const user = {
    name: (session.user.name as string | null | undefined) ?? null,
    email: (session.user.email as string | null | undefined) ?? null,
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: BRAND.colors.light,
      }}
    >
      <Sidebar role={role} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Topbar user={user} role={role} />
        <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
      </div>
    </div>
  );
}
