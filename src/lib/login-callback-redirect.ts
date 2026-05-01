import { NextResponse } from "next/server";

// Pure helper invoked by Auth0Client.onCallback. Extracted from
// `src/lib/auth0.ts` so it can be unit-tested without re-evaluating
// the Auth0Client singleton (Auth0Client constructor reads env at
// import-time and would re-initialise per test).

export interface LoginCallbackContext {
  readonly returnTo?: string;
  readonly appBaseUrl?: string;
}

// Same-origin guard: only relative paths starting with a single "/"
// pass through. Absolute URLs (https://...) and protocol-relative
// (//evil.com) are stripped to "/".
function safeRelativePath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function buildLoginCallbackResponse(
  error: Error | null,
  ctx: LoginCallbackContext,
): NextResponse {
  const base = ctx.appBaseUrl ?? process.env.APP_BASE_URL ?? "";

  if (error) {
    return NextResponse.redirect(new URL("/access-denied", base));
  }

  const to = safeRelativePath(ctx.returnTo);
  const auditUrl = new URL("/api/auth/audit-login", base);
  auditUrl.searchParams.set("to", to);
  return NextResponse.redirect(auditUrl);
}
