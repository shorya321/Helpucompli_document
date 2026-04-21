import { describe, expect, it } from "vitest";
import { buildEmbedCode } from "@/lib/link-embed";

describe("buildEmbedCode", () => {
  it("returns an iframe snippet pointing at the supplied shareable URL", () => {
    const url = "https://docs.helpucompli.com/api/links/abc123";
    const code = buildEmbedCode(url);
    expect(code).toContain("<iframe");
    expect(code).toContain(`src="${url}"`);
    expect(code).toContain("</iframe>");
  });

  it("includes security-hardened iframe attributes", () => {
    const code = buildEmbedCode("https://example.com/api/links/x");
    // HIPAA embed: restrict referrer + enable fullscreen + lazy load.
    expect(code).toMatch(/referrerpolicy="no-referrer-when-downgrade"/);
    expect(code).toMatch(/loading="lazy"/);
    expect(code).toMatch(/allow="fullscreen"/);
    // No border so embedder sees a clean frame.
    expect(code).toMatch(/style="border:0"/);
  });

  it("escapes quotes in the URL to prevent attribute breakout", () => {
    const malicious = 'https://evil.com/" onload="alert(1)';
    const code = buildEmbedCode(malicious);
    expect(code).not.toContain('onload="alert(1)"');
    expect(code).toContain("&quot;");
  });

  it("produces a stable, deterministic snippet for a given URL", () => {
    const url = "https://docs.helpucompli.com/api/links/same";
    expect(buildEmbedCode(url)).toBe(buildEmbedCode(url));
  });
});
