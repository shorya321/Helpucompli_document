import { describe, expect, it } from "vitest";
import {
  domainSchema,
  cidrSchema,
  policyInputSchema,
  policyUpdateSchema,
} from "@/lib/policy-schema";

describe("domainSchema", () => {
  it.each([
    "example.com",
    "sub.example.com",
    "deep.sub.example.com",
    "*.example.com",
    "*.sub.example.com",
    "xn--bcher-kva.de",
  ])("accepts %s", (d) => {
    expect(domainSchema.safeParse(d).success).toBe(true);
  });

  it.each([
    "",
    " ",
    "no_underscore.com",
    "ends-with-dash-.com",
    "-starts-with-dash.com",
    "double..dot",
    "*.*.example.com",
    "**.example.com",
    "*example.com",
    "javascript:alert(1)",
    "http://example.com",
    "example.com/path",
    "a".repeat(254),
  ])("rejects %s", (d) => {
    expect(domainSchema.safeParse(d).success).toBe(false);
  });

  it("normalises to lowercase", () => {
    expect(domainSchema.parse("Example.COM")).toBe("example.com");
  });
});

describe("cidrSchema", () => {
  it.each([
    "10.0.0.0/8",
    "192.168.1.0/24",
    "1.2.3.4/32",
    "0.0.0.0/0",
    "255.255.255.255/32",
  ])("accepts %s", (c) => {
    expect(cidrSchema.safeParse(c).success).toBe(true);
  });

  it.each([
    "10.0.0.0",
    "10.0.0.0/33",
    "10.0.0.0/-1",
    "256.0.0.0/24",
    "10.0.0/24",
    "::1/128",
    "10.0.0.0 /24",
    "",
  ])("rejects %s", (c) => {
    expect(cidrSchema.safeParse(c).success).toBe(false);
  });
});

describe("policyInputSchema", () => {
  const base = {
    name: "Default",
    targetType: "bucket",
    targetValue: "helpucompli-prod",
    allowedDomains: [],
    allowedIpRanges: [],
    linkTtlSeconds: 900,
    maxDownloads: null,
    requireAuth: false,
  };

  it("accepts a minimal valid policy", () => {
    expect(policyInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(
      policyInputSchema.safeParse({ ...base, name: "" }).success,
    ).toBe(false);
  });

  it("rejects unknown targetType", () => {
    expect(
      policyInputSchema.safeParse({ ...base, targetType: "user" }).success,
    ).toBe(false);
  });

  it("rejects empty targetValue", () => {
    expect(
      policyInputSchema.safeParse({ ...base, targetValue: "" }).success,
    ).toBe(false);
  });

  it("accepts linkTtlSeconds=null (never expires; superadmin-gated on route)", () => {
    expect(
      policyInputSchema.safeParse({ ...base, linkTtlSeconds: null }).success,
    ).toBe(true);
  });

  it("rejects TTL outside [60, 604800]", () => {
    expect(
      policyInputSchema.safeParse({ ...base, linkTtlSeconds: 30 }).success,
    ).toBe(false);
    expect(
      policyInputSchema.safeParse({ ...base, linkTtlSeconds: 604_801 }).success,
    ).toBe(false);
  });

  it("rejects negative or excessive maxDownloads", () => {
    expect(
      policyInputSchema.safeParse({ ...base, maxDownloads: 0 }).success,
    ).toBe(false);
    expect(
      policyInputSchema.safeParse({ ...base, maxDownloads: -5 }).success,
    ).toBe(false);
    expect(
      policyInputSchema.safeParse({ ...base, maxDownloads: 100_000 }).success,
    ).toBe(false);
  });

  it("rejects too many domains or CIDRs (DoS guard)", () => {
    const lots = Array.from({ length: 51 }, (_, i) => `host${i}.example.com`);
    expect(
      policyInputSchema.safeParse({ ...base, allowedDomains: lots }).success,
    ).toBe(false);
    const cidrs = Array.from({ length: 51 }, () => "10.0.0.0/24");
    expect(
      policyInputSchema.safeParse({ ...base, allowedIpRanges: cidrs }).success,
    ).toBe(false);
  });

  it("rejects bad domain or CIDR inside arrays", () => {
    expect(
      policyInputSchema.safeParse({
        ...base,
        allowedDomains: ["good.example.com", "bad_domain"],
      }).success,
    ).toBe(false);
    expect(
      policyInputSchema.safeParse({
        ...base,
        allowedIpRanges: ["10.0.0.0/8", "256.0.0.0/8"],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict mode — prototype-pollution guard)", () => {
    const result = policyInputSchema.safeParse({
      ...base,
      isAdmin: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("policyUpdateSchema (partial)", () => {
  it("accepts a single-field patch", () => {
    expect(policyUpdateSchema.safeParse({ name: "Renamed" }).success).toBe(
      true,
    );
  });

  it("rejects empty patch", () => {
    expect(policyUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("validates each provided field", () => {
    expect(
      policyUpdateSchema.safeParse({ linkTtlSeconds: 1 }).success,
    ).toBe(false);
  });
});
