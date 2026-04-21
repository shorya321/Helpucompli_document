import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  readonly sub?: string;
}

export function SummaryCards({ stats }: SummaryCardsProps) {
  const cards: readonly SummaryCard[] = [
    { label: "Documents", value: stats.totalDocuments },
    { label: "Buckets", value: stats.totalBuckets },
    {
      label: "Uploads",
      value: stats.recentUploads,
      sub: `Last ${RECENT_WINDOW_DAYS} days`,
    },
    {
      label: "Links",
      value: stats.recentLinks,
      sub: `Last ${RECENT_WINDOW_DAYS} days`,
    },
    { label: "Active users", value: stats.activeUsers },
  ];

  return (
    <ul
      role="list"
      className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4 p-0"
    >
      {cards.map((card) => (
        <li key={card.label}>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                {card.label}
              </p>
            </CardHeader>
            <CardContent>
              <p className="text-foreground font-mono text-3xl font-bold tabular-nums">
                {card.value}
              </p>
              {card.sub ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {card.sub}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
