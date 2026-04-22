import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { asStatsPrisma, getDashboardStats } from "@/lib/dashboard-stats";
import type { DashboardStats } from "@/lib/dashboard-stats";
import {
  asActivityPrisma,
  getRecentActivity,
  type ActivityEntry,
} from "@/lib/activity-feed";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { QuickActions } from "@/components/dashboard/quick-actions";

export const dynamic = "force-dynamic";

export default async function DashboardHomePage() {
  const session = await auth0.getSession();
  const role = await resolveRole(session ?? null);
  const canSeeAggregate = await resolveHasRole(session ?? null, [
    "superadmin",
    "admin",
  ]);

  let stats: DashboardStats | null = null;
  let activity: readonly ActivityEntry[] = [];
  let loadError = false;
  if (canSeeAggregate) {
    try {
      [stats, activity] = await Promise.all([
        getDashboardStats(asStatsPrisma(prisma)),
        getRecentActivity(asActivityPrisma(prisma)),
      ]);
    } catch {
      // Engine-level errors can embed DATABASE_URL. Do NOT surface.
      loadError = true;
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-foreground m-0 text-3xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm">
          {canSeeAggregate
            ? "Activity summary for the last 7 days."
            : "Welcome back. Use the sidebar to browse the documents and links you can access."}
        </p>
      </header>
      {role ? <QuickActions role={role} /> : null}
      {canSeeAggregate && stats ? <SummaryCards stats={stats} /> : null}
      {canSeeAggregate && loadError ? (
        <p role="alert" className="text-destructive text-sm">
          Unable to load dashboard metrics. Please try again.
        </p>
      ) : null}
      {canSeeAggregate && !loadError ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-foreground text-base font-semibold tracking-tight">
            Recent activity
          </h2>
          <ActivityFeed initial={activity} />
        </section>
      ) : null}
    </section>
  );
}
