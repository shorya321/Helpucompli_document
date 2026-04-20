import { describe, expect, it } from "vitest";
import QRCode from "qrcode";

// Smoke test the qrcode dependency directly. The React component is a
// thin shell over QRCode.toDataURL — once the lib renders correctly,
// the component just embeds the data URL in an <img>.

describe("qrcode toDataURL", () => {
  it("encodes a URL into a PNG data URL", async () => {
    const url = "https://docs.helpucompli.com/api/links/abc";
    const dataUrl = await QRCode.toDataURL(url);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    // Real QR codes are >100 chars even at smallest size.
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  it("respects errorCorrectionLevel=M", async () => {
    const url = "https://x/api/links/short";
    const a = await QRCode.toDataURL(url, { errorCorrectionLevel: "L" });
    const b = await QRCode.toDataURL(url, { errorCorrectionLevel: "H" });
    expect(a).not.toBe(b);
  });
});
