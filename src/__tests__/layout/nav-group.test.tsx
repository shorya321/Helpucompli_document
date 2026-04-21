import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { Home, Settings } from "lucide-react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { NavGroup } from "@/components/layout/nav-group";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { NavGroupConfig } from "@/lib/sidebar-groups";

const GROUP: NavGroupConfig = {
  title: "Workspace",
  items: [
    { href: "/", label: "Dashboard", icon: Home, roles: ["superadmin"] },
    {
      href: "/settings",
      label: "Settings",
      icon: Settings,
      roles: ["superadmin"],
      badge: 3,
    },
  ],
};

function render() {
  return renderToString(
    <SidebarProvider>
      <NavGroup group={GROUP} />
    </SidebarProvider>,
  );
}

describe("NavGroup", () => {
  it("renders the group label", () => {
    const html = render();
    expect(html).toContain("Workspace");
  });

  it("renders each item as a link", () => {
    const html = render();
    expect(html).toMatch(/href="\/"/);
    expect(html).toMatch(/href="\/settings"/);
    expect(html).toContain("Dashboard");
    expect(html).toContain("Settings");
  });

  it("renders a badge when provided", () => {
    const html = render();
    expect(html).toMatch(/3<\/div>|3<\/span>/);
  });

  it("marks the active item with aria-current", () => {
    const html = render();
    expect(html).toMatch(
      /<a[^>]*aria-current="page"[^>]*href="\/"|<a[^>]*href="\/"[^>]*aria-current="page"/,
    );
  });
});
