import { describe, expect, it } from "vitest";
import {
  bucketNameSchema,
  cidrSchema,
  domainSchema,
  emailSchema,
  fileNameSchema,
  uuidSchema,
} from "@/lib/validation";

describe("uuidSchema", () => {
  it("accepts RFC 4122 v4 UUIDs (canonical 8-4-4-4-12)", () => {
    expect(
      uuidSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success,
    ).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    for (const bad of [
      "",
      "not-a-uuid",
      "550e8400-e29b-41d4-a716", // truncated
      "550e8400e29b41d4a716446655440000", // no dashes
      "550e8400-e29b-41d4-a716-44665544000g", // bad hex char
    ]) {
      expect(uuidSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("emailSchema", () => {
  it("lowercases + trims + accepts valid addresses", () => {
    const r = emailSchema.safeParse("  User@Example.COM  ");
    expect(r.success).toBe(true);
    expect(r.success && r.data).toBe("user@example.com");
  });

  it("rejects bogus addresses", () => {
    for (const bad of ["", "no-at", "a@b", "a@b.", "@no-local.com"]) {
      expect(emailSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("caps length at 254 (RFC 5321)", () => {
    const tooLong = "a".repeat(250) + "@x.co";
    expect(emailSchema.safeParse(tooLong).success).toBe(false);
  });
});

describe("domainSchema", () => {
  it("accepts plain + wildcard domains", () => {
    for (const d of ["example.com", "sub.example.com", "*.example.com"]) {
      expect(domainSchema.safeParse(d).success).toBe(true);
    }
  });
  it("rejects scheme-prefixed or malformed domains", () => {
    for (const d of ["", "http://example.com", "example", "-bad.com"]) {
      expect(domainSchema.safeParse(d).success).toBe(false);
    }
  });
});

describe("cidrSchema", () => {
  it("accepts IPv4 CIDR", () => {
    expect(cidrSchema.safeParse("10.0.0.0/24").success).toBe(true);
    expect(cidrSchema.safeParse("192.168.1.1/32").success).toBe(true);
  });
  it("rejects malformed CIDR", () => {
    for (const c of ["", "10.0.0.0", "10.0.0.0/33", "999.0.0.0/24"]) {
      expect(cidrSchema.safeParse(c).success).toBe(false);
    }
  });
});

describe("bucketNameSchema", () => {
  it("accepts valid S3 bucket names (3-63 chars, lowercase, -/digit)", () => {
    for (const n of [
      "abc",
      "helpucompli-docs-main",
      "a-b-c",
      "b" + "1".repeat(62),
    ]) {
      expect(bucketNameSchema.safeParse(n).success).toBe(true);
    }
  });
  it("rejects invalid bucket names", () => {
    for (const n of [
      "", // empty
      "ab", // too short
      "-leading-dash",
      "trailing-dash-",
      "Upper-Case",
      "under_score",
      "a".repeat(64), // too long
    ]) {
      expect(bucketNameSchema.safeParse(n).success).toBe(false);
    }
  });
});

describe("fileNameSchema", () => {
  it("accepts typical filenames", () => {
    for (const n of [
      "document.pdf",
      "2026-04-20 report (final).docx",
      "image.jpeg",
    ]) {
      expect(fileNameSchema.safeParse(n).success).toBe(true);
    }
  });
  it("rejects path traversal + null bytes + slashes", () => {
    for (const n of [
      "",
      "../etc/passwd",
      "..\\windows\\system",
      "sub/dir/file.txt",
      "back\\slash",
      "null\u0000byte",
    ]) {
      expect(fileNameSchema.safeParse(n).success).toBe(false);
    }
  });
  it("caps length at 255 bytes (filesystem limit)", () => {
    expect(fileNameSchema.safeParse("a".repeat(256)).success).toBe(false);
    expect(fileNameSchema.safeParse("a".repeat(255)).success).toBe(true);
  });
});
