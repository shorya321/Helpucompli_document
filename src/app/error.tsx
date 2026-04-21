"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
    <main className="bg-background flex min-h-[60vh] items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <h2 className="text-foreground m-0 text-xl font-semibold">
            Something went wrong.
          </h2>
          <p className="text-muted-foreground m-0">
            An unexpected error occurred. Our team has been notified.
            {error.digest ? (
              <>
                {" "}
                Reference:{" "}
                <span className="tabular-nums">{error.digest}</span>
              </>
            ) : null}
          </p>
          <Button type="button" onClick={reset} className="mt-2">
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
