import type { Role } from "@/types";

export interface DashboardNavItem {
  readonly href: string;
  readonly label: string;
  readonly roles: readonly Role[];
}

const ALL: readonly Role[] = ["superadmin", "admin", "viewer"];
const ADMIN_UP: readonly Role[] = ["superadmin", "admin"];
const SUPER_ONLY: readonly Role[] = ["superadmin"];

export const DASHBOARD_NAV_ITEMS: readonly DashboardNavItem[] = [
  { href: "/", label: "Dashboard", roles: ALL },
  { href: "/buckets", label: "Buckets", roles: ADMIN_UP },
  { href: "/documents", label: "Documents", roles: ALL },
  { href: "/policies", label: "Policies", roles: ADMIN_UP },
  { href: "/links", label: "Links", roles: ALL },
  { href: "/audit", label: "Audit Log", roles: ADMIN_UP },
  { href: "/users", label: "Users", roles: SUPER_ONLY },
] as const;

export function filterNavForRole(
  items: readonly DashboardNavItem[],
  role: Role | null,
): readonly DashboardNavItem[] {
  if (role === null) return [];
  return items.filter((item) => item.roles.includes(role));
}
