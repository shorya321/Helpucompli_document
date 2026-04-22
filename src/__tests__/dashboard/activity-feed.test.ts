import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_FEED_LIMIT,
  actionBadgeTone,
  getRecentActivity,
  type ActivityEntry,
  type ActivityFeedPrisma,
} from "@/lib/activity-feed";
import type { AuditAction } from "@/types";

type FindManyArg = {
  take?: number;
  orderBy?: unknown;
  select?: unknown;
};

function makeStub(rows: Array<Record<string, unknown>>) {
  const calls: FindManyArg[] = [];
  const client: ActivityFeedPrisma = {
    auditLog: {
      findMany: vi.fn(async (args?: FindManyArg) => {
        calls.push(args ?? {});
        return rows;
      }),
    },
  };
  return { client, calls };
}

describe("ACTIVITY_FEED_LIMIT", () => {
  it("is 20 per the F4.3 spec", () => {
    expect(ACTIVITY_FEED_LIMIT).toBe(20);
  });
});

describe("getRecentActivity", () => {
  it("queries auditLog.findMany with take=20 + desc createdAt by default", async () => {
    const stub = makeStub([]);
    await getRecentActivity(stub.client);
    const call = stub.calls[0];
    expect(call?.take).toBe(20);
    expect(call?.orderBy).toEqual({ createdAt: "desc" });
  });

  it("selects only {id, createdAt, action, targetType, targetId, user:{name}} — HIPAA minimum-necessary, email excluded", async () => {
    const stub = makeStub([]);
    await getRecentActivity(stub.client);
    const select = stub.calls[0]?.select as Record<string, unknown>;
    expect(select).toEqual({
      id: true,
      createdAt: true,
      action: true,
      targetType: true,
      targetId: true,
      user: { select: { name: true } },
    });
  });

  it("never fetches email — even if a stub row contains it, userName does not leak it", async () => {
    const stub = makeStub([
      {
        id: "a1",
        createdAt: new Date(),
        action: "LOGIN",
        targetType: "user",
        targetId: "u1",
        // Simulate a stray email field on the row — the function must
        // NOT use it as a fallback (unlike prior F4.3 behaviour).
        user: { name: null, email: "leak@x.com" },
      },
    ]);
    const out = await getRecentActivity(stub.client);
    expect(out[0]?.userName).toBeNull();
  });

  it("accepts a custom limit override", async () => {
    const stub = makeStub([]);
    await getRecentActivity(stub.client, 5);
    expect(stub.calls[0]?.take).toBe(5);
  });

  it("clamps limit to [1, 200] — cannot hammer the audit table by accident", async () => {
    const stub = makeStub([]);
    await getRecentActivity(stub.client, 10_000);
    expect(stub.calls[0]?.take).toBe(200);
    await getRecentActivity(stub.client, 0);
    expect(stub.calls[1]?.take).toBe(1);
    await getRecentActivity(stub.client, -5);
    expect(stub.calls[2]?.take).toBe(1);
  });

  it("maps rows to ActivityEntry shape — user.name preferred", async () => {
    const createdAt = new Date("2026-04-17T10:00:00Z");
    const stub = makeStub([
      {
        id: "a1",
        createdAt,
        action: "DOCUMENT_UPLOAD",
        targetType: "document",
        targetId: "doc-1",
        user: { name: "Alice", email: "a@x.com" },
      },
    ]);
    const out = await getRecentActivity(stub.client);
    const expected: ActivityEntry = {
      id: "a1",
      createdAt,
      action: "DOCUMENT_UPLOAD",
      userName: "Alice",
      targetType: "document",
      targetId: "doc-1",
    };
    expect(out).toEqual([expected]);
  });

  it("returns null userName when name is null — no email fallback (HIPAA min-necessary)", async () => {
    const stub = makeStub([
      {
        id: "a2",
        createdAt: new Date(),
        action: "LOGIN",
        targetType: "user",
        targetId: "u-1",
        user: { name: null },
      },
    ]);
    const out = await getRecentActivity(stub.client);
    expect(out[0]?.userName).toBeNull();
  });

  it("userName is null when the whole user row is null (HIPAA: audit_logs.user_id SET NULL on user delete)", async () => {
    const stub = makeStub([
      {
        id: "a3",
        createdAt: new Date(),
        action: "LOGIN",
        targetType: "user",
        targetId: "u-1",
        user: null,
      },
    ]);
    const out = await getRecentActivity(stub.client);
    expect(out[0]?.userName).toBeNull();
  });
});

describe("actionBadgeTone", () => {
  const cases: Array<[AuditAction, string]> = [
    ["LOGIN", "success"],
    ["LOGOUT", "info"],
    ["DOCUMENT_UPLOAD", "info"],
    ["LINK_GENERATE", "info"],
    ["BUCKET_CREATE", "info"],
    ["POLICY_CREATE", "info"],
    ["POLICY_UPDATE", "warning"],
    ["USER_ROLE_CHANGE", "warning"],
    ["DOCUMENT_SOFT_DELETE", "warning"],
    ["DOCUMENT_HARD_DELETE", "danger"],
    ["BUCKET_DELETE", "danger"],
    ["POLICY_DELETE", "danger"],
    ["LINK_DENIED", "danger"],
    ["LINK_REVOKE", "danger"],
    ["USER_DISABLE", "danger"],
  ];
  for (const [action, tone] of cases) {
    it(`${action} -> ${tone}`, () => {
      expect(actionBadgeTone(action)).toBe(tone);
    });
  }

  it("every AuditAction produces one of the four tones (exhaustive)", () => {
    const all: AuditAction[] = [
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
      "LINK_SHARE_INFO_VIEW",
      "USER_INVITE",
      "USER_ROLE_CHANGE",
      "USER_DISABLE",
      "USER_ENABLE",
    ];
    const valid = new Set(["info", "success", "warning", "danger"]);
    for (const a of all) {
      expect(valid.has(actionBadgeTone(a))).toBe(true);
    }
  });
});
