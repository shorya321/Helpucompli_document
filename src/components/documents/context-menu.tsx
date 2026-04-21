"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  readonly key: string;
  readonly label: string;
  readonly href?: string;
  readonly onSelect?: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}

interface ContextMenuProps {
  readonly items: ReadonlyArray<ContextMenuItem>;
  readonly children: React.ReactNode;
}

// Cursor-position-anchored right-click menu. Wraps any child element
// and opens an absolutely-positioned menu on contextmenu. Closes on:
//   - outside click (document-level listener)
//   - Escape key
//   - any menu item selection
export function ContextMenu({ items, children }: ContextMenuProps) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);

  const onContext = useCallback((ev: React.MouseEvent) => {
    ev.preventDefault();
    setOpen({ x: ev.clientX, y: ev.clientY });
  }, []);

  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        close();
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <span
      onContextMenu={onContext}
      className="contents"
    >
      {children}
      {open ? (
        <ul
          ref={menuRef}
          role="menu"
          aria-label="Document actions"
          style={{ top: open.y, left: open.x }}
          className="border-border bg-popover text-popover-foreground fixed z-50 m-0 min-w-40 list-none rounded-md border p-1 text-sm shadow-md"
        >
          {items.map((it) => {
            const disabled = it.disabled === true;
            const baseClass =
              "block w-full rounded-md px-2.5 py-1.5 text-left no-underline select-none";
            const toneClass = disabled
              ? "text-muted-foreground cursor-not-allowed"
              : it.danger
                ? "text-destructive hover:bg-destructive/10 cursor-pointer"
                : "text-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer";
            const cls = `${baseClass} ${toneClass}`;
            const onPick = () => {
              if (disabled) return;
              close();
              it.onSelect?.();
            };
            return (
              <li key={it.key} role="none">
                {it.href ? (
                  <a
                    role="menuitem"
                    href={disabled ? undefined : it.href}
                    aria-disabled={disabled || undefined}
                    onClick={disabled ? (e) => e.preventDefault() : close}
                    className={cls}
                  >
                    {it.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    onClick={onPick}
                    className={`${cls} border-none bg-transparent font-[inherit] text-[inherit]`}
                  >
                    {it.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </span>
  );
}

// buildDocumentMenu is exported from ./context-menu-items (non-'use
// client' module) so server components can call it. Importing it
// through this file would re-export it as a client reference.
