/** @vitest-environment node */
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/documents/restore-button", () => ({
  RestoreButton: ({ filename }: { filename: string }) => (
    <button type="button">Restore {filename}</button>
  ),
}));

vi.mock("@/components/documents/restore-folder-button", () => ({
  RestoreFolderButton: ({ prefix }: { prefix: string }) => (
    <button type="button">Restore {prefix}</button>
  ),
}));

import { TrashView, type TrashEntry } from "@/components/documents/trash-view";

describe("TrashView", () => {
  it("renders deleted folders with a folder restore action", () => {
    const entries: TrashEntry[] = [
      {
        kind: "folder",
        id: "folder:b1:docs/",
        bucketId: "b1",
        bucketName: "helpucompli-docs-acme",
        prefix: "docs/",
        deletedAt: new Date("2026-05-02T10:00:00.000Z"),
      },
    ];

    const html = renderToString(<TrashView entries={entries} canHardDelete={false} />);

    expect(html).toContain("docs/");
    expect(html).toContain("Folder");
    expect(html).toMatch(/Restore\s*(?:<!-- -->)?\s*docs\//);
  });

  it("still renders deleted documents with the existing restore action", () => {
    const entries: TrashEntry[] = [
      {
        kind: "document",
        id: "doc-a",
        bucketId: "b1",
        bucketName: "helpucompli-docs-acme",
        s3Key: "docs/a.pdf",
        filename: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: BigInt(100),
        deletedAt: new Date("2026-05-02T10:00:00.000Z"),
        deletedByEmail: "admin@example.com",
      },
    ];

    const html = renderToString(<TrashView entries={entries} canHardDelete={false} />);

    expect(html).toContain("a.pdf");
    expect(html).toContain("Document");
    expect(html).toMatch(/Restore\s*(?:<!-- -->)?\s*a\.pdf/);
  });
});
