"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ACTIVITY_FEED_LIMIT,
  actionBadgeTone,
  type ActivityEntry,
  type ActivityFeedPage,
  type BadgeTone,
} from "@/lib/activity-feed";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_LABELS,
  categoryForAction,
  type ActivityCategory,
} from "@/lib/activity-categories";
import { formatRelative } from "@/lib/format-time";
import type { ApiResponse } from "@/types";

type InitialActivity = readonly ActivityEntry[] | ActivityFeedPage;

interface ActivityFeedProps {
  readonly initial: InitialActivity;
  readonly initialNextCursor?: string | null;
}

const REFETCH_INTERVAL_MS = 30_000;
const LOAD_MORE_LIMIT = 20;
const MAX_DISPLAYED = 100;

const TONE_VARIANT: Record<
  BadgeTone,
  {
    variant: "default" | "secondary" | "destructive" | "outline";
    Icon: LucideIcon;
  }
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

function isPage(initial: InitialActivity): initial is ActivityFeedPage {
  return (
    typeof initial === "object" &&
    initial !== null &&
    !Array.isArray(initial) &&
    "entries" in initial
  );
}

function normaliseInitial(initial: InitialActivity): {
  entries: readonly ActivityEntry[];
  nextCursor: string | null;
} {
  if (isPage(initial)) {
    return { entries: initial.entries, nextCursor: initial.nextCursor };
  }
  return { entries: initial, nextCursor: null };
}

async function fetchFirstPage(): Promise<readonly ActivityEntry[]> {
  // Cursor-less call returns the legacy array shape — preserves the
  // F4.3 contract used by other clients and keeps polling lightweight.
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

async function fetchNextPage(
  cursor: string,
  limit: number,
): Promise<ActivityFeedPage> {
  const res = await fetch(
    `/api/dashboard/activity?cursor=${encodeURIComponent(cursor)}&limit=${limit}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    // Capture the server's error string (already redacted) so the
    // dev console + caller can see why the request failed.
    let serverError: string | undefined;
    try {
      const errBody = (await res.json()) as ApiResponse<unknown>;
      serverError = errBody.error ?? undefined;
    } catch {
      // body wasn't JSON
    }
    throw new ActivityFetchError(
      res.status,
      `HTTP ${res.status}${serverError ? `: ${serverError}` : ""}`,
    );
  }
  const body = (await res.json()) as ApiResponse<ActivityFeedPage>;
  const page = body.data;
  if (!page) {
    throw new ActivityFetchError(500, body.error ?? "Empty payload");
  }
  return {
    entries: page.entries.map((e) => ({
      ...e,
      createdAt: new Date(e.createdAt as unknown as string),
    })),
    nextCursor: page.nextCursor,
  };
}

type FilterTab = "all" | ActivityCategory;
const FILTER_TABS: readonly FilterTab[] = ["all", ...ACTIVITY_CATEGORIES];
const FILTER_LABELS: Record<FilterTab, string> = {
  all: "All",
  ...CATEGORY_LABELS,
};

export function ActivityFeed({
  initial,
  initialNextCursor,
}: ActivityFeedProps) {
  const baseline = useMemo(() => normaliseInitial(initial), [initial]);
  const [initialUpdatedAt] = useState(() => Date.now());
  const [appended, setAppended] = useState<readonly ActivityEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialNextCursor ?? baseline.nextCursor,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");

  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey: ["dashboard", "activity"],
    queryFn: fetchFirstPage,
    initialData: baseline.entries,
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

  const firstPage = (data ?? baseline.entries) as readonly ActivityEntry[];

  // Concatenate, then dedupe by id — first-page poll can overlap with
  // appended pages if writes raced; id wins to keep keys stable.
  const allEntries = useMemo(() => {
    const seen = new Set<string>();
    const merged: ActivityEntry[] = [];
    for (const e of [...firstPage, ...appended]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      merged.push(e);
    }
    return merged;
  }, [firstPage, appended]);

  const filtered = useMemo(() => {
    if (filter === "all") return allEntries;
    return allEntries.filter((e) => categoryForAction(e.action) === filter);
  }, [allEntries, filter]);

  const now = useMemo(
    () => new Date(dataUpdatedAt || initialUpdatedAt),
    [dataUpdatedAt, initialUpdatedAt],
  );

  // Load more only operates on the unfiltered feed — clicking it on a
  // category tab fetches the next 20 raw entries which may not contain
  // that category, leaving the user clicking forever. Pin the control
  // to the All tab and surface a hint elsewhere.
  const canLoadMore =
    filter === "all" &&
    nextCursor !== null &&
    allEntries.length < MAX_DISPLAYED &&
    !loadingMore;

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    setExhausted(false);
    try {
      const page = await fetchNextPage(nextCursor, LOAD_MORE_LIMIT);
      setAppended((prev) => [...prev, ...page.entries]);
      setNextCursor(page.nextCursor);
      // Surface a non-error confirmation when the feed has no more rows
      // to fetch — without it the button just disappears and the click
      // appears to have done nothing.
      if (page.entries.length === 0 || page.nextCursor === null) {
        setExhausted(true);
      }
    } catch (e) {
      // Surface the HTTP status code in the visible error so the user
      // can report it ("Unable to load more activity (500)") and the
      // dev console keeps the full reason for debugging.
      let suffix = "";
      if (e instanceof ActivityFetchError) {
        suffix = ` (HTTP ${e.status})`;
        if (process.env.NODE_ENV !== "production") {
          console.error("[activity-feed] load-more failed:", e.message);
        }
      } else if (e instanceof Error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[activity-feed] load-more failed:", e);
        }
      }
      setLoadMoreError(`Unable to load more activity.${suffix}`);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  if (isError && allEntries.length === 0) {
    return (
      <p role="alert" className="text-destructive">
        Unable to refresh activity. Your session may have expired.
      </p>
    );
  }

  if (allEntries.length === 0) {
    return <p className="text-muted-foreground">No recent activity to show.</p>;
  }

  return (
    <Tabs
      value={filter}
      onValueChange={(v) => {
        setFilter(v as FilterTab);
        // Clear prior Load-more state when switching tabs so error /
        // exhausted hints don't follow the user across category views.
        setLoadMoreError(null);
        setExhausted(false);
      }}
      className="gap-3"
    >
      <TabsList className="self-start">
        {FILTER_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {FILTER_LABELS[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={filter} className="m-0">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No {FILTER_LABELS[filter].toLowerCase()} activity in view.
          </p>
        ) : (
          <Card className="overflow-hidden">
            <ul
              role="list"
              className="m-0 flex list-none flex-col divide-y divide-border/60 p-0"
            >
              {filtered.map((entry) => {
                const { variant, Icon } =
                  TONE_VARIANT[actionBadgeTone(entry.action)];
                return (
                  <li
                    key={entry.id}
                    className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
                  >
                    <Badge
                      variant={variant}
                      className="gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide"
                    >
                      <Icon aria-hidden="true" className="size-3" />
                      {entry.action}
                    </Badge>
                    <span className="text-foreground truncate text-sm font-medium">
                      {entry.userName ?? "System"}
                    </span>
                    <span className="text-muted-foreground truncate font-mono text-xs">
                      {entry.targetType}:{entry.targetId}
                    </span>
                    <span
                      className="text-muted-foreground ml-auto whitespace-nowrap font-mono text-xs tabular-nums"
                      title={entry.createdAt.toISOString()}
                    >
                      {formatRelative(entry.createdAt, now)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        {filter === "all" && loadMoreError ? (
          <p role="alert" className="text-destructive mt-3 text-sm">
            {loadMoreError}
          </p>
        ) : null}
        {canLoadMore ? (
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              data-testid="activity-feed-load-more"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
        {filter !== "all" && nextCursor !== null ? (
          <p className="text-muted-foreground mt-3 text-center text-xs">
            Switch to <span className="font-medium">All</span> to load older
            activity.
          </p>
        ) : null}
        {filter === "all" && exhausted && !loadingMore && !loadMoreError ? (
          <p className="text-muted-foreground mt-3 text-center text-xs">
            No more activity to load.
          </p>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}

// Re-export for legacy import paths used in tests.
export { ACTIVITY_FEED_LIMIT };
