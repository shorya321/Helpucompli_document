"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ConfigDrawer } from "@/components/layout/config-drawer";
import { ProfileDropdown } from "@/components/layout/profile-dropdown";
import { SearchTrigger } from "@/components/layout/search-trigger";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import type { Role } from "@/types";

export interface TopbarUser {
  readonly name: string | null | undefined;
  readonly email: string | null | undefined;
}

interface TopbarProps {
  readonly user: TopbarUser;
  readonly role: Role;
}

// 1:1 port of satnaing/shadcn-admin src/components/layout/header.tsx.
// Scroll offset > 10px toggles the frosted-glass after:-pseudo
// background + elevates a subtle shadow. Scroll is read from the
// document scrollingElement, matching the reference.
export function Topbar({ user, role }: TopbarProps) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setOffset(
        document.body.scrollTop || document.documentElement.scrollTop,
      );
    };
    document.addEventListener("scroll", onScroll, { passive: true });
    return () => document.removeEventListener("scroll", onScroll);
  }, []);

  const isElevated = offset > 10;

  return (
    <header
      className={cn(
        "header-fixed peer/header z-50 h-16 w-[inherit] sticky top-0",
        isElevated ? "shadow" : "shadow-none",
      )}
    >
      <div
        className={cn(
          "relative flex h-full items-center gap-3 p-4 sm:gap-4",
          isElevated &&
            "after:absolute after:inset-0 after:-z-10 after:bg-background/20 after:backdrop-blur-lg",
        )}
      >
        <SidebarTrigger variant="outline" className="max-md:scale-125" />
        <Separator orientation="vertical" className="h-6" />

        <div className="me-auto max-w-sm flex-1">
          <SearchTrigger />
        </div>

        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown user={user} role={role} />
      </div>
    </header>
  );
}
