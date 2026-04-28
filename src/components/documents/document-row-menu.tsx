"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ContextMenuItem } from "@/components/documents/context-menu";

interface DocumentRowMenuProps {
  readonly items: ReadonlyArray<ContextMenuItem>;
}

// Kebab dropdown rendered at the right end of each file row. Mirrors
// the right-click ContextMenu items so users get the same actions
// without needing to know about right-click. Reuses buildDocumentMenu()
// from context-menu-items so role-gating stays in one place.
export function DocumentRowMenu({ items }: DocumentRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Document actions"
          className="size-8"
          // Stop the click from bubbling to the row's onContextMenu /
          // future row-level handlers — the kebab is its own affordance.
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {items.map((it) => {
          const disabled = it.disabled === true;
          const danger = it.danger === true;
          const className = danger
            ? "text-destructive focus:text-destructive focus:bg-destructive/10"
            : undefined;

          if (it.href) {
            return (
              <DropdownMenuItem
                key={it.key}
                asChild
                disabled={disabled}
                className={className}
              >
                <Link href={it.href}>{it.label}</Link>
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem
              key={it.key}
              disabled={disabled}
              className={className}
              onSelect={() => {
                if (disabled) return;
                it.onSelect?.();
              }}
            >
              {it.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
