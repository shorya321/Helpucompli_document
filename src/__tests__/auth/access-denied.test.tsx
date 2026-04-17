import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import AccessDeniedPage, {
  metadata,
} from "@/app/(auth)/access-denied/page";
import { BRAND } from "@/lib/brand";

const html = () => renderToString(<AccessDeniedPage />);

describe("access-denied page", () => {
  it("renders branded access denied heading", () => {
    const out = html();
    expect(out).toMatch(/access denied/i);
  });

  it("shows HelpUcompli brand name", () => {
    const out = html();
    expect(out).toContain(BRAND.name);
  });

  it("includes a contact-admin call to action", () => {
    const out = html();
    expect(out).toMatch(/contact.*admin/i);
  });

  it("uses HelpUcompli pink as the primary color accent", () => {
    const out = html();
    expect(out).toContain(BRAND.colors.pink);
  });

  it("provides a link back to login", () => {
    const out = html();
    expect(out).toMatch(/\/auth\/login/);
  });

  it("exports metadata with a 403 / Access Denied title", () => {
    expect(metadata.title).toMatch(/access denied/i);
  });

  it("uses plain <a href> for the login link (not next/link) so Auth0 proxy handles the navigation", async () => {
    const out = html();
    // No next/link serialized markers
    expect(out).not.toMatch(/data-prefetch/i);
    // Anchor with href attribute targeting /auth/login
    expect(out).toMatch(/<a[^>]+href="\/auth\/login"/);
  });

  it("exports dynamic='force-dynamic' so the 403 body (with admin email) is not CDN-cached", async () => {
    const mod = await import("@/app/(auth)/access-denied/page");
    expect((mod as { dynamic?: string }).dynamic).toBe("force-dynamic");
  });
});
