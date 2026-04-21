import {
  Activity,
  FileText,
  FolderKanban,
  Home,
  Link2,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/types";

export interface NavItemConfig {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly roles: readonly Role[];
  readonly badge?: string | number;
  readonly children?: readonly NavItemConfig[];
}

export interface NavGroupConfig {
  readonly title: string;
  readonly items: readonly NavItemConfig[];
}

const ALL: readonly Role[] = ["superadmin", "admin", "viewer"];
const ADMIN_UP: readonly Role[] = ["superadmin", "admin"];
const SUPER_ONLY: readonly Role[] = ["superadmin"];

export const DASHBOARD_SIDEBAR_GROUPS: readonly NavGroupConfig[] = [
  {
    title: "Workspace",
    items: [
      { href: "/", label: "Dashboard", icon: Home, roles: ALL },
      { href: "/buckets", label: "Buckets", icon: FolderKanban, roles: ADMIN_UP },
      { href: "/documents", label: "Documents", icon: FileText, roles: ALL },
      { href: "/links", label: "Links", icon: Link2, roles: ALL },
    ],
  },
  {
    title: "Management",
    items: [
      { href: "/policies", label: "Policies", icon: Shield, roles: ADMIN_UP },
      { href: "/users", label: "Users", icon: Users, roles: SUPER_ONLY },
      { href: "/audit", label: "Audit Log", icon: Activity, roles: ADMIN_UP },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, roles: ALL },
    ],
  },
] as const;

function filterItemsForRole(
  items: readonly NavItemConfig[],
  role: Role,
): readonly NavItemConfig[] {
  const filtered: NavItemConfig[] = [];
  for (const item of items) {
    if (!item.roles.includes(role)) continue;
    if (item.children) {
      const children = filterItemsForRole(item.children, role);
      filtered.push({ ...item, children });
    } else {
      filtered.push(item);
    }
  }
  return filtered;
}

export function filterGroupsForRole(
  groups: readonly NavGroupConfig[],
  role: Role | null,
): readonly NavGroupConfig[] {
  if (role === null) return [];
  const result: NavGroupConfig[] = [];
  for (const group of groups) {
    const items = filterItemsForRole(group.items, role);
    if (items.length === 0) continue;
    result.push({ title: group.title, items });
  }
  return result;
}
