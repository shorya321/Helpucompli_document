"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { NavGroupConfig, NavItemConfig } from "@/lib/sidebar-groups";

interface NavGroupProps {
  readonly group: NavGroupConfig;
}

function isItemActive(item: NavItemConfig, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function FlatItem({
  item,
  pathname,
}: {
  readonly item: NavItemConfig;
  readonly pathname: string;
}) {
  const Icon = item.icon;
  const active = isItemActive(item, pathname);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link href={item.href} aria-current={active ? "page" : undefined}>
          <Icon aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {item.badge !== undefined ? (
        <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function CollapsedDropdown({
  item,
  pathname,
}: {
  readonly item: NavItemConfig;
  readonly pathname: string;
}) {
  const Icon = item.icon;
  const active = isItemActive(item, pathname);
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton isActive={active} tooltip={item.label}>
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="min-w-48">
          <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {item.children?.map((child) => (
            <DropdownMenuItem key={child.href} asChild>
              <Link href={child.href}>
                <child.icon aria-hidden="true" />
                <span>{child.label}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function ExpandedWithChildren({
  item,
  pathname,
}: {
  readonly item: NavItemConfig;
  readonly pathname: string;
}) {
  const Icon = item.icon;
  const active = isItemActive(item, pathname);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link href={item.href} aria-current={active ? "page" : undefined}>
          <Icon aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      <SidebarMenuSub>
        {item.children?.map((child) => {
          const childActive = isItemActive(child, pathname);
          return (
            <SidebarMenuSubItem key={child.href}>
              <SidebarMenuSubButton asChild isActive={childActive}>
                <Link
                  href={child.href}
                  aria-current={childActive ? "page" : undefined}
                >
                  <child.icon aria-hidden="true" />
                  <span>{child.label}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          );
        })}
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}

export function NavGroup({ group }: NavGroupProps) {
  const pathname = usePathname() ?? "/";
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            if (!hasChildren) {
              return (
                <FlatItem key={item.href} item={item} pathname={pathname} />
              );
            }
            if (collapsed) {
              return (
                <CollapsedDropdown
                  key={item.href}
                  item={item}
                  pathname={pathname}
                />
              );
            }
            return (
              <ExpandedWithChildren
                key={item.href}
                item={item}
                pathname={pathname}
              />
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
