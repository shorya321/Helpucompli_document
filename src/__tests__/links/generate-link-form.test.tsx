// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { GenerateLinkForm } from "@/components/links/generate-link-form";

const DOC_RESTRICTED = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "car4.jpg",
  bucketName: "helpucompli-docs-developer",
};

const DOC_OPEN = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "car2.png",
  bucketName: "helpucompli-docs-test",
};

const POLICY_OPTION = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Public 24h",
  linkTtlSeconds: 86_400,
  maxDownloads: null,
};

const BUCKET_POLICY = {
  id: "44444444-4444-4444-4444-444444444444",
  name: "Developer Bucket Restrict",
  linkTtlSeconds: 900,
  maxDownloads: null,
};

describe("GenerateLinkForm — effective policy preview", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockEffective(resp: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: resp, error: null }),
    });
  }

  it("renders the inherited-policy label on the select", () => {
    render(
      <GenerateLinkForm
        documents={[DOC_RESTRICTED]}
        policies={[POLICY_OPTION, BUCKET_POLICY]}
      />,
    );
    expect(screen.getByText("Use inherited policy")).toBeDefined();
    expect(
      screen.getByText(/bucket and folder policies still apply/i),
    ).toBeDefined();
  });

  it("shows requireAuth warning when bucket policy denies anonymous and no override picked", async () => {
    const user = userEvent.setup();
    mockEffective({
      source: "bucket",
      policyId: BUCKET_POLICY.id,
      linkTtlSeconds: 900,
      maxDownloads: null,
      requireAuth: true,
      allowedDomains: [],
      allowedIpRanges: [],
    });
    render(
      <GenerateLinkForm
        documents={[DOC_RESTRICTED]}
        policies={[POLICY_OPTION, BUCKET_POLICY]}
      />,
    );
    await user.selectOptions(
      screen.getByLabelText(/document/i),
      DOC_RESTRICTED.id,
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/recipients must be logged in/i);
    expect(alert.textContent).toMatch(/Developer Bucket Restrict/i);
  });

  it("shows advisory banner when no inherited policy (anonymous allowed)", async () => {
    const user = userEvent.setup();
    mockEffective({
      source: "none",
      policyId: null,
      linkTtlSeconds: 900,
      maxDownloads: null,
      requireAuth: false,
      allowedDomains: [],
      allowedIpRanges: [],
    });
    render(
      <GenerateLinkForm
        documents={[DOC_OPEN]}
        policies={[POLICY_OPTION]}
      />,
    );
    await user.selectOptions(
      screen.getByLabelText(/document/i),
      DOC_OPEN.id,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Default \(anonymous, no restrictions\)/i),
      ).toBeDefined();
    });
    // Not an alert-level warning
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows override notice when a policy is picked from the dropdown", async () => {
    const user = userEvent.setup();
    mockEffective({
      source: "bucket",
      policyId: BUCKET_POLICY.id,
      linkTtlSeconds: 900,
      maxDownloads: null,
      requireAuth: true,
      allowedDomains: [],
      allowedIpRanges: [],
    });
    render(
      <GenerateLinkForm
        documents={[DOC_RESTRICTED]}
        policies={[POLICY_OPTION, BUCKET_POLICY]}
      />,
    );
    await user.selectOptions(
      screen.getByLabelText(/document/i),
      DOC_RESTRICTED.id,
    );
    await waitFor(() => screen.getByRole("alert"));
    await user.selectOptions(
      screen.getByLabelText(/^policy/i),
      POLICY_OPTION.id,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/will replace the inherited rules/i),
      ).toBeDefined();
    });
    // "Public 24h" appears both as <option> and in the banner — just
    // assert at least one match exists in text form.
    expect(screen.getAllByText(/Public 24h/).length).toBeGreaterThan(0);
    // Restrictive-inherited alert should disappear once override is picked
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
