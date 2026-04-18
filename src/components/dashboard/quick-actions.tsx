import Link from "next/link";
import { BRAND } from "@/lib/brand";
import {
  DASHBOARD_QUICK_ACTIONS,
  filterQuickActionsForRole,
  type QuickAction,
} from "@/lib/dashboard-quick-actions";
import type { Role } from "@/types";

interface QuickActionsProps {
  readonly role: Role;
}

function toneStyle(action: QuickAction): React.CSSProperties {
  const primary = action.tone === "primary";
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.625rem 1rem",
    borderRadius: "0.5rem",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "0.875rem",
    background: primary ? BRAND.colors.pink : "#FFFFFF",
    color: primary ? BRAND.colors.light : BRAND.colors.dark,
    border: primary ? "none" : `1px solid ${BRAND.colors.blue}`,
  };
}

export function QuickActions({ role }: QuickActionsProps) {
  const actions = filterQuickActionsForRole(DASHBOARD_QUICK_ACTIONS, role);

  if (actions.length === 0) return null;

  return (
    <ul
      role="list"
      aria-label="Quick actions"
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
      }}
    >
      {actions.map((action) => (
        <li key={action.id}>
          <Link href={action.href} style={toneStyle(action)}>
            {action.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
