import { describe, expect, it, vi } from "vitest";
import {
  getLinkAnalytics,
  type LinkAnalyticsPrisma,
} from "@/lib/link-analytics";

const NOW = new Date("2026-04-20T12:00:00Z");

function makeStub(opts: {
  total?: number;
  revoked?: number;
  active?: number;
  topDocs?: ReadonlyArray<Record<string, unknown>>;
  docMap?: Record<string, { filename: string }>;
}) {
  const calls: { method: string; args: unknown }[] = [];
  const generatedLink = {
    count: vi.fn(async (args?: { where?: Record<string, unknown> }) => {
      calls.push({ method: "count", args });
      const where = args?.where as Record<string, unknown> | undefined;
      if (!where) return opts.total ?? 0;
      if (where.isRevoked === true) return opts.revoked ?? 0;
      const expiresAt = where.expiresAt as Record<string, unknown> | undefined;
      if (expiresAt?.gt) return opts.active ?? 0;
      return 0;
    }),
    groupBy: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ method: "groupBy", args });
      return [...(opts.topDocs ?? [])];
    }),
  };
  const document = {
    findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
      const ids = args.where.id.in;
      return ids.map((id) => ({
        id,
        filename: opts.docMap?.[id]?.filename ?? "unknown",
      }));
    }),
  };
  const client: LinkAnalyticsPrisma = {
    generatedLink,
    document,
  };
  return { client, calls };
}

describe("getLinkAnalytics", () => {
  it("returns total/active/revoked/expired counts (expired = total - active - revoked)", async () => {
    const stub = makeStub({
      total: 100,
      active: 60,
      revoked: 10,
    });
    const r = await getLinkAnalytics(stub.client, NOW);
    expect(r.total).toBe(100);
    expect(r.active).toBe(60);
    expect(r.revoked).toBe(10);
    expect(r.expired).toBe(30); // 100 - 60 - 10
  });

  it("expired clamps at zero (defensive — counts could race)", async () => {
    const stub = makeStub({ total: 5, active: 60, revoked: 10 });
    const r = await getLinkAnalytics(stub.client, NOW);
    expect(r.expired).toBe(0);
  });

  it("returns top 5 most-shared documents joined with filename", async () => {
    const stub = makeStub({
      total: 0,
      active: 0,
      revoked: 0,
      topDocs: [
        { documentId: "d-1", _count: { _all: 12 } },
        { documentId: "d-2", _count: { _all: 7 } },
        { documentId: "d-3", _count: { _all: 3 } },
      ],
      docMap: {
        "d-1": { filename: "alpha.pdf" },
        "d-2": { filename: "beta.pdf" },
        "d-3": { filename: "gamma.pdf" },
      },
    });
    const r = await getLinkAnalytics(stub.client, NOW);
    expect(r.topDocuments).toHaveLength(3);
    expect(r.topDocuments[0]).toMatchObject({
      documentId: "d-1",
      filename: "alpha.pdf",
      linkCount: 12,
    });
  });

  it("groupBy is called with take=5 and orderBy desc on _count", async () => {
    const stub = makeStub({});
    await getLinkAnalytics(stub.client, NOW);
    const groupCall = stub.calls.find((c) => c.method === "groupBy");
    expect(groupCall?.args).toMatchObject({
      by: ["documentId"],
      take: 5,
      orderBy: { _count: { documentId: "desc" } },
    });
  });

  it("safely returns when topDocs is empty (no document.findMany call)", async () => {
    const stub = makeStub({ topDocs: [] });
    const r = await getLinkAnalytics(stub.client, NOW);
    expect(r.topDocuments).toEqual([]);
  });
});
