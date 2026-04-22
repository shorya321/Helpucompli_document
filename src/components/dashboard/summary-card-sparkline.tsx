"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { categoryColorVar } from "@/lib/activity-trend";
import type { ActivityCategory } from "@/lib/activity-categories";

interface SparklinePoint {
  readonly date: string;
  readonly value: number;
}

interface SummaryCardSparklineProps {
  readonly data: readonly SparklinePoint[];
  readonly category: ActivityCategory;
  readonly label: string;
}

export function SummaryCardSparkline({
  data,
  category,
  label,
}: SummaryCardSparklineProps) {
  if (data.length === 0) return null;
  const total = data.reduce((sum, p) => sum + p.value, 0);
  const fillId = `spark-${category}`;
  const color = categoryColorVar(category);

  return (
    <div
      className="mt-2 h-6 w-full"
      role="img"
      aria-label={`${label} 7-day trend, ${total} events`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data as SparklinePoint[]}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${fillId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
