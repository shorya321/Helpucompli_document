import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ActivityTrendSkeleton() {
  return (
    <Card
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading activity trend"
    >
      <CardHeader>
        <CardTitle className="text-foreground text-base font-semibold">
          Activity trend
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-48 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}
