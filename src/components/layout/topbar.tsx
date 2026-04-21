"use client";

import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ConfigDrawer } from "@/components/layout/config-drawer";
import { ProfileDropdown } from "@/components/layout/profile-dropdown";
import { SearchTrigger } from "@/components/layout/search-trigger";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { useScrolled } from "@/hooks/use-scrolled";
import type { Role } from "@/types";

export interface TopbarUser {
  readonly name: string | null | undefined;
  readonly email: string | null | undefined;
}

interface TopbarProps {
  readonly user: TopbarUser;
  readonly role: Role;
}

export function Topbar({ user, role }: TopbarProps) {
  const scrolled = useScrolled(10);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 transition-[box-shadow,background-color]",
        scrolled &&
          "bg-background/20 shadow-sm backdrop-blur-lg supports-[backdrop-filter]:bg-background/60",
      )}
    >
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />

      <div className="me-auto max-w-sm flex-1">
        <SearchTrigger />
      </div>

      <ThemeSwitch />
      <ConfigDrawer />
      <ProfileDropdown user={user} role={role} />
    </header>
  );
}
