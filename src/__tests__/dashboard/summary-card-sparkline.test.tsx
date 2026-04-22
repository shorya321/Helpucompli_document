import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import type { DashboardStats } from "@/lib/dashboard-stats";

const stats: DashboardStats = {
  totalDocuments: 100,
  totalBuckets: 5,
  recentUploads: 20,
  recentLinks: 10,
  activeUsers: 8,
};

const sparkPoints = Array.from({ length: 7 }, (_, i) => ({
  date: `2026-04-${String(16 + i).padStart(2, "0")}`,
  value: i,
}));

describe("SummaryCards sparkline integration", () => {
  it("renders without sparklines when prop is omitted (back-compat)", () => {
    const html = renderToString(<SummaryCards stats={stats} />);
    expect(html).toContain("100");
    expect(html).toContain(">5<");
    expect(html.includes("role=\"img\"")).toBe(false);
  });

  it("renders sparkline aria-label per category when sparklines provided", () => {
    const html = renderToString(
      <SummaryCards
        stats={stats}
        sparklines={{
          document: sparkPoints,
          link: sparkPoints,
          user: sparkPoints,
        }}
      />,
    );
    expect(html).toContain("Uploads 7-day trend");
    expect(html).toContain("Links 7-day trend");
    expect(html).toContain("Active users 7-day trend");
    // role=img should be present (markup may quote attribute differently)
    expect(/role=("|')img\1/.test(html)).toBe(true);
  });

  it("does not render sparkline for cards without provided data", () => {
    const html = renderToString(
      <SummaryCards stats={stats} sparklines={{ document: sparkPoints }} />,
    );
    expect(html).toContain("Uploads 7-day trend");
    expect(html).not.toContain("Links 7-day trend");
    expect(html).not.toContain("Active users 7-day trend");
  });

  it("aria-label includes the total event count", () => {
    const html = renderToString(
      <SummaryCards stats={stats} sparklines={{ document: sparkPoints }} />,
    );
    // sparkPoints sums 0+1+...+6 = 21
    expect(html).toContain("21 events");
  });
});
