/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ContextMenu } from "@/components/documents/context-menu";
import { buildDocumentMenu } from "@/components/documents/context-menu-items";

describe("buildDocumentMenu", () => {
  it("produces the standard action set when admin+ (includes link)", () => {
    const menu = buildDocumentMenu({
      bucket: "my-bucket",
      prefix: "",
      bucketId: "b1",
      s3Key: "abc-report.pdf",
      canHardDelete: false,
      canGenerateLink: true,
    });
    const keys = menu.map((m) => m.key);
    expect(keys).toEqual(["preview", "download", "move", "copy", "link", "delete"]);
  });

  it("omits link action for viewers (canGenerateLink=false)", () => {
    const menu = buildDocumentMenu({
      bucket: "my-bucket",
      prefix: "",
      bucketId: "b1",
      s3Key: "abc-report.pdf",
      canHardDelete: false,
      canGenerateLink: false,
    });
    const keys = menu.map((m) => m.key);
    expect(keys).toEqual(["preview", "download", "move", "copy", "delete"]);
  });

  it("appends hard-delete when canHardDelete=true", () => {
    const menu = buildDocumentMenu({
      bucket: "my-bucket",
      prefix: "",
      bucketId: "b1",
      s3Key: "abc-report.pdf",
      canHardDelete: true,
      canGenerateLink: true,
    });
    expect(menu.at(-1)?.key).toBe("hard-delete");
  });

  it("link action targets /links page with fromBucketId + fromS3Key", () => {
    const menu = buildDocumentMenu({
      bucket: "my-bucket",
      prefix: "",
      bucketId: "b 1",
      s3Key: "a b/c.pdf",
      canHardDelete: false,
      canGenerateLink: true,
    });
    const link = menu.find((m) => m.key === "link")!;
    expect(link.disabled).toBeUndefined();
    expect(link.href).toContain("/links?fromBucketId=b%201");
    expect(link.href).toContain("fromS3Key=a%20b%2Fc.pdf");
  });

  it("encodes bucketId + s3Key in query", () => {
    const menu = buildDocumentMenu({
      bucket: "my-bucket",
      prefix: "",
      bucketId: "b 1",
      s3Key: "a b/c.pdf",
      canHardDelete: false,
      canGenerateLink: false,
    });
    expect(menu[0]!.href).toContain("bucketId=b%201");
    expect(menu[0]!.href).toContain("s3Key=a%20b%2Fc.pdf");
  });

  it("preserves current browse state (bucket + prefix) in href", () => {
    const menu = buildDocumentMenu({
      bucket: "my-bucket",
      prefix: "folder/",
      bucketId: "b1",
      s3Key: "file.pdf",
      canHardDelete: false,
      canGenerateLink: false,
    });
    const moveHref = menu.find((m) => m.key === "move")!.href!;
    expect(moveHref).toContain("bucket=my-bucket");
    expect(moveHref).toContain("prefix=folder%2F");
    expect(moveHref).toContain("op=move");
  });

  it("omits prefix param when prefix is empty", () => {
    const menu = buildDocumentMenu({
      bucket: "my-bucket",
      prefix: "",
      bucketId: "b1",
      s3Key: "file.pdf",
      canHardDelete: false,
      canGenerateLink: false,
    });
    const moveHref = menu.find((m) => m.key === "move")!.href!;
    expect(moveHref).toContain("bucket=my-bucket");
    expect(moveHref).not.toContain("prefix=");
  });

  it("marks delete as danger", () => {
    const menu = buildDocumentMenu({
      bucket: "my-bucket",
      prefix: "",
      bucketId: "b1",
      s3Key: "k",
      canHardDelete: true,
      canGenerateLink: false,
    });
    expect(menu.find((m) => m.key === "delete")?.danger).toBe(true);
    expect(menu.find((m) => m.key === "hard-delete")?.danger).toBe(true);
  });
});

describe("ContextMenu", () => {
  it("SSR renders children without the menu", () => {
    const html = renderToString(
      <ContextMenu
        items={[
          { key: "a", label: "A", href: "/x" },
          { key: "b", label: "B", href: "/y" },
        ]}
      >
        <span>child</span>
      </ContextMenu>,
    );
    expect(html).toContain("child");
    // Menu only opens on contextmenu event — not present in SSR HTML.
    expect(html).not.toContain('role="menu"');
  });
});
