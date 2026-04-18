import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

// Hermetic: bypass React Query — return `initialData` verbatim so we
// can assert first-paint markup without a QueryClientProvider in the
// node test env.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ initialData }: { initialData: unknown }) => ({
    data: initialData,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
}));

import { ActivityFeed } from "@/components/dashboard/activity-feed";
import type { ActivityEntry } from "@/lib/activity-feed";

const sample: readonly ActivityEntry[] = [
  {
    id: "1",
    createdAt: new Date("2026-04-17T10:00:00Z"),
    action: "DOCUMENT_UPLOAD",
    userName: "Alice",
    targetType: "document",
    targetId: "doc-1",
  },
  {
    id: "2",
    createdAt: new Date("2026-04-17T09:55:00Z"),
    action: "LINK_DENIED",
    userName: null,
    targetType: "link",
    targetId: "link-1",
  },
  {
    id: "3",
    createdAt: new Date("2026-04-17T09:50:00Z"),
    action: "LOGIN",
    userName: "bob@x.com",
    targetType: "user",
    targetId: "u-2",
  },
];

describe("ActivityFeed", () => {
  it("renders a semantic list landmark", () => {
    const html = renderToString(<ActivityFeed initial={sample} />);
    expect(html).toMatch(/<ul[^>]*role="list"|<ul\b/);
  });

  it("renders one entry per row in initial data", () => {
    const html = renderToString(<ActivityFeed initial={sample} />);
    const liCount = (html.match(/<li\b/g) ?? []).length;
    expect(liCount).toBe(sample.length);
  });

  it("shows the user display name or a fallback when null", () => {
    const html = renderToString(<ActivityFeed initial={sample} />);
    expect(html).toContain("Alice");
    expect(html).toContain("bob@x.com");
    // null userName -> 'System' or 'Unknown' fallback (not a blank)
    expect(html.toLowerCase()).toMatch(/system|unknown/);
  });

  it("renders a badge per action", () => {
    const html = renderToString(<ActivityFeed initial={sample} />);
    expect(html).toContain("DOCUMENT_UPLOAD");
    expect(html).toContain("LINK_DENIED");
    expect(html).toContain("LOGIN");
  });

  it("shows target reference for each entry", () => {
    const html = renderToString(<ActivityFeed initial={sample} />);
    expect(html).toContain("doc-1");
    expect(html).toContain("link-1");
    expect(html).toContain("u-2");
  });

  it("renders an empty-state message when initial is empty", () => {
    const html = renderToString(<ActivityFeed initial={[]} />);
    expect(html.toLowerCase()).toMatch(/no.*activity|empty|nothing/);
  });
});
