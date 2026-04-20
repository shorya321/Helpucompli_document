import { describe, expect, it, vi } from "vitest";
import {
  queryAuditLogs,
  type AuditQueryPrisma,
  type AuditQueryFilters,
} from "@/lib/audit-query";

interface FindArgs {
  where?: Record<string, unknown>;
  orderBy?: ReadonlyArray<Record<string, "asc" | "desc">>;
  take?: number;
  cursor?: { id: string };
  skip?: number;
  select?: Record<string, unknown>;
}

function makeStub(rows: ReadonlyArray<Record<string, unknown>> = []) {
  const calls: FindArgs[] = [];
  const client: AuditQueryPrisma = {
    auditLog: {
      findMany: vi.fn(async (args: FindArgs) => {
        calls.push(args);
        return rows.slice(0, args.take ?? rows.length);
      }),
    },
  };
  return { client, calls };
}

function fakeRow(i: number): Record<string, unknown> {
  return {
    id: `a-${i}`,
    createdAt: new Date(`2026-01-${String(i).padStart(2, "0")}T00:00:00Z`),
    action: "BUCKET_CREATE",
    targetType: "bucket",
    targetId: `b-${i}`,
    ipAddress: "10.0.0.1",
    user: { id: `u-${i}`, name: `User ${i}`, email: `u${i}@x.com` },
  };
}

describe("queryAuditLogs", () => {
  it("returns rows and nextCursor=null when fewer than limit returned", async () => {
    const stub = makeStub([fakeRow(1), fakeRow(2)]);
    const result = await queryAuditLogs(stub.client, { limit: 50 });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("requests take=limit+1 to detect more pages, drops sentinel, returns nextCursor", async () => {
    const stub = makeStub([fakeRow(1), fakeRow(2), fakeRow(3)]);
    const result = await queryAuditLogs(stub.client, { limit: 2 });
    expect(stub.calls[0]?.take).toBe(3);
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBe("a-2");
  });

  it("clamps limit to [1, 100]", async () => {
    const stub = makeStub([]);
    await queryAuditLogs(stub.client, { limit: 9999 });
    expect(stub.calls[0]?.take).toBe(101);
    await queryAuditLogs(stub.client, { limit: 0 });
    expect(stub.calls[1]?.take).toBe(2);
  });

  it("orders by createdAt desc then id desc for stable cursor pagination", async () => {
    const stub = makeStub([]);
    await queryAuditLogs(stub.client, { limit: 50 });
    expect(stub.calls[0]?.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("applies cursor + skip:1 when cursor passed", async () => {
    const stub = makeStub([]);
    await queryAuditLogs(stub.client, { limit: 50, cursor: "a-9" });
    expect(stub.calls[0]?.cursor).toEqual({ id: "a-9" });
    expect(stub.calls[0]?.skip).toBe(1);
  });

  it("filters by userId", async () => {
    const stub = makeStub([]);
    await queryAuditLogs(stub.client, { limit: 50, userId: "u-7" });
    expect(stub.calls[0]?.where).toMatchObject({ userId: "u-7" });
  });

  it("filters by actions (multi)", async () => {
    const stub = makeStub([]);
    await queryAuditLogs(stub.client, {
      limit: 50,
      actions: ["BUCKET_CREATE", "BUCKET_DELETE"],
    });
    expect(stub.calls[0]?.where).toMatchObject({
      action: { in: ["BUCKET_CREATE", "BUCKET_DELETE"] },
    });
  });

  it("filters by date range (gte+lte)", async () => {
    const stub = makeStub([]);
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-31T23:59:59Z");
    await queryAuditLogs(stub.client, { limit: 50, dateFrom: from, dateTo: to });
    expect(stub.calls[0]?.where).toMatchObject({
      createdAt: { gte: from, lte: to },
    });
  });

  it("filters by targetType", async () => {
    const stub = makeStub([]);
    await queryAuditLogs(stub.client, { limit: 50, targetType: "document" });
    expect(stub.calls[0]?.where).toMatchObject({ targetType: "document" });
  });

  it("composes multiple filters in a single where clause", async () => {
    const stub = makeStub([]);
    const filters: AuditQueryFilters = {
      limit: 50,
      userId: "u-1",
      actions: ["LOGIN"],
      targetType: "user",
    };
    await queryAuditLogs(stub.client, filters);
    expect(stub.calls[0]?.where).toMatchObject({
      userId: "u-1",
      action: { in: ["LOGIN"] },
      targetType: "user",
    });
  });

  it("flattens user join into userName for transport", async () => {
    const stub = makeStub([fakeRow(1)]);
    const result = await queryAuditLogs(stub.client, { limit: 50 });
    expect(result.rows[0]).toMatchObject({
      id: "a-1",
      action: "BUCKET_CREATE",
      targetType: "bucket",
      targetId: "b-1",
      ipAddress: "10.0.0.1",
      userName: "User 1",
      userEmail: "u1@x.com",
    });
  });

  it("handles missing user join gracefully (system events)", async () => {
    const row = { ...fakeRow(1), user: null };
    const stub = makeStub([row]);
    const result = await queryAuditLogs(stub.client, { limit: 50 });
    expect(result.rows[0]?.userName).toBeNull();
    expect(result.rows[0]?.userEmail).toBeNull();
  });
});
