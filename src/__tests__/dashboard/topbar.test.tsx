import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Topbar } from "@/components/layout/topbar";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderTopbar(
  user: { name: string | null; email: string | null },
  role: "superadmin" | "admin" | "viewer",
): string {
  return renderToString(
    <SidebarProvider>
      <Topbar user={user} role={role} />
    </SidebarProvider>,
  );
}

describe("Topbar", () => {
  it("renders the sidebar trigger for mobile collapse", () => {
    const html = renderTopbar({ name: "A", email: "a@x.com" }, "admin");
    expect(html).toMatch(/data-slot="sidebar-trigger"/);
  });

  it("renders the search trigger (opens command palette in E3)", () => {
    const html = renderTopbar({ name: "A", email: "a@x.com" }, "admin");
    expect(html).toMatch(/aria-label="Open command menu"/);
  });

  it("renders the theme switch trigger", () => {
    const html = renderTopbar({ name: "A", email: "a@x.com" }, "admin");
    expect(html).toMatch(/aria-label="Toggle theme"/);
  });

  it("renders the layout config drawer trigger", () => {
    const html = renderTopbar({ name: "A", email: "a@x.com" }, "admin");
    expect(html).toMatch(/aria-label="Open layout config"/);
  });

  it("renders a profile dropdown trigger labelled with the user's display name", () => {
    const html = renderTopbar(
      { name: "Alice Admin", email: "alice@x.com" },
      "admin",
    );
    expect(html).toMatch(/aria-label="Open profile menu for Alice Admin"/);
  });
});
