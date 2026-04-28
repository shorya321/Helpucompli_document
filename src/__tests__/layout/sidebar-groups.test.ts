import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SIDEBAR_GROUPS,
  filterGroupsForRole,
} from "@/lib/sidebar-groups";

function flatten(
  groups: readonly { items: readonly { href: string }[] }[],
): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.href));
}

describe("DASHBOARD_SIDEBAR_GROUPS", () => {
  it("defines two groups (Workspace / Management)", () => {
    expect(DASHBOARD_SIDEBAR_GROUPS.map((g) => g.title)).toEqual([
      "Workspace",
      "Management",
    ]);
  });
});

describe("filterGroupsForRole", () => {
  it("returns empty array when role is null", () => {
    expect(filterGroupsForRole(DASHBOARD_SIDEBAR_GROUPS, null)).toEqual([]);
  });

  it("superadmin sees every route", () => {
    const hrefs = flatten(
      filterGroupsForRole(DASHBOARD_SIDEBAR_GROUPS, "superadmin"),
    );
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/buckets");
    expect(hrefs).toContain("/documents");
    expect(hrefs).toContain("/links");
    expect(hrefs).toContain("/policies");
    expect(hrefs).toContain("/users");
    expect(hrefs).toContain("/audit");
    expect(hrefs).not.toContain("/settings");
  });

  it("admin loses /users but keeps /buckets /policies /audit", () => {
    const hrefs = flatten(
      filterGroupsForRole(DASHBOARD_SIDEBAR_GROUPS, "admin"),
    );
    expect(hrefs).toContain("/buckets");
    expect(hrefs).toContain("/policies");
    expect(hrefs).toContain("/audit");
    expect(hrefs).not.toContain("/users");
  });

  it("viewer sees only Workspace items", () => {
    const groups = filterGroupsForRole(DASHBOARD_SIDEBAR_GROUPS, "viewer");
    const hrefs = flatten(groups);
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/documents");
    expect(hrefs).toContain("/links");
    expect(hrefs).not.toContain("/settings");
    expect(hrefs).not.toContain("/buckets");
    expect(hrefs).not.toContain("/policies");
    expect(hrefs).not.toContain("/users");
    expect(hrefs).not.toContain("/audit");
  });

  it("drops groups that have no visible items", () => {
    const groups = filterGroupsForRole(DASHBOARD_SIDEBAR_GROUPS, "viewer");
    // Management group is empty for viewer -> should be dropped.
    expect(groups.map((g) => g.title)).toEqual(["Workspace"]);
  });
});
