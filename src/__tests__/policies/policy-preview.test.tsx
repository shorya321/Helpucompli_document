/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PolicyPreview } from "@/components/policies/policy-preview";
import { describePolicy } from "@/lib/policy-preview";

describe("describePolicy (pure)", () => {
  it("describes a fully-restricted policy", () => {
    const text = describePolicy({
      targetType: "bucket",
      targetValue: "helpucompli-prod",
      allowedDomains: ["example.com", "*.acme.com"],
      allowedIpRanges: ["10.0.0.0/8"],
      linkTtlSeconds: 3600,
      maxDownloads: 5,
      requireAuth: true,
    });
    expect(text.target).toMatch(/bucket helpucompli-prod/i);
    expect(text.ttl).toMatch(/1 hour/);
    expect(text.maxDownloads).toMatch(/5 download/i);
    expect(text.ipRestriction).toMatch(/1 range/i);
    expect(text.domainRestriction).toMatch(/2 domain/i);
    expect(text.requireAuth).toBe("yes");
  });

  it("describes a fully-open policy", () => {
    const text = describePolicy({
      targetType: "prefix",
      targetValue: "shared/",
      allowedDomains: [],
      allowedIpRanges: [],
      linkTtlSeconds: 900,
      maxDownloads: null,
      requireAuth: false,
    });
    expect(text.target).toMatch(/prefix shared\//i);
    expect(text.ttl).toMatch(/15 minutes/i);
    expect(text.maxDownloads).toMatch(/unlimited/i);
    expect(text.ipRestriction).toMatch(/none/i);
    expect(text.domainRestriction).toMatch(/none/i);
    expect(text.requireAuth).toBe("no");
  });
});

describe("PolicyPreview SSR", () => {
  it("renders all six labelled rows", () => {
    const html = renderToString(
      <PolicyPreview
        policy={{
          targetType: "object",
          targetValue: "shared/contract.pdf",
          allowedDomains: ["example.com"],
          allowedIpRanges: [],
          linkTtlSeconds: 86_400,
          maxDownloads: 1,
          requireAuth: true,
        }}
      />,
    );
    expect(html).toContain("Applies to");
    expect(html).toContain("Links expire after");
    expect(html).toContain("Max downloads");
    expect(html).toContain("IP restriction");
    expect(html).toContain("Domain restriction");
    expect(html).toContain("Auth required");
    expect(html).toContain("shared/contract.pdf");
    expect(html).toContain("24 hours");
  });
});
