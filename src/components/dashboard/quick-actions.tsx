import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DASHBOARD_QUICK_ACTIONS,
  filterQuickActionsForRole,
  type QuickAction,
} from "@/lib/dashboard-quick-actions";
import type { Role } from "@/types";

interface QuickActionsProps {
  readonly role: Role;
}

function buttonVariant(action: QuickAction): "default" | "outline" {
  return action.tone === "primary" ? "default" : "outline";
}

export function QuickActions({ role }: QuickActionsProps) {
  const actions = filterQuickActionsForRole(DASHBOARD_QUICK_ACTIONS, role);

  if (actions.length === 0) return null;

  return (
    <ul
      role="list"
      aria-label="Quick actions"
      className="m-0 flex list-none flex-wrap gap-2 p-0"
    >
      {actions.map((action) => (
        <li key={action.id}>
          <Button variant={buttonVariant(action)} size="sm" asChild>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
