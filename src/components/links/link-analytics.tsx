import { BRAND } from "@/lib/brand";
import type { LinkAnalytics } from "@/lib/link-analytics";

interface LinkAnalyticsProps {
  readonly stats: LinkAnalytics;
}

const STAT_COLORS: Record<string, string> = {
  Total: BRAND.colors.dark,
  Active: "#16A34A",
  Expired: "#D97706",
  Revoked: BRAND.colors.pink,
};

export function LinkAnalyticsView({ stats }: LinkAnalyticsProps) {
  const cards: Array<{ label: string; value: number }> = [
    { label: "Total", value: stats.total },
    { label: "Active", value: stats.active },
    { label: "Expired", value: stats.expired },
    { label: "Revoked", value: stats.revoked },
  ];

  return (
    <section
      style={{
        marginBottom: "1.5rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              padding: "0.75rem 1rem",
              background: "#FFFFFF",
              border: `1px solid ${BRAND.colors.dark}1A`,
              borderRadius: "0.5rem",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: STAT_COLORS[c.label] ?? BRAND.colors.dark,
              }}
            >
              {c.label}
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {stats.topDocuments.length > 0 && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#FFFFFF",
            border: `1px solid ${BRAND.colors.dark}1A`,
            borderRadius: "0.5rem",
          }}
        >
          <h3
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "rgba(30,41,59,0.64)",
              margin: "0 0 0.5rem",
            }}
          >
            Most-shared documents
          </h3>
          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            {stats.topDocuments.map((d) => (
              <li
                key={d.documentId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  {d.filename}
                </span>
                <span
                  style={{
                    color: "rgba(30,41,59,0.64)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {d.linkCount} link{d.linkCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
