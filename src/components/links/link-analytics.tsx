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
    <section className="mb-6 flex flex-col gap-4">
      <ul
        role="list"
        className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3 p-0"
      >
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <li key={c.label}>
              <Card className="h-full gap-2 py-5">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {c.label}
                  </CardTitle>
                  <Icon
                    aria-hidden="true"
                    className="text-muted-foreground h-4 w-4"
                  />
                </CardHeader>
                <CardContent>
                  <div className="text-foreground text-2xl font-bold tabular-nums">
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
            <h3 className="text-muted-foreground m-0 text-xs font-semibold uppercase tracking-wider">
              Most-shared documents
            </h3>
          </CardHeader>
          <CardContent>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {stats.topDocuments.map((d) => (
                <li
                  key={d.documentId}
                  className="flex justify-between text-sm"
                >
                  <span className="text-foreground">
                    {d.filename}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
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
