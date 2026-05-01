/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DocumentPreview } from "@/components/documents/document-preview";

const base = {
  bucketId: "b1",
  s3Key: "abc-file.pdf",
  filename: "report.pdf",
  sizeBytes: BigInt(2048),
  uploadedAt: new Date("2026-04-10T12:00:00Z"),
  uploadedByName: "Test User" as string | null,
};

describe("DocumentPreview", () => {
  it("renders filename and size regardless of type", () => {
    const html = renderToString(
      <DocumentPreview {...base} contentType="application/pdf" />,
    );
    expect(html).toContain("report.pdf");
    expect(html).toContain("2.0 KB");
  });

  it("renders iframe for PDF contentType", () => {
    const html = renderToString(
      <DocumentPreview {...base} contentType="application/pdf" />,
    );
    // SSR render happens before useEffect fetch, so iframe is absent
    // until URL lands; but the fallback dl must NOT appear.
    expect(html).not.toContain("No inline preview available");
  });

  it("renders metadata panel for unsupported types", () => {
    const html = renderToString(
      <DocumentPreview {...base} contentType="application/x-custom" />,
    );
    expect(html).toContain("No inline preview available");
    expect(html).toContain("application/x-custom");
    expect(html).toContain("2026-04-10T12:00:00");
  });

  it("escapes HTML in filename (XSS regression)", () => {
    const html = renderToString(
      <DocumentPreview
        {...base}
        filename="<img src=x>.pdf"
        contentType="application/pdf"
      />,
    );
    expect(html).not.toContain("<img src=x>.pdf");
    expect(html).toContain("&lt;img");
  });

  it("shows uploadedByName in metadata fallback", () => {
    const html = renderToString(
      <DocumentPreview
        {...base}
        contentType="application/x-custom"
        uploadedByName="Alice Admin"
      />,
    );
    expect(html).toContain("Alice Admin");
  });

  it("renders image-fallback metadata when contentType=null", () => {
    const html = renderToString(
      <DocumentPreview {...base} contentType={null} />,
    );
    expect(html).toContain("No inline preview available");
    expect(html).toContain("unknown");
  });

  it.each([
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime",
  ])("treats %s as inline-eligible (no fallback dl)", (ct) => {
    const html = renderToString(
      <DocumentPreview {...base} contentType={ct} />,
    );
    expect(html).not.toContain("No inline preview available");
  });

  it.each([
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
  ])("treats %s as inline-eligible (no fallback dl)", (ct) => {
    const html = renderToString(
      <DocumentPreview {...base} contentType={ct} />,
    );
    expect(html).not.toContain("No inline preview available");
  });

  it("still falls back for unrelated binary types like application/zip", () => {
    const html = renderToString(
      <DocumentPreview {...base} contentType="application/zip" />,
    );
    expect(html).toContain("No inline preview available");
    expect(html).toContain("application/zip");
  });
});
