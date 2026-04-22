import { describe, expect, it } from "vitest";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_LABELS,
  categoryForAction,
  type ActivityCategory,
} from "@/lib/activity-categories";
import type { AuditAction } from "@/types";

const ALL_ACTIONS: AuditAction[] = [
  "LOGIN",
  "LOGOUT",
  "BUCKET_CREATE",
  "BUCKET_DELETE",
  "DOCUMENT_UPLOAD",
  "DOCUMENT_DOWNLOAD",
  "DOCUMENT_SOFT_DELETE",
  "DOCUMENT_HARD_DELETE",
  "DOCUMENT_MOVE",
  "DOCUMENT_COPY",
  "POLICY_CREATE",
  "POLICY_UPDATE",
  "POLICY_DELETE",
  "LINK_GENERATE",
  "LINK_ACCESS",
  "LINK_DENIED",
  "LINK_REVOKE",
  "LINK_SHARE_INFO_VIEW",
  "USER_INVITE",
  "USER_ROLE_CHANGE",
  "USER_DISABLE",
  "USER_ENABLE",
];

describe("ACTIVITY_CATEGORIES", () => {
  it("exposes the five categories in render order", () => {
    expect([...ACTIVITY_CATEGORIES]).toEqual([
      "auth",
      "document",
      "policy",
      "link",
      "user",
    ]);
  });

  it("has a label for every category", () => {
    for (const c of ACTIVITY_CATEGORIES) {
      expect(typeof CATEGORY_LABELS[c]).toBe("string");
      expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0);
    }
  });
});

describe("categoryForAction", () => {
  const cases: Array<[AuditAction, ActivityCategory]> = [
    ["LOGIN", "auth"],
    ["LOGOUT", "auth"],
    ["DOCUMENT_UPLOAD", "document"],
    ["DOCUMENT_DOWNLOAD", "document"],
    ["DOCUMENT_SOFT_DELETE", "document"],
    ["DOCUMENT_HARD_DELETE", "document"],
    ["DOCUMENT_MOVE", "document"],
    ["DOCUMENT_COPY", "document"],
    ["POLICY_CREATE", "policy"],
    ["POLICY_UPDATE", "policy"],
    ["POLICY_DELETE", "policy"],
    ["LINK_GENERATE", "link"],
    ["LINK_ACCESS", "link"],
    ["LINK_DENIED", "link"],
    ["LINK_REVOKE", "link"],
    ["LINK_SHARE_INFO_VIEW", "link"],
    ["BUCKET_CREATE", "user"],
    ["BUCKET_DELETE", "user"],
    ["USER_INVITE", "user"],
    ["USER_ROLE_CHANGE", "user"],
    ["USER_DISABLE", "user"],
    ["USER_ENABLE", "user"],
  ];

  for (const [action, expected] of cases) {
    it(`${action} → ${expected}`, () => {
      expect(categoryForAction(action)).toBe(expected);
    });
  }

  it("every AuditAction maps to a known category — guards against drift", () => {
    const valid = new Set<ActivityCategory>(ACTIVITY_CATEGORIES);
    for (const a of ALL_ACTIONS) {
      expect(valid.has(categoryForAction(a))).toBe(true);
    }
  });
});
