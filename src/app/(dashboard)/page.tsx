import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/prisma";
import {
  getDashboardStats,
  type DashboardStatsPrisma,
} from "@/lib/dashboard-stats";
import { SummaryCards } from "@/components/dashboard/summary-cards";

export const dynamic = "force-dynamic";

export default async function DashboardHomePage() {
  const stats = await getDashboardStats(
    prisma as unknown as DashboardStatsPrisma,
  );

  return (
    <section
      style={{
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      <header>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
          Dashboard
        </h1>
        <p style={{ marginTop: "0.25rem", color: "rgba(30,41,59,0.72)" }}>
          Activity summary for the last 7 days.
        </p>
      </header>
      <SummaryCards stats={stats} />
    </section>
  );
}
