"use client";

import { BRAND } from "@/lib/brand";
import { BrandLogo } from "@/components/layout/brand-logo";
import type { Role } from "@/types";

export interface TopbarUser {
  readonly name: string | null | undefined;
  readonly email: string;
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

export function Topbar({ user, role }: TopbarProps) {
  const displayName = user.name && user.name.length > 0 ? user.name : user.email;
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1.25rem",
        borderBottom: `1px solid ${BRAND.colors.dark}1A`,
        background: BRAND.colors.light,
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
      }}
    >
      <BrandLogo />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          color: BRAND.colors.dark,
        }}
      >
        <span style={{ fontWeight: 500 }}>{displayName}</span>
        <span
          aria-label={`Role: ${ROLE_LABEL[role]}`}
          style={{
            background: BRAND.colors.blue,
            color: BRAND.colors.light,
            padding: "0.125rem 0.5rem",
            borderRadius: "0.375rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            textTransform: "lowercase",
          }}
        >
          {ROLE_LABEL[role].toLowerCase()}
        </span>
        <a
          href="/auth/logout"
          style={{
            color: BRAND.colors.pink,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Logout
        </a>
      </div>
    </header>
  );
}
