"use client";

import { useQuery } from "@tanstack/react-query";
import { BRAND } from "@/lib/brand";
import {
  actionBadgeTone,
  type ActivityEntry,
  type BadgeTone,
} from "@/lib/activity-feed";
import type { ApiResponse } from "@/types";

interface ActivityFeedProps {
  readonly initial: readonly ActivityEntry[];
}

const REFETCH_INTERVAL_MS = 30_000;

const TONE_COLORS: Record<BadgeTone, { bg: string; fg: string }> = {
  info: { bg: BRAND.colors.blue, fg: BRAND.colors.light },
  success: { bg: "#16A34A", fg: BRAND.colors.light },
  warning: { bg: "#D97706", fg: BRAND.colors.light },
  danger: { bg: BRAND.colors.pink, fg: BRAND.colors.light },
};

async function fetchActivity(): Promise<readonly ActivityEntry[]> {
  const res = await fetch("/api/dashboard/activity", { cache: "no-store" });
  const body = (await res.json()) as ApiResponse<readonly ActivityEntry[]>;
  // Coerce createdAt strings back to Date across the wire.
  const raw = body.data ?? [];
  return raw.map((e) => ({
    ...e,
    createdAt: new Date(e.createdAt as unknown as string),
  }));
}

function formatRelative(when: Date, now: Date = new Date()): string {
  const diffSec = Math.round((when.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

export function ActivityFeed({ initial }: ActivityFeedProps) {
  const { data } = useQuery({
    queryKey: ["dashboard", "activity"],
    queryFn: fetchActivity,
    initialData: initial,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_INTERVAL_MS / 2,
  });
  const entries = (data ?? initial) as readonly ActivityEntry[];

  if (entries.length === 0) {
    return (
      <p
        style={{
          color: "rgba(30,41,59,0.64)",
          fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        }}
      >
        No recent activity to show.
      </p>
    );
  }

  return (
    <ul
      role="list"
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
      }}
    >
      {entries.map((entry) => {
        const tone = TONE_COLORS[actionBadgeTone(entry.action)];
        return (
          <li
            key={entry.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background: "#FFFFFF",
              border: `1px solid ${BRAND.colors.dark}1A`,
              borderRadius: "0.5rem",
              color: BRAND.colors.dark,
            }}
          >
            <span
              style={{
                background: tone.bg,
                color: tone.fg,
                padding: "0.125rem 0.5rem",
                borderRadius: "0.375rem",
                fontSize: "0.7rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {entry.action}
            </span>
            <span style={{ fontWeight: 500 }}>
              {entry.userName ?? "System"}
            </span>
            <span style={{ color: "rgba(30,41,59,0.64)" }}>
              {entry.targetType}:{entry.targetId}
            </span>
            <span
              style={{
                marginLeft: "auto",
                color: "rgba(30,41,59,0.56)",
                fontSize: "0.8rem",
              }}
              title={entry.createdAt.toISOString()}
            >
              {formatRelative(entry.createdAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
