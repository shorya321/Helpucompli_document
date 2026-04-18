import { describe, expect, it, vi } from "vitest";
import { logAudit, type AuditPrisma } from "@/lib/audit";

type CreateArgs = { data: Record<string, unknown> };

function makeStub() {
  const calls: CreateArgs[] = [];
  const client: AuditPrisma = {
    auditLog: {
      create: vi.fn(async (args: CreateArgs) => {
        calls.push(args);
        return { id: "audit-1" };
      }),
    },
  };
  return { client, calls };
}

describe("logAudit", () => {
  it("writes an audit row with every required field", async () => {
    const stub = makeStub();
    await logAudit(stub.client, {
      userId: "u-1",
      action: "BUCKET_CREATE",
      targetType: "bucket",
      targetId: "b-1",
      ipAddress: "10.0.0.1",
      userAgent: "vitest/1.0",
    });
    const [args] = stub.calls;
    expect(args?.data).toMatchObject({
      userId: "u-1",
      action: "BUCKET_CREATE",
      targetType: "bucket",
      targetId: "b-1",
      ipAddress: "10.0.0.1",
      userAgent: "vitest/1.0",
    });
  });

  it("persists metadata verbatim when provided", async () => {
    const stub = makeStub();
    await logAudit(stub.client, {
      userId: "u-1",
      action: "BUCKET_CREATE",
      targetType: "bucket",
      targetId: "b-1",
      metadata: { region: "us-east-1", name: "helpucompli-docs-x" },
      ipAddress: "10.0.0.1",
      userAgent: "vitest/1.0",
    });
    expect(stub.calls[0]?.data.metadata).toEqual({
      region: "us-east-1",
      name: "helpucompli-docs-x",
    });
  });

  it("defaults metadata to {} when omitted (schema uses JSON null otherwise)", async () => {
    const stub = makeStub();
    await logAudit(stub.client, {
      userId: "u-1",
      action: "LOGIN",
      targetType: "user",
      targetId: "u-1",
      ipAddress: "10.0.0.1",
      userAgent: "vitest/1.0",
    });
    expect(stub.calls[0]?.data.metadata).toEqual({});
  });

  it("accepts userId=null (system-initiated events such as link auto-revoke)", async () => {
    const stub = makeStub();
    await logAudit(stub.client, {
      userId: null,
      action: "LINK_REVOKE",
      targetType: "link",
      targetId: "l-1",
      ipAddress: "unknown",
      userAgent: "unknown",
    });
    expect(stub.calls[0]?.data.userId).toBeNull();
  });

  it("rejects empty ipAddress to force callers to pass a fallback token", async () => {
    const stub = makeStub();
    await expect(
      logAudit(stub.client, {
        userId: "u-1",
        action: "BUCKET_CREATE",
        targetType: "bucket",
        targetId: "b-1",
        ipAddress: "",
        userAgent: "vitest/1.0",
      }),
    ).rejects.toThrow(/ipAddress/);
    expect(stub.calls).toHaveLength(0);
  });

  it("rejects empty userAgent to force callers to pass a fallback token", async () => {
    const stub = makeStub();
    await expect(
      logAudit(stub.client, {
        userId: "u-1",
        action: "BUCKET_CREATE",
        targetType: "bucket",
        targetId: "b-1",
        ipAddress: "10.0.0.1",
        userAgent: "",
      }),
    ).rejects.toThrow(/userAgent/);
    expect(stub.calls).toHaveLength(0);
  });

  it("truncates oversized userAgent at 512 chars (DB column is TEXT; guard against log-table abuse)", async () => {
    const stub = makeStub();
    const huge = "a".repeat(10_000);
    await logAudit(stub.client, {
      userId: "u-1",
      action: "BUCKET_CREATE",
      targetType: "bucket",
      targetId: "b-1",
      ipAddress: "10.0.0.1",
      userAgent: huge,
    });
    const ua = stub.calls[0]?.data.userAgent as string;
    expect(ua.length).toBeLessThanOrEqual(512);
  });
});
