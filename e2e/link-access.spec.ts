import { test, expect, request } from "@playwright/test";

const TOKEN = "t0o3Klv3IMqrtHVLm79PAPq8uqlySd90oJAQENbVWao";
const BASE = "http://localhost:3000";

test.describe("Public link access — diagnose 403", () => {
  test("plain GET (no Referer) returns 403 because bucket policy requires referer", async () => {
    const ctx = await request.newContext({ extraHTTPHeaders: {} });
    const res = await ctx.get(`${BASE}/api/links/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    expect(await res.text()).toBe("Forbidden");
    await ctx.dispose();
  });

  test("GET with matching Referer (compass.helpucompli.com) returns 302 → S3", async () => {
    const ctx = await request.newContext({
      extraHTTPHeaders: { Referer: "https://compass.helpucompli.com/" },
    });
    const res = await ctx.get(`${BASE}/api/links/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    const location = res.headers()["location"];
    expect(location).toMatch(/\.s3\..*amazonaws\.com\//);
    expect(location).toMatch(/X-Amz-Signature=/);
    await ctx.dispose();
  });

  test("GET with non-matching Referer returns 403", async () => {
    const ctx = await request.newContext({
      extraHTTPHeaders: { Referer: "https://example.com/" },
    });
    const res = await ctx.get(`${BASE}/api/links/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test("opening token URL in real browser (no Referer) shows 'Forbidden' page", async ({
    page,
  }) => {
    const response = await page.goto(`${BASE}/api/links/${TOKEN}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(403);
    await expect(page.locator("body")).toContainText("Forbidden");
  });

  test("opening token URL via simulated link from compass.helpucompli.com → 302 → S3 file loads", async ({
    page,
  }) => {
    // Stage a tiny page that links to the token URL — clicking sends
    // the staging origin as Referer. We cannot serve from
    // compass.helpucompli.com locally, but we can verify the redirect
    // chain works end-to-end with a matching referer via setExtraHTTPHeaders.
    await page.setExtraHTTPHeaders({
      Referer: "https://compass.helpucompli.com/share",
    });
    const response = await page.goto(`${BASE}/api/links/${TOKEN}`, {
      waitUntil: "domcontentloaded",
    });
    // Final URL after the 302 should be the S3 host.
    expect(page.url()).toMatch(/\.s3\..*amazonaws\.com\//);
    expect(response?.status()).toBeLessThan(400);
  });
});
