import { CheckCircle2, Link2, ShieldX, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { LinkAnalytics } from "@/lib/link-analytics";

interface LinkAnalyticsProps {
  readonly stats: LinkAnalytics;
}

interface StatCard {
  readonly label: string;
  readonly value: number;
  readonly icon: LucideIcon;
}

export function LinkAnalyticsView({ stats }: LinkAnalyticsProps) {
  const cards: readonly StatCard[] = [
    { label: "Total", value: stats.total, icon: Link2 },
    { label: "Active", value: stats.active, icon: CheckCircle2 },
    { label: "Expired", value: stats.expired, icon: XCircle },
    { label: "Revoked", value: stats.revoked, icon: ShieldX },
  ];

  return (
    <section className="flex flex-col gap-5">
      <ul
        role="list"
        className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4 p-0 md:gap-5"
      >
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <li key={c.label}>
              <Card className="group h-full gap-3 py-5 hover:shadow-md">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-0">
                  <CardTitle className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                    {c.label}
                  </CardTitle>
                  <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                </CardHeader>
                <CardContent>
                  <div className="text-foreground font-mono text-3xl font-semibold tracking-tight tabular-nums">
                    {c.value}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {stats.topDocuments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-muted-foreground m-0 text-[11px] font-semibold uppercase tracking-wider">
              Most-shared documents
            </h3>
          </CardHeader>
          <CardContent>
            <ol className="m-0 flex list-none flex-col divide-y divide-border/60 p-0">
              {stats.topDocuments.map((d) => (
                <li
                  key={d.documentId}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="text-foreground truncate">{d.filename}</span>
                  <span className="text-muted-foreground whitespace-nowrap font-mono text-xs tabular-nums">
                    {d.linkCount} link{d.linkCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
