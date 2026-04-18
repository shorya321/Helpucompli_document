/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { FileList, type FileListEntry } from "@/components/documents/file-list";

const folder = (prefix: string): FileListEntry => ({
  kind: "folder",
  name: prefix.split("/").filter(Boolean).pop() ?? prefix,
  prefix,
});

const file = (key: string, size: number): FileListEntry => ({
  kind: "file",
  key,
  size: BigInt(size),
  lastModified: new Date("2026-04-10T00:00:00Z"),
});

describe("FileList", () => {
  it("renders empty state when nothing to show", () => {
    const html = renderToString(
      <FileList
        bucket="helpucompli-docs-acme"
        prefix=""
        entries={[]}
        view="list"
      />,
    );
    expect(html.toLowerCase()).toContain("empty");
  });

  it("renders folder rows with up-nav href", () => {
    const html = renderToString(
      <FileList
        bucket="helpucompli-docs-acme"
        prefix=""
        entries={[folder("invoices/")]}
        view="list"
      />,
    );
    expect(html).toContain("invoices");
    expect(html).toContain(
      "/documents?bucket=helpucompli-docs-acme&amp;prefix=invoices%2F",
    );
  });

  it("renders file rows with filename + size", () => {
    const html = renderToString(
      <FileList
        bucket="helpucompli-docs-acme"
        prefix=""
        entries={[file("readme.pdf", 2048)]}
        view="list"
      />,
    );
    expect(html).toContain("readme.pdf");
    expect(html).toContain("2.0 KB");
  });

  it("renders grid view when view=grid", () => {
    const html = renderToString(
      <FileList
        bucket="helpucompli-docs-acme"
        prefix=""
        entries={[file("a.pdf", 0), folder("f/")]}
        view="grid"
      />,
    );
    expect(html).toContain("data-view=\"grid\"");
  });

  it("renders list view when view=list", () => {
    const html = renderToString(
      <FileList
        bucket="helpucompli-docs-acme"
        prefix=""
        entries={[file("a.pdf", 0)]}
        view="list"
      />,
    );
    expect(html).toContain("data-view=\"list\"");
  });

  it("escapes HTML in filenames (XSS regression)", () => {
    const html = renderToString(
      <FileList
        bucket="helpucompli-docs-acme"
        prefix=""
        entries={[file("<img src=x>.pdf", 0)]}
        view="list"
      />,
    );
    expect(html).not.toContain("<img src=x>.pdf");
    expect(html).toContain("&lt;img");
  });

  it("renders breadcrumb when nested prefix", () => {
    const html = renderToString(
      <FileList
        bucket="helpucompli-docs-acme"
        prefix="invoices/2026/"
        entries={[]}
        view="list"
      />,
    );
    expect(html).toContain("helpucompli-docs-acme");
    expect(html).toContain("invoices");
    expect(html).toContain("2026");
  });
});
