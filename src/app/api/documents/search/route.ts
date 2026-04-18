import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asDocumentSearchPrisma,
  parseDocumentSearchQuery,
  searchDocuments,
  type DocumentSearchScope,
} from "@/lib/document-search";
import { createRateLimiter } from "@/lib/rate-limit";
import { toJsonSafe, type JsonValue } from "@/lib/bigint";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

// 30 searches / 30s per authed user. Each call runs an ILIKE +
// aggregate count — tighter cap than read-only list endpoints to
// shield the DB from reload abuse.
const limiter = createRateLimiter({
  max: 30,
  windowMs: 30_000,
  prefix: "@helpucompli/documents-search",
});

function json(body: ApiResponse<JsonValue>, status: number, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  const role = await resolveRole(session);
  if (!role) return json({ data: null, error: "Forbidden" }, 403);

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await limiter.limit(`documents-search:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const options = parseDocumentSearchQuery(params);
  if (!options) return json({ data: null, error: "Invalid query" }, 400);

  let scope: DocumentSearchScope;
  if (role === "viewer") {
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    if (!dbUser) {
      // Viewer without a DB row has no UserBucketAccess — return an
      // empty page rather than 403 so first-login UX is "empty state"
      // not "permission error".
      return json(
        {
          data: toJsonSafe({
            documents: [],
            total: 0,
            page: options.page,
            pageSize: options.pageSize,
          }),
          error: null,
        },
        200,
      );
    }
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  try {
    const result = await searchDocuments(
      asDocumentSearchPrisma(prisma),
      scope,
      options,
    );
    return json({ data: toJsonSafe(result), error: null }, 200);
  } catch {
    // Engine errors can embed DATABASE_URL.
    return json({ data: null, error: "Failed to search documents" }, 500);
  }
}
