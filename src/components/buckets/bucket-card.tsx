import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BucketSummary } from "@/lib/bucket-list";

const KB = BigInt(1024);
const MB = KB * BigInt(1024);
const GB = MB * BigInt(1024);
const TB = GB * BigInt(1024);

// Human-readable storage formatter. Operates on BigInt to keep values
// correct past 2^53 bytes (9 PB), then down-scales to Number only
// for the display division once the bucket magnitude is picked.
export function formatStorage(bytes: bigint): string {
  if (bytes < BigInt(1024)) return `${bytes.toString()} B`;
  if (bytes < MB) return `${(Number(bytes) / Number(KB)).toFixed(1)} KB`;
  if (bytes < GB) return `${(Number(bytes) / Number(MB)).toFixed(1)} MB`;
  if (bytes < TB) return `${(Number(bytes) / Number(GB)).toFixed(1)} GB`;
  return `${(Number(bytes / GB) / 1024).toFixed(1)} TB`;
}

interface BucketCardProps {
  readonly bucket: BucketSummary;
}

export function BucketCard({ bucket }: BucketCardProps) {
  return (
    <Link
      href={`/buckets/${bucket.id}`}
      className="block no-underline"
    >
      <Card className="hover:bg-accent/30 h-full transition-colors">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="break-all text-base font-semibold">
            {bucket.name}
          </CardTitle>
          <Badge
            variant={bucket.isActive ? "secondary" : "outline"}
            className="shrink-0 font-mono text-[0.6rem] uppercase tracking-wide"
          >
            {bucket.isActive ? "Active" : "Inactive"}
          </Badge>
        </CardHeader>
        <CardContent>
          {bucket.description ? (
            <p className="text-muted-foreground mb-4 text-sm">
              {bucket.description}
            </p>
          ) : null}
          <dl className="grid grid-cols-3 gap-3">
            <Metric label="Region" value={bucket.region} />
            <Metric label="Documents" value={String(bucket.documentCount)} />
            <Metric label="Storage" value={formatStorage(bucket.storageBytes)} />
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}

interface MetricProps {
  readonly label: string;
  readonly value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div>
      <dt className="text-muted-foreground m-0 text-[0.65rem] font-semibold uppercase tracking-wider">
        {label}
      </dt>
      <dd className="text-foreground mt-0.5 break-words font-mono text-sm font-medium tabular-nums">
        {value}
      </dd>
    </div>
  );
}
