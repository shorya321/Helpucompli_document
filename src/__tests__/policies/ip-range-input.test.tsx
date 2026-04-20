/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { IpRangeInput } from "@/components/policies/ip-range-input";
import { addCidr } from "@/lib/policy-input-helpers";

describe("addCidr", () => {
  it.each([
    ["10.0.0.0/8", "10.0.0.0/8"],
    ["192.168.1.0/24", "192.168.1.0/24"],
    ["1.2.3.4/32", "1.2.3.4/32"],
    ["0.0.0.0/0", "0.0.0.0/0"],
    [" 10.0.0.0/16 ", "10.0.0.0/16"],
  ])("accepts %s", (input, normalised) => {
    expect(addCidr([], input)).toMatchObject({
      ok: true,
      next: [normalised],
    });
  });

  it.each([
    "10.0.0.0",
    "10.0.0.0/33",
    "256.0.0.0/24",
    "::1/128",
    "10.0.0/24",
    "",
  ])("rejects %s", (input) => {
    expect(addCidr([], input)).toMatchObject({ ok: false });
  });

  it("rejects duplicates", () => {
    expect(addCidr(["10.0.0.0/8"], "10.0.0.0/8")).toMatchObject({
      ok: false,
      reason: "duplicate",
    });
  });
});

describe("IpRangeInput SSR", () => {
  it("renders existing chips", () => {
    const html = renderToString(
      <IpRangeInput
        value={["10.0.0.0/8", "192.168.1.0/24"]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("10.0.0.0/8");
    expect(html).toContain("192.168.1.0/24");
    expect(html).toContain("Remove 10.0.0.0/8");
  });

  it("renders empty list with placeholder", () => {
    const html = renderToString(<IpRangeInput value={[]} onChange={() => {}} />);
    expect(html).toContain('placeholder="10.0.0.0/8 or 1.2.3.4/32"');
  });
});
