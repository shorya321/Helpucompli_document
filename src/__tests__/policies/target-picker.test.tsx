/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TargetPicker } from "@/components/policies/target-picker";

const buckets = [
  { id: "b-1", name: "alpha-bucket" },
  { id: "b-2", name: "beta-bucket" },
];

describe("TargetPicker SSR", () => {
  it("renders bucket dropdown when targetType=bucket", () => {
    const html = renderToString(
      <TargetPicker
        targetType="bucket"
        targetValue=""
        buckets={buckets}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("alpha-bucket");
    expect(html).toContain("beta-bucket");
    expect(html).toContain("Select bucket");
  });

  it("renders folder prefix text input when targetType=prefix", () => {
    const html = renderToString(
      <TargetPicker
        targetType="prefix"
        targetValue="shared/"
        buckets={buckets}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Folder prefix"');
    expect(html).toContain('value="shared/"');
  });

  it("renders object key text input when targetType=object", () => {
    const html = renderToString(
      <TargetPicker
        targetType="object"
        targetValue="shared/contract.pdf"
        buckets={buckets}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Object key"');
    expect(html).toContain('value="shared/contract.pdf"');
  });

  it("includes all three radios checked correctly", () => {
    const html = renderToString(
      <TargetPicker
        targetType="prefix"
        targetValue=""
        buckets={buckets}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('value="bucket"');
    expect(html).toContain('value="prefix"');
    expect(html).toContain('value="object"');
  });
});
