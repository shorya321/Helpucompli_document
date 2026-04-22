import Link from "next/link";
import {
  ArrowUpRight,
  Database,
  FileClock,
  Link2,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  DASHBOARD_QUICK_ACTIONS,
  filterQuickActionsForRole,
  type QuickAction,
  type QuickActionId,
} from "@/lib/dashboard-quick-actions";
import type { Role } from "@/types";

interface QuickActionsProps {
  readonly role: Role;
}

const ACTION_ICON: Record<QuickActionId, LucideIcon> = {
  upload: Upload,
  createBucket: Database,
  generateLink: Link2,
  viewAudit: FileClock,
};

function isPrimary(action: QuickAction): boolean {
  return action.tone === "primary";
}

export function QuickActions({ role }: QuickActionsProps) {
  const actions = filterQuickActionsForRole(DASHBOARD_QUICK_ACTIONS, role);

  if (actions.length === 0) return null;

  return (
    <ul
      role="list"
      aria-label="Quick actions"
      className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4"
    >
      {actions.map((action) => {
        const Icon = ACTION_ICON[action.id];
        const primary = isPrimary(action);
        return (
          <li key={action.id}>
            <Link
              href={action.href}
              className="group block focus-visible:outline-none"
            >
              <Card
                className={
                  primary
                    ? "flex-row items-center gap-3 border-foreground/20 bg-foreground px-4 py-3.5 text-background shadow-sm transition-all hover:shadow-md"
                    : "flex-row items-center gap-3 px-4 py-3.5 transition-all hover:-translate-y-px hover:shadow-md"
                }
              >
                <span
                  className={
                    primary
                      ? "bg-background/10 flex size-9 items-center justify-center rounded-md"
                      : "bg-muted flex size-9 items-center justify-center rounded-md"
                  }
                >
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-sm font-medium leading-tight">
                    {action.label}
                  </span>
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-4 opacity-40 transition-all duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
                />
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
