import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type GlobalWithPrisma = typeof globalThis & {
  prisma?: unknown;
};

const g = globalThis as GlobalWithPrisma;

async function importPrismaModule() {
  // force a fresh evaluation of the module so NODE_ENV + globalThis cache
  // are exercised under the test-provided conditions. Re-import PrismaClient
  // from the same fresh module graph so `instanceof` checks are valid.
  vi.resetModules();
  const { PrismaClient } = await import("@prisma/client");
  const mod = await import("@/lib/prisma");
  return { ...mod, PrismaClient };
}

describe("F2.2 — Prisma client singleton", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete g.prisma;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    const cached = g.prisma as { $disconnect?: () => Promise<void> } | undefined;
    if (cached && typeof cached.$disconnect === "function") {
      await cached.$disconnect();
    }
    delete g.prisma;
    vi.resetModules();
  });

  it("exports a `prisma` symbol that is a PrismaClient instance", async () => {
    const mod = await importPrismaModule();
    // duck-type via Prisma runtime methods; toBeInstanceOf on the proxy
    // recurses in vitest's serializer
    expect(mod.prisma).toBeDefined();
    expect(typeof (mod.prisma as unknown as { $connect: unknown }).$connect).toBe("function");
    expect(typeof (mod.prisma as unknown as { $disconnect: unknown }).$disconnect).toBe("function");
    expect(typeof (mod.prisma as unknown as { $transaction: unknown }).$transaction).toBe("function");
  });

  it("returns the same reference across two imports (singleton)", async () => {
    const first = (await importPrismaModule()).prisma;
    const second = (await importPrismaModule()).prisma;
    expect(first).toBe(second);
  });

  it("stores the client on globalThis in non-production (dev HMR safety)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { prisma } = await importPrismaModule();
    expect(g.prisma).toBe(prisma);
  });

  it("stores the client on globalThis in test env too", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { prisma } = await importPrismaModule();
    expect(g.prisma).toBe(prisma);
  });

  it("does NOT write to globalThis when NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await importPrismaModule();
    expect(g.prisma).toBeUndefined();
  });

  it("reuses a pre-existing globalThis.prisma instead of constructing a new client", async () => {
    vi.resetModules();
    const { PrismaClient } = await import("@prisma/client");
    const preExisting = new PrismaClient();
    g.prisma = preExisting;
    const { prisma } = await import("@/lib/prisma");
    expect(prisma).toBe(preExisting);
  });
});
