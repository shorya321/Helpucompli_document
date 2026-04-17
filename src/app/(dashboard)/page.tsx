import { BRAND } from "@/lib/brand";

export default function DashboardHomePage() {
  return (
    <section
      style={{
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
        Dashboard
      </h1>
      <p style={{ marginTop: "0.5rem", color: "rgba(30,41,59,0.72)" }}>
        Welcome back. Summary metrics, recent activity, and quick actions
        will appear here.
      </p>
    </section>
  );
}
