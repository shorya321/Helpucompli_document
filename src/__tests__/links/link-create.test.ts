import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLink,
  generateLinkToken,
  resolveEffectiveSettings,
  DocumentNotFoundError,
  PerpetualLinkForbiddenError,
  PolicyMismatchError,
  type LinkCreatePrisma,
  type LinkCreateInput,
} from "@/lib/link-create";

// ---------------------------------------------------------------------------
// generateLinkToken
// ---------------------------------------------------------------------------
describe("generateLinkToken", () => {
  it("returns a base64url string of length ≥ 43 (256 bits of entropy)", () => {
    const token = generateLinkToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats across many invocations (entropy guard)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateLinkToken());
    expect(seen.size).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveSettings — TTL + maxDownloads precedence
// ---------------------------------------------------------------------------
describe("resolveEffectiveSettings", () => {
  it("uses default TTL (900) when no policy and no override", () => {
    const r = resolveEffectiveSettings({
      policy: null,
      ttlOverride: null,
      maxDownloadsOverride: null,
    });
    expect(r.ttlSeconds).toBe(900);
    expect(r.maxDownloads).toBeNull();
  });

  it("uses policy TTL when no override", () => {
    const r = resolveEffectiveSettings({
      policy: {
        linkTtlSeconds: 3600,
        maxDownloads: 10,
      },
      ttlOverride: null,
      maxDownloadsOverride: null,
    });
    expect(r.ttlSeconds).toBe(3600);
    expect(r.maxDownloads).toBe(10);
  });

  it("override clamps to policy TTL ceiling (cannot extend beyond policy)", () => {
    const r = resolveEffectiveSettings({
      policy: { linkTtlSeconds: 3600, maxDownloads: null },
      ttlOverride: 86_400,
      maxDownloadsOverride: null,
    });
    expect(r.ttlSeconds).toBe(3600);
  });

  it("override may shorten TTL below policy", () => {
    const r = resolveEffectiveSettings({
      policy: { linkTtlSeconds: 3600, maxDownloads: null },
      ttlOverride: 900,
      maxDownloadsOverride: null,
    });
    expect(r.ttlSeconds).toBe(900);
  });

  it("override TTL is clamped to global [60, 604800] range", () => {
    expect(
      resolveEffectiveSettings({
        policy: null,
        ttlOverride: 1,
        maxDownloadsOverride: null,
      }).ttlSeconds,
    ).toBe(60);
    expect(
      resolveEffectiveSettings({
        policy: null,
        ttlOverride: 9_999_999,
        maxDownloadsOverride: null,
      }).ttlSeconds,
    ).toBe(604_800);
  });

  it("maxDownloads override clamps to policy ceiling when policy sets it", () => {
    const r = resolveEffectiveSettings({
      policy: { linkTtlSeconds: 900, maxDownloads: 5 },
      ttlOverride: null,
      maxDownloadsOverride: 100,
    });
    expect(r.maxDownloads).toBe(5);
  });

  it("maxDownloads override may shorten below policy", () => {
    const r = resolveEffectiveSettings({
      policy: { linkTtlSeconds: 900, maxDownloads: 50 },
      ttlOverride: null,
      maxDownloadsOverride: 3,
    });
    expect(r.maxDownloads).toBe(3);
  });

  it("maxDownloads override sets a finite cap when policy has none", () => {
    const r = resolveEffectiveSettings({
      policy: { linkTtlSeconds: 900, maxDownloads: null },
      ttlOverride: null,
      maxDownloadsOverride: 10,
    });
    expect(r.maxDownloads).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// createLink
// ---------------------------------------------------------------------------
type Tx = {
  document: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  accessPolicy: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  generatedLink: {
    create: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
};

function makeStub(opts: {
  document?: Record<string, unknown> | null;
  policy?: Record<string, unknown> | null;
  // Rows returned by accessPolicy.findMany during the inheritance
  // fallback branch (policyId=null). Default = [] (no inherited policy)
  // so existing tests preserve the legacy "policy=null → unlimited"
  // shape they were written against.
  inheritedRows?: Array<Record<string, unknown>>;
} = {}) {
  const audit: Record<string, unknown>[] = [];
  const tx: Tx = {
    document: {
      findUnique: vi.fn(async () => opts.document ?? null),
    },
    accessPolicy: {
      findUnique: vi.fn(async () => opts.policy ?? null),
      findMany: vi.fn(async () => opts.inheritedRows ?? []),
    },
    generatedLink: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "link-1",
        ...data,
      })),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return { id: `a-${audit.length}` };
      }),
    },
  };
  const client: LinkCreatePrisma = {
    document: tx.document,
    accessPolicy: tx.accessPolicy,
    generatedLink: tx.generatedLink,
    auditLog: tx.auditLog,
    $transaction: vi.fn(async (cb: (t: Tx) => Promise<unknown>) => cb(tx)),
  } as unknown as LinkCreatePrisma;
  return { client, tx, audit };
}

const ctx = {
  userId: "u-1",
  ipAddress: "10.0.0.1",
  userAgent: "vitest",
};

const baseInput: LinkCreateInput = {
  documentId: "11111111-1111-4111-8111-111111111111",
  policyId: null,
  ttlSecondsOverride: null,
  maxDownloadsOverride: null,
};

const baseDoc = {
  id: baseInput.documentId,
  s3Key: "shared/contract.pdf",
  isDeleted: false,
  bucket: { name: "alpha-bucket" },
};

describe("createLink", () => {
  it("404s (DocumentNotFoundError) when document missing", async () => {
    const stub = makeStub({ document: null });
    await expect(createLink(stub.client, baseInput, ctx)).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
    expect(stub.tx.generatedLink.create).not.toHaveBeenCalled();
  });

  it("404s when document soft-deleted", async () => {
    const stub = makeStub({ document: { ...baseDoc, isDeleted: true } });
    await expect(createLink(stub.client, baseInput, ctx)).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
  });

  it("inserts link + audit in single transaction", async () => {
    const stub = makeStub({ document: baseDoc });
    await createLink(stub.client, baseInput, ctx);
    expect(stub.tx.generatedLink.create).toHaveBeenCalledOnce();
    expect(stub.audit).toHaveLength(1);
    expect(stub.audit[0]).toMatchObject({
      action: "LINK_GENERATE",
      targetType: "link",
      userId: "u-1",
      ipAddress: "10.0.0.1",
    });
  });

  it("computes expiresAt = now + ttl", async () => {
    const stub = makeStub({ document: baseDoc });
    const before = Date.now();
    const result = await createLink(
      stub.client,
      { ...baseInput, ttlSecondsOverride: 900 },
      ctx,
    );
    const expected = before + 900_000;
    expect(result.expiresAt).not.toBeNull();
    expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(expected - 1000);
    expect(result.expiresAt!.getTime()).toBeLessThanOrEqual(expected + 5000);
  });

  it("rejects when policyId provided but policy missing", async () => {
    const stub = makeStub({ document: baseDoc, policy: null });
    await expect(
      createLink(stub.client, { ...baseInput, policyId: "p-1" }, ctx),
    ).rejects.toBeInstanceOf(PolicyMismatchError);
  });

  it("uses policy.linkTtlSeconds when no override", async () => {
    const stub = makeStub({
      document: baseDoc,
      policy: { id: "p-1", linkTtlSeconds: 3600, maxDownloads: 5 },
    });
    const result = await createLink(
      stub.client,
      { ...baseInput, policyId: "p-1" },
      ctx,
    );
    expect(result.ttlSeconds).toBe(3600);
    expect(result.maxDownloads).toBe(5);
  });

  it("returned token is the base64url hash stored in row.presignedUrlHash", async () => {
    const stub = makeStub({ document: baseDoc });
    const result = await createLink(stub.client, baseInput, ctx);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    const args = stub.tx.generatedLink.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.presignedUrlHash).toBe(result.token);
  });

  it("neverExpires=true stores expiresAt=null and ignores TTL override", async () => {
    const stub = makeStub({ document: baseDoc });
    const result = await createLink(
      stub.client,
      { ...baseInput, neverExpires: true, ttlSecondsOverride: 900 },
      ctx,
    );
    expect(result.expiresAt).toBeNull();
    expect(result.ttlSeconds).toBeNull();
    const args = stub.tx.generatedLink.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.expiresAt).toBeNull();
  });

  it("neverExpires=true records neverExpires + null fields in audit metadata", async () => {
    const stub = makeStub({ document: baseDoc });
    await createLink(
      stub.client,
      { ...baseInput, neverExpires: true },
      ctx,
    );
    const meta = stub.audit[0]?.metadata as Record<string, unknown>;
    expect(meta.neverExpires).toBe(true);
    expect(meta.ttlSeconds).toBeNull();
    expect(meta.expiresAt).toBeNull();
  });

  it("allowPublicEmbed defaults to false in row + audit when not provided (regression guard)", async () => {
    const stub = makeStub({ document: baseDoc });
    const result = await createLink(stub.client, baseInput, ctx);
    expect(result.allowPublicEmbed).toBe(false);
    const args = stub.tx.generatedLink.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.allowPublicEmbed).toBe(false);
    const meta = stub.audit[0]?.metadata as Record<string, unknown>;
    expect(meta.allowPublicEmbed).toBe(false);
  });

  it("allowPublicEmbed=true persists on row + records in audit metadata", async () => {
    const stub = makeStub({ document: baseDoc });
    const result = await createLink(
      stub.client,
      { ...baseInput, allowPublicEmbed: true },
      ctx,
    );
    expect(result.allowPublicEmbed).toBe(true);
    const args = stub.tx.generatedLink.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.allowPublicEmbed).toBe(true);
    const meta = stub.audit[0]?.metadata as Record<string, unknown>;
    expect(meta.allowPublicEmbed).toBe(true);
  });

  it("resolveEffectiveSettings: null policy TTL + null override → ttlSeconds null (perpetual)", () => {
    const r = resolveEffectiveSettings({
      policy: { linkTtlSeconds: null, maxDownloads: 10 },
      ttlOverride: null,
      maxDownloadsOverride: null,
    });
    expect(r.ttlSeconds).toBeNull();
    expect(r.maxDownloads).toBe(10);
  });

  it("resolveEffectiveSettings: null policy TTL + finite override → override wins (clamped to global max)", () => {
    const r = resolveEffectiveSettings({
      policy: { linkTtlSeconds: null, maxDownloads: null },
      ttlOverride: 900,
      maxDownloadsOverride: null,
    });
    expect(r.ttlSeconds).toBe(900);
  });

  it("createLink with policy.linkTtlSeconds=null + no override + non-superadmin → PerpetualLinkForbiddenError", async () => {
    const stub = makeStub({
      document: baseDoc,
      policy: { id: "p-1", linkTtlSeconds: null, maxDownloads: null },
    });
    await expect(
      createLink(
        stub.client,
        { ...baseInput, policyId: "p-1" },
        { ...ctx, callerRole: "admin" },
      ),
    ).rejects.toBeInstanceOf(PerpetualLinkForbiddenError);
    expect(stub.tx.generatedLink.create).not.toHaveBeenCalled();
  });

  it("createLink with policy.linkTtlSeconds=null + no override + superadmin → perpetual link OK", async () => {
    const stub = makeStub({
      document: baseDoc,
      policy: { id: "p-1", linkTtlSeconds: null, maxDownloads: null },
    });
    const result = await createLink(
      stub.client,
      { ...baseInput, policyId: "p-1" },
      { ...ctx, callerRole: "superadmin" },
    );
    expect(result.expiresAt).toBeNull();
    expect(result.ttlSeconds).toBeNull();
  });

  it("createLink with null policy TTL + finite override by admin → OK (resolved TTL is finite)", async () => {
    const stub = makeStub({
      document: baseDoc,
      policy: { id: "p-1", linkTtlSeconds: null, maxDownloads: null },
    });
    const result = await createLink(
      stub.client,
      { ...baseInput, policyId: "p-1", ttlSecondsOverride: 900 },
      { ...ctx, callerRole: "admin" },
    );
    expect(result.expiresAt).not.toBeNull();
    expect(result.ttlSeconds).toBe(900);
  });

  it("policyId=null with bucket-inherited policy snapshots maxDownloads from inheritance", async () => {
    // Reproduces the user-reported bug: policy created without max,
    // edited later to set maxDownloads=3. Prior to the fix, the link
    // generated with the default "Use inherited policy" option captured
    // null cap and downloaded unlimited times.
    const stub = makeStub({
      document: baseDoc,
      inheritedRows: [
        {
          id: "p-bucket",
          targetType: "bucket",
          targetValue: "alpha-bucket",
          allowedDomains: [],
          allowedIpRanges: [],
          linkTtlSeconds: 900,
          maxDownloads: 3,
          requireAuth: false,
        },
      ],
    });
    const result = await createLink(stub.client, baseInput, ctx);
    expect(result.maxDownloads).toBe(3);
    const args = stub.tx.generatedLink.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.maxDownloads).toBe(3);
    const meta = stub.audit[0]?.metadata as Record<string, unknown>;
    expect(meta.resolvedPolicyId).toBe("p-bucket");
  });

  it("policyId=null with no inherited policy keeps maxDownloads=null (legacy unlimited path)", async () => {
    const stub = makeStub({ document: baseDoc, inheritedRows: [] });
    const result = await createLink(stub.client, baseInput, ctx);
    expect(result.maxDownloads).toBeNull();
    const meta = stub.audit[0]?.metadata as Record<string, unknown>;
    expect(meta.resolvedPolicyId).toBeNull();
  });

  it("policyId=null with inherited policy + maxDownloadsOverride clamps to inherited cap", async () => {
    const stub = makeStub({
      document: baseDoc,
      inheritedRows: [
        {
          id: "p-bucket",
          targetType: "bucket",
          targetValue: "alpha-bucket",
          allowedDomains: [],
          allowedIpRanges: [],
          linkTtlSeconds: 900,
          maxDownloads: 3,
          requireAuth: false,
        },
      ],
    });
    const result = await createLink(
      stub.client,
      { ...baseInput, maxDownloadsOverride: 100 },
      ctx,
    );
    expect(result.maxDownloads).toBe(3);
  });

  it("explicit policyId branch is unaffected by inheritance fallback", async () => {
    // Regression guard: explicit-policy path must NOT call findMany.
    const stub = makeStub({
      document: baseDoc,
      policy: { id: "p-1", linkTtlSeconds: 900, maxDownloads: 7 },
    });
    const result = await createLink(
      stub.client,
      { ...baseInput, policyId: "p-1" },
      ctx,
    );
    expect(result.maxDownloads).toBe(7);
    expect(stub.tx.accessPolicy.findMany).not.toHaveBeenCalled();
  });

  it("audit metadata includes documentId + policyId for forensic review", async () => {
    const stub = makeStub({
      document: baseDoc,
      policy: { id: "p-1", linkTtlSeconds: 900, maxDownloads: null },
    });
    await createLink(stub.client, { ...baseInput, policyId: "p-1" }, ctx);
    const meta = stub.audit[0]?.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      documentId: baseInput.documentId,
      policyId: "p-1",
    });
    // Token MUST NOT be logged — it is a bearer token.
    expect(JSON.stringify(meta)).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });
});

afterEach(() => vi.restoreAllMocks());
