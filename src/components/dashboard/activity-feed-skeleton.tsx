import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ROWS = 5;

export function ActivityFeedSkeleton() {
  return (
    <Card
      className="overflow-hidden"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading recent activity"
    >
      <ul
        role="list"
        className="m-0 flex list-none flex-col divide-y divide-border/60 p-0"
      >
        {Array.from({ length: ROWS }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-5 py-3">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="ml-auto h-3 w-16" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
