import { describe, expect, it } from "vitest";
import { rowsToCsv, csvFilename } from "@/lib/audit-csv";
import type { AuditQueryRow } from "@/lib/audit-query";

function row(over: Partial<AuditQueryRow> = {}): AuditQueryRow {
  return {
    id: "a-1",
    createdAt: new Date("2026-01-15T10:30:00Z"),
    action: "BUCKET_CREATE",
    targetType: "bucket",
    targetId: "b-1",
    ipAddress: "10.0.0.1",
    userId: "u-1",
    userName: "Alice",
    userEmail: "alice@x.com",
    ...over,
  };
}

describe("rowsToCsv", () => {
  it("emits header line followed by one row per entry", () => {
    const csv = rowsToCsv([row(), row({ id: "a-2", targetId: "b-2" })]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "timestamp,user_name,user_email,user_id,action,target_type,target_id,ip_address",
    );
  });

  it("ISO-formats timestamps", () => {
    const csv = rowsToCsv([row()]);
    expect(csv).toMatch(/2026-01-15T10:30:00\.000Z/);
  });

  it("RFC 4180 escapes commas, quotes, and newlines in fields", () => {
    const csv = rowsToCsv([
      row({ userName: 'Eve, the "quoted"\nname' }),
    ]);
    expect(csv).toMatch(/"Eve, the ""quoted""\nname"/);
  });

  it("renders nulls as empty fields (no literal 'null')", () => {
    const csv = rowsToCsv([
      row({ userName: null, userEmail: null, userId: null }),
    ]);
    const dataLine = csv.trim().split("\n")[1] ?? "";
    expect(dataLine).not.toMatch(/null/);
    expect(dataLine.split(",").slice(1, 4)).toEqual(["", "", ""]);
  });

  it("returns header-only output for empty list", () => {
    const csv = rowsToCsv([]);
    expect(csv.trim().split("\n")).toHaveLength(1);
  });
});

describe("csvFilename", () => {
  it("matches audit_log_YYYY-MM-DD_HH-mm.csv format", () => {
    const name = csvFilename(new Date("2026-04-20T15:07:00Z"));
    expect(name).toMatch(/^audit_log_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.csv$/);
  });

  it("uses UTC components for stable filenames across runners", () => {
    const name = csvFilename(new Date("2026-04-20T15:07:00Z"));
    expect(name).toBe("audit_log_2026-04-20_15-07.csv");
  });
});
