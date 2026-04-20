import { describe, expect, it, vi } from "vitest";
import { logAudit, type AuditPrisma } from "@/lib/audit";
import type { AuditAction } from "@/types";

const ACTIONS: readonly AuditAction[] = [
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

describe("AuditAction enum", () => {
  it("covers all 21 HIPAA action types", () => {
    expect(ACTIONS).toHaveLength(21);
    expect(new Set(ACTIONS).size).toBe(21);
  });

  it("accepts every action in logAudit() without runtime error", async () => {
    const writes: string[] = [];
    const client: AuditPrisma = {
      auditLog: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          writes.push(args.data.action as string);
          return { id: "x" };
        }),
      },
    };
    for (const action of ACTIONS) {
      await logAudit(client, {
        userId: "u-1",
        action,
        targetType: "thing",
        targetId: "t-1",
        ipAddress: "10.0.0.1",
        userAgent: "vitest",
      });
    }
    expect(writes).toEqual([...ACTIONS]);
  });
});
