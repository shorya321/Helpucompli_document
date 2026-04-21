"use client";

import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Role } from "@/types";

export interface TopbarUser {
  readonly name: string | null | undefined;
  readonly email: string | null | undefined;
}

interface TopbarProps {
  readonly user: TopbarUser;
  readonly role: Role;
}

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  viewer: "Viewer",
};

const ROLE_VARIANT: Record<Role, "default" | "secondary" | "outline"> = {
  superadmin: "default",
  admin: "secondary",
  viewer: "outline",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Topbar({ user, role }: TopbarProps) {
  const displayName =
    user.name && user.name.length > 0
      ? user.name
      : user.email && user.email.length > 0
        ? user.email
        : "Signed in";

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />

      <div className="ml-auto flex items-center gap-3">
        <Badge
          variant={ROLE_VARIANT[role]}
          aria-label={`Role: ${ROLE_LABEL[role]}`}
          className="font-mono text-[0.65rem] uppercase tracking-wide"
        >
          {ROLE_LABEL[role]}
        </Badge>

        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[0.65rem] font-semibold">
              {initialsOf(displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {displayName}
          </span>
        </div>

        <Separator orientation="vertical" className="h-4" />

        <Button variant="ghost" size="sm" asChild>
          <a href="/auth/logout" aria-label="Sign out">
            <LogOut aria-hidden="true" />
            <span className="hidden sm:inline">Logout</span>
          </a>
        </Button>
      </div>
    </header>
  );
}
