import { Database, FileText, Link2, Upload, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  RECENT_WINDOW_DAYS,
  type DashboardStats,
} from "@/lib/dashboard-stats";

interface SummaryCardsProps {
  readonly stats: DashboardStats;
}

interface SummaryCard {
  readonly label: string;
  readonly value: number;
  readonly icon: LucideIcon;
  readonly sub?: string;
}

export function SummaryCards({ stats }: SummaryCardsProps) {
  const cards: readonly SummaryCard[] = [
    { label: "Documents", value: stats.totalDocuments, icon: FileText },
    { label: "Buckets", value: stats.totalBuckets, icon: Database },
    {
      label: "Uploads",
      value: stats.recentUploads,
      icon: Upload,
      sub: `Last ${RECENT_WINDOW_DAYS} days`,
    },
    {
      label: "Links",
      value: stats.recentLinks,
      icon: Link2,
      sub: `Last ${RECENT_WINDOW_DAYS} days`,
    },
    { label: "Active users", value: stats.activeUsers, icon: Users },
  ];

  return (
    <ul
      role="list"
      className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4 p-0 md:gap-5"
    >
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <li key={card.label}>
            <Card className="group h-full gap-3 py-5 hover:shadow-md">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-0">
                <CardTitle className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                  {card.label}
                </CardTitle>
                <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
              </CardHeader>
              <CardContent>
                <div className="text-foreground font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {card.value}
                </div>
                {card.sub ? (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    {card.sub}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
