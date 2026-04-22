import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

const queryMock = vi.hoisted(() => ({
  state: {
    data: undefined as unknown,
    isError: false,
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({
    initialData,
    initialDataUpdatedAt,
  }: {
    initialData: unknown;
    initialDataUpdatedAt?: number;
  }) => ({
    data: queryMock.state.data ?? initialData,
    dataUpdatedAt: initialDataUpdatedAt ?? 0,
    isError: queryMock.state.isError,
  }),
}));

import { ActivityFeed } from "@/components/dashboard/activity-feed";
import type { ActivityEntry } from "@/lib/activity-feed";

const entries: readonly ActivityEntry[] = [
  {
    id: "1",
    createdAt: new Date("2026-04-22T10:00:00Z"),
    action: "DOCUMENT_UPLOAD",
    userName: "Alice",
    targetType: "document",
    targetId: "doc-1",
  },
  {
    id: "2",
    createdAt: new Date("2026-04-22T09:55:00Z"),
    action: "LOGIN",
    userName: "bob",
    targetType: "user",
    targetId: "u-2",
  },
  {
    id: "3",
    createdAt: new Date("2026-04-22T09:50:00Z"),
    action: "POLICY_CREATE",
    userName: "carla",
    targetType: "policy",
    targetId: "p-1",
  },
];

describe("ActivityFeed tab filter", () => {
  it("renders a TabsList with All + 5 categories", () => {
    const html = renderToString(<ActivityFeed initial={entries} />);
    expect(html).toMatch(/role="tablist"/);
    expect(html).toContain("All");
    expect(html).toContain("Auth");
    expect(html).toContain("Documents");
    expect(html).toContain("Policies");
    expect(html).toContain("Links");
    expect(html).toContain("Admin");
  });

  it("'All' tab is active by default", () => {
    const html = renderToString(<ActivityFeed initial={entries} />);
    // Radix Tabs sets data-state=active on active trigger
    expect(html).toMatch(/data-state="active"[^>]*>\s*All/);
  });

  it("renders all entries under default All tab", () => {
    const html = renderToString(<ActivityFeed initial={entries} />);
    expect(html).toContain("doc-1");
    expect(html).toContain("u-2");
    expect(html).toContain("p-1");
  });

  it("paginated initial (ActivityFeedPage shape) renders entries identically", () => {
    const html = renderToString(
      <ActivityFeed initial={{ entries, nextCursor: null }} />,
    );
    expect(html).toContain("doc-1");
    expect(html).toContain("u-2");
    expect(html).toContain("p-1");
  });

  it("does not render Load more button when nextCursor is null", () => {
    const html = renderToString(
      <ActivityFeed initial={{ entries, nextCursor: null }} />,
    );
    expect(html).not.toContain("Load more");
  });

  it("renders Load more button when nextCursor present", () => {
    const html = renderToString(
      <ActivityFeed initial={{ entries, nextCursor: "abc" }} />,
    );
    expect(html).toContain("Load more");
    expect(html).toContain("data-testid=\"activity-feed-load-more\"");
  });
});
