// Node-only graceful shutdown: flush Prisma RDS pool on SIGTERM/SIGINT
// so rolling deploys don't leak half-open connections.
// Ref: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
import { prisma } from "@/lib/prisma";

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
    process.exit(0);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
