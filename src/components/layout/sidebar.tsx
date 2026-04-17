"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  DASHBOARD_NAV_ITEMS,
  filterNavForRole,
} from "@/lib/dashboard-nav";
import type { Role } from "@/types";

interface SidebarProps {
  readonly role: Role;
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname() ?? "/";
  const items = filterNavForRole(DASHBOARD_NAV_ITEMS, role);

  return (
    <nav
      aria-label="Primary"
      style={{
        width: "16rem",
        minHeight: "100vh",
        background: BRAND.colors.dark,
        color: BRAND.colors.light,
        padding: "1.5rem 0.75rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      {items.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            style={{
              display: "block",
              padding: "0.625rem 0.875rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              color: BRAND.colors.light,
              background: isActive ? BRAND.colors.pink : "transparent",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
