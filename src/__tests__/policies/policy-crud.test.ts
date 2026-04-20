import { describe, expect, it, vi } from "vitest";
import {
  createPolicy,
  updatePolicy,
  deletePolicy,
  getPolicy,
  PolicyNotFoundError,
  type PolicyCrudPrisma,
} from "@/lib/policy-crud";
import type { PolicyInput, PolicyUpdate } from "@/lib/policy-schema";

type AuditCalls = Array<Record<string, unknown>>;

function makeStub(opts: {
  existing?: Record<string, unknown> | null;
  createReturns?: Record<string, unknown>;
  updateReturns?: Record<string, unknown>;
} = {}) {
  const auditCalls: AuditCalls = [];
  const txCalls: number[] = [];
  const policyByMethod = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-id",
      ...data,
      ...opts.createReturns,
    })),
    findUnique: vi.fn(async () => opts.existing ?? null),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "existing-id",
      ...(opts.existing ?? {}),
      ...data,
      ...opts.updateReturns,
    })),
    delete: vi.fn(async () => opts.existing ?? null),
  };
  const auditLog = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      auditCalls.push(data);
      return { id: `audit-${auditCalls.length}` };
    }),
  };

  const tx = { accessPolicy: policyByMethod, auditLog };

  const client: PolicyCrudPrisma = {
    accessPolicy: policyByMethod,
    auditLog,
    $transaction: vi.fn(async (cb: (txClient: typeof tx) => Promise<unknown>) => {
      txCalls.push(1);
      return cb(tx);
    }),
  } as unknown as PolicyCrudPrisma;

  return { client, auditCalls, txCalls, policyByMethod, auditLog };
}

const ctx = {
  userId: "u-1",
  ipAddress: "10.0.0.1",
  userAgent: "vitest",
};

const VALID_INPUT: PolicyInput = {
  name: "Default",
  targetType: "bucket",
  targetValue: "helpucompli-prod",
  allowedDomains: ["example.com"],
  allowedIpRanges: ["10.0.0.0/8"],
  linkTtlSeconds: 900,
  maxDownloads: null,
  requireAuth: false,
};

describe("createPolicy", () => {
  it("inserts a policy + writes POLICY_CREATE audit row in a single transaction", async () => {
    const stub = makeStub();
    await createPolicy(stub.client, VALID_INPUT, ctx);
    expect(stub.txCalls).toHaveLength(1);
    expect(stub.policyByMethod.create).toHaveBeenCalledOnce();
    expect(stub.auditCalls).toHaveLength(1);
    expect(stub.auditCalls[0]).toMatchObject({
      action: "POLICY_CREATE",
      targetType: "policy",
      userId: "u-1",
      ipAddress: "10.0.0.1",
    });
  });

  it("persists createdById from ctx", async () => {
    const stub = makeStub();
    await createPolicy(stub.client, VALID_INPUT, ctx);
    const args = stub.policyByMethod.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.createdById).toBe("u-1");
  });

  it("includes input snapshot in audit metadata for forensic review", async () => {
    const stub = makeStub();
    await createPolicy(stub.client, VALID_INPUT, ctx);
    const meta = stub.auditCalls[0]?.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      name: "Default",
      targetType: "bucket",
      targetValue: "helpucompli-prod",
    });
  });
});

describe("updatePolicy", () => {
  it("404 (PolicyNotFoundError) when policy missing", async () => {
    const stub = makeStub({ existing: null });
    await expect(
      updatePolicy(stub.client, "missing", { name: "x" } as PolicyUpdate, ctx),
    ).rejects.toBeInstanceOf(PolicyNotFoundError);
    expect(stub.policyByMethod.update).not.toHaveBeenCalled();
    expect(stub.auditCalls).toHaveLength(0);
  });

  it("updates + writes POLICY_UPDATE audit with patch keys in metadata", async () => {
    const existing = { id: "p-1", name: "Old", linkTtlSeconds: 900 };
    const stub = makeStub({ existing });
    await updatePolicy(
      stub.client,
      "p-1",
      { name: "New", linkTtlSeconds: 3600 },
      ctx,
    );
    expect(stub.policyByMethod.update).toHaveBeenCalledOnce();
    expect(stub.auditCalls[0]).toMatchObject({
      action: "POLICY_UPDATE",
      targetId: "p-1",
    });
    const meta = stub.auditCalls[0]?.metadata as Record<string, unknown>;
    expect(meta.changedKeys).toEqual(["name", "linkTtlSeconds"]);
  });
});

describe("deletePolicy", () => {
  it("404 when missing", async () => {
    const stub = makeStub({ existing: null });
    await expect(
      deletePolicy(stub.client, "missing", ctx),
    ).rejects.toBeInstanceOf(PolicyNotFoundError);
    expect(stub.policyByMethod.delete).not.toHaveBeenCalled();
  });

  it("deletes + writes POLICY_DELETE audit", async () => {
    const existing = { id: "p-1", name: "Old" };
    const stub = makeStub({ existing });
    await deletePolicy(stub.client, "p-1", ctx);
    expect(stub.policyByMethod.delete).toHaveBeenCalledOnce();
    expect(stub.auditCalls[0]).toMatchObject({
      action: "POLICY_DELETE",
      targetId: "p-1",
    });
  });
});

describe("getPolicy", () => {
  it("returns policy", async () => {
    const stub = makeStub({ existing: { id: "p-1", name: "X" } });
    const result = await getPolicy(stub.client, "p-1");
    expect(result?.id).toBe("p-1");
  });

  it("returns null when not found", async () => {
    const stub = makeStub({ existing: null });
    const result = await getPolicy(stub.client, "missing");
    expect(result).toBeNull();
  });
});
