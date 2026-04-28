import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

// next/navigation is not available in node test env; mock the hook surface
vi.mock("next/navigation", () => ({
  usePathname: () => "/buckets",
}));

import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

const STUB_USER = {
  id: "u-test",
  name: "Test User",
  email: "test@example.com",
};

function renderSidebar(role: "superadmin" | "admin" | "viewer"): string {
  return renderToString(
    <SidebarProvider>
      <Sidebar role={role} user={STUB_USER} />
    </SidebarProvider>,
  );
}

describe("Sidebar", () => {
  it("renders role-appropriate links for a superadmin (includes /users)", () => {
    const html = renderSidebar("superadmin");
    expect(html).toMatch(/href="\/users"/);
    expect(html).toMatch(/href="\/buckets"/);
    expect(html).toMatch(/href="\/audit"/);
  });

  it("hides /users for admin role", () => {
    const html = renderSidebar("admin");
    expect(html).not.toMatch(/href="\/users"/);
    expect(html).toMatch(/href="\/buckets"/);
  });

  it("only shows documents + links + home for viewer role", () => {
    const html = renderSidebar("viewer");
    expect(html).toMatch(/href="\/documents"/);
    expect(html).toMatch(/href="\/links"/);
    expect(html).not.toMatch(/href="\/settings"/);
    expect(html).not.toMatch(/href="\/buckets"/);
    expect(html).not.toMatch(/href="\/policies"/);
    expect(html).not.toMatch(/href="\/audit"/);
    expect(html).not.toMatch(/href="\/users\b"/);
  });

  it("marks the link matching the current pathname as active via aria-current", () => {
    const html = renderSidebar("superadmin");
    // usePathname mocked to /buckets — next/link may order attrs either way
    expect(html).toMatch(
      /<a[^>]*aria-current="page"[^>]*href="\/buckets"|<a[^>]*href="\/buckets"[^>]*aria-current="page"/,
    );
    expect(html).not.toMatch(
      /<a[^>]*aria-current="page"[^>]*href="\/documents"|<a[^>]*href="\/documents"[^>]*aria-current="page"/,
    );
  });

  it("renders the shadcn sidebar landmark container", () => {
    const html = renderSidebar("superadmin");
    expect(html).toMatch(/data-slot="sidebar"/);
  });

  it("renders the two nav group labels (Workspace / Management)", () => {
    const html = renderSidebar("superadmin");
    expect(html).toContain("Workspace");
    expect(html).toContain("Management");
  });

  it("surfaces the NavUser footer with the current displayName", () => {
    const html = renderSidebar("admin");
    expect(html).toContain(STUB_USER.name);
    expect(html).toContain(STUB_USER.email);
  });
});
