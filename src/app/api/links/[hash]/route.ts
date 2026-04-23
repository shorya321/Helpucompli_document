import { NextRequest, NextResponse } from "next/server";
import { resolveAndAuthorizeLink } from "@/lib/link-access";

export const dynamic = "force-dynamic";

// Public endpoint — bearer token in URL is the only credential. All
// authorization, rate-limit, audit, counter, and presign logic lives in
// `src/lib/link-access.ts` and is shared with the new embeddable viewer
// at /l/<token>. This route stays a 302 redirect for backward
// compatibility with already-distributed links + programmatic clients
// that expect a direct binary stream.

interface RouteCtx {
  readonly params: Promise<{ hash: string }>;
}

function forbidden() {
  // Generic 403 — never leak whether the token existed, was revoked,
  // expired, exhausted, or rejected by policy. Sec invariant.
  return new NextResponse("Forbidden", {
    status: 403,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function tooManyRequests(retryAfterSec: number) {
  return new NextResponse("Too Many Requests", {
    status: 429,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(retryAfterSec),
    },
  });
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { hash } = await ctx.params;
  const result = await resolveAndAuthorizeLink(req, hash);

  if (result.kind === "forbidden") return forbidden();
  if (result.kind === "rateLimited") {
    return tooManyRequests(result.retryAfterSec);
  }

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: result.presignedUrl,
      "Cache-Control": "no-store, private",
    },
  });
}
