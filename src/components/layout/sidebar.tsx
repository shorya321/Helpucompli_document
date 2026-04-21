"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FileText,
  FolderKanban,
  Home,
  Link2,
  Shield,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/layout/brand-logo";
import { ModeToggle } from "@/components/mode-toggle";
import {
  DASHBOARD_NAV_ITEMS,
  filterNavForRole,
  type DashboardNavItem,
} from "@/lib/dashboard-nav";
import type { Role } from "@/types";

interface SidebarProps {
  readonly role: Role;
}

const NAV_ICONS: Record<string, LucideIcon> = {
  "/": Home,
  "/buckets": FolderKanban,
  "/documents": FileText,
  "/policies": Shield,
  "/links": Link2,
  "/audit": Activity,
  "/users": Users,
};

function iconFor(item: DashboardNavItem): LucideIcon {
  return NAV_ICONS[item.href] ?? FileText;
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname() ?? "/";
  const items = filterNavForRole(DASHBOARD_NAV_ITEMS, role);

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center justify-between gap-2 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <BrandLogo className="group-data-[collapsible=icon]:[&>span:last-child]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                const Icon = iconFor(item);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                    >
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <Icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center justify-between gap-2 px-1 py-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
          <ModeToggle />
        </div>
      </SidebarFooter>
    </SidebarRoot>
  );
}
