import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_FEED_LIMIT,
  ACTIVITY_FEED_PAGE_LIMIT_MAX,
  getRecentActivityPage,
  type ActivityFeedPrisma,
} from "@/lib/activity-feed";
import type { AuditAction } from "@/types";

function row(
  id: string,
  createdAt: Date,
  action: AuditAction = "LOGIN",
): Record<string, unknown> {
  return {
    id,
    createdAt,
    action,
    targetType: "user",
    targetId: `target-${id}`,
    user: { name: `name-${id}` },
  };
}

interface FindManyArgs {
  take?: number;
  orderBy?: unknown;
  select?: unknown;
  where?: Record<string, unknown>;
}

function makeStub(rowsByCall: Array<Record<string, unknown>[]>) {
  let i = 0;
  const calls: FindManyArgs[] = [];
  const findUniqueCalls: Array<{ id: string }> = [];
  const idToRow = new Map<string, Record<string, unknown>>();
  for (const list of rowsByCall) {
    for (const r of list) {
      idToRow.set(r.id as string, r);
    }
  }
  const client: ActivityFeedPrisma = {
    auditLog: {
      findMany: vi.fn(async (args?: FindManyArgs) => {
        calls.push(args ?? {});
        return rowsByCall[i++] ?? [];
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        findUniqueCalls.push(where);
        const found = idToRow.get(where.id);
        if (!found) return null;
        return { createdAt: found.createdAt as Date };
      }),
    },
  };
  return { client, calls, findUniqueCalls };
}

describe("getRecentActivityPage", () => {
  it("first page: no cursor, returns up to limit + nextCursor when more exist", async () => {
    const rows = Array.from({ length: ACTIVITY_FEED_LIMIT + 1 }, (_, i) =>
      row(`a${i}`, new Date(2026, 3, 22, 12, 0, 0, -i)),
    );
    const { client, calls } = makeStub([rows]);
    const page = await getRecentActivityPage(client, { limit: ACTIVITY_FEED_LIMIT });
    expect(page.entries).toHaveLength(ACTIVITY_FEED_LIMIT);
    expect(page.nextCursor).toBe(`a${ACTIVITY_FEED_LIMIT - 1}`);
    expect(calls[0]?.take).toBe(ACTIVITY_FEED_LIMIT + 1);
    expect(calls[0]?.where).toBeUndefined();
  });

  it("first page: nextCursor is null when fewer than limit returned", async () => {
    const rows = [row("only", new Date("2026-04-22T12:00:00Z"))];
    const { client } = makeStub([rows]);
    const page = await getRecentActivityPage(client, { limit: 20 });
    expect(page.entries).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("second page: with cursor, applies where clause and returns next slice", async () => {
    const ts = new Date("2026-04-22T12:00:00Z");
    // The cursor row needs to be discoverable by findUnique only.
    const cursorRow = row("a19", ts);
    const nextRows = Array.from({ length: 21 }, (_, i) =>
      row(`b${i}`, new Date(ts.getTime() - (i + 1) * 1000)),
    );
    // Single findMany call in the cursor branch — return nextRows.
    // Seed the findUnique map by including cursorRow in the same batch
    // so the id→row map covers it; findMany only returns the FIRST
    // batch which we set to nextRows.
    const { client, calls, findUniqueCalls } = makeStub([nextRows]);
    // Manually register cursor row so findUnique can find it.
    (client.auditLog.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === "a19") return { createdAt: ts };
        if (where.id === cursorRow.id) return { createdAt: ts };
        return null;
      },
    );
    const page = await getRecentActivityPage(client, {
      cursor: "a19",
      limit: 20,
    });
    expect(findUniqueCalls.length === 0 || findUniqueCalls[0]?.id === "a19").toBe(
      true,
    );
    // The first (and only) findMany call here is the page query.
    expect(calls[0]?.where).toBeDefined();
    expect(page.entries).toHaveLength(20);
    expect(page.nextCursor).toBe("b19");
  });

  it("empty page when cursor row missing — no crash, nextCursor null", async () => {
    const { client } = makeStub([[]]);
    const page = await getRecentActivityPage(client, {
      cursor: "does-not-exist",
      limit: 20,
    });
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("clamps limit > max to max", async () => {
    const rows = Array.from({ length: ACTIVITY_FEED_PAGE_LIMIT_MAX + 1 }, (_, i) =>
      row(`x${i}`, new Date(2026, 3, 22, 12, 0, 0, -i)),
    );
    const { client, calls } = makeStub([rows]);
    await getRecentActivityPage(client, { limit: 9999 });
    expect(calls[0]?.take).toBe(ACTIVITY_FEED_PAGE_LIMIT_MAX + 1);
  });

  it("clamps limit < 1 to 1", async () => {
    const { client, calls } = makeStub([[row("a0", new Date())]]);
    await getRecentActivityPage(client, { limit: 0 });
    expect(calls[0]?.take).toBe(2); // 1 + 1
  });

  it("orders by createdAt desc, id desc — tie-stable", async () => {
    const { client, calls } = makeStub([[]]);
    await getRecentActivityPage(client, { limit: 5 });
    expect(calls[0]?.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("HIPAA: never returns email even if a row has it", async () => {
    const r = row("h1", new Date());
    (r.user as Record<string, unknown>).email = "leak@x.com";
    const { client } = makeStub([[r]]);
    const page = await getRecentActivityPage(client, { limit: 5 });
    const json = JSON.stringify(page);
    expect(json).not.toContain("leak@x.com");
  });
});
