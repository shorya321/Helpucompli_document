import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

// next/navigation is not available in node test env; mock the hook surface
vi.mock("next/navigation", () => ({
  usePathname: () => "/buckets",
}));

import { Sidebar } from "@/components/layout/sidebar";

describe("Sidebar", () => {
  it("renders role-appropriate links for a superadmin (includes /users)", () => {
    const html = renderToString(<Sidebar role="superadmin" />);
    expect(html).toMatch(/href="\/users"/);
    expect(html).toMatch(/href="\/buckets"/);
    expect(html).toMatch(/href="\/audit"/);
  });

  it("hides /users for admin role", () => {
    const html = renderToString(<Sidebar role="admin" />);
    expect(html).not.toMatch(/href="\/users"/);
    expect(html).toMatch(/href="\/buckets"/);
  });

  it("only shows documents + links + home for viewer role", () => {
    const html = renderToString(<Sidebar role="viewer" />);
    expect(html).toMatch(/href="\/documents"/);
    expect(html).toMatch(/href="\/links"/);
    expect(html).not.toMatch(/href="\/buckets"/);
    expect(html).not.toMatch(/href="\/policies"/);
    expect(html).not.toMatch(/href="\/audit"/);
    expect(html).not.toMatch(/href="\/users"/);
  });

  it("marks the link matching the current pathname as active via aria-current", () => {
    const html = renderToString(<Sidebar role="superadmin" />);
    // usePathname mocked to /buckets
    expect(html).toMatch(/href="\/buckets"[^>]*aria-current="page"/);
    // non-active link must not have aria-current
    expect(html).not.toMatch(/href="\/documents"[^>]*aria-current="page"/);
  });

  it("is wrapped in a <nav> landmark", () => {
    const html = renderToString(<Sidebar role="superadmin" />);
    expect(html).toMatch(/<nav\b/);
  });
});
