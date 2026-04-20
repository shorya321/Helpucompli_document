import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
  ensureUser: vi.fn(),
  findLink: vi.fn(),
  updateLink: vi.fn(),
  auditCreate: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
  resolveRole: mocks.resolveRole,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    generatedLink: {
      findUnique: mocks.findLink,
      update: mocks.updateLink,
    },
    auditLog: { create: mocks.auditCreate },
  },
}));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

import { DELETE } from "@/app/api/links/[hash]/route";
import { NextRequest } from "next/server";

const ok = { success: true, reset: Date.now() + 30_000 };
const adminSession = () => ({ user: { sub: "auth0|a" } });
const params = (hash: string) => Promise.resolve({ hash });
const TOKEN = "tok_abc_with_long_enough_token_value_xyz";

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

beforeEach(() => {
  mocks.limit.mockResolvedValue(ok);
});

function req() {
  return new NextRequest(`http://x/api/links/${TOKEN}`, { method: "DELETE" });
}

describe("DELETE /api/links/[hash]", () => {
  it("401 unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await DELETE(req(), { params: params(TOKEN) });
    expect(res.status).toBe(401);
  });

  it("403 non-admin", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await DELETE(req(), { params: params(TOKEN) });
    expect(res.status).toBe(403);
    expect(mocks.updateLink).not.toHaveBeenCalled();
  });

  it("400 malformed token", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    const res = await DELETE(req(), { params: params("short") });
    expect(res.status).toBe(400);
  });

  it("404 when link missing", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce(null);
    const res = await DELETE(req(), { params: params(TOKEN) });
    expect(res.status).toBe(404);
    expect(mocks.updateLink).not.toHaveBeenCalled();
  });

  it("204 success — sets isRevoked=true and writes LINK_REVOKE audit", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: "link-1",
      documentId: "d-1",
      policyId: null,
      isRevoked: false,
    });
    mocks.updateLink.mockResolvedValueOnce({});
    const res = await DELETE(req(), { params: params(TOKEN) });
    expect(res.status).toBe(204);
    expect(mocks.updateLink).toHaveBeenCalledOnce();
    const args = mocks.updateLink.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.data.isRevoked).toBe(true);
    expect(mocks.auditCreate.mock.calls[0]?.[0].data.action).toBe(
      "LINK_REVOKE",
    );
  });

  it("idempotent — already revoked returns 204 without writing audit again", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: "link-1",
      documentId: "d-1",
      policyId: null,
      isRevoked: true,
    });
    const res = await DELETE(req(), { params: params(TOKEN) });
    expect(res.status).toBe(204);
    expect(mocks.updateLink).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
