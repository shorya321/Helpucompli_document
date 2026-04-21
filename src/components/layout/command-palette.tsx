"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useSearch } from "@/components/layout/search-provider";
import {
  DASHBOARD_SIDEBAR_GROUPS,
  filterGroupsForRole,
  type NavItemConfig,
} from "@/lib/sidebar-groups";
import type { Role } from "@/types";

interface CommandPaletteProps {
  readonly role: Role;
}

function flattenItems(items: readonly NavItemConfig[]): NavItemConfig[] {
  const out: NavItemConfig[] = [];
  for (const item of items) {
    out.push(item);
    if (item.children) out.push(...flattenItems(item.children));
  }
  return out;
}

export function CommandPalette({ role }: CommandPaletteProps) {
  const router = useRouter();
  const { open, setOpen } = useSearch();
  const groups = filterGroupsForRole(DASHBOARD_SIDEBAR_GROUPS, role);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {groups.map((group, idx) => (
          <div key={group.title}>
            {idx > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={group.title}>
              {flattenItems(group.items).map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={`${group.title} ${item.label}`}
                    onSelect={() => go(item.href)}
                  >
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
