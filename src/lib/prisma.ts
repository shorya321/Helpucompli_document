import { PrismaClient } from "@prisma/client";

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
export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { level: "error", emit: "event" },
      { level: "warn", emit: "stdout" },
    ],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
