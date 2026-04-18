import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  upsertUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  createFolderMarker: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bucket: { findUnique: mocks.findUniqueBucket },
    user: { upsert: mocks.upsertUser },
    userBucketAccess: { findFirst: mocks.findFirstBucketAccess },
    auditLog: { create: mocks.auditLogCreate },
  },
}));

vi.mock("@/lib/s3-folders", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-folders")>("@/lib/s3-folders");
  return { ...actual, createFolderMarker: mocks.createFolderMarker };
});

import { POST } from "@/app/api/s3/folders/route";
import { NextRequest } from "next/server";

afterEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

const BUCKET_ID = "11111111-1111-1111-1111-111111111111";

function superadmin() {
  return {
    user: {
      sub: `auth0|su-${Math.random().toString(36).slice(2)}`,
      email: "s@x.com",
      "https://docs.helpucompli.com/role": "superadmin",
    },
  };
}
function admin() {
  return {
    user: {
      sub: `auth0|a-${Math.random().toString(36).slice(2)}`,
      email: "a@x.com",
      "https://docs.helpucompli.com/role": "admin",
    },
  };
}
function viewer() {
  return {
    user: {
      sub: `auth0|v-${Math.random().toString(36).slice(2)}`,
      email: "v@x.com",
      "https://docs.helpucompli.com/role": "viewer",
    },
  };
}

const validBody = {
  bucketId: BUCKET_ID,
  parentPrefix: "",
  name: "invoices",
};

function req(payload: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://x/api/s3/folders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.2",
      "user-agent": "vitest-ua/1.0",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("POST /api/s3/folders", () => {
  it("401 without session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("415 non-JSON", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req(validBody, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("400 schema fail (bad name)", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req({ ...validBody, name: "has/slash" }));
    expect(res.status).toBe(400);
  });

  it("400 on invalid parentPrefix (traversal)", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req({ ...validBody, parentPrefix: "a/../b/" }));
    expect(res.status).toBe(400);
  });

  it("404 when bucket missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
  });

  it("409 when bucket inactive", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: false,
    });
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
  });

  it("403 when admin lacks UserBucketAccess", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("201 creates marker + DOCUMENT_UPLOAD audit with folder_marker mode", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.createFolderMarker.mockResolvedValue({ key: "invoices/" });
    mocks.auditLogCreate.mockResolvedValue({});
    const res = await POST(req(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.key).toBe("invoices/");
    expect(mocks.createFolderMarker).toHaveBeenCalledWith({
      bucket: "helpucompli-docs-acme",
      parentPrefix: "",
      name: "invoices",
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: {
        action: string;
        targetType: string;
        targetId: string;
        metadata: { mode: string };
      };
    };
    expect(audit.data.action).toBe("DOCUMENT_UPLOAD");
    expect(audit.data.targetType).toBe("folder");
    expect(audit.data.targetId).toBe("invoices/");
    expect(audit.data.metadata.mode).toBe("folder_marker");
  });

  it("admin with access can create nested folder", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-a" });
    mocks.createFolderMarker.mockResolvedValue({ key: "invoices/2026/q2/" });
    mocks.auditLogCreate.mockResolvedValue({});
    const res = await POST(
      req({
        bucketId: BUCKET_ID,
        parentPrefix: "invoices/2026/",
        name: "q2",
      }),
    );
    expect(res.status).toBe(201);
  });

  it("500 generic on S3 throw (no engine leak)", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.createFolderMarker.mockRejectedValue(
      new Error("arn:aws:kms:leak DATABASE_URL=x"),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });
});
