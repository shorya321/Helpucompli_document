import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Topbar } from "@/components/layout/topbar";

describe("Topbar", () => {
  it("displays the user's name", () => {
    const html = renderToString(
      <Topbar user={{ name: "Alice Admin", email: "alice@x.com" }} role="admin" />,
    );
    expect(html).toContain("Alice Admin");
  });

  it("falls back to email when name is missing", () => {
    const html = renderToString(
      <Topbar user={{ name: null, email: "bob@x.com" }} role="viewer" />,
    );
    expect(html).toContain("bob@x.com");
  });

  it("shows a role badge with the current role label", () => {
    const html = renderToString(
      <Topbar user={{ name: "Sam Super", email: "sam@x.com" }} role="superadmin" />,
    );
    expect(html.toLowerCase()).toContain("superadmin");
  });

  it("renders a logout anchor pointing at /auth/logout (Auth0 proxy route)", () => {
    const html = renderToString(
      <Topbar user={{ name: "A", email: "a@x.com" }} role="admin" />,
    );
    expect(html).toMatch(/<a[^>]+href="\/auth\/logout"/);
  });

  it("embeds the brand logo", () => {
    const html = renderToString(
      <Topbar user={{ name: "A", email: "a@x.com" }} role="admin" />,
    );
    expect(html).toContain("HelpUcompli");
  });
});
