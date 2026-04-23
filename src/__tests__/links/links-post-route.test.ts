import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
  ensureUser: vi.fn(),
  createLink: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
  resolveRole: mocks.resolveRole,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/link-create", async () => {
  const actual = await vi.importActual<typeof import("@/lib/link-create")>(
    "@/lib/link-create",
  );
  return { ...actual, createLink: mocks.createLink };
});
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

import { POST } from "@/app/api/links/route";
import { NextRequest } from "next/server";
import {
  DocumentNotFoundError,
  PolicyMismatchError,
} from "@/lib/link-create";

const ok = { success: true, reset: Date.now() + 30_000 };
const adminSession = () => ({ user: { sub: "auth0|a" } });

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

const VALID_BODY = {
  documentId: "11111111-1111-4111-8111-111111111111",
  policyId: null,
  ttlSecondsOverride: null,
  maxDownloadsOverride: null,
};

function jsonReq(body: unknown, hdrs: Record<string, string> = {}) {
  return new NextRequest("http://x/api/links", {
    method: "POST",
    headers: { "content-type": "application/json", ...hdrs },
    body: JSON.stringify(body),
  });
}

describe("POST /api/links", () => {
  it("401 unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("403 non-admin", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it("415 non-JSON content-type", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const req = new NextRequest("http://x/api/links", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("400 invalid JSON", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const req = new NextRequest("http://x/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400 invalid documentId (not uuid)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await POST(jsonReq({ ...VALID_BODY, documentId: "x" }));
    expect(res.status).toBe(400);
  });

  it("404 when document not found", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.createLink.mockRejectedValueOnce(
      new DocumentNotFoundError(VALID_BODY.documentId),
    );
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it("404 when policy not found", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.createLink.mockRejectedValueOnce(new PolicyMismatchError("p-x"));
    const res = await POST(
      jsonReq({
        ...VALID_BODY,
        policyId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("201 returns token + shareableUrl + expiresAt", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    const expiresAt = new Date(Date.now() + 900_000);
    mocks.createLink.mockResolvedValueOnce({
      id: "link-1",
      token: "abcDEF123_-",
      expiresAt,
      ttlSeconds: 900,
      maxDownloads: null,
    });
    const req = new NextRequest("http://docs.helpucompli.com/api/links", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4",
        "user-agent": "TestBot",
      },
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        id: string;
        token: string;
        shareableUrl: string;
        expiresAt: string;
      };
    };
    expect(body.data.token).toBe("abcDEF123_-");
    // shareableUrl host derives from APP_BASE_URL (stubbed in
    // vitest.setup.ts), NOT from the request origin — that was the
    // 0.0.0.0:3000 prod bug.
    expect(body.data.shareableUrl).toBe(
      "http://localhost:3000/api/links/abcDEF123_-",
    );
    expect(new Date(body.data.expiresAt).getTime()).toBe(expiresAt.getTime());

    const ctx = mocks.createLink.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(ctx.userId).toBe("u-1");
    expect(ctx.ipAddress).toBe("1.2.3.4");
    expect(ctx.userAgent).toBe("TestBot");
  });

  it("403 when admin (non-superadmin) requests neverExpires=true", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await POST(jsonReq({ ...VALID_BODY, neverExpires: true }));
    expect(res.status).toBe(403);
    expect(mocks.createLink).not.toHaveBeenCalled();
  });

  it("201 with expiresAt=null when superadmin requests neverExpires=true", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-s" });
    mocks.createLink.mockResolvedValueOnce({
      id: "link-2",
      token: "tokNoExpire",
      expiresAt: null,
      ttlSeconds: null,
      maxDownloads: null,
    });
    const res = await POST(
      jsonReq({ ...VALID_BODY, neverExpires: true }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { expiresAt: string | null; ttlSeconds: number | null };
    };
    expect(body.data.expiresAt).toBeNull();
    expect(body.data.ttlSeconds).toBeNull();
  });

  it("429 rate limit", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 5000,
    });
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(429);
  });

  it("500 generic on unexpected error (no DB URL leak)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.createLink.mockRejectedValueOnce(
      new Error("postgresql://user:pw@host failed"),
    );
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/postgres|@|pw/i);
  });
});
