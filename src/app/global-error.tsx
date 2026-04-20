"use client";

import { useEffect } from "react";

// F12.5 — root error boundary. Renders when the root layout itself
// crashes (no other boundary catches it). Must be a minimal
// self-contained tree — layout/providers are NOT available.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[global-error]", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
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
            maxWidth: "480px",
            textAlign: "center",
            padding: "48px 32px",
            background: "#ffffff",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
          }}
        >
          <h1
            style={{
              fontSize: "32px",
              margin: "0 0 8px",
              color: "#1e293b",
            }}
          >
            Application error
          </h1>
          <p style={{ color: "#475569", margin: "0 0 24px" }}>
            The application failed to load. Please refresh the page. If
            the problem persists, contact support.
            {error.digest ? ` Reference: ${error.digest}` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "10px 20px",
              background: "#E91E8C",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
