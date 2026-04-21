import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BrandLogo } from "@/components/layout/brand-logo";

describe("BrandLogo", () => {
  it("renders the Compass Doc wordmark", () => {
    const html = renderToString(<BrandLogo />);
    expect(html).toContain("Compass Doc");
  });

  it("renders as a single link to the dashboard root", () => {
    const html = renderToString(<BrandLogo />);
    expect(html).toMatch(/<a[^>]+href="\/"/);
  });

  it("renders the accent mark element", () => {
    const html = renderToString(<BrandLogo />);
    expect(html).toMatch(/<span[^>]+aria-hidden="true"[^>]*><\/span>/);
  });

  it("exposes an accessible label via aria-label", () => {
    const html = renderToString(<BrandLogo />);
    expect(html).toMatch(/aria-label=/i);
  });

  it("uses semantic Tailwind tokens for theme-aware color (no inline hex)", () => {
    // The monochrome redesign drops inline style colors and renders the
    // brand mark via bg-foreground so it flips correctly in light/dark
    // mode. Guard against accidental reintroduction of raw hex in the
    // component markup.
    const html = renderToString(<BrandLogo />);
    expect(html).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(html).toContain("bg-foreground");
  });
});
