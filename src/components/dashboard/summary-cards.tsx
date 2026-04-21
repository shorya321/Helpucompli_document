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
      className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4 p-0"
    >
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <li key={card.label}>
            <Card className="h-full gap-2 py-5">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {card.label}
                </CardTitle>
                <Icon
                  aria-hidden="true"
                  className="text-muted-foreground h-4 w-4"
                />
              </CardHeader>
              <CardContent>
                <div className="text-foreground text-2xl font-bold tabular-nums">
                  {card.value}
                </div>
                {card.sub ? (
                  <p className="text-muted-foreground mt-1 text-xs">
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
