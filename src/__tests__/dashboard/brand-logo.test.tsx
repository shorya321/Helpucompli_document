import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BrandLogo } from "@/components/layout/brand-logo";
import { BRAND } from "@/lib/brand";

describe("BrandLogo", () => {
  it("renders the HelpUcompli wordmark", () => {
    const html = renderToString(<BrandLogo />);
    expect(html).toContain(BRAND.name);
  });

  it("uses the brand pink accent color", () => {
    const html = renderToString(<BrandLogo />);
    expect(html.toLowerCase()).toContain(BRAND.colors.pink.toLowerCase());
  });

  it("renders as a single link to the dashboard root", () => {
    const html = renderToString(<BrandLogo />);
    expect(html).toMatch(/<a[^>]+href="\/"/);
  });

  it("exposes an accessible label via aria-label", () => {
    const html = renderToString(<BrandLogo />);
    expect(html).toMatch(/aria-label=/i);
  });
});
