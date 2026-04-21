"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

const TONE_VARIANT: Record<
  BadgeTone,
  { variant: "default" | "secondary" | "destructive" | "outline"; Icon: LucideIcon }
> = {
  info: { variant: "secondary", Icon: Info },
  success: { variant: "default", Icon: CheckCircle2 },
  warning: { variant: "outline", Icon: AlertTriangle },
  danger: { variant: "destructive", Icon: ShieldAlert },
};

class ActivityFetchError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ActivityFetchError";
  }
}

async function fetchActivity(): Promise<readonly ActivityEntry[]> {
  const res = await fetch("/api/dashboard/activity", { cache: "no-store" });
  if (!res.ok) {
    throw new ActivityFetchError(res.status, `HTTP ${res.status}`);
  }
  const body = (await res.json()) as ApiResponse<readonly ActivityEntry[]>;
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
  const [initialUpdatedAt] = useState(() => Date.now());
  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey: ["dashboard", "activity"],
    queryFn: fetchActivity,
    initialData: initial,
    initialDataUpdatedAt: initialUpdatedAt,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_INTERVAL_MS / 2,
    retry: (failureCount, error) => {
      if (error instanceof ActivityFetchError && error.status < 500) {
        return false;
      }
      return failureCount < 2;
    },
  });
  const entries = (data ?? initial) as readonly ActivityEntry[];
  const now = useMemo(
    () => new Date(dataUpdatedAt || initialUpdatedAt),
    [dataUpdatedAt, initialUpdatedAt],
  );

  if (isError && entries.length === 0) {
    return (
      <p role="alert" className="text-destructive">
        Unable to refresh activity. Your session may have expired.
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground">No recent activity to show.</p>
    );
  }

  return (
    <ul
      role="list"
      className="m-0 flex list-none flex-col gap-2 p-0"
    >
      {entries.map((entry) => {
        const { variant, Icon } = TONE_VARIANT[actionBadgeTone(entry.action)];
        return (
          <li key={entry.id}>
            <Card>
              <CardContent className="flex items-center gap-3 px-4 py-3">
                <Badge
                  variant={variant}
                  className="gap-1 whitespace-nowrap font-mono text-[0.65rem] uppercase tracking-wide"
                >
                  <Icon aria-hidden="true" className="h-3 w-3" />
                  {entry.action}
                </Badge>
                <span className="text-foreground font-medium">
                  {entry.userName ?? "System"}
                </span>
                <span className="text-muted-foreground font-mono text-sm">
                  {entry.targetType}:{entry.targetId}
                </span>
                <span
                  className="text-muted-foreground ml-auto text-sm tabular-nums"
                  title={entry.createdAt.toISOString()}
                >
                  {formatRelative(entry.createdAt, now)}
                </span>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
