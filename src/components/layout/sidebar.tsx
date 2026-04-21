"use client";

import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/layout/brand-logo";
import { NavGroup } from "@/components/layout/nav-group";
import { NavUser, type NavUserInfo } from "@/components/layout/nav-user";
import {
  DASHBOARD_SIDEBAR_GROUPS,
  filterGroupsForRole,
} from "@/lib/sidebar-groups";
import type { Role } from "@/types";

interface SidebarProps {
  readonly role: Role;
  readonly user: NavUserInfo;
}

export function Sidebar({ role, user }: SidebarProps) {
  const groups = filterGroupsForRole(DASHBOARD_SIDEBAR_GROUPS, role);

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center justify-between gap-2 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <BrandLogo className="group-data-[collapsible=icon]:[&>span:last-child]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <NavGroup key={group.title} group={group} />
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <NavUser user={user} role={role} />
      </SidebarFooter>
    </SidebarRoot>
  );
}
