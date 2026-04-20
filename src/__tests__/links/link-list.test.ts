import { describe, expect, it, vi } from "vitest";
import {
  computeLinkStatus,
  queryLinks,
  type LinkListPrisma,
} from "@/lib/link-list";

const NOW = new Date("2026-04-20T12:00:00Z");

describe("computeLinkStatus", () => {
  it("revoked → 'revoked' (wins over expiry)", () => {
    expect(
      computeLinkStatus(
        {
          isRevoked: true,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          downloadCount: 0,
          maxDownloads: null,
        },
        NOW,
      ),
    ).toBe("revoked");
  });

  it("expired when expiresAt < now and not revoked", () => {
    expect(
      computeLinkStatus(
        {
          isRevoked: false,
          expiresAt: new Date("2026-04-19T00:00:00Z"),
          downloadCount: 0,
          maxDownloads: null,
        },
        NOW,
      ),
    ).toBe("expired");
  });

  it("expired when downloadCount has reached maxDownloads", () => {
    expect(
      computeLinkStatus(
        {
          isRevoked: false,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          downloadCount: 5,
          maxDownloads: 5,
        },
        NOW,
      ),
    ).toBe("expired");
  });

  it("active otherwise", () => {
    expect(
      computeLinkStatus(
        {
          isRevoked: false,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          downloadCount: 0,
          maxDownloads: null,
        },
        NOW,
      ),
    ).toBe("active");
  });
});

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "link-1",
    documentId: "d-1",
    presignedUrlHash: "tok-1",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    createdAt: new Date("2026-04-01T00:00:00Z"),
    downloadCount: 0,
    maxDownloads: null,
    isRevoked: false,
    document: { filename: "a.pdf", bucket: { name: "alpha-bucket" } },
    generatedBy: { name: "Alice", email: "alice@x.com" },
    ...over,
  };
}

function makeStub(rows: ReadonlyArray<Record<string, unknown>>) {
  const calls: Record<string, unknown>[] = [];
  const client: LinkListPrisma = {
    generatedLink: {
      findMany: vi.fn(async (args: Parameters<LinkListPrisma["generatedLink"]["findMany"]>[0]) => {
        calls.push(args as Record<string, unknown>);
        return [...rows];
      }),
    },
  };
  return { client, calls };
}

describe("queryLinks", () => {
  it("orders by chosen field+dir", async () => {
    const stub = makeStub([]);
    await queryLinks(stub.client, {
      status: "all",
      sort: "expiresAt",
      dir: "asc",
    });
    expect(stub.calls[0]?.orderBy).toEqual([
      { expiresAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("filters status=active using where: !revoked && expires>now", async () => {
    const stub = makeStub([]);
    await queryLinks(stub.client, {
      status: "active",
      sort: "createdAt",
      dir: "desc",
    });
    const where = stub.calls[0]?.where as Record<string, unknown>;
    expect(where.isRevoked).toBe(false);
    expect((where.expiresAt as Record<string, unknown>).gt).toBeInstanceOf(Date);
  });

  it("filters status=expired using where: !revoked && expires<=now", async () => {
    const stub = makeStub([]);
    await queryLinks(stub.client, {
      status: "expired",
      sort: "createdAt",
      dir: "desc",
    });
    const where = stub.calls[0]?.where as Record<string, unknown>;
    expect(where.isRevoked).toBe(false);
    expect((where.expiresAt as Record<string, unknown>).lte).toBeInstanceOf(
      Date,
    );
  });

  it("filters status=revoked using where: isRevoked=true", async () => {
    const stub = makeStub([]);
    await queryLinks(stub.client, {
      status: "revoked",
      sort: "createdAt",
      dir: "desc",
    });
    expect(stub.calls[0]?.where).toMatchObject({ isRevoked: true });
  });

  it("uses cursor + skip:1", async () => {
    const stub = makeStub([]);
    await queryLinks(stub.client, {
      status: "all",
      sort: "createdAt",
      dir: "desc",
      cursor: "link-9",
    });
    expect(stub.calls[0]?.cursor).toEqual({ id: "link-9" });
    expect(stub.calls[0]?.skip).toBe(1);
  });

  it("returns nextCursor when more rows than limit", async () => {
    const stub = makeStub([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]);
    const result = await queryLinks(
      stub.client,
      { status: "all", sort: "createdAt", dir: "desc", limit: 2 },
      NOW,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBe("b");
  });

  it("flattens document + generatedBy joins and computes status", async () => {
    const stub = makeStub([row()]);
    const result = await queryLinks(
      stub.client,
      { status: "all", sort: "createdAt", dir: "desc" },
      NOW,
    );
    expect(result.rows[0]).toMatchObject({
      id: "link-1",
      token: "tok-1",
      documentName: "a.pdf",
      bucketName: "alpha-bucket",
      generatedByName: "Alice",
      status: "active",
    });
  });
});
