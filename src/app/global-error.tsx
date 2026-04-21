"use client";

import { useEffect } from "react";
import "./globals.css";

// F12.5 — root error boundary. Renders when the root layout itself
// crashes (no other boundary catches it). Must be a minimal
// self-contained tree — layout/providers are NOT available, so we
// import globals.css directly and use the same semantic tokens as
// the rest of the app (theme-aware via :root + .dark tokens).
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
      <body className="bg-background text-foreground antialiased m-0 flex min-h-screen items-center justify-center p-6 font-sans">
        <div className="border-border bg-card max-w-md w-full rounded-xl border p-10 text-center shadow-sm">
          <h1 className="text-foreground mb-2 text-3xl font-semibold tracking-tight">
            Application error
          </h1>
          <p className="text-muted-foreground mb-6">
            The application failed to load. Please refresh the page. If the
            problem persists, contact support.
            {error.digest ? (
              <>
                {" "}
                Reference:{" "}
                <span className="font-mono tabular-nums">{error.digest}</span>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={reset}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-5 text-sm font-medium transition-colors"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
