import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

// Hermetic — bypass React Query and recharts. We assert the
// surrounding structure (figure + figcaption + sr-only table) which is
// what carries the accessibility contract.
const queryMock = vi.hoisted(() => ({
  state: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ initialData }: { initialData: unknown }) => ({
    data: queryMock.state.data ?? initialData,
    isLoading: queryMock.state.isLoading,
    isError: queryMock.state.isError,
  }),
}));

// recharts depends on layout APIs not present in node — stub primitives
// to inert <div>s. The chart still renders its outer figure shell
// (which carries the a11y caption + table) so we can assert that.
vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ResponsiveContainer: Pass,
    AreaChart: Pass,
    Area: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

import { ActivityTrendChart } from "@/components/dashboard/activity-trend-chart";
import type { ActivityTrend } from "@/lib/activity-trend";

const sample: ActivityTrend = {
  days: 14,
  points: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-04-${String(9 + i).padStart(2, "0")}`,
    auth: i,
    document: i + 1,
    policy: 0,
    link: 1,
    user: 0,
  })),
};

afterEach(() => {
  queryMock.state.data = undefined;
  queryMock.state.isLoading = false;
  queryMock.state.isError = false;
});

describe("ActivityTrendChart", () => {
  it("renders a figure with figcaption a11y summary", () => {
    const html = renderToString(<ActivityTrendChart initial={sample} />);
    expect(html).toMatch(/<figure\b/);
    expect(html).toMatch(/<figcaption[^>]*class="sr-only"/);
    // React injects HTML comments between adjacent text/expression nodes
    expect(html).toMatch(/last\s*(<!---->)?\s*(<!--\s*-->)?\s*14/i);
  });

  it("includes sr-only data table for screen readers", () => {
    const html = renderToString(<ActivityTrendChart initial={sample} />);
    expect(html).toMatch(/<table[^>]*class="sr-only"/);
    expect(html).toContain("Events per day by category");
    // 14 day rows + 1 header
    const rowCount = (html.match(/<tr\b/g) ?? []).length;
    expect(rowCount).toBe(15);
  });

  it("renders 'Last N days' subtitle from the prop", () => {
    const html = renderToString(<ActivityTrendChart initial={sample} />);
    // React injects <!-- --> between adjacent text/expression nodes
    expect(html).toMatch(/Last[\s\S]*?14[\s\S]*?days/);
  });

  it("renders skeleton placeholder when no initial and loading", () => {
    queryMock.state.isLoading = true;
    queryMock.state.data = undefined;
    const html = renderToString(<ActivityTrendChart initial={null} />);
    expect(html).toContain("Loading activity trend");
  });

  it("renders an error alert when no initial and isError", () => {
    queryMock.state.isError = true;
    queryMock.state.data = undefined;
    const html = renderToString(<ActivityTrendChart initial={null} />);
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("Unable to load activity trend");
  });

  it("returns null silently when no initial, not loading, not erroring", () => {
    const html = renderToString(<ActivityTrendChart initial={null} />);
    // Empty render acceptable — no figure, no error, no skeleton.
    expect(html).not.toMatch(/<figure\b/);
  });
});
