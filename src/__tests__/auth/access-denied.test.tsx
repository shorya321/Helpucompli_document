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
});
