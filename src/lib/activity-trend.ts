import { z } from "zod";
import {
  ACTIVITY_CATEGORIES,
  categoryForAction,
  type ActivityCategory,
} from "@/lib/activity-categories";
import { auditActionSchema } from "@/lib/activity-feed";
import type { AuditAction } from "@/types";

export const ACTIVITY_TREND_DAYS_DEFAULT = 14 as const;
export const ACTIVITY_TREND_DAYS_MIN = 7 as const;
export const ACTIVITY_TREND_DAYS_MAX = 30 as const;
const DAY_MS = 86_400_000;

export interface ActivityTrendPoint {
  readonly date: string; // YYYY-MM-DD (UTC day)
  readonly auth: number;
  readonly document: number;
  readonly policy: number;
  readonly link: number;
  readonly user: number;
}

export interface ActivityTrend {
  readonly days: number;
  readonly points: readonly ActivityTrendPoint[];
}

const trendPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  auth: z.number().int().nonnegative(),
  document: z.number().int().nonnegative(),
  policy: z.number().int().nonnegative(),
  link: z.number().int().nonnegative(),
  user: z.number().int().nonnegative(),
});

export const activityTrendSchema = z.object({
  days: z
    .number()
    .int()
    .min(ACTIVITY_TREND_DAYS_MIN)
    .max(ACTIVITY_TREND_DAYS_MAX),
  points: z.array(trendPointSchema).max(ACTIVITY_TREND_DAYS_MAX),
});

// Narrow Prisma surface — same pattern as ActivityFeedPrisma /
// DashboardStatsPrisma so tests can inject plain stubs without pulling
// the generated client types.
export interface ActivityTrendPrisma {
  readonly auditLog: {
    groupBy: (args: {
      by: ReadonlyArray<"action">;
      where: { createdAt: { gte: Date } };
      _count: { _all: true };
    }) => Promise<Array<{ action: AuditAction; _count: { _all: number } }>>;
    findMany: (args: {
      where: { createdAt: { gte: Date } };
      select: { action: true; createdAt: true };
      take?: number;
    }) => Promise<Array<{ action: AuditAction; createdAt: Date }>>;
  };
}

interface TrendPrismaLike {
  readonly auditLog: {
    groupBy(args?: unknown): Promise<unknown[]>;
    findMany(args?: unknown): Promise<unknown[]>;
  };
}

export function asTrendPrisma(client: TrendPrismaLike): ActivityTrendPrisma {
  return client as unknown as ActivityTrendPrisma;
}

// UTC day key, e.g. 2026-04-22. Bucketing in UTC keeps tests
// deterministic and avoids per-admin tz drift when comparing trends.
function dayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyPoint(date: string): ActivityTrendPoint {
  return { date, auth: 0, document: 0, policy: 0, link: 0, user: 0 };
}

function clampDays(value: number): number {
  const n = Math.floor(Number(value) || ACTIVITY_TREND_DAYS_DEFAULT);
  return Math.max(
    ACTIVITY_TREND_DAYS_MIN,
    Math.min(ACTIVITY_TREND_DAYS_MAX, n),
  );
}

// Build the day skeleton — N entries ending today (UTC), zero-filled.
// Caller-side aggregation (vs SQL date_trunc) keeps the lib stack-
// agnostic: same code works against the in-memory test stub and the
// real Prisma client without raw SQL coupling. The audit table is
// already paginated/indexed on createdAt, and 30 days of admin events
// fits comfortably in memory for aggregation.
export async function getActivityTrend(
  prisma: ActivityTrendPrisma,
  opts: { days?: number; now?: Date } = {},
): Promise<ActivityTrend> {
  const days = clampDays(opts.days ?? ACTIVITY_TREND_DAYS_DEFAULT);
  const now = opts.now ?? new Date();

  // Window starts at midnight UTC of the earliest included day so the
  // first bucket is full, not partial.
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const windowStart = new Date(todayUtc.getTime() - (days - 1) * DAY_MS);

  const rows = await prisma.auditLog.findMany({
    where: { createdAt: { gte: windowStart } },
    select: { action: true, createdAt: true },
    take: 50_000, // safety cap — even busy tenants stay well below this
  });

  const buckets = new Map<string, ActivityTrendPoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(windowStart.getTime() + i * DAY_MS);
    const key = dayKey(d);
    buckets.set(key, emptyPoint(key));
  }

  for (const row of rows) {
    const key = dayKey(row.createdAt);
    const point = buckets.get(key);
    if (!point) continue; // out-of-window safeguard
    // Validate enum at boundary — drop rows with stale/unknown action
    // codes rather than mis-attribute them to a category.
    const parsed = auditActionSchema.safeParse(row.action);
    if (!parsed.success) continue;
    const cat = categoryForAction(parsed.data);
    const next = { ...point, [cat]: point[cat] + 1 } as ActivityTrendPoint;
    buckets.set(key, next);
  }

  const points: ActivityTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(windowStart.getTime() + i * DAY_MS);
    const key = dayKey(d);
    points.push(buckets.get(key) ?? emptyPoint(key));
  }

  return { days, points };
}

// Helper: convert trend → 7-day per-category sparkline series for
// summary cards. Slices the tail; pads with zeros if window < 7.
export function sparklineForCategory(
  trend: ActivityTrend,
  category: ActivityCategory,
  windowDays = 7,
): readonly { readonly date: string; readonly value: number }[] {
  const slice = trend.points.slice(-windowDays);
  return slice.map((p) => ({ date: p.date, value: p[category] }));
}

export function categoryColorVar(category: ActivityCategory): string {
  // 1-indexed token names match globals.css `--chart-1..5`.
  const idx = ACTIVITY_CATEGORIES.indexOf(category) + 1;
  return `var(--chart-${idx})`;
}
