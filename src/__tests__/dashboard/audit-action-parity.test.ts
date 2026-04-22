import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditActionSchema } from "@/lib/activity-feed";
import { categoryForAction } from "@/lib/activity-categories";
import type { AuditAction } from "@/types";

// Drift guard: every value in the Prisma `AuditAction` enum MUST also
// appear in the TS AuditAction union, the auditActionSchema Zod enum,
// and categoryForAction's switch. Missing one was the root cause of
// the 2026-04-22 dashboard load-more 500: LINK_SHARE_INFO_VIEW existed
// in Prisma + the writer (link share-info route) but had been omitted
// from the type/schema/category map. The cursor-less feed only hit it
// occasionally; pagination scanned older rows and tripped the boundary
// validator on every Load more. This test fails fast if any future
// Prisma enum value is added without the matching TS plumbing.

const SCHEMA_PATH = join(process.cwd(), "prisma", "schema.prisma");

function readPrismaAuditActionValues(): string[] {
  const raw = readFileSync(SCHEMA_PATH, "utf8");
  const start = raw.indexOf("enum AuditAction");
  if (start === -1) throw new Error("AuditAction enum not found in schema");
  const open = raw.indexOf("{", start);
  const close = raw.indexOf("}", open);
  if (open === -1 || close === -1) {
    throw new Error("AuditAction enum braces not found");
  }
  return raw
    .slice(open + 1, close)
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0);
}

describe("AuditAction enum parity (Prisma ↔ TS ↔ Zod ↔ category)", () => {
  const prismaValues = readPrismaAuditActionValues();

  it("Prisma enum was parsed (sanity)", () => {
    expect(prismaValues.length).toBeGreaterThan(15);
  });

  for (const value of readPrismaAuditActionValues()) {
    it(`${value} is in auditActionSchema`, () => {
      expect(auditActionSchema.safeParse(value).success).toBe(true);
    });

    it(`${value} maps to a category`, () => {
      const cat = categoryForAction(value as AuditAction);
      expect(["auth", "document", "policy", "link", "user"]).toContain(cat);
    });
  }
});
