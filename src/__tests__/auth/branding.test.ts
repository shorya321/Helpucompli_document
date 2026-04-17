import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import {
  AUTH0_BRANDING_PAYLOAD,
  AUTH0_UNIVERSAL_LOGIN_TEMPLATE,
} from "@/lib/auth0-branding";

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe("BRAND tokens", () => {
  it("exposes the HelpUcompli pink primary #E91E8C", () => {
    expect(BRAND.colors.pink).toBe("#E91E8C");
  });

  it("exposes the HelpUcompli blue accent #2563EB", () => {
    expect(BRAND.colors.blue).toBe("#2563EB");
  });

  it("exposes the HelpUcompli dark #1E293B", () => {
    expect(BRAND.colors.dark).toBe("#1E293B");
  });

  it("uses the Inter font family", () => {
    expect(BRAND.font.family).toBe("Inter");
  });

  it("all brand colors are valid six-digit hex", () => {
    for (const value of Object.values(BRAND.colors)) {
      expect(value).toMatch(HEX);
    }
  });

  it("provides logo and favicon URLs (absolute or relative)", () => {
    expect(typeof BRAND.assets.logoUrl).toBe("string");
    expect(BRAND.assets.logoUrl.length).toBeGreaterThan(0);
    expect(typeof BRAND.assets.faviconUrl).toBe("string");
    expect(BRAND.assets.faviconUrl.length).toBeGreaterThan(0);
  });
});

describe("AUTH0_BRANDING_PAYLOAD (Auth0 Management API /api/v2/branding)", () => {
  it("primary color is the HelpUcompli pink", () => {
    expect(AUTH0_BRANDING_PAYLOAD.colors.primary).toBe("#E91E8C");
  });

  it("page_background is a solid hex color (dark)", () => {
    expect(AUTH0_BRANDING_PAYLOAD.colors.page_background).toBe("#1E293B");
  });

  it("includes logo_url and favicon_url", () => {
    expect(AUTH0_BRANDING_PAYLOAD.logo_url).toBeTruthy();
    expect(AUTH0_BRANDING_PAYLOAD.favicon_url).toBeTruthy();
  });

  it("font.url points to a font stylesheet", () => {
    expect(AUTH0_BRANDING_PAYLOAD.font.url).toMatch(/^https?:\/\//);
  });
});

describe("AUTH0_UNIVERSAL_LOGIN_TEMPLATE", () => {
  it("is a non-empty string containing Auth0 widget placeholder", () => {
    expect(typeof AUTH0_UNIVERSAL_LOGIN_TEMPLATE).toBe("string");
    expect(AUTH0_UNIVERSAL_LOGIN_TEMPLATE).toMatch(/\{%-\s*auth0:widget\s*-%\}/);
  });

  it("references HelpUcompli brand name", () => {
    expect(AUTH0_UNIVERSAL_LOGIN_TEMPLATE).toContain("HelpUcompli");
  });
});
