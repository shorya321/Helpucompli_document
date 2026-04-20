import { test, expect } from "@playwright/test";

/**
 * Regression: edit-policy form's Save button stayed permanently
 * disabled because the edit page passed `{ id, ...fields }` into the
 * form's `initial` prop and the strict policyInputSchema rejected the
 * stray `id`. Form state must NOT carry the id forward into validation.
 *
 * This test loads the edit page, asserts Save is enabled on first
 * paint, edits a field, asserts Save remains enabled.
 *
 * Requires an admin/superadmin Auth0 session — provide via
 *   PLAYWRIGHT_AUTH_COOKIE=...  npx playwright test e2e/policy-edit-form.spec.ts
 * If the env var is missing, the test is skipped with a clear message.
 */
test.describe("Policy edit form — Save button enablement", () => {
  test.skip(
    !process.env.PLAYWRIGHT_AUTH_COOKIE,
    "Requires PLAYWRIGHT_AUTH_COOKIE env var (admin Auth0 session cookie)",
  );

  test("Save changes is enabled when an existing policy is loaded", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "appSession",
        value: process.env.PLAYWRIGHT_AUTH_COOKIE!,
        url: "http://localhost:3000",
      },
    ]);

    // Get any policy id from the list page.
    await page.goto("/policies");
    const editLink = page.locator("a:has-text('Edit')").first();
    await editLink.click();
    await page.waitForURL(/\/policies\/[0-9a-f-]+$/);

    const saveBtn = page.locator("button:has-text('Save changes')");
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });

    // Add a domain — Save should remain enabled.
    const domainInput = page.locator(
      "input[placeholder*='example.com or *.example.com']",
    );
    await domainInput.fill("test-edit.example.com");
    await page.locator("button:has-text('Add'):near(:text('Allowed domains'))").first().click();
    await expect(saveBtn).toBeEnabled();
  });
});
