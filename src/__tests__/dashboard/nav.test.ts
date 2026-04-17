import { describe, expect, it } from "vitest";
import {
  DASHBOARD_NAV_ITEMS,
  filterNavForRole,
  type DashboardNavItem,
} from "@/lib/dashboard-nav";
import type { Role } from "@/types";

describe("DASHBOARD_NAV_ITEMS", () => {
  it("exposes the six core module links", () => {
    const hrefs = DASHBOARD_NAV_ITEMS.map((n) => n.href);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/",
        "/buckets",
        "/documents",
        "/policies",
        "/links",
        "/users",
        "/audit",
      ]),
    );
  });

  it("every item has a human label", () => {
    for (const item of DASHBOARD_NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it("every item declares the roles that may see it", () => {
    for (const item of DASHBOARD_NAV_ITEMS) {
      expect(Array.isArray(item.roles)).toBe(true);
      expect(item.roles.length).toBeGreaterThan(0);
      for (const role of item.roles) {
        expect(["superadmin", "admin", "viewer"]).toContain(role);
      }
    }
  });

  it("hrefs are unique", () => {
    const hrefs = DASHBOARD_NAV_ITEMS.map((n) => n.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("filterNavForRole", () => {
  const byHref = (items: readonly DashboardNavItem[], href: string) =>
    items.find((i) => i.href === href);

  it("superadmin sees every link including Users (superadmin only)", () => {
    const filtered = filterNavForRole(DASHBOARD_NAV_ITEMS, "superadmin");
    expect(byHref(filtered, "/users")).toBeDefined();
    expect(byHref(filtered, "/buckets")).toBeDefined();
    expect(byHref(filtered, "/audit")).toBeDefined();
  });

  it("admin sees buckets, documents, policies, links, audit but NOT users (user mgmt is superadmin)", () => {
    const filtered = filterNavForRole(DASHBOARD_NAV_ITEMS, "admin");
    expect(byHref(filtered, "/buckets")).toBeDefined();
    expect(byHref(filtered, "/documents")).toBeDefined();
    expect(byHref(filtered, "/policies")).toBeDefined();
    expect(byHref(filtered, "/links")).toBeDefined();
    expect(byHref(filtered, "/audit")).toBeDefined();
    expect(byHref(filtered, "/users")).toBeUndefined();
  });

  it("viewer sees documents + links but NOT buckets/policies/users/audit", () => {
    const filtered = filterNavForRole(DASHBOARD_NAV_ITEMS, "viewer");
    expect(byHref(filtered, "/documents")).toBeDefined();
    expect(byHref(filtered, "/links")).toBeDefined();
    expect(byHref(filtered, "/buckets")).toBeUndefined();
    expect(byHref(filtered, "/policies")).toBeUndefined();
    expect(byHref(filtered, "/users")).toBeUndefined();
    expect(byHref(filtered, "/audit")).toBeUndefined();
  });

  it("null role yields an empty list (unauthenticated sees nothing in sidebar)", () => {
    const filtered = filterNavForRole(DASHBOARD_NAV_ITEMS, null);
    expect(filtered).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const before = [...DASHBOARD_NAV_ITEMS];
    filterNavForRole(DASHBOARD_NAV_ITEMS, "viewer" as Role);
    expect(DASHBOARD_NAV_ITEMS).toEqual(before);
  });

  it("Dashboard Home is visible to every authenticated role", () => {
    for (const role of ["superadmin", "admin", "viewer"] as const) {
      const filtered = filterNavForRole(DASHBOARD_NAV_ITEMS, role);
      expect(byHref(filtered, "/")).toBeDefined();
    }
  });
});
