/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin AUTH0_SECRET so the HMAC key is deterministic across tests.
vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    AUTH0_SECRET:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  }),
}));

import {
  issueUploadReceipt,
  verifyUploadReceipt,
  InvalidUploadReceiptError,
} from "@/lib/upload-receipt";

const base = {
  sub: "auth0|user-1",
  bucketId: "b1",
  s3Key: "abc-report.pdf",
  uploadId: undefined as string | undefined,
};

describe("upload receipt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T00:00:00Z"));
  });

  it("signs and verifies a simple receipt", () => {
    const token = issueUploadReceipt(base, 900);
    expect(verifyUploadReceipt(token, base)).toBe(true);
  });

  it("fails when sub differs", () => {
    const token = issueUploadReceipt(base, 900);
    expect(() =>
      verifyUploadReceipt(token, { ...base, sub: "auth0|other" }),
    ).toThrow(InvalidUploadReceiptError);
  });

  it("fails when s3Key differs", () => {
    const token = issueUploadReceipt(base, 900);
    expect(() =>
      verifyUploadReceipt(token, { ...base, s3Key: "other" }),
    ).toThrow(InvalidUploadReceiptError);
  });

  it("fails when bucketId differs", () => {
    const token = issueUploadReceipt(base, 900);
    expect(() =>
      verifyUploadReceipt(token, { ...base, bucketId: "b2" }),
    ).toThrow(InvalidUploadReceiptError);
  });

  it("fails when uploadId differs (multipart binding)", () => {
    const token = issueUploadReceipt({ ...base, uploadId: "uid-1" }, 900);
    expect(() =>
      verifyUploadReceipt(token, { ...base, uploadId: "uid-2" }),
    ).toThrow(InvalidUploadReceiptError);
  });

  it("fails when the receipt is expired", () => {
    const token = issueUploadReceipt(base, 60);
    vi.setSystemTime(new Date("2026-04-18T00:02:00Z")); // +120s
    expect(() => verifyUploadReceipt(token, base)).toThrow(
      InvalidUploadReceiptError,
    );
  });

  it("fails on tampered token body", () => {
    const token = issueUploadReceipt(base, 900);
    // Flip one character in the base64 segment.
    const tampered = token.replace(/.$/, (c: string) => (c === "A" ? "B" : "A"));
    expect(() => verifyUploadReceipt(tampered, base)).toThrow(
      InvalidUploadReceiptError,
    );
  });

  it("rejects malformed (non-dot-separated) input", () => {
    expect(() => verifyUploadReceipt("garbage", base)).toThrow(
      InvalidUploadReceiptError,
    );
  });
});
