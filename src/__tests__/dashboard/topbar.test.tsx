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
  it("displays the user's name", () => {
    const html = renderTopbar(
      { name: "Alice Admin", email: "alice@x.com" },
      "admin",
    );
    expect(html).toContain("Alice Admin");
  });

  it("falls back to email when name is missing", () => {
    const html = renderTopbar({ name: null, email: "bob@x.com" }, "viewer");
    expect(html).toContain("bob@x.com");
  });

  it("shows a role badge with the current role label", () => {
    const html = renderTopbar(
      { name: "Sam Super", email: "sam@x.com" },
      "superadmin",
    );
    expect(html).toContain("Superadmin");
  });

  it("renders a logout anchor pointing at /auth/logout (Auth0 proxy route)", () => {
    const html = renderTopbar({ name: "A", email: "a@x.com" }, "admin");
    expect(html).toMatch(/<a[^>]+href="\/auth\/logout"/);
  });

  it("renders the sidebar trigger (for mobile collapse)", () => {
    const html = renderTopbar({ name: "A", email: "a@x.com" }, "admin");
    expect(html).toMatch(/data-slot="sidebar-trigger"/);
  });
});
