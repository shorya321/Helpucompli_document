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
import { SummaryCardSparkline } from "./summary-card-sparkline";
import type { ActivityCategory } from "@/lib/activity-categories";

interface SparklinePoint {
  readonly date: string;
  readonly value: number;
}

export interface SummaryCardSparklines {
  readonly document?: readonly SparklinePoint[];
  readonly link?: readonly SparklinePoint[];
  readonly user?: readonly SparklinePoint[];
}

interface SummaryCardsProps {
  readonly stats: DashboardStats;
  readonly sparklines?: SummaryCardSparklines;
}

interface SummaryCard {
  readonly label: string;
  readonly value: number;
  readonly icon: LucideIcon;
  readonly sub?: string;
  readonly sparkline?: {
    readonly data: readonly SparklinePoint[];
    readonly category: ActivityCategory;
  };
}

export function SummaryCards({ stats, sparklines }: SummaryCardsProps) {
  const docSpark = sparklines?.document;
  const linkSpark = sparklines?.link;
  const userSpark = sparklines?.user;
  const cards: readonly SummaryCard[] = [
    { label: "Documents", value: stats.totalDocuments, icon: FileText },
    { label: "Buckets", value: stats.totalBuckets, icon: Database },
    {
      label: "Uploads",
      value: stats.recentUploads,
      icon: Upload,
      sub: `Last ${RECENT_WINDOW_DAYS} days`,
      sparkline: docSpark
        ? { data: docSpark, category: "document" }
        : undefined,
    },
    {
      label: "Links",
      value: stats.recentLinks,
      icon: Link2,
      sub: `Last ${RECENT_WINDOW_DAYS} days`,
      sparkline: linkSpark
        ? { data: linkSpark, category: "link" }
        : undefined,
    },
    {
      label: "Active users",
      value: stats.activeUsers,
      icon: Users,
      sparkline: userSpark
        ? { data: userSpark, category: "user" }
        : undefined,
    },
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
                {card.sparkline ? (
                  <SummaryCardSparkline
                    data={card.sparkline.data}
                    category={card.sparkline.category}
                    label={card.label}
                  />
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
