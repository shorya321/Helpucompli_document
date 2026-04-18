import type { Role } from "@/types";

export type QuickActionId =
  | "upload"
  | "createBucket"
  | "generateLink"
  | "viewAudit";

export type QuickActionTone = "primary" | "secondary";

export interface QuickAction {
  readonly id: QuickActionId;
  readonly label: string;
  readonly href: string;
  readonly roles: readonly Role[];
  readonly tone: QuickActionTone;
}

const ALL: readonly Role[] = ["superadmin", "admin", "viewer"];
const ADMIN_UP: readonly Role[] = ["superadmin", "admin"];
const SUPER_ONLY: readonly Role[] = ["superadmin"];

export const DASHBOARD_QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "upload",
    label: "Upload Document",
    href: "/documents?upload=1",
    roles: ALL,
    tone: "primary",
  },
  {
    id: "createBucket",
    label: "Create Bucket",
    href: "/buckets?new=1",
    roles: SUPER_ONLY,
    tone: "secondary",
  },
  {
    id: "generateLink",
    label: "Generate Link",
    href: "/links?new=1",
    roles: ADMIN_UP,
    tone: "secondary",
  },
  {
    id: "viewAudit",
    label: "View Audit Log",
    href: "/audit",
    roles: ADMIN_UP,
    tone: "secondary",
  },
] as const;

export function filterQuickActionsForRole(
  items: readonly QuickAction[],
  role: Role | null,
): readonly QuickAction[] {
  if (role === null) return [];
  return items.filter((item) => item.roles.includes(role));
}
