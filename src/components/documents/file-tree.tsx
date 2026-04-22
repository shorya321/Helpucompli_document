import Link from "next/link";
import { Database } from "lucide-react";

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
      className="border-border bg-card text-foreground rounded-xl border p-2 shadow-xs"
    >
      <h2 className="text-muted-foreground m-0 mb-1.5 px-2.5 pt-2 text-[11px] font-semibold uppercase tracking-wider">
        Buckets
      </h2>

      {visible.length === 0 ? (
        <p className="text-muted-foreground m-0 px-2.5 py-2 text-sm">
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
                      ? "bg-accent text-accent-foreground relative flex items-center gap-2 break-all rounded-md px-2.5 py-2 text-sm font-medium no-underline before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary"
                      : "text-foreground/80 hover:bg-accent/60 hover:text-foreground flex items-center gap-2 break-all rounded-md px-2.5 py-2 text-sm font-normal no-underline transition-colors duration-150"
                  }
                >
                  <Database
                    aria-hidden="true"
                    className={
                      isActive
                        ? "text-foreground size-3.5 shrink-0"
                        : "text-muted-foreground size-3.5 shrink-0"
                    }
                  />
                  <span className="truncate">{b.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
