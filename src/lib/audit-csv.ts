import type { AuditQueryRow } from "@/lib/audit-query";

const HEADERS = [
  "timestamp",
  "user_name",
  "user_email",
  "user_id",
  "action",
  "target_type",
  "target_id",
  "ip_address",
] as const;

function escape(value: string | null): string {
  if (value === null || value === undefined) return "";
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: readonly AuditQueryRow[]): string {
  const lines: string[] = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escape(r.createdAt.toISOString()),
        escape(r.userName),
        escape(r.userEmail),
        escape(r.userId),
        escape(r.action),
        escape(r.targetType),
        escape(r.targetId),
        escape(r.ipAddress),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function csvFilename(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = pad2(now.getUTCMonth() + 1);
  const d = pad2(now.getUTCDate());
  const h = pad2(now.getUTCHours());
  const mi = pad2(now.getUTCMinutes());
  return `audit_log_${y}-${mo}-${d}_${h}-${mi}.csv`;
}
