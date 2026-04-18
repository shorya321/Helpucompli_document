/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { FileTree } from "@/components/documents/file-tree";
import type { BucketSummary } from "@/lib/bucket-list";

const mkBucket = (over: Partial<BucketSummary> = {}): BucketSummary => ({
  id: `b-${over.name ?? "acme"}`,
  name: "helpucompli-docs-acme",
  region: "us-east-1",
  description: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  isActive: true,
  documentCount: 0,
  storageBytes: BigInt(0),
  ...over,
});

describe("FileTree", () => {
  it("renders empty state when no buckets", () => {
    const html = renderToString(
      <FileTree buckets={[]} activeBucket={undefined} />,
    );
    expect(html.toLowerCase()).toContain("no buckets");
  });

  it("lists every bucket name", () => {
    const html = renderToString(
      <FileTree
        buckets={[
          mkBucket({ name: "helpucompli-docs-acme" }),
          mkBucket({ name: "helpucompli-docs-beta" }),
        ]}
        activeBucket={undefined}
      />,
    );
    expect(html).toContain("helpucompli-docs-acme");
    expect(html).toContain("helpucompli-docs-beta");
  });

  it("links each bucket to /documents?bucket=<name>", () => {
    const html = renderToString(
      <FileTree
        buckets={[mkBucket({ name: "helpucompli-docs-acme" })]}
        activeBucket={undefined}
      />,
    );
    expect(html).toContain("/documents?bucket=helpucompli-docs-acme");
  });

  it("marks the active bucket with aria-current", () => {
    const html = renderToString(
      <FileTree
        buckets={[
          mkBucket({ name: "helpucompli-docs-acme" }),
          mkBucket({ name: "helpucompli-docs-beta" }),
        ]}
        activeBucket="helpucompli-docs-beta"
      />,
    );
    expect(html).toMatch(
      /helpucompli-docs-beta[^<]*<\/[^>]+>[\s\S]*aria-current|aria-current[^>]*>[\s\S]*helpucompli-docs-beta/,
    );
  });

  it("skips inactive buckets", () => {
    const html = renderToString(
      <FileTree
        buckets={[
          mkBucket({ name: "helpucompli-docs-acme" }),
          mkBucket({ name: "helpucompli-docs-archived", isActive: false }),
        ]}
        activeBucket={undefined}
      />,
    );
    expect(html).toContain("helpucompli-docs-acme");
    expect(html).not.toContain("helpucompli-docs-archived");
  });
});
