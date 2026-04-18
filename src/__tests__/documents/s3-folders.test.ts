/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  assertFolderName,
  buildFolderKey,
  InvalidFolderNameError,
  MAX_FOLDER_NAME_LENGTH,
} from "@/lib/s3-folders";

describe("assertFolderName", () => {
  it("accepts simple alnum name", () => {
    expect(() => assertFolderName("invoices")).not.toThrow();
  });

  it("accepts dot, hyphen, underscore, digits", () => {
    expect(() => assertFolderName("2026-q2_v3.draft")).not.toThrow();
  });

  it("accepts Unicode letters (HIPAA tenant may use non-ASCII labels)", () => {
    expect(() => assertFolderName("médicaux")).not.toThrow();
  });

  it("rejects empty", () => {
    expect(() => assertFolderName("")).toThrow(InvalidFolderNameError);
  });

  it("rejects '..'", () => {
    expect(() => assertFolderName("..")).toThrow(InvalidFolderNameError);
  });

  it("rejects '.'", () => {
    expect(() => assertFolderName(".")).toThrow(InvalidFolderNameError);
  });

  it("rejects leading dot", () => {
    expect(() => assertFolderName(".hidden")).toThrow(InvalidFolderNameError);
  });

  it("rejects slash", () => {
    expect(() => assertFolderName("a/b")).toThrow(InvalidFolderNameError);
  });

  it("rejects backslash", () => {
    expect(() => assertFolderName("a\\b")).toThrow(InvalidFolderNameError);
  });

  it("rejects control chars", () => {
    expect(() => assertFolderName("a\u0001b")).toThrow(InvalidFolderNameError);
  });

  it("rejects whitespace", () => {
    expect(() => assertFolderName("two words")).toThrow(InvalidFolderNameError);
  });

  it("rejects names longer than MAX_FOLDER_NAME_LENGTH", () => {
    const long = "a".repeat(MAX_FOLDER_NAME_LENGTH + 1);
    expect(() => assertFolderName(long)).toThrow(InvalidFolderNameError);
  });
});

describe("buildFolderKey", () => {
  it("joins parentPrefix + name + trailing slash at root", () => {
    expect(buildFolderKey("", "invoices")).toBe("invoices/");
  });

  it("joins under nested prefix", () => {
    expect(buildFolderKey("invoices/2026/", "q2")).toBe("invoices/2026/q2/");
  });

  it("rejects invalid parentPrefix (leading slash)", () => {
    expect(() => buildFolderKey("/invoices/", "q2")).toThrow();
  });

  it("rejects invalid parentPrefix (missing trailing slash)", () => {
    expect(() => buildFolderKey("invoices", "q2")).toThrow();
  });

  it("rejects invalid parentPrefix (traversal)", () => {
    expect(() => buildFolderKey("a/../b/", "q2")).toThrow();
  });

  it("rejects invalid folder name (enforced by assertFolderName)", () => {
    expect(() => buildFolderKey("", "..")).toThrow(InvalidFolderNameError);
  });
});

describe("createFolderMarker", () => {
  it("sends PutObjectCommand with zero-byte body at the computed key", async () => {
    vi.resetModules();
    const send = vi.fn().mockResolvedValue({});
    vi.doMock("@/lib/s3", async () => {
      const actual = await vi.importActual<typeof import("@/lib/s3")>(
        "@/lib/s3",
      );
      return {
        ...actual,
        getS3Client: () => ({ send }) as unknown as ReturnType<
          typeof actual.getS3Client
        >,
      };
    });
    const { createFolderMarker } = await import("@/lib/s3-folders");
    const res = await createFolderMarker({
      bucket: "helpucompli-docs-acme",
      parentPrefix: "invoices/",
      name: "2026",
    });
    expect(res.key).toBe("invoices/2026/");
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]![0] as {
      constructor: { name: string };
      input: { Bucket: string; Key: string; Body?: unknown };
    };
    expect(cmd.constructor.name).toBe("PutObjectCommand");
    expect(cmd.input.Bucket).toBe("helpucompli-docs-acme");
    expect(cmd.input.Key).toBe("invoices/2026/");
    // Zero-byte body — S3 accepts "", Buffer.alloc(0), or undefined.
    // Assert our choice is one of those.
    expect([undefined, ""]).toContain(cmd.input.Body);
    vi.doUnmock("@/lib/s3");
  });
});
