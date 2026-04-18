import { describe, expect, it } from "vitest";
import {
  DASHBOARD_QUICK_ACTIONS,
  filterQuickActionsForRole,
  type QuickAction,
} from "@/lib/dashboard-quick-actions";
import type { Role } from "@/types";

describe("DASHBOARD_QUICK_ACTIONS", () => {
  it("exposes the four quick actions from the F4.4 spec", () => {
    const ids = DASHBOARD_QUICK_ACTIONS.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "upload",
        "createBucket",
        "generateLink",
        "viewAudit",
      ]),
    );
  });

  it("every action has a non-empty label and href", () => {
    for (const action of DASHBOARD_QUICK_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.href.length).toBeGreaterThan(0);
    }
  });

  it("hrefs and ids are unique", () => {
    const hrefs = DASHBOARD_QUICK_ACTIONS.map((a) => a.href);
    const ids = DASHBOARD_QUICK_ACTIONS.map((a) => a.id);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every action declares at least one role", () => {
    for (const action of DASHBOARD_QUICK_ACTIONS) {
      expect(action.roles.length).toBeGreaterThan(0);
      for (const role of action.roles) {
        expect(["superadmin", "admin", "viewer"]).toContain(role);
      }
    }
  });

  it("Create Bucket is restricted to superadmin only", () => {
    const action = DASHBOARD_QUICK_ACTIONS.find((a) => a.id === "createBucket");
    expect(action).toBeDefined();
    expect([...(action?.roles ?? [])]).toEqual(["superadmin"]);
  });
});

describe("filterQuickActionsForRole", () => {
  const byId = (items: readonly QuickAction[], id: string) =>
    items.find((a) => a.id === id);

  it("superadmin sees all four actions", () => {
    const filtered = filterQuickActionsForRole(
      DASHBOARD_QUICK_ACTIONS,
      "superadmin",
    );
    expect(filtered).toHaveLength(4);
    expect(byId(filtered, "createBucket")).toBeDefined();
  });

  it("admin sees upload, generateLink, viewAudit — NO createBucket", () => {
    const filtered = filterQuickActionsForRole(
      DASHBOARD_QUICK_ACTIONS,
      "admin",
    );
    expect(byId(filtered, "upload")).toBeDefined();
    expect(byId(filtered, "generateLink")).toBeDefined();
    expect(byId(filtered, "viewAudit")).toBeDefined();
    expect(byId(filtered, "createBucket")).toBeUndefined();
  });

  it("viewer sees only the Upload Document action", () => {
    const filtered = filterQuickActionsForRole(
      DASHBOARD_QUICK_ACTIONS,
      "viewer",
    );
    expect(byId(filtered, "upload")).toBeDefined();
    expect(byId(filtered, "createBucket")).toBeUndefined();
    expect(byId(filtered, "generateLink")).toBeUndefined();
    expect(byId(filtered, "viewAudit")).toBeUndefined();
  });

  it("null role yields an empty list", () => {
    expect(filterQuickActionsForRole(DASHBOARD_QUICK_ACTIONS, null)).toEqual(
      [],
    );
  });

  it("does not mutate the input array", () => {
    const before = [...DASHBOARD_QUICK_ACTIONS];
    filterQuickActionsForRole(DASHBOARD_QUICK_ACTIONS, "viewer" as Role);
    expect(DASHBOARD_QUICK_ACTIONS).toEqual(before);
  });
});
