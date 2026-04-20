// Next.js `instrumentation.ts` — runs once on server bootstrap for
// each runtime. We use it to wire graceful-shutdown handlers so
// Prisma flushes its RDS connection pool on rolling deploy.
//
// F2.2 sec-review INFO + F12.5 follow-up: without these handlers a
// SIGTERM during a deploy leaves the pool TCP-half-open for up to
// keepalive window, bumping RDS `connections` metric above baseline
// and risking pool exhaustion on the incoming green fleet.
//
// Ref: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register(): Promise<void> {
  // instrumentation.ts runs on both Node and Edge runtimes. Signal
  // handlers are Node-only — guard the runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { prisma } = await import("@/lib/prisma");

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[instrumentation] ${signal} received — flushing Prisma pool`);
    try {
      await prisma.$disconnect();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[instrumentation] prisma.$disconnect failed", {
        name: (err as Error).name,
      });
    } finally {
      // Exit cleanly so the process manager (systemd / k8s / Vercel)
      // completes the rolling-deploy terminate phase without a
      // SIGKILL fallback.
      process.exit(0);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
