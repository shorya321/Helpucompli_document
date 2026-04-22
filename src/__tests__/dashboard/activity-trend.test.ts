import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_TREND_DAYS_DEFAULT,
  ACTIVITY_TREND_DAYS_MAX,
  ACTIVITY_TREND_DAYS_MIN,
  asTrendPrisma,
  categoryColorVar,
  getActivityTrend,
  sparklineForCategory,
  type ActivityTrendPrisma,
} from "@/lib/activity-trend";
import type { AuditAction } from "@/types";

interface RowStub {
  readonly action: AuditAction;
  readonly createdAt: Date;
}

function makeStub(rows: RowStub[]) {
  const calls: Array<Record<string, unknown>> = [];
  const client: ActivityTrendPrisma = {
    auditLog: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async (args?: Record<string, unknown>) => {
        calls.push(args ?? {});
        return rows;
      }),
    },
  };
  return { client, calls };
}

const NOW = new Date("2026-04-22T12:00:00Z");

describe("getActivityTrend", () => {
  it("returns N points when days=N (zero-filled)", async () => {
    const { client } = makeStub([]);
    const trend = await getActivityTrend(client, { days: 14, now: NOW });
    expect(trend.days).toBe(14);
    expect(trend.points).toHaveLength(14);
    for (const p of trend.points) {
      expect(p.auth).toBe(0);
      expect(p.document).toBe(0);
      expect(p.policy).toBe(0);
      expect(p.link).toBe(0);
      expect(p.user).toBe(0);
    }
  });

  it("last bucket date is today (UTC)", async () => {
    const { client } = makeStub([]);
    const trend = await getActivityTrend(client, { days: 14, now: NOW });
    expect(trend.points[trend.points.length - 1]?.date).toBe("2026-04-22");
  });

  it("first bucket date is days-1 days before today", async () => {
    const { client } = makeStub([]);
    const trend = await getActivityTrend(client, { days: 14, now: NOW });
    expect(trend.points[0]?.date).toBe("2026-04-09");
  });

  it("buckets dates ascending with no gaps", async () => {
    const { client } = makeStub([]);
    const trend = await getActivityTrend(client, { days: 7, now: NOW });
    const dates = trend.points.map((p) => p.date);
    expect(dates).toEqual([
      "2026-04-16",
      "2026-04-17",
      "2026-04-18",
      "2026-04-19",
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
    ]);
  });

  it("categorises events into the right column", async () => {
    const today = new Date("2026-04-22T08:00:00Z");
    const { client } = makeStub([
      { action: "LOGIN", createdAt: today },
      { action: "LOGOUT", createdAt: today },
      { action: "DOCUMENT_UPLOAD", createdAt: today },
      { action: "POLICY_CREATE", createdAt: today },
      { action: "LINK_ACCESS", createdAt: today },
      { action: "USER_INVITE", createdAt: today },
      { action: "BUCKET_CREATE", createdAt: today },
    ]);
    const trend = await getActivityTrend(client, { days: 7, now: NOW });
    const last = trend.points[trend.points.length - 1];
    expect(last).toBeDefined();
    expect(last?.auth).toBe(2);
    expect(last?.document).toBe(1);
    expect(last?.policy).toBe(1);
    expect(last?.link).toBe(1);
    expect(last?.user).toBe(2); // USER_INVITE + BUCKET_CREATE
  });

  it("clamps days < min to min", async () => {
    const { client } = makeStub([]);
    const trend = await getActivityTrend(client, { days: 1, now: NOW });
    expect(trend.days).toBe(ACTIVITY_TREND_DAYS_MIN);
    expect(trend.points).toHaveLength(ACTIVITY_TREND_DAYS_MIN);
  });

  it("clamps days > max to max", async () => {
    const { client } = makeStub([]);
    const trend = await getActivityTrend(client, { days: 999, now: NOW });
    expect(trend.days).toBe(ACTIVITY_TREND_DAYS_MAX);
    expect(trend.points).toHaveLength(ACTIVITY_TREND_DAYS_MAX);
  });

  it("defaults to 14 days when no days option provided", async () => {
    const { client } = makeStub([]);
    const trend = await getActivityTrend(client, { now: NOW });
    expect(trend.days).toBe(ACTIVITY_TREND_DAYS_DEFAULT);
  });

  it("queries the right window in createdAt.gte", async () => {
    const { client, calls } = makeStub([]);
    await getActivityTrend(client, { days: 14, now: NOW });
    const where = (calls[0]?.where ?? {}) as {
      createdAt?: { gte?: Date };
    };
    const gte = where.createdAt?.gte;
    expect(gte).toBeInstanceOf(Date);
    // 14-day window ending today UTC, starting at 2026-04-09T00:00:00Z
    expect(gte?.toISOString()).toBe("2026-04-09T00:00:00.000Z");
  });

  it("ignores rows whose action is unknown", async () => {
    const today = new Date("2026-04-22T08:00:00Z");
    const { client } = makeStub([
      { action: "LOGIN", createdAt: today },
      { action: "NOT_REAL" as unknown as AuditAction, createdAt: today },
    ]);
    const trend = await getActivityTrend(client, { days: 7, now: NOW });
    const last = trend.points[trend.points.length - 1];
    expect(last?.auth).toBe(1);
  });

  it("ignores rows outside the window", async () => {
    const longAgo = new Date("2026-01-01T00:00:00Z");
    const { client } = makeStub([
      { action: "LOGIN", createdAt: longAgo },
    ]);
    const trend = await getActivityTrend(client, { days: 7, now: NOW });
    const totals = trend.points.reduce(
      (s, p) => s + p.auth + p.document + p.policy + p.link + p.user,
      0,
    );
    expect(totals).toBe(0);
  });
});

describe("sparklineForCategory", () => {
  it("returns the last N points (default 7)", async () => {
    const { client } = makeStub([]);
    const trend = await getActivityTrend(client, { days: 14, now: NOW });
    const spark = sparklineForCategory(trend, "document");
    expect(spark).toHaveLength(7);
    expect(spark[spark.length - 1]?.date).toBe("2026-04-22");
  });

  it("returns the requested category values", async () => {
    const today = new Date("2026-04-22T08:00:00Z");
    const { client } = makeStub([
      { action: "LINK_ACCESS", createdAt: today },
      { action: "LINK_GENERATE", createdAt: today },
    ]);
    const trend = await getActivityTrend(client, { days: 14, now: NOW });
    const spark = sparklineForCategory(trend, "link");
    expect(spark[spark.length - 1]?.value).toBe(2);
  });
});

describe("categoryColorVar", () => {
  it("maps each category to a chart-N CSS variable", () => {
    expect(categoryColorVar("auth")).toBe("var(--chart-1)");
    expect(categoryColorVar("document")).toBe("var(--chart-2)");
    expect(categoryColorVar("policy")).toBe("var(--chart-3)");
    expect(categoryColorVar("link")).toBe("var(--chart-4)");
    expect(categoryColorVar("user")).toBe("var(--chart-5)");
  });
});

describe("asTrendPrisma", () => {
  it("returns the structurally compatible client", () => {
    const stub = {
      auditLog: {
        groupBy: async () => [],
        findMany: async () => [],
      },
    };
    const client = asTrendPrisma(stub);
    expect(client).toBe(stub);
  });
});
