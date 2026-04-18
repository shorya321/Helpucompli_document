/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  buildUploadKey,
  sanitizeFilename,
  chooseUploadMode,
  uploadUrlRequestSchema,
  uploadCompleteRequestSchema,
  MAX_FILENAME_LENGTH,
} from "@/lib/document-upload";

describe("sanitizeFilename", () => {
  it("strips leading path + replaces unsafe chars", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
  });

  it("strips directory prefix and keeps the basename", () => {
    expect(sanitizeFilename("a/b\\c.pdf")).toBe("c.pdf");
  });

  it("preserves letters, numbers, dots, hyphens, underscores, spaces", () => {
    expect(sanitizeFilename("Report Q2-2026_v3.pdf")).toBe("Report Q2-2026_v3.pdf");
  });

  it("strips control characters", () => {
    expect(sanitizeFilename("file\u0000name.pdf")).toBe("file_name.pdf");
  });

  it("caps at MAX_FILENAME_LENGTH chars", () => {
    const long = "a".repeat(MAX_FILENAME_LENGTH + 50) + ".pdf";
    const safe = sanitizeFilename(long);
    expect(safe.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
  });

  it("rejects empty filename as 'file'", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("///")).toBe("file");
  });
});

describe("buildUploadKey", () => {
  it("joins prefix + uuid + safe filename with a separator", () => {
    const key = buildUploadKey({
      folderPrefix: "invoices/2026/",
      filename: "Q2 report.pdf",
      uuid: "11111111-2222-3333-4444-555555555555",
    });
    expect(key).toBe(
      "invoices/2026/11111111-2222-3333-4444-555555555555-Q2 report.pdf",
    );
  });

  it("drops prefix when empty", () => {
    const key = buildUploadKey({
      folderPrefix: "",
      filename: "a.pdf",
      uuid: "11111111-2222-3333-4444-555555555555",
    });
    expect(key).toBe("11111111-2222-3333-4444-555555555555-a.pdf");
  });

  it("sanitizes filename in key", () => {
    const key = buildUploadKey({
      folderPrefix: "",
      filename: "../../secret.pdf",
      uuid: "u",
    });
    expect(key).toBe("u-secret.pdf");
  });

  it("rejects traversal in folderPrefix", () => {
    expect(() =>
      buildUploadKey({
        folderPrefix: "a/../b/",
        filename: "x.pdf",
        uuid: "u",
      }),
    ).toThrow();
  });

  it("rejects folderPrefix without trailing slash", () => {
    expect(() =>
      buildUploadKey({
        folderPrefix: "invoices",
        filename: "x.pdf",
        uuid: "u",
      }),
    ).toThrow();
  });

  it("rejects folderPrefix with leading slash", () => {
    expect(() =>
      buildUploadKey({
        folderPrefix: "/invoices/",
        filename: "x.pdf",
        uuid: "u",
      }),
    ).toThrow();
  });
});

describe("chooseUploadMode", () => {
  it("simple mode below threshold", () => {
    expect(chooseUploadMode(1024)).toBe("simple");
    expect(chooseUploadMode(100 * 1024 * 1024)).toBe("simple");
  });
  it("multipart strictly above threshold", () => {
    expect(chooseUploadMode(100 * 1024 * 1024 + 1)).toBe("multipart");
    expect(chooseUploadMode(500 * 1024 * 1024)).toBe("multipart");
  });
  it("rejects zero and negative sizes", () => {
    expect(() => chooseUploadMode(0)).toThrow();
    expect(() => chooseUploadMode(-1)).toThrow();
  });
  it("rejects sizes over 5 GB cap", () => {
    const cap = 5 * 1024 * 1024 * 1024;
    expect(() => chooseUploadMode(cap + 1)).toThrow();
  });
});

describe("uploadUrlRequestSchema", () => {
  const valid = {
    bucketId: "11111111-1111-1111-1111-111111111111",
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    folderPrefix: "",
  };

  it("accepts a well-formed payload", () => {
    expect(uploadUrlRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("requires UUID bucketId", () => {
    expect(
      uploadUrlRequestSchema.safeParse({ ...valid, bucketId: "not-uuid" }).success,
    ).toBe(false);
  });

  it("rejects filename over cap", () => {
    expect(
      uploadUrlRequestSchema.safeParse({
        ...valid,
        filename: "a".repeat(MAX_FILENAME_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects invalid contentType", () => {
    expect(
      uploadUrlRequestSchema.safeParse({ ...valid, contentType: "not a mime" }).success,
    ).toBe(false);
  });

  it("rejects sizeBytes over 5 GB", () => {
    expect(
      uploadUrlRequestSchema.safeParse({
        ...valid,
        sizeBytes: 5 * 1024 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });

  it("rejects folderPrefix with traversal", () => {
    expect(
      uploadUrlRequestSchema.safeParse({ ...valid, folderPrefix: "a/../b/" }).success,
    ).toBe(false);
  });
});

describe("uploadCompleteRequestSchema", () => {
  const valid = {
    bucketId: "11111111-1111-1111-1111-111111111111",
    s3Key: "abc-report.pdf",
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
  };

  it("accepts a well-formed simple-upload payload", () => {
    expect(uploadCompleteRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts multipart payload with parts", () => {
    expect(
      uploadCompleteRequestSchema.safeParse({
        ...valid,
        multipart: {
          uploadId: "uid",
          parts: [{ partNumber: 1, etag: '"abc123abc123abc123abc123abc12312"' }],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects s3Key with traversal", () => {
    expect(
      uploadCompleteRequestSchema.safeParse({ ...valid, s3Key: "../a.pdf" }).success,
    ).toBe(false);
  });

  it("rejects s3Key with leading slash", () => {
    expect(
      uploadCompleteRequestSchema.safeParse({ ...valid, s3Key: "/a.pdf" }).success,
    ).toBe(false);
  });
});
