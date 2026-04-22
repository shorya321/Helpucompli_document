"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_LABELS,
  type ActivityCategory,
} from "@/lib/activity-categories";
import {
  ACTIVITY_TREND_DAYS_DEFAULT,
  categoryColorVar,
  type ActivityTrend,
  type ActivityTrendPoint,
} from "@/lib/activity-trend";
import type { ApiResponse } from "@/types";
import { ActivityTrendSkeleton } from "./activity-trend-skeleton";

interface ActivityTrendChartProps {
  readonly initial: ActivityTrend | null;
  readonly days?: number;
}

class TrendFetchError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "TrendFetchError";
  }
}

async function fetchTrend(days: number): Promise<ActivityTrend> {
  const res = await fetch(`/api/dashboard/activity-trend?days=${days}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new TrendFetchError(res.status, `HTTP ${res.status}`);
  }
  const body = (await res.json()) as ApiResponse<ActivityTrend>;
  if (!body.data) {
    throw new TrendFetchError(500, body.error ?? "Empty payload");
  }
  return body.data;
}

function subscribeMatchMedia(query: string) {
  return (cb: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener?.("change", cb);
    return () => mq.removeEventListener?.("change", cb);
  };
}

function getMatchMedia(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMatchMedia("(prefers-reduced-motion: reduce)"),
    () => getMatchMedia("(prefers-reduced-motion: reduce)"),
    () => false,
  );
}

function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribeMatchMedia("(max-width: 640px)"),
    () => getMatchMedia("(max-width: 640px)"),
    () => false,
  );
}

function formatTick(date: string): string {
  // YYYY-MM-DD → "Apr 22"
  const [, m, d] = date.split("-");
  const monthIdx = Number(m) - 1;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[monthIdx] ?? m} ${Number(d)}`;
}

function summarise(trend: ActivityTrend): {
  total: number;
  trendLabel: "rising" | "falling" | "flat";
} {
  const total = trend.points.reduce(
    (s, p) => s + p.auth + p.document + p.policy + p.link + p.user,
    0,
  );
  const half = Math.floor(trend.points.length / 2);
  if (half < 1) return { total, trendLabel: "flat" };
  const first = trend.points
    .slice(0, half)
    .reduce(
      (s, p) => s + p.auth + p.document + p.policy + p.link + p.user,
      0,
    );
  const second = trend.points
    .slice(-half)
    .reduce(
      (s, p) => s + p.auth + p.document + p.policy + p.link + p.user,
      0,
    );
  if (second > first * 1.1) return { total, trendLabel: "rising" };
  if (second < first * 0.9) return { total, trendLabel: "falling" };
  return { total, trendLabel: "flat" };
}

export function ActivityTrendChart({
  initial,
  days = ACTIVITY_TREND_DAYS_DEFAULT,
}: ActivityTrendChartProps) {
  const reducedMotion = usePrefersReducedMotion();
  const narrow = useIsNarrow();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "activity-trend", days],
    queryFn: () => fetchTrend(days),
    initialData: initial ?? undefined,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: false,
    retry: (failureCount, error) => {
      if (error instanceof TrendFetchError && error.status < 500) return false;
      return failureCount < 2;
    },
  });

  const trend: ActivityTrend | null = data ?? initial ?? null;

  const summary = useMemo(
    () => (trend ? summarise(trend) : { total: 0, trendLabel: "flat" as const }),
    [trend],
  );

  if (!trend && isLoading) {
    return <ActivityTrendSkeleton />;
  }

  if (!trend && isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-base font-semibold">
            Activity trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-destructive text-sm">
            Unable to load activity trend.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!trend) return null;

  const chartData: ActivityTrendPoint[] = trend.points.map((p) => ({ ...p }));
  const tickInterval = narrow ? 2 : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base font-semibold">
          Activity trend
        </CardTitle>
        <CardDescription>Last {trend.days} days</CardDescription>
      </CardHeader>
      <CardContent>
        <figure className="m-0">
          <figcaption className="sr-only">
            Stacked area chart: events per day by category, last {trend.days}{" "}
            days. Total: {summary.total}. Trend: {summary.trendLabel}.
          </figcaption>
          <div className="h-56 w-full" data-testid="activity-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  {ACTIVITY_CATEGORIES.map((c) => {
                    const id = `area-${c}`;
                    const color = categoryColorVar(c);
                    return (
                      <linearGradient
                        key={id}
                        id={id}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                        <stop
                          offset="100%"
                          stopColor={color}
                          stopOpacity={0.08}
                        />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeOpacity={0.6}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatTick}
                  interval={tickInterval}
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickMargin={6}
                />
                <YAxis
                  allowDecimals={false}
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--popover-foreground)",
                    fontSize: "12px",
                  }}
                  labelFormatter={(label: string) => formatTick(label)}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: "12px" }}
                  formatter={(value: string) =>
                    CATEGORY_LABELS[value as ActivityCategory] ?? value
                  }
                />
                {ACTIVITY_CATEGORIES.map((c) => (
                  <Area
                    key={c}
                    type="monotone"
                    dataKey={c}
                    name={c}
                    stackId="1"
                    stroke={categoryColorVar(c)}
                    strokeWidth={1.5}
                    fill={`url(#area-${c})`}
                    isAnimationActive={!reducedMotion}
                    animationDuration={250}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Events per day by category</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {ACTIVITY_CATEGORIES.map((c) => (
                  <th key={c} scope="col">
                    {CATEGORY_LABELS[c]}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {trend.points.map((p) => {
                const dayTotal =
                  p.auth + p.document + p.policy + p.link + p.user;
                return (
                  <tr key={p.date}>
                    <th scope="row">{formatTick(p.date)}</th>
                    {ACTIVITY_CATEGORIES.map((c) => (
                      <td key={c}>{p[c]}</td>
                    ))}
                    <td>{dayTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </figure>
      </CardContent>
    </Card>
  );
}
