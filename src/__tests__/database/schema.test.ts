import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCHEMA_PATH = join(REPO_ROOT, "prisma", "schema.prisma");
const MIGRATIONS_DIR = join(REPO_ROOT, "prisma", "migrations");
const SRC_DIR = join(REPO_ROOT, "src");

const schema = readFileSync(SCHEMA_PATH, "utf8");

function latestInitMigrationSql(): string {
  const dirs = readdirSync(MIGRATIONS_DIR)
    .filter((d) => d.endsWith("_init"))
    .sort();
  if (dirs.length === 0) throw new Error("no *_init migration found");
  const sqlPath = join(MIGRATIONS_DIR, dirs[dirs.length - 1], "migration.sql");
  return readFileSync(sqlPath, "utf8");
}

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walkTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("F2.1 — Prisma schema: generated client", () => {
  it("exports PrismaClient constructor (prisma generate has run)", async () => {
    const mod = await import("@prisma/client");
    expect(typeof mod.PrismaClient).toBe("function");
  });
});

describe("F2.1 — Prisma schema: 7 core models", () => {
  const models = [
    "User",
    "Bucket",
    "Document",
    "AccessPolicy",
    "GeneratedLink",
    "AuditLog",
    "UserBucketAccess",
  ];

  for (const m of models) {
    it(`defines model ${m}`, () => {
      expect(schema).toMatch(new RegExp(`model\\s+${m}\\s*\\{`));
    });
  }

  const tableMap: Array<[string, string]> = [
    ["User", "users"],
    ["Bucket", "buckets"],
    ["Document", "documents"],
    ["AccessPolicy", "access_policies"],
    ["GeneratedLink", "generated_links"],
    ["AuditLog", "audit_logs"],
    ["UserBucketAccess", "user_bucket_access"],
  ];

  for (const [model, table] of tableMap) {
    it(`maps ${model} to snake_case table "${table}"`, () => {
      const modelBlock = extractModelBlock(schema, model);
      expect(modelBlock).toMatch(
        new RegExp(`@@map\\("${table}"\\)`),
      );
    });
  }
});

describe("F2.1 — Prisma schema: enums", () => {
  it("defines Role enum with superadmin, admin, viewer", () => {
    const block = extractEnumBlock(schema, "Role");
    expect(block).toContain("superadmin");
    expect(block).toContain("admin");
    expect(block).toContain("viewer");
  });

  it("defines AuditAction enum with all 21 action types", () => {
    const expected = [
      "LOGIN",
      "LOGOUT",
      "BUCKET_CREATE",
      "BUCKET_DELETE",
      "DOCUMENT_UPLOAD",
      "DOCUMENT_DOWNLOAD",
      "DOCUMENT_SOFT_DELETE",
      "DOCUMENT_HARD_DELETE",
      "DOCUMENT_MOVE",
      "DOCUMENT_COPY",
      "POLICY_CREATE",
      "POLICY_UPDATE",
      "POLICY_DELETE",
      "LINK_GENERATE",
      "LINK_ACCESS",
      "LINK_DENIED",
      "LINK_REVOKE",
      "USER_INVITE",
      "USER_ROLE_CHANGE",
      "USER_DISABLE",
      "USER_ENABLE",
    ];
    const block = extractEnumBlock(schema, "AuditAction");
    for (const v of expected) {
      expect(block).toContain(v);
    }
    expect(expected).toHaveLength(21);
  });

  it("defines PolicyTargetType enum with bucket, prefix, object", () => {
    const block = extractEnumBlock(schema, "PolicyTargetType");
    expect(block).toContain("bucket");
    expect(block).toContain("prefix");
    expect(block).toContain("object");
  });

  it("defines UserStatus enum with active, disabled", () => {
    const block = extractEnumBlock(schema, "UserStatus");
    expect(block).toContain("active");
    expect(block).toContain("disabled");
  });
});

describe("F2.1 — Prisma schema: field types and constraints", () => {
  it("User.status uses UserStatus enum with default active", () => {
    const block = extractModelBlock(schema, "User");
    expect(block).toMatch(/status\s+UserStatus\s+@default\(active\)/);
  });

  it("GeneratedLink.presignedUrlHash is unique", () => {
    const block = extractModelBlock(schema, "GeneratedLink");
    expect(block).toMatch(
      /presignedUrlHash\s+String\s+@unique\s+@map\("presigned_url_hash"\)/,
    );
  });

  it("Document.sizeBytes is BigInt optional", () => {
    const block = extractModelBlock(schema, "Document");
    expect(block).toMatch(/sizeBytes\s+BigInt\?\s+@map\("size_bytes"\)/);
  });

  it("AuditLog.metadata is Json optional", () => {
    const block = extractModelBlock(schema, "AuditLog");
    expect(block).toMatch(/metadata\s+Json\?/);
  });

  it("AuditLog.ipAddress and userAgent are required strings", () => {
    const block = extractModelBlock(schema, "AuditLog");
    expect(block).toMatch(/ipAddress\s+String\s+@map\("ip_address"\)/);
    expect(block).toMatch(/userAgent\s+String\s+@map\("user_agent"\)/);
  });

  it("UserBucketAccess has composite primary key [userId, bucketId]", () => {
    const block = extractModelBlock(schema, "UserBucketAccess");
    expect(block).toMatch(/@@id\(\[userId,\s*bucketId\]\)/);
  });

  it("GeneratedLink.isRevoked defaults to false", () => {
    const block = extractModelBlock(schema, "GeneratedLink");
    expect(block).toMatch(/isRevoked\s+Boolean\s+@default\(false\)/);
  });

  it("GeneratedLink.downloadCount defaults to 0", () => {
    const block = extractModelBlock(schema, "GeneratedLink");
    expect(block).toMatch(/downloadCount\s+Int\s+@default\(0\)/);
  });

  it("AccessPolicy.linkTtlSeconds defaults to 900 (15 min)", () => {
    const block = extractModelBlock(schema, "AccessPolicy");
    expect(block).toMatch(/linkTtlSeconds\s+Int\s+@default\(900\)/);
  });
});

describe("F2.1 — Prisma schema: unique constraints and indexes", () => {
  it("users.auth0_id is unique", () => {
    const block = extractModelBlock(schema, "User");
    expect(block).toMatch(/auth0Id\s+String\s+@unique\s+@map\("auth0_id"\)/);
  });

  it("users.email is unique", () => {
    const block = extractModelBlock(schema, "User");
    expect(block).toMatch(/email\s+String\s+@unique/);
  });

  it("buckets.name is unique", () => {
    const block = extractModelBlock(schema, "Bucket");
    expect(block).toMatch(/name\s+String\s+@unique/);
  });

  it("Document has index on bucket_id", () => {
    const block = extractModelBlock(schema, "Document");
    expect(block).toMatch(/@@index\(\[bucketId\]\)/);
  });

  it("Document has index on s3_key", () => {
    const block = extractModelBlock(schema, "Document");
    expect(block).toMatch(/@@index\(\[s3Key\]\)/);
  });

  it("AuditLog has indexes on created_at, user_id, action", () => {
    const block = extractModelBlock(schema, "AuditLog");
    expect(block).toMatch(/@@index\(\[createdAt\]\)/);
    expect(block).toMatch(/@@index\(\[userId\]\)/);
    expect(block).toMatch(/@@index\(\[action\]\)/);
  });

  it("GeneratedLink has index on document_id", () => {
    const block = extractModelBlock(schema, "GeneratedLink");
    expect(block).toMatch(/@@index\(\[documentId\]\)/);
  });
});

describe("F2.1 — init migration: audit_logs append-only trigger", () => {
  const sql = latestInitMigrationSql();

  it("defines audit_logs_reject_mutation function", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION audit_logs_reject_mutation\(\)/,
    );
  });

  it("raises exception on any mutation op with insufficient_privilege", () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'audit_logs is append-only/);
    expect(sql).toMatch(/ERRCODE = 'insufficient_privilege'/);
  });

  it("attaches BEFORE UPDATE trigger on audit_logs", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER audit_logs_no_update[\s\S]*?BEFORE UPDATE ON "audit_logs"/,
    );
  });

  it("attaches BEFORE DELETE trigger on audit_logs", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER audit_logs_no_delete[\s\S]*?BEFORE DELETE ON "audit_logs"/,
    );
  });

  it("attaches BEFORE TRUNCATE trigger on audit_logs", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER audit_logs_no_truncate[\s\S]*?BEFORE TRUNCATE ON "audit_logs"/,
    );
  });
});

describe("F2.1 — Prisma schema: FK retention (no cascade on audit/link paths)", () => {
  it("AuditLog.user relation has no onDelete:Cascade (HIPAA retention)", () => {
    const block = extractModelBlock(schema, "AuditLog");
    const userRelation = block.match(/user\s+User\?\s+@relation\([^)]*\)/);
    expect(userRelation).toBeTruthy();
    expect(userRelation![0]).not.toMatch(/onDelete:\s*Cascade/);
  });

  it("GeneratedLink.document relation has no onDelete:Cascade", () => {
    const block = extractModelBlock(schema, "GeneratedLink");
    const docRelation = block.match(/document\s+Document\s+@relation\([^)]*\)/);
    expect(docRelation).toBeTruthy();
    expect(docRelation![0]).not.toMatch(/onDelete:\s*Cascade/);
  });
});

describe("F2.1 — append-only sentinel for audit_logs (source-layer)", () => {
  const srcFiles = walkTsFiles(SRC_DIR).filter(
    (f) => !f.includes("__tests__"),
  );

  // Source-layer sentinel is a fast-feedback belt; the DB trigger (tested
  // above) is the authoritative enforcer. Both required — defense in depth.

  it("no src file calls auditLog.update on any prisma-shaped alias", () => {
    const hits = srcFiles.filter((f) =>
      readFileSync(f, "utf8").match(/\.auditLog\.update\b/),
    );
    expect(hits).toEqual([]);
  });

  it("no src file calls auditLog.delete/deleteMany on any prisma-shaped alias", () => {
    const hits = srcFiles.filter((f) =>
      readFileSync(f, "utf8").match(/\.auditLog\.(delete|deleteMany)\b/),
    );
    expect(hits).toEqual([]);
  });

  it("no src file calls auditLog.upsert on any prisma-shaped alias", () => {
    const hits = srcFiles.filter((f) =>
      readFileSync(f, "utf8").match(/\.auditLog\.upsert\b/),
    );
    expect(hits).toEqual([]);
  });

  it("no src file uses $executeRaw / $queryRaw against audit_logs", () => {
    // Matches any tag or call: $executeRaw, $executeRawUnsafe, $queryRaw, $queryRawUnsafe
    const rawRe = /\$(?:execute|query)Raw(?:Unsafe)?[^`;]*?audit_logs/i;
    const hits = srcFiles.filter((f) =>
      readFileSync(f, "utf8").match(rawRe),
    );
    expect(hits).toEqual([]);
  });

  it("no src file uses bracket-notation dispatch like ['auditLog']['update']", () => {
    const hits = srcFiles.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        src.match(/\[\s*["']auditLog["']\s*\]\s*\[\s*["'](?:update|delete|deleteMany|upsert)["']\s*\]/) ||
        src.match(/\[\s*["']audit_logs["']\s*\]/)
      );
    });
    expect(hits).toEqual([]);
  });
});

// -- helpers --

function extractModelBlock(src: string, name: string): string {
  const re = new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`model ${name} not found in schema`);
  return m[1];
}

function extractEnumBlock(src: string, name: string): string {
  const re = new RegExp(`enum\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`enum ${name} not found in schema`);
  return m[1];
}
