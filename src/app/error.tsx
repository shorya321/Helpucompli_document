"use client";

import { useEffect } from "react";

// F12.5 — route-segment error boundary. Next.js renders this when an
// error is thrown during render in any page or layout below the root.
// HIPAA: never surface the raw error message to the user (may include
// DB credentials via Prisma error text). Log via console so the
// client-side Sentry layer (wired in F12.5 carry) picks it up, then
// render a safe, friendly body.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[route-error]", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <main
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "480px",
          textAlign: "center",
          padding: "32px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
        }}
      >
        <h2
          style={{
            fontSize: "20px",
            fontWeight: 600,
            color: "#1e293b",
            margin: "0 0 12px",
          }}
        >
          Something went wrong.
        </h2>
        <p style={{ color: "#475569", margin: "0 0 24px" }}>
          An unexpected error occurred. Our team has been notified.
          {error.digest ? ` Reference: ${error.digest}` : ""}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "10px 20px",
            background: "#2563EB",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
