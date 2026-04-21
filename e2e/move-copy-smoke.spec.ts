import { test, expect, request } from "@playwright/test";

// Smoke: verify the move/copy wire-up in documents/page.tsx does not crash
// SSR when op=move/op=copy is present in the query. Cannot log into Auth0
// from CI without a test-tenant seed (F12.3 note), so this validates the
// SSR path only and asserts redirect to /auth/login. Full interactive
// right-click → dialog-opens journey will land in Module 12 with the
// authenticated fixture.

const BASE = "http://localhost:3000";

test.describe("move/copy dialog SSR smoke", () => {
  test("documents?op=move redirects to /auth/login without crash", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(
      `${BASE}/documents?bucket=helpucompli-test&op=move&bucketId=00000000-0000-0000-0000-000000000000&s3Key=foo/bar.pdf`,
      { maxRedirects: 0 },
    );
    expect([302, 307]).toContain(res.status());
    const loc = res.headers()["location"] ?? "";
    expect(loc).toMatch(/\/auth\/login|\/authorize/);
    await ctx.dispose();
  });

  test("documents?op=copy redirects to /auth/login without crash", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(
      `${BASE}/documents?bucket=helpucompli-test&op=copy&bucketId=00000000-0000-0000-0000-000000000000&s3Key=foo/bar.pdf`,
      { maxRedirects: 0 },
    );
    expect([302, 307]).toContain(res.status());
    const loc = res.headers()["location"] ?? "";
    expect(loc).toMatch(/\/auth\/login|\/authorize/);
    await ctx.dispose();
  });

  test("POST /api/s3/move unauthenticated returns 401", async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BASE}/api/s3/move`, {
      data: {
        mode: "move",
        sourceBucketId: "00000000-0000-0000-0000-000000000000",
        sourceS3Key: "foo.pdf",
        destBucketId: "00000000-0000-0000-0000-000000000001",
        destFolderPrefix: "",
      },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
