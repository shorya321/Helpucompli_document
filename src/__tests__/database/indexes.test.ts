import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCHEMA_PATH = join(REPO_ROOT, "prisma", "schema.prisma");
const MIGRATIONS_DIR = join(REPO_ROOT, "prisma", "migrations");

const schema = readFileSync(SCHEMA_PATH, "utf8");

function allMigrationSql(): string {
  const dirs = readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith(".") && d !== "migration_lock.toml")
    .sort();
  return dirs
    .map((d) => {
      try {
        return readFileSync(join(MIGRATIONS_DIR, d, "migration.sql"), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

// Scope model body so `@@index` in another model never false-positives.
function modelBody(modelName: string): string {
  const re = new RegExp(
    `model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`,
    "m",
  );
  const match = schema.match(re);
  if (!match) throw new Error(`model ${modelName} not found in schema.prisma`);
  return match[1];
}

describe("F2.3 — Performance indexes in schema.prisma", () => {
  it("GeneratedLink has @@index([expiresAt]) for active/expired filter", () => {
    const body = modelBody("GeneratedLink");
    expect(body).toMatch(/@@index\(\[expiresAt\]\)/);
  });

  it("GeneratedLink has @@index([isRevoked]) for status filter", () => {
    const body = modelBody("GeneratedLink");
    expect(body).toMatch(/@@index\(\[isRevoked\]\)/);
  });

  it("Document has @@index([isDeleted]) for soft-delete filter", () => {
    const body = modelBody("Document");
    expect(body).toMatch(/@@index\(\[isDeleted\]\)/);
  });

  it("Document has @@index([uploadedAt]) for time-range sort", () => {
    const body = modelBody("Document");
    expect(body).toMatch(/@@index\(\[uploadedAt\]\)/);
  });
});

describe("F2.3 — Performance indexes materialized in migration.sql", () => {
  const sql = allMigrationSql();

  it("CREATE INDEX on generated_links.expires_at present", () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+[^;]*"generated_links"\s*\(\s*"expires_at"\s*\)/i,
    );
  });

  it("CREATE INDEX on generated_links.is_revoked present", () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+[^;]*"generated_links"\s*\(\s*"is_revoked"\s*\)/i,
    );
  });

  it("CREATE INDEX on documents.is_deleted present", () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+[^;]*"documents"\s*\(\s*"is_deleted"\s*\)/i,
    );
  });

  it("CREATE INDEX on documents.uploaded_at present", () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+[^;]*"documents"\s*\(\s*"uploaded_at"\s*\)/i,
    );
  });
});
