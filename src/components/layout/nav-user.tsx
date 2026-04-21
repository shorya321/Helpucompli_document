"use client";

import { ChevronsUpDown, LogOut, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Role } from "@/types";

export interface NavUserInfo {
  readonly name: string | null | undefined;
  readonly email: string | null | undefined;
}

interface NavUserProps {
  readonly user: NavUserInfo;
  readonly role: Role;
}

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  viewer: "Viewer",
};

function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function NavUser({ user, role }: NavUserProps) {
  const { isMobile } = useSidebar();
  const displayName =
    user.name && user.name.length > 0
      ? user.name
      : user.email && user.email.length > 0
        ? user.email
        : "Signed in";
  const initials = initialsOf(displayName);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg text-[0.7rem] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email ?? ROLE_LABEL[role]}
                </span>
              </div>
              <ChevronsUpDown aria-hidden="true" className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg text-[0.7rem] font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayName}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email ?? ROLE_LABEL[role]}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <a href="/settings/profile">
                  <UserRound aria-hidden="true" />
                  Account
                </a>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              asChild
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              {/*
                Plain anchor — Auth0 v4 requires a full document navigation
                to /auth/logout so the proxy can execute the sign-out flow.
              */}
              <a href="/auth/logout">
                <LogOut aria-hidden="true" />
                Sign out
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
