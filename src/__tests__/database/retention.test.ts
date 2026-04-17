import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CHECKLIST_PATH = join(REPO_ROOT, "docs", "HIPAA-COMPLIANCE-CHECKLIST.md");

describe("F2.4 — Audit log retention policy documentation", () => {
  it("HIPAA compliance checklist exists at docs/HIPAA-COMPLIANCE-CHECKLIST.md", () => {
    expect(existsSync(CHECKLIST_PATH)).toBe(true);
  });

  it("documents 6-year minimum retention for audit_logs", () => {
    const md = readFileSync(CHECKLIST_PATH, "utf8");
    expect(md).toMatch(/audit[_\s-]*log/i);
    expect(md).toMatch(/6[\s-]*year/i);
  });

  it("documents monthly partitioning strategy for scale", () => {
    const md = readFileSync(CHECKLIST_PATH, "utf8");
    expect(md).toMatch(/partition/i);
    expect(md).toMatch(/month/i);
  });

  it("documents S3 Glacier archive plan for aged partitions", () => {
    const md = readFileSync(CHECKLIST_PATH, "utf8");
    expect(md).toMatch(/glacier/i);
    expect(md).toMatch(/archiv/i);
  });

  it("documents DB-enforced append-only (BEFORE UPDATE/DELETE/TRUNCATE triggers from F2.1)", () => {
    const md = readFileSync(CHECKLIST_PATH, "utf8");
    expect(md).toMatch(/append[-\s]?only/i);
    expect(md).toMatch(/BEFORE\s+UPDATE|UPDATE\/DELETE|trigger/i);
  });

  it("references 45 CFR §164.316(b)(2) six-year HIPAA retention rule", () => {
    const md = readFileSync(CHECKLIST_PATH, "utf8");
    expect(md).toMatch(/164\.316/);
  });
});
