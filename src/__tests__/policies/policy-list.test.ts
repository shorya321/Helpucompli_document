import { describe, expect, it, vi } from "vitest";
import {
  getPolicyList,
  summarizeRestrictions,
  type PolicyListPrisma,
} from "@/lib/policy-list";

function fakeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p-1",
    name: "Default",
    targetType: "bucket",
    targetValue: "helpucompli-prod",
    allowedDomains: [],
    allowedIpRanges: [],
    linkTtlSeconds: 900,
    maxDownloads: null,
    requireAuth: false,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    createdBy: { name: "Alice", email: "alice@x.com" },
    ...over,
  };
}

function makeStub(rows: ReadonlyArray<Record<string, unknown>>) {
  const calls: Record<string, unknown>[] = [];
  const client: PolicyListPrisma = {
    accessPolicy: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        calls.push(args);
        return [...rows];
      }),
    },
  };
  return { client, calls };
}

describe("getPolicyList", () => {
  it("orders by updatedAt desc and selects only the columns the list view needs", async () => {
    const stub = makeStub([fakeRow()]);
    await getPolicyList(stub.client);
    expect(stub.calls[0]?.orderBy).toEqual({ updatedAt: "desc" });
    const select = stub.calls[0]?.select as Record<string, unknown>;
    expect(select).toMatchObject({
      id: true,
      name: true,
      targetType: true,
      targetValue: true,
      allowedDomains: true,
      allowedIpRanges: true,
      linkTtlSeconds: true,
      maxDownloads: true,
      requireAuth: true,
      updatedAt: true,
    });
  });

  it("flattens createdBy join into createdByName", async () => {
    const stub = makeStub([fakeRow()]);
    const rows = await getPolicyList(stub.client);
    expect(rows[0]).toMatchObject({
      id: "p-1",
      name: "Default",
      targetType: "bucket",
      targetValue: "helpucompli-prod",
      createdByName: "Alice",
    });
  });

  it("returns null createdByName when join missing", async () => {
    const stub = makeStub([fakeRow({ createdBy: null })]);
    const rows = await getPolicyList(stub.client);
    expect(rows[0]?.createdByName).toBeNull();
  });
});

describe("summarizeRestrictions", () => {
  it("flags every restriction and TTL human-readable", () => {
    const text = summarizeRestrictions({
      allowedDomains: ["example.com", "*.acme.com"],
      allowedIpRanges: ["10.0.0.0/8"],
      linkTtlSeconds: 3600,
      maxDownloads: 5,
      requireAuth: true,
    });
    expect(text).toMatch(/2 domains?/i);
    expect(text).toMatch(/1 ip range/i);
    expect(text).toMatch(/1 hour/i);
    expect(text).toMatch(/5 downloads/i);
    expect(text).toMatch(/auth required/i);
  });

  it("renders 'no restrictions' when fully open", () => {
    const text = summarizeRestrictions({
      allowedDomains: [],
      allowedIpRanges: [],
      linkTtlSeconds: 900,
      maxDownloads: null,
      requireAuth: false,
    });
    expect(text).toMatch(/15 minutes/i);
    expect(text).toMatch(/unlimited downloads/i);
    expect(text).not.toMatch(/auth required/i);
  });
});
