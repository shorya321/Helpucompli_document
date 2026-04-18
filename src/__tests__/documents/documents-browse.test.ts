/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  buildBreadcrumb,
  folderNameFromPrefix,
  parentPrefix,
  parseBrowseQuery,
  type BrowseQuery,
} from "@/lib/documents-browse";

describe("parseBrowseQuery", () => {
  it("returns empty defaults when no params present", () => {
    const q = parseBrowseQuery({});
    expect(q.bucket).toBeUndefined();
    expect(q.prefix).toBe("");
    expect(q.view).toBe("list");
  });

  it("parses bucket + prefix + view from string params", () => {
    const q = parseBrowseQuery({
      bucket: "helpucompli-docs-acme",
      prefix: "folder/sub/",
      view: "grid",
    });
    expect(q.bucket).toBe("helpucompli-docs-acme");
    expect(q.prefix).toBe("folder/sub/");
    expect(q.view).toBe("grid");
  });

  it("picks first value when param is array", () => {
    const q = parseBrowseQuery({
      bucket: ["helpucompli-docs-a", "helpucompli-docs-b"],
      prefix: ["p/"],
    });
    expect(q.bucket).toBe("helpucompli-docs-a");
    expect(q.prefix).toBe("p/");
  });

  it("defaults view to list when unknown", () => {
    const q = parseBrowseQuery({ view: "timeline" });
    expect(q.view).toBe("list");
  });

  it("rejects bucket with invalid characters", () => {
    const q = parseBrowseQuery({ bucket: "Bad Name!" });
    expect(q.bucket).toBeUndefined();
  });

  it("rejects prefix with traversal segment", () => {
    const q = parseBrowseQuery({ prefix: "a/../b/" });
    expect(q.prefix).toBe("");
  });

  it("rejects prefix with leading slash", () => {
    const q = parseBrowseQuery({ prefix: "/a/b/" });
    expect(q.prefix).toBe("");
  });

  it("strips missing trailing slash from prefix", () => {
    const q = parseBrowseQuery({ prefix: "folder/sub" });
    expect(q.prefix).toBe("folder/sub/");
  });
});

describe("buildBreadcrumb", () => {
  it("returns bucket-only crumb when prefix empty", () => {
    const crumbs = buildBreadcrumb("acme", "");
    expect(crumbs).toEqual([{ label: "acme", prefix: "" }]);
  });

  it("builds nested crumbs for multi-segment prefix", () => {
    const crumbs = buildBreadcrumb("acme", "folder/sub/");
    expect(crumbs).toEqual([
      { label: "acme", prefix: "" },
      { label: "folder", prefix: "folder/" },
      { label: "sub", prefix: "folder/sub/" },
    ]);
  });
});

describe("folderNameFromPrefix", () => {
  it("extracts the last folder segment", () => {
    expect(folderNameFromPrefix("folder/sub/")).toBe("sub");
  });
  it("returns empty for empty input", () => {
    expect(folderNameFromPrefix("")).toBe("");
  });
});

describe("parentPrefix", () => {
  it("returns empty string for root", () => {
    expect(parentPrefix("")).toBe("");
    expect(parentPrefix("folder/")).toBe("");
  });
  it("strips last segment", () => {
    expect(parentPrefix("folder/sub/")).toBe("folder/");
    expect(parentPrefix("a/b/c/")).toBe("a/b/");
  });
});

describe("BrowseQuery type", () => {
  it("compiles against expected shape", () => {
    const q: BrowseQuery = {
      bucket: "a",
      prefix: "",
      view: "grid",
    };
    expect(q.view).toBe("grid");
  });
});
