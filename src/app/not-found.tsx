import Link from "next/link";

// F12.5 — app-level 404 page. Rendered by Next.js when a route is not
// matched or when `notFound()` is called. Keep content minimal —
// HIPAA: no user-controlled input echoed, no stack trace.
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "Inter, system-ui, sans-serif",
        backgroundColor: "#f8fafc",
      }}
    >
      <div
        style={{
          maxWidth: "440px",
          textAlign: "center",
          padding: "48px 32px",
          background: "#ffffff",
          borderRadius: "12px",
          boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
        }}
      >
        <h1
          style={{
            fontSize: "48px",
            fontWeight: 600,
            margin: "0 0 8px",
            color: "#1e293b",
          }}
        >
          404
        </h1>
        <p
          style={{
            fontSize: "18px",
            margin: "0 0 24px",
            color: "#475569",
          }}
        >
          Page not found.
        </p>
        <Link
          href="/dashboard"
          style={{
            display: "inline-block",
            padding: "10px 20px",
            background: "#2563EB",
            color: "#ffffff",
            textDecoration: "none",
            borderRadius: "8px",
            fontWeight: 500,
          }}
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
