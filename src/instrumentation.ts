// Next.js `instrumentation.ts` — runs once on server bootstrap for each
// runtime. Node-only graceful-shutdown logic lives in ./instrumentation-node
// and is loaded via a runtime-gated dynamic import so the Edge bundler never
// traverses it (avoids warnings about process.on / process.exit).
//
// F2.2 sec-review INFO + F12.5 follow-up: without these handlers a SIGTERM
// during a deploy leaves the Prisma pool TCP-half-open for up to the
// keepalive window, bumping RDS `connections` metric above baseline and
// risking pool exhaustion on the incoming green fleet.
//
// Ref: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
