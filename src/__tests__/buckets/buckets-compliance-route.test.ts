import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkBucketCompliance: vi.fn(),
  findUniqueBucket: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bucket: { findUnique: mocks.findUniqueBucket },
  },
}));

vi.mock("@/lib/bucket-compliance", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bucket-compliance")>(
      "@/lib/bucket-compliance",
    );
  return {
    ...actual,
    checkBucketCompliance: mocks.checkBucketCompliance,
  };
});

import { GET } from "@/app/api/s3/buckets/[id]/compliance/route";
import { NextRequest } from "next/server";

function req(id = "b-1") {
  return new NextRequest(`http://x/api/s3/buckets/${id}/compliance`);
}

function ctx(id = "b-1") {
  return { params: Promise.resolve({ id }) };
}

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.checkBucketCompliance.mockReset();
  mocks.findUniqueBucket.mockReset();
});

function session(role: string, sub = "auth0|x") {
  return {
    user: {
      sub,
      email: "x@x.com",
      "https://docs.helpucompli.com/role": role,
    },
  };
}

const REPORT = {
  bucketName: "helpucompli-docs-acme",
  compliant: true,
  sseKms: { ok: true, algorithm: "aws:kms", bucketKeyEnabled: true },
  versioning: { ok: true, status: "Enabled" },
  publicAccessBlock: {
    ok: true,
    blockPublicAcls: true,
    ignorePublicAcls: true,
    blockPublicPolicy: true,
    restrictPublicBuckets: true,
  },
  httpsOnlyPolicy: {
    ok: true,
    denyNonHttpsPresent: true,
    denyTlsBelow12Present: true,
  },
  checkedAt: new Date("2026-04-18T12:00:00Z"),
};

describe("GET /api/s3/buckets/[id]/compliance", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("403 for viewer — compliance drift is admin+ info", async () => {
    mocks.getSession.mockResolvedValueOnce(session("viewer"));
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
    expect(mocks.checkBucketCompliance).not.toHaveBeenCalled();
  });

  it("400 on oversized id", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin"));
    const long = "a".repeat(200);
    const res = await GET(req(long), ctx(long));
    expect(res.status).toBe(400);
  });

  it("404 when bucket not found", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin"));
    mocks.findUniqueBucket.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(mocks.checkBucketCompliance).not.toHaveBeenCalled();
  });

  it("200 + report for admin", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin"));
    mocks.findUniqueBucket.mockResolvedValueOnce({
      name: "helpucompli-docs-acme",
    });
    mocks.checkBucketCompliance.mockResolvedValueOnce(REPORT);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { compliant: boolean; bucketName: string };
    };
    expect(body.data.compliant).toBe(true);
    expect(body.data.bucketName).toBe("helpucompli-docs-acme");
  });

  it("passes the DB-stored bucket name (not the url-provided id) to the compliance runner", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin"));
    mocks.findUniqueBucket.mockResolvedValueOnce({
      name: "helpucompli-docs-real",
    });
    mocks.checkBucketCompliance.mockResolvedValueOnce({
      ...REPORT,
      bucketName: "helpucompli-docs-real",
    });
    await GET(req("b-id-not-a-name"), ctx("b-id-not-a-name"));
    const callArgs = mocks.checkBucketCompliance.mock.calls[0];
    expect(callArgs?.[1]).toBe("helpucompli-docs-real");
  });

  it("429 after 10 compliance checks in 60s for the same user (AWS API quota shielding)", async () => {
    const sub = "auth0|rate-comp";
    for (let i = 0; i < 10; i++) {
      mocks.getSession.mockResolvedValueOnce(session("admin", sub));
      mocks.findUniqueBucket.mockResolvedValueOnce({
        name: "helpucompli-docs-x",
      });
      mocks.checkBucketCompliance.mockResolvedValueOnce(REPORT);
      const ok = await GET(req(), ctx());
      expect(ok.status).toBe(200);
    }
    mocks.getSession.mockResolvedValueOnce(session("admin", sub));
    const res = await GET(req(), ctx());
    expect(res.status).toBe(429);
  });

  it("500 + generic error; never leaks raw AWS error", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin", "auth0|err"));
    mocks.findUniqueBucket.mockResolvedValueOnce({
      name: "helpucompli-docs-err",
    });
    mocks.checkBucketCompliance.mockRejectedValueOnce(
      new Error("AccessDenied on arn:aws:iam::123456789012:user/alice"),
    );
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("123456789012");
    expect(body.error).not.toContain("arn:aws");
  });
});
