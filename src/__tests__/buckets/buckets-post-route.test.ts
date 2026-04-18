import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createBucketForTenant: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { upsert: mocks.upsertUser },
  },
}));

vi.mock("@/lib/bucket-create", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bucket-create")>(
      "@/lib/bucket-create",
    );
  return {
    ...actual,
    createBucketForTenant: mocks.createBucketForTenant,
  };
});

import { POST } from "@/app/api/s3/buckets/route";
import { NextRequest } from "next/server";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.createBucketForTenant.mockReset();
  mocks.upsertUser.mockReset();
});

function superadminSession(sub = "auth0|su") {
  return {
    user: {
      sub,
      email: "s@x.com",
      "https://docs.helpucompli.com/role": "superadmin",
    },
  };
}

function adminSession(sub = "auth0|a") {
  return {
    user: {
      sub,
      email: "a@x.com",
      "https://docs.helpucompli.com/role": "admin",
    },
  };
}

function viewerSession(sub = "auth0|v") {
  return {
    user: {
      sub,
      email: "v@x.com",
      "https://docs.helpucompli.com/role": "viewer",
    },
  };
}

function body(payload: Record<string, unknown>, headers?: Record<string, string>) {
  return new NextRequest("http://x/api/s3/buckets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.9",
      "user-agent": "vitest-ua/1.0",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

const VALID = {
  name: "helpucompli-docs-acme",
  awsRegion: "us-east-1",
  description: "primary",
};

describe("POST /api/s3/buckets", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await POST(body(VALID));
    expect(res.status).toBe(401);
    expect(mocks.createBucketForTenant).not.toHaveBeenCalled();
  });

  it("403 for admin — only superadmin can create buckets", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    const res = await POST(body(VALID));
    expect(res.status).toBe(403);
    expect(mocks.createBucketForTenant).not.toHaveBeenCalled();
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValueOnce(viewerSession());
    const res = await POST(body(VALID));
    expect(res.status).toBe(403);
  });

  it("415 when Content-Type is not application/json", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|ct"));
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-42" });
    const req = new NextRequest("http://x/api/s3/buckets", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(VALID),
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
    expect(mocks.createBucketForTenant).not.toHaveBeenCalled();
  });

  it("400 when body is not valid JSON", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|jb"));
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-42" });
    const req = new NextRequest("http://x/api/s3/buckets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400 when input fails Zod validation (bad bucket name)", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|bn"));
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-42" });
    const res = await POST(body({ ...VALID, name: "nope-no-prefix" }));
    expect(res.status).toBe(400);
    expect(mocks.createBucketForTenant).not.toHaveBeenCalled();
  });

  it("auto-provisions a User row on first superadmin create (no separate bootstrap step)", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|new"));
    // upsert returns the freshly-created row's id
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-fresh" });
    mocks.createBucketForTenant.mockResolvedValueOnce({
      id: "b-fresh",
      name: VALID.name,
      region: "us-east-1",
    });
    const res = await POST(body(VALID));
    expect(res.status).toBe(201);
    // upsert keyed by auth0Id from the session
    const arg = mocks.upsertUser.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ auth0Id: "auth0|new" });
    expect(arg.create).toMatchObject({
      auth0Id: "auth0|new",
      email: "s@x.com",
      role: "superadmin",
    });
    // createdBy threaded from the upsert-returned id
    const [, , , ctx] = mocks.createBucketForTenant.mock.calls[0] ?? [];
    expect(ctx.createdById).toBe("u-fresh");
  });

  it("201 + payload on success", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|ok"));
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-42" });
    mocks.createBucketForTenant.mockResolvedValueOnce({
      id: "b-new",
      name: VALID.name,
      region: "us-east-1",
    });
    const res = await POST(body(VALID));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: string; name: string };
      error: null;
    };
    expect(json.data).toEqual({
      id: "b-new",
      name: VALID.name,
      region: "us-east-1",
    });
  });

  it("forwards ipAddress + userAgent from headers into the ctx", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|hdr"));
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-42" });
    mocks.createBucketForTenant.mockResolvedValueOnce({
      id: "b-1",
      name: VALID.name,
      region: "us-east-1",
    });
    await POST(
      body(VALID, {
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "user-agent": "Mozilla/5.0 ua-test",
      }),
    );
    const [, , , ctx] = mocks.createBucketForTenant.mock.calls[0] ?? [];
    expect(ctx).toEqual({
      createdById: "u-42",
      // first hop of x-forwarded-for
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0 ua-test",
    });
  });

  it("falls back to 'unknown' when ip/ua headers are absent", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|noip"));
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-42" });
    mocks.createBucketForTenant.mockResolvedValueOnce({
      id: "b-1",
      name: VALID.name,
      region: "us-east-1",
    });
    // Build request without the header overrides.
    const req = new NextRequest("http://x/api/s3/buckets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID),
    });
    await POST(req);
    const [, , , ctx] = mocks.createBucketForTenant.mock.calls[0] ?? [];
    expect(ctx.ipAddress).toBe("unknown");
    expect(ctx.userAgent).toBe("unknown");
  });

  it("409 + specific error when DuplicateBucketNameError thrown", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|dup"));
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-42" });
    const { DuplicateBucketNameError } = await import("@/lib/bucket-create");
    mocks.createBucketForTenant.mockRejectedValueOnce(
      new DuplicateBucketNameError(VALID.name),
    );
    const res = await POST(body(VALID));
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string };
    expect(j.error).toMatch(/already exists/i);
  });

  it("500 + generic error on unknown failure; never leaks the raw error message", async () => {
    mocks.getSession.mockResolvedValueOnce(superadminSession("auth0|err"));
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-42" });
    mocks.createBucketForTenant.mockRejectedValueOnce(
      new Error("postgres://user:secret@host/db connection refused"),
    );
    const res = await POST(body(VALID));
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string };
    expect(j.error).not.toContain("secret");
    expect(j.error).not.toContain("postgres://");
  });

  it("429 after 5 create attempts in 60s for the same user", async () => {
    const sub = "auth0|rate-post";
    for (let i = 0; i < 5; i++) {
      mocks.getSession.mockResolvedValueOnce(superadminSession(sub));
      mocks.upsertUser.mockResolvedValueOnce({ id: "u-1" });
      mocks.createBucketForTenant.mockResolvedValueOnce({
        id: `b-${i}`,
        name: `${VALID.name}-${i}`,
        region: "us-east-1",
      });
      const ok = await POST(
        body({ ...VALID, name: `${VALID.name}-${i}` }),
      );
      expect(ok.status).toBe(201);
    }
    mocks.getSession.mockResolvedValueOnce(superadminSession(sub));
    const res = await POST(body(VALID));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});
