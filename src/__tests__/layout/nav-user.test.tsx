// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavUser } from "@/components/layout/nav-user";
import { SidebarProvider } from "@/components/ui/sidebar";

function mount(user: { name: string | null; email: string | null }) {
  return render(
    <SidebarProvider>
      <NavUser user={user} role="admin" />
    </SidebarProvider>,
  );
}

describe("NavUser", () => {
  it("renders the display name when provided", () => {
    mount({ name: "Alice Admin", email: "alice@x.com" });
    expect(screen.getByText("Alice Admin")).toBeDefined();
  });

  it("falls back to email when name is missing", () => {
    mount({ name: null, email: "bob@x.com" });
    expect(screen.getAllByText("bob@x.com").length).toBeGreaterThan(0);
  });

  it("opens the menu and exposes a sign-out anchor to /auth/logout", async () => {
    const user = userEvent.setup();
    mount({ name: "A", email: "a@x.com" });
    await user.click(screen.getByRole("button"));
    const signOut = await screen.findByRole("menuitem", { name: /sign out/i });
    const anchor = signOut.querySelector("a") ?? signOut;
    expect(anchor.getAttribute("href")).toBe("/auth/logout");
  });

  it("shows the Account menu item when opened", async () => {
    const user = userEvent.setup();
    mount({ name: "A", email: "a@x.com" });
    await user.click(screen.getByRole("button"));
    expect(
      await screen.findByRole("menuitem", { name: /account/i }),
    ).toBeDefined();
  });
});
