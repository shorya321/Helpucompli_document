import Link from "next/link";
import { BRAND } from "@/lib/brand";
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
  // Approx TB — once beyond TB we divide BigInt → Number which is
  // safe because bytes/TB cannot exceed ~9k in any realistic tenant.
  return `${(Number(bytes / GB) / 1024).toFixed(1)} TB`;
}

interface BucketCardProps {
  readonly bucket: BucketSummary;
}

export function BucketCard({ bucket }: BucketCardProps) {
  const statusLabel = bucket.isActive ? "Active" : "Inactive";
  const statusBg = bucket.isActive
    ? `${BRAND.colors.blue}14`
    : `${BRAND.colors.dark}14`;
  const statusFg = bucket.isActive ? BRAND.colors.blue : BRAND.colors.dark;

  return (
    <Link
      href={`/buckets/${bucket.id}`}
      style={{
        display: "block",
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.75rem",
        padding: "1.25rem",
        color: BRAND.colors.dark,
        textDecoration: "none",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "1rem",
            fontWeight: 600,
            wordBreak: "break-all",
          }}
        >
          {bucket.name}
        </h3>
        <span
          style={{
            background: statusBg,
            color: statusFg,
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "0.25rem 0.5rem",
            borderRadius: "999px",
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {bucket.description ? (
        <p
          style={{
            margin: "0.5rem 0 0",
            fontSize: "0.8125rem",
            color: "rgba(30,41,59,0.72)",
          }}
        >
          {bucket.description}
        </p>
      ) : null}

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "0.75rem",
          margin: "1rem 0 0",
        }}
      >
        <Metric label="Region" value={bucket.region} />
        <Metric label="Documents" value={String(bucket.documentCount)} />
        <Metric label="Storage" value={formatStorage(bucket.storageBytes)} />
      </dl>
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
      <dt
        style={{
          margin: 0,
          fontSize: "0.6875rem",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: BRAND.colors.blue,
          fontWeight: 600,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: "0.125rem 0 0",
          fontSize: "0.875rem",
          fontWeight: 500,
          wordBreak: "break-word",
        }}
      >
        {value}
      </dd>
    </div>
  );
}
