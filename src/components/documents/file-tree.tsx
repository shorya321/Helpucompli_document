import Link from "next/link";
import type { BucketSummary } from "@/lib/bucket-list";

interface FileTreeProps {
  readonly buckets: ReadonlyArray<BucketSummary>;
  readonly activeBucket: string | undefined;
}

// Left-panel bucket list. Only active buckets are shown so the browser
// never presents an archived bucket as a valid navigation target; the
// bucket-manager module is the right place to surface inactive ones.
export function FileTree({ buckets, activeBucket }: FileTreeProps) {
  const visible = buckets.filter((b) => b.isActive);

  return (
    <nav
      aria-label="Buckets"
      className="border-border bg-card text-foreground rounded-xl border p-3"
    >
      <h2 className="text-muted-foreground m-0 mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider">
        Buckets
      </h2>

      {visible.length === 0 ? (
        <p className="text-muted-foreground m-0 text-sm">
          No buckets available.
        </p>
      ) : (
        <ul role="list" className="m-0 flex list-none flex-col gap-0.5 p-0">
          {visible.map((b) => {
            const isActive = b.name === activeBucket;
            return (
              <li key={b.id}>
                <Link
                  href={`/documents?bucket=${encodeURIComponent(b.name)}`}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? "bg-accent text-accent-foreground block break-all rounded-md px-2.5 py-1.5 text-sm font-semibold no-underline"
                      : "text-foreground hover:bg-accent/50 block break-all rounded-md px-2.5 py-1.5 text-sm font-medium no-underline transition-colors"
                  }
                >
                  {b.name}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
