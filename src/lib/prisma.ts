import { Prisma, PrismaClient } from "@prisma/client";

// Deployment assumption: long-lived Node.js process (EC2/ECS/Vercel
// Node runtime). The globalThis cache below deduplicates clients
// across Next.js HMR in dev; it intentionally does NOT write in
// production. For isolate-per-request runtimes (Lambda, Edge)
// revisit connection-pool strategy (consider Prisma Accelerate or
// Data Proxy) to avoid RDS pool exhaustion under burst traffic.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// log: 'error' is emitted as an event (not logged to stdout) so the
// default engine-error format — which may include the raw
// DATABASE_URL — never reaches CloudWatch/Datadog in plaintext.
// 'warn' remains on stdout since it carries no credentials.
function buildClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { level: "error", emit: "event" },
      { level: "warn", emit: "stdout" },
    ],
  });

  // Subscribe to the 'error' event so it is actually observed. Without
  // a listener the event goes to a dead channel — the stdout-suppression
  // from emit:'event' is real, but errors would also disappear from
  // diagnostics entirely. Log sanitised (no URL / message body that the
  // engine might interpolate credentials into — just level + target).
  // Ref: https://www.prisma.io/docs/orm/reference/prisma-client-reference#log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as unknown as { $on: (event: "error", cb: (e: Prisma.LogEvent) => void) => void }).$on(
    "error",
    (event) => {
      // Pino/Sentry will be wired in Module 12; for now use console.error
      // with a structured payload that explicitly does NOT include the
      // event.message body (engine-side message may include connection
      // parameters).
      // eslint-disable-next-line no-console
      console.error("[prisma]", {
        timestamp: event.timestamp,
        target: event.target,
      });
    },
  );

  return client;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
