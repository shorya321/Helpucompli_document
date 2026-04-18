/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BucketCard, formatStorage } from "@/components/buckets/bucket-card";
import type { BucketSummary } from "@/lib/bucket-list";

const base: BucketSummary = {
  id: "b-1",
  name: "helpucompli-docs-acme",
  region: "us-east-1",
  description: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  isActive: true,
  documentCount: 12,
  storageBytes: BigInt(2_500_000_000),
};

describe("formatStorage", () => {
  it("renders 0 bytes as '0 B'", () => {
    expect(formatStorage(BigInt(0))).toBe("0 B");
  });
  it("renders bytes below 1 KB in bytes", () => {
    expect(formatStorage(BigInt(512))).toBe("512 B");
  });
  it("renders KB with one decimal", () => {
    expect(formatStorage(BigInt(2048))).toBe("2.0 KB");
  });
  it("renders MB with one decimal", () => {
    expect(formatStorage(BigInt(5 * 1024 * 1024))).toBe("5.0 MB");
  });
  it("renders GB with one decimal", () => {
    expect(formatStorage(BigInt(3) * BigInt(1024) * BigInt(1024) * BigInt(1024))).toBe(
      "3.0 GB",
    );
  });
  it("renders TB above 1024 GB", () => {
    const tb = BigInt(1024) * BigInt(1024) * BigInt(1024) * BigInt(1024);
    expect(formatStorage(BigInt(2) * tb)).toBe("2.0 TB");
  });
});

describe("BucketCard", () => {
  it("renders bucket name, region, doc count, and storage", () => {
    const html = renderToString(<BucketCard bucket={base} />);
    expect(html).toContain("helpucompli-docs-acme");
    expect(html).toContain("us-east-1");
    expect(html).toContain("12"); // doc count
    expect(html).toContain("2.3 GB"); // 2_500_000_000 B ≈ 2.3 GiB
  });

  it("shows Active badge for active buckets", () => {
    const html = renderToString(<BucketCard bucket={base} />);
    expect(html.toLowerCase()).toContain("active");
  });

  it("shows Inactive badge for inactive buckets", () => {
    const html = renderToString(
      <BucketCard bucket={{ ...base, isActive: false }} />,
    );
    expect(html.toLowerCase()).toContain("inactive");
  });

  it("renders description when provided", () => {
    const html = renderToString(
      <BucketCard bucket={{ ...base, description: "primary docs" }} />,
    );
    expect(html).toContain("primary docs");
  });

  it("wraps in a next/link to /buckets/[id]", () => {
    const html = renderToString(<BucketCard bucket={base} />);
    expect(html).toContain('href="/buckets/b-1"');
  });

  it("escapes HTML in description (XSS regression guard)", () => {
    const html = renderToString(
      <BucketCard bucket={{ ...base, description: "<script>alert(1)</script>" }} />,
    );
    // React escapes — rendered output must not contain a raw <script> tag.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
