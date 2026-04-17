import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import type { DashboardStats } from "@/lib/dashboard-stats";

const stats: DashboardStats = {
  totalDocuments: 128,
  totalBuckets: 4,
  recentUploads: 11,
  recentLinks: 6,
  activeUsers: 9,
};

describe("SummaryCards", () => {
  it("renders all five metric values", () => {
    const html = renderToString(<SummaryCards stats={stats} />);
    expect(html).toContain("128");
    expect(html).toContain(">4<");
    expect(html).toContain("11");
    expect(html).toContain(">6<");
    expect(html).toContain(">9<");
  });

  it("renders labels for every metric", () => {
    const html = renderToString(<SummaryCards stats={stats} />);
    expect(html.toLowerCase()).toContain("documents");
    expect(html.toLowerCase()).toContain("buckets");
    expect(html.toLowerCase()).toContain("uploads");
    expect(html.toLowerCase()).toContain("links");
    expect(html.toLowerCase()).toContain("users");
  });

  it("labels the recent-window cards with the 7-day window", () => {
    const html = renderToString(<SummaryCards stats={stats} />);
    expect(html).toMatch(/7[\s-]*day/i);
  });

  it("uses a semantic list for the card group", () => {
    const html = renderToString(<SummaryCards stats={stats} />);
    expect(html).toMatch(/<ul\b|<ol\b|role="list"/);
  });
});
