import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logLoginOnce } from "@/lib/log-login-once";
import type { SessionData } from "@auth0/nextjs-auth0/types";

type CreateArgs = { data: Record<string, unknown> };
type FindFirstArgs = { where: Record<string, unknown> };

function makePrisma(opts: { existing?: { id: string } | null } = {}) {
  const findFirst = vi.fn(async (_args: FindFirstArgs) => {
    void _args;
    return opts.existing ?? null;
  });
  const create = vi.fn(async (_args: CreateArgs) => {
    void _args;
    return { id: "audit-new" };
  });
  return {
    client: {
      auditLog: { findFirst, create },
    },
    findFirst,
    create,
  };
}

function makeSession(sid = "sid-abc"): SessionData {
  return {
    user: { sub: "auth0|user-1", email: "u@example.com" },
    tokenSet: { accessToken: "at", idToken: "it", expiresAt: 0 } as never,
    internal: { sid, createdAt: 1234567890 },
  } as unknown as SessionData;
}

function makeHeaders(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    "x-forwarded-for": "10.1.2.3",
    "user-agent": "vitest-ua/1.0",
    ...overrides,
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.AUDIT_LOGIN_LOGOUT_ENABLED;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("logLoginOnce", () => {
  it("inserts LOGIN row when no prior LOGIN exists for this session sid", async () => {
    const p = makePrisma({ existing: null });
    await logLoginOnce(p.client, makeSession("sid-new"), {
      userDbId: "u-db-1",
      headers: makeHeaders(),
    });
    expect(p.findFirst).toHaveBeenCalledTimes(1);
    expect(p.create).toHaveBeenCalledTimes(1);
    const [args] = p.create.mock.calls;
    expect(args?.[0]?.data).toMatchObject({
      userId: "u-db-1",
      action: "LOGIN",
      targetType: "session",
      targetId: "sid-new",
      ipAddress: "10.1.2.3",
      userAgent: "vitest-ua/1.0",
    });
    const meta = (args?.[0]?.data as { metadata?: Record<string, unknown> })
      .metadata;
    expect(meta).toMatchObject({ sessionId: "sid-new" });
  });

  it("skips insert when a LOGIN row already exists for the same sid (idempotency)", async () => {
    const p = makePrisma({ existing: { id: "audit-existing" } });
    await logLoginOnce(p.client, makeSession("sid-existing"), {
      userDbId: "u-db-1",
      headers: makeHeaders(),
    });
    expect(p.findFirst).toHaveBeenCalledTimes(1);
    expect(p.create).not.toHaveBeenCalled();
  });

  it("kill-switch AUDIT_LOGIN_LOGOUT_ENABLED=false short-circuits before any DB call", async () => {
    process.env.AUDIT_LOGIN_LOGOUT_ENABLED = "false";
    const p = makePrisma({ existing: null });
    await logLoginOnce(p.client, makeSession("sid-x"), {
      userDbId: "u-db-1",
      headers: makeHeaders(),
    });
    expect(p.findFirst).not.toHaveBeenCalled();
    expect(p.create).not.toHaveBeenCalled();
  });

  it("swallows DB errors so it never blocks the dashboard render", async () => {
    const p = {
      client: {
        auditLog: {
          findFirst: vi.fn(async () => {
            throw new Error("db down");
          }),
          create: vi.fn(),
        },
      },
    };
    await expect(
      logLoginOnce(p.client, makeSession(), {
        userDbId: "u-db-1",
        headers: makeHeaders(),
      }),
    ).resolves.toBeUndefined();
  });

  it("falls back to 'unknown' for missing IP / UA headers (logAudit requires non-empty)", async () => {
    const p = makePrisma({ existing: null });
    await logLoginOnce(p.client, makeSession("sid-empty"), {
      userDbId: "u-db-1",
      headers: new Headers(),
    });
    expect(p.create).toHaveBeenCalledTimes(1);
    const [args] = p.create.mock.calls;
    expect(args?.[0]?.data).toMatchObject({
      ipAddress: "unknown",
      userAgent: "unknown",
    });
  });

  it("skips entirely when session.internal.sid is missing (cannot dedup safely)", async () => {
    const p = makePrisma({ existing: null });
    const session = makeSession();
    (session as { internal: { sid?: string } }).internal = {};
    await logLoginOnce(p.client, session, {
      userDbId: "u-db-1",
      headers: makeHeaders(),
    });
    expect(p.findFirst).not.toHaveBeenCalled();
    expect(p.create).not.toHaveBeenCalled();
  });
});
