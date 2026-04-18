"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";

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
      style={{ display: "contents" }}
    >
      {children}
      {open ? (
        <ul
          ref={menuRef}
          role="menu"
          aria-label="Document actions"
          style={{
            position: "fixed",
            top: open.y,
            left: open.x,
            zIndex: 50,
            listStyle: "none",
            padding: "0.25rem",
            margin: 0,
            background: "#FFFFFF",
            border: `1px solid ${BRAND.colors.dark}26`,
            borderRadius: "0.5rem",
            boxShadow: "0 8px 24px rgba(30,41,59,0.15)",
            fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
            fontSize: "0.8125rem",
            minWidth: "10rem",
          }}
        >
          {items.map((it) => {
            const disabled = it.disabled === true;
            const color = disabled
              ? "rgba(30,41,59,0.4)"
              : it.danger
              ? BRAND.colors.pink
              : BRAND.colors.dark;
            const style: React.CSSProperties = {
              display: "block",
              padding: "0.4375rem 0.625rem",
              borderRadius: "0.375rem",
              color,
              textDecoration: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              userSelect: "none",
            };
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
                    style={style}
                  >
                    {it.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    onClick={onPick}
                    style={{
                      ...style,
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      fontFamily: "inherit",
                      fontSize: "inherit",
                    }}
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

// Helper: builds the standard document-action menu. Keeps the set of
// action hrefs in one place so file-list and details-page stay in
// sync.
export function buildDocumentMenu({
  bucketId,
  s3Key,
  canHardDelete,
  basePath = "/documents",
}: {
  readonly bucketId: string;
  readonly s3Key: string;
  readonly canHardDelete: boolean;
  readonly basePath?: string;
}): ReadonlyArray<ContextMenuItem> {
  const q = (op: string) =>
    `${basePath}?op=${op}&bucketId=${encodeURIComponent(bucketId)}&s3Key=${encodeURIComponent(s3Key)}`;
  return [
    { key: "preview", label: "View details", href: q("preview") },
    { key: "download", label: "Download", href: q("download") },
    { key: "move", label: "Move to…", href: q("move") },
    { key: "copy", label: "Copy to…", href: q("copy") },
    {
      key: "link",
      label: "Generate link",
      href: q("link"),
      disabled: true, // F9 wires the link engine
    },
    { key: "delete", label: "Delete", href: q("delete"), danger: true },
    ...(!canHardDelete
      ? []
      : [
          {
            key: "hard-delete",
            label: "Delete permanently",
            href: q("hard-delete"),
            danger: true,
          } as ContextMenuItem,
        ]),
  ];
}
