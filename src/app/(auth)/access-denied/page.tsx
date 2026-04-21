import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Access Denied — ${BRAND.name}`,
  description:
    "You do not have permission to view this page. Contact an administrator.",
  robots: { index: false, follow: false },
};

// Prevent CDN/edge caching of the 403 body — it contains the admin
// contact email, and a cached response would leak that contact into
// any downstream caller regardless of session state.
export const dynamic = "force-dynamic";

export default function AccessDeniedPage() {
  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center p-6">
      <Card
        role="alert"
        aria-labelledby="access-denied-heading"
        className="w-full max-w-xl"
      >
        <CardContent className="flex flex-col gap-3 p-8 text-center">
          <p className="text-muted-foreground m-0 text-xs font-semibold uppercase tracking-widest">
            {BRAND.name}
          </p>
          <h1
            id="access-denied-heading"
            className="text-foreground m-0 text-2xl font-bold tracking-tight"
          >
            Access Denied
          </h1>
          <p className="text-muted-foreground m-0">
            You do not have permission to view this resource. Please contact
            an administrator to request access.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {/*
              Plain anchor — Auth0 v4 requires a full document navigation
              to /auth/login so the proxy can execute the OAuth flow.
              next/link would attempt client-side routing and bypass it.
              Ref: https://github.com/auth0/nextjs-auth0/blob/main/README.md#on-next-js-16
            */}
            <Button asChild>
              <a href="/auth/login">Return to sign-in</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`mailto:admin@${BRAND.domain}?subject=Access%20request`}>
                Contact administrator
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
