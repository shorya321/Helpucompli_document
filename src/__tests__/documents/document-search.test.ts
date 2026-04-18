/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  documentSearchQuerySchema,
  parseDocumentSearchQuery,
  searchDocuments,
  type DocumentSearchPrisma,
} from "@/lib/document-search";

describe("documentSearchQuerySchema", () => {
  it("accepts empty payload — all defaults", () => {
    const parsed = documentSearchQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.page).toBe(1);
  });

  it("accepts complete query", () => {
    const r = documentSearchQuerySchema.safeParse({
      bucketId: "11111111-1111-1111-1111-111111111111",
      q: "report",
      contentType: "application/pdf",
      uploaderId: "22222222-2222-2222-2222-222222222222",
      from: "2026-01-01",
      to: "2026-12-31",
      sort: "uploadedAt",
      dir: "desc",
      page: 2,
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-UUID bucketId", () => {
    expect(
      documentSearchQuerySchema.safeParse({ bucketId: "nope" }).success,
    ).toBe(false);
  });

  it("rejects unknown sort field", () => {
    expect(
      documentSearchQuerySchema.safeParse({ sort: "hacked" }).success,
    ).toBe(false);
  });

  it("rejects bad date formats", () => {
    expect(
      documentSearchQuerySchema.safeParse({ from: "yesterday" }).success,
    ).toBe(false);
  });

  it("clamps page to >= 1", () => {
    expect(
      documentSearchQuerySchema.safeParse({ page: 0 }).success,
    ).toBe(false);
  });
});

describe("parseDocumentSearchQuery", () => {
  it("reads URL-style string record", () => {
    const q = parseDocumentSearchQuery({
      q: "foo",
      page: "3",
      sort: "filename",
      dir: "asc",
    });
    expect(q?.q).toBe("foo");
    expect(q?.page).toBe(3);
    expect(q?.sort).toBe("filename");
  });

  it("returns null on invalid input", () => {
    const q = parseDocumentSearchQuery({ page: "nope" });
    expect(q).toBeNull();
  });

  it("picks first array value", () => {
    const q = parseDocumentSearchQuery({ q: ["a", "b"] as unknown as string });
    expect(q?.q).toBe("a");
  });
});

describe("searchDocuments", () => {
  const baseRow = {
    id: "d1",
    bucketId: "b1",
    s3Key: "abc-file.pdf",
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: BigInt(2048),
    uploadedAt: new Date("2026-04-10T00:00:00Z"),
    uploadedBy: { id: "u1", name: "Alice", email: "a@x.com" },
    isDeleted: false,
  };

  function fakePrisma(
    rows: typeof baseRow[],
    total?: number,
  ): DocumentSearchPrisma {
    return {
      document: {
        findMany: vi.fn().mockResolvedValue(rows),
        count: vi.fn().mockResolvedValue(total ?? rows.length),
      },
    };
  }

  it("returns hits + total count", async () => {
    const prisma = fakePrisma([baseRow], 1);
    const res = await searchDocuments(
      prisma,
      { role: "superadmin" },
      { q: "" },
    );
    expect(res.documents).toHaveLength(1);
    expect(res.total).toBe(1);
  });

  it("viewer scope applies UserBucketAccess filter", async () => {
    const prisma = fakePrisma([]);
    await searchDocuments(
      prisma,
      { role: "viewer", userId: "u1" },
      { q: "" },
    );
    const call = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as {
      where: {
        bucket: { userAccess: { some: { userId: string } } };
      };
    };
    expect(call.where.bucket.userAccess.some.userId).toBe("u1");
  });

  it("filters by bucketId when provided", async () => {
    const prisma = fakePrisma([]);
    await searchDocuments(
      prisma,
      { role: "superadmin" },
      { bucketId: "b1" },
    );
    const call = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { where: { bucketId?: string } };
    expect(call.where.bucketId).toBe("b1");
  });

  it("filters by contentType when provided", async () => {
    const prisma = fakePrisma([]);
    await searchDocuments(
      prisma,
      { role: "superadmin" },
      { contentType: "application/pdf" },
    );
    const call = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { where: { contentType?: string } };
    expect(call.where.contentType).toBe("application/pdf");
  });

  it("filters by date range when provided", async () => {
    const prisma = fakePrisma([]);
    await searchDocuments(
      prisma,
      { role: "superadmin" },
      { from: "2026-01-01", to: "2026-06-30" },
    );
    const call = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { where: { uploadedAt?: { gte?: Date; lte?: Date } } };
    expect(call.where.uploadedAt?.gte?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(call.where.uploadedAt?.lte?.toISOString()).toBe(
      "2026-06-30T23:59:59.999Z",
    );
  });

  it("excludes soft-deleted by default", async () => {
    const prisma = fakePrisma([]);
    await searchDocuments(prisma, { role: "superadmin" }, {});
    const call = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { where: { isDeleted?: boolean } };
    expect(call.where.isDeleted).toBe(false);
  });

  it("q filters by contains-insensitive on filename", async () => {
    const prisma = fakePrisma([]);
    await searchDocuments(prisma, { role: "superadmin" }, { q: "Report" });
    const call = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as {
      where: {
        filename?: { contains: string; mode: string };
      };
    };
    expect(call.where.filename?.contains).toBe("Report");
    expect(call.where.filename?.mode).toBe("insensitive");
  });

  it("pagination translates page to skip/take", async () => {
    const prisma = fakePrisma([]);
    await searchDocuments(
      prisma,
      { role: "superadmin" },
      { page: 3, pageSize: 10 },
    );
    const call = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { skip: number; take: number };
    expect(call.skip).toBe(20);
    expect(call.take).toBe(10);
  });

  it("sort defaults to uploadedAt desc", async () => {
    const prisma = fakePrisma([]);
    await searchDocuments(prisma, { role: "superadmin" }, {});
    const call = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { orderBy: { uploadedAt?: string } };
    expect(call.orderBy.uploadedAt).toBe("desc");
  });
});
