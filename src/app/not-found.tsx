import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// F12.5 — app-level 404 page. Rendered by Next.js when a route is not
// matched or when `notFound()` is called. Keep content minimal —
// HIPAA: no user-controlled input echoed, no stack trace.
export default function NotFound() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <h1 className="text-foreground text-5xl font-semibold tabular-nums">
            404
          </h1>
          <p className="text-muted-foreground m-0 text-base">
            Page not found.
          </p>
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
