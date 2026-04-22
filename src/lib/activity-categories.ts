import type { AuditAction } from "@/types";

// Single source of truth shared by activity-feed tabs, activity-trend
// chart, and summary-card sparklines. Keeps category groupings aligned
// across every dashboard widget so admins see the same buckets
// everywhere.

export type ActivityCategory =
  | "auth"
  | "document"
  | "policy"
  | "link"
  | "user";

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "auth",
  "document",
  "policy",
  "link",
  "user",
] as const;

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  auth: "Auth",
  document: "Documents",
  policy: "Policies",
  link: "Links",
  user: "Admin",
};

// Exhaustive switch — adding a new AuditAction without updating this
// map fails to compile (the `_exhaustive: never` arm forces it).
export function categoryForAction(action: AuditAction): ActivityCategory {
  switch (action) {
    case "LOGIN":
    case "LOGOUT":
      return "auth";
    case "DOCUMENT_UPLOAD":
    case "DOCUMENT_DOWNLOAD":
    case "DOCUMENT_SOFT_DELETE":
    case "DOCUMENT_HARD_DELETE":
    case "DOCUMENT_MOVE":
    case "DOCUMENT_COPY":
      return "document";
    case "POLICY_CREATE":
    case "POLICY_UPDATE":
    case "POLICY_DELETE":
      return "policy";
    case "LINK_GENERATE":
    case "LINK_ACCESS":
    case "LINK_DENIED":
    case "LINK_REVOKE":
    case "LINK_SHARE_INFO_VIEW":
      return "link";
    case "BUCKET_CREATE":
    case "BUCKET_DELETE":
    case "USER_INVITE":
    case "USER_ROLE_CHANGE":
    case "USER_DISABLE":
    case "USER_ENABLE":
      return "user";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
