import { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  checkBucketCompliance,
  defaultComplianceRunner,
} from "@/lib/bucket-compliance";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Compliance check hits 4 live AWS APIs per invocation — tight cap
// (10/60s per sub) shields the AWS request budget from reload-abuse.
const limiter = createRateLimiter({
  max: 10,
  windowMs: 60_000,
  prefix: "@helpucompli/s3-buckets-compliance",
});

const idSchema = z.string().min(1).max(64);


export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);

  // admin+superadmin — viewers do not see compliance drift info.
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = session.user.sub as string | undefined;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);

  const quota = await limiter.limit(`compliance:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const { id } = await ctx.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return json({ data: null, error: "Invalid id" }, 400);

  // Pull the REAL bucket name from the DB — the path param is the
  // internal UUID; passing that to AWS as a bucket name would 404 on
  // S3 even for valid buckets. Lookup also confirms the bucket is
  // managed by this tenant before billing an AWS call on it.
  const row = await prisma.bucket.findUnique({
    where: { id: parsedId.data },
    select: { name: true },
  });
  if (!row) return json({ data: null, error: "Not Found" }, 404);

  try {
    const report = await checkBucketCompliance(
      defaultComplianceRunner,
      row.name,
    );
    // checkedAt is serialised via Next.js default JSON (Date →
    // ISO string) — acceptable for this one-off field.
    return json({ data: report, error: null }, 200);
  } catch {
    return json(
      { data: null, error: "Failed to check compliance" },
      500,
    );
  }
}
