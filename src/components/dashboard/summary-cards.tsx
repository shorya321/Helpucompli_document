import { BRAND } from "@/lib/brand";
import {
  RECENT_WINDOW_DAYS,
  type DashboardStats,
} from "@/lib/dashboard-stats";

interface SummaryCardsProps {
  readonly stats: DashboardStats;
}

interface Card {
  readonly label: string;
  readonly value: number;
  readonly sub?: string;
}

export function SummaryCards({ stats }: SummaryCardsProps) {
  const cards: readonly Card[] = [
    { label: "Documents", value: stats.totalDocuments },
    { label: "Buckets", value: stats.totalBuckets },
    {
      label: "Uploads",
      value: stats.recentUploads,
      sub: `Last ${RECENT_WINDOW_DAYS} days`,
    },
    {
      label: "Links",
      value: stats.recentLinks,
      sub: `Last ${RECENT_WINDOW_DAYS} days`,
    },
    { label: "Active users", value: stats.activeUsers },
  ];

  return (
    <ul
      role="list"
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
        gap: "1rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
      }}
    >
      {cards.map((card) => (
        <li
          key={card.label}
          style={{
            background: "#FFFFFF",
            border: `1px solid ${BRAND.colors.dark}1A`,
            borderRadius: "0.75rem",
            padding: "1.25rem",
            color: BRAND.colors.dark,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: BRAND.colors.blue,
              fontWeight: 600,
            }}
          >
            {card.label}
          </p>
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "1.75rem",
              fontWeight: 700,
            }}
          >
            {card.value}
          </p>
          {card.sub ? (
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.75rem",
                color: "rgba(30,41,59,0.64)",
              }}
            >
              {card.sub}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
