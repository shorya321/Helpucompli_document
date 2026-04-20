/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DomainInput } from "@/components/policies/domain-input";
import { addDomain } from "@/lib/policy-input-helpers";

describe("addDomain", () => {
  it("appends a normalised valid domain", () => {
    expect(addDomain([], "Example.COM")).toEqual({
      ok: true,
      next: ["example.com"],
    });
  });

  it("accepts wildcard", () => {
    expect(addDomain([], "*.example.com")).toEqual({
      ok: true,
      next: ["*.example.com"],
    });
  });

  it("rejects invalid domain", () => {
    expect(addDomain([], "no_underscore")).toMatchObject({ ok: false });
  });

  it("rejects duplicates (case-insensitive)", () => {
    expect(addDomain(["example.com"], "EXAMPLE.com")).toMatchObject({
      ok: false,
      reason: "duplicate",
    });
  });
});

describe("DomainInput SSR", () => {
  it("renders existing chips with monospace font", () => {
    const html = renderToString(
      <DomainInput
        value={["example.com", "*.acme.com"]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("example.com");
    expect(html).toContain("*.acme.com");
    expect(html).toContain("Remove example.com");
  });

  it("renders an empty chip list when value is []", () => {
    const html = renderToString(<DomainInput value={[]} onChange={() => {}} />);
    expect(html).toContain('placeholder="example.com or *.example.com"');
  });
});
