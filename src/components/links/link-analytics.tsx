import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { LinkAnalytics } from "@/lib/link-analytics";

interface LinkAnalyticsProps {
  readonly stats: LinkAnalytics;
}

interface StatCard {
  readonly label: string;
  readonly value: number;
}

export function LinkAnalyticsView({ stats }: LinkAnalyticsProps) {
  const cards: readonly StatCard[] = [
    { label: "Total", value: stats.total },
    { label: "Active", value: stats.active },
    { label: "Expired", value: stats.expired },
    { label: "Revoked", value: stats.revoked },
  ];

  return (
    <section className="mb-6 flex flex-col gap-4">
      <ul
        role="list"
        className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3 p-0"
      >
        {cards.map((c) => (
          <li key={c.label}>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  {c.label}
                </p>
              </CardHeader>
              <CardContent>
                <p className="text-foreground font-mono text-2xl font-bold tabular-nums">
                  {c.value}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
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
                  <span className="text-foreground font-mono">
                    {d.filename}
                  </span>
                  <span className="text-muted-foreground font-mono tabular-nums">
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
