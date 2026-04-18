import Link from "next/link";
import { BRAND } from "@/lib/brand";
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
      style={{
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.75rem",
        padding: "0.75rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <h2
        style={{
          margin: "0 0 0.5rem",
          fontSize: "0.6875rem",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: BRAND.colors.blue,
          fontWeight: 600,
        }}
      >
        Buckets
      </h2>

      {visible.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "rgba(30,41,59,0.72)" }}>
          No buckets available.
        </p>
      ) : (
        <ul
          role="list"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.125rem",
          }}
        >
          {visible.map((b) => {
            const isActive = b.name === activeBucket;
            return (
              <li key={b.id}>
                <Link
                  href={`/documents?bucket=${encodeURIComponent(b.name)}`}
                  aria-current={isActive ? "page" : undefined}
                  style={{
                    display: "block",
                    padding: "0.4375rem 0.625rem",
                    borderRadius: "0.375rem",
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? BRAND.colors.blue : BRAND.colors.dark,
                    background: isActive ? `${BRAND.colors.blue}14` : "transparent",
                    textDecoration: "none",
                    wordBreak: "break-all",
                  }}
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
