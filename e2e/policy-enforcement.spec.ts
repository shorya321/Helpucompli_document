import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const TOKEN = "s3TmkrRSDdkI5EfK0cEHCL3M3t-u0VrhM9OPAyCboK4"; // from recent link

/**
 * Proves the enforcement engine IS working, by flipping policy state
 * between empty (permissive) and restrictive and hitting the same link.
 *
 * Requires .env.local DATABASE_URL to be sourced. Run with:
 *   set -a; source .env.local; set +a; npx playwright test e2e/policy-enforcement.spec.ts
 */
test.describe("Policy enforcement matrix on /api/links/[hash]", () => {
  let prisma: PrismaClient;
  let policyId: string;

  test.beforeAll(async () => {
    prisma = new PrismaClient();
    const link = await prisma.generatedLink.findUnique({
      where: { presignedUrlHash: TOKEN },
      select: { policyId: true },
    });
    if (!link?.policyId) {
      throw new Error(
        `Link ${TOKEN} has no policyId — use a policy-attached link.`,
      );
    }
    policyId = link.policyId;
  });

  test.afterAll(async () => {
    // Restore policy to fully permissive (the state the user last set)
    await prisma.accessPolicy.update({
      where: { id: policyId },
      data: {
        allowedDomains: [],
        allowedIpRanges: [],
        requireAuth: false,
      },
    });
    await prisma.$disconnect();
  });

  test("fully permissive policy (all empty) → 302", async () => {
    await prisma.accessPolicy.update({
      where: { id: policyId },
      data: {
        allowedDomains: [],
        allowedIpRanges: [],
        requireAuth: false,
      },
    });
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/links/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    await ctx.dispose();
  });

  test("allowedDomains set → no-Referer request denied", async () => {
    await prisma.accessPolicy.update({
      where: { id: policyId },
      data: {
        allowedDomains: ["example.com"],
        allowedIpRanges: [],
        requireAuth: false,
      },
    });
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/links/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test("allowedDomains set → matching Referer allowed", async () => {
    await prisma.accessPolicy.update({
      where: { id: policyId },
      data: {
        allowedDomains: ["example.com"],
        allowedIpRanges: [],
        requireAuth: false,
      },
    });
    const ctx = await request.newContext({
      extraHTTPHeaders: { Referer: "https://example.com/share" },
    });
    const res = await ctx.get(`${BASE}/api/links/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    await ctx.dispose();
  });

  test("allowedIpRanges set to unreachable subnet → denied", async () => {
    await prisma.accessPolicy.update({
      where: { id: policyId },
      data: {
        allowedDomains: [],
        allowedIpRanges: ["192.0.2.0/24"], // RFC 5737 test range, never localhost
        requireAuth: false,
      },
    });
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/links/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test("requireAuth=true + no session → denied", async () => {
    await prisma.accessPolicy.update({
      where: { id: policyId },
      data: {
        allowedDomains: [],
        allowedIpRanges: [],
        requireAuth: true,
      },
    });
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/links/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });
});
