"use client";

import { LogOut, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Role } from "@/types";

export interface ProfileInfo {
  readonly id: string;
  readonly name: string | null | undefined;
  readonly email: string | null | undefined;
}

interface ProfileDropdownProps {
  readonly user: ProfileInfo;
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

export function ProfileDropdown({ user, role }: ProfileDropdownProps) {
  const displayName =
    user.name && user.name.length > 0
      ? user.name
      : user.email && user.email.length > 0
        ? user.email
        : "Signed in";
  const initials = initialsOf(displayName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Open profile menu for ${displayName}`}
          className="size-8 rounded-full"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-[0.7rem] font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
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
                {ROLE_LABEL[role]}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href={`/users/${user.id}`}>
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
          {/* Plain anchor — Auth0 v4 proxy needs a document navigation.
              Routes through /api/auth/audit-logout so the LOGOUT row is
              written before Auth0 SDK clears the session at /auth/logout. */}
          <a href="/api/auth/audit-logout">
            <LogOut aria-hidden="true" />
            Sign out
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
