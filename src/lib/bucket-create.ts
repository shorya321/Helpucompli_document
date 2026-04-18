import { z } from "zod";
import {
  createHipaaBucket,
  deleteEmptyHipaaBucket,
} from "@/lib/s3-buckets";
import {
  AWS_REGIONS,
  BUCKET_NAME_RE,
  HIPAA_BUCKET_NAME_PREFIX,
} from "@/lib/bucket-constants";

// Re-export so existing imports (route + tests) keep working without
// touching every call site.
export { AWS_REGIONS, HIPAA_BUCKET_NAME_PREFIX } from "@/lib/bucket-constants";
export type { AwsRegion } from "@/lib/bucket-constants";

// Single schema for the POST /api/s3/buckets body AND the lib's own
// boundary check. Duplicating the validation server-side is intentional
// — defense in depth — a buggy route that forgets to parse still cannot
// slip through unsanitised input.
export const bucketCreateInputSchema = z
  .object({
    name: z
      .string()
      .min(3)
      .max(63)
      .regex(BUCKET_NAME_RE, "invalid S3 bucket name")
      .refine(
        (n) => n.startsWith(HIPAA_BUCKET_NAME_PREFIX),
        `must start with '${HIPAA_BUCKET_NAME_PREFIX}'`,
      )
      .refine((n) => !n.startsWith("xn--"), "reserved IDN prefix")
      .refine((n) => !n.endsWith("-s3alias"), "reserved access-point suffix"),
    awsRegion: z.enum(AWS_REGIONS),
    description: z.string().max(2048).optional(),
  })
  .strict();

export type BucketCreateInput = z.infer<typeof bucketCreateInputSchema>;

export interface BucketCreateContext {
  readonly createdById: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface CreatedBucket {
  readonly id: string;
  readonly name: string;
  readonly region: string;
}

export class DuplicateBucketNameError extends Error {
  constructor(name: string) {
    super(`Bucket '${name}' already exists`);
    this.name = "DuplicateBucketNameError";
  }
}

// Transaction context — `bucket.create` + `auditLog.create` run on the
// same tx handle so an audit-log insert failure rolls the bucket row
// back (HIPAA 164.312(b) — no committed mutation without a log row).
export interface BucketCreateTxHandle {
  readonly bucket: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ id: string; name: string; awsRegion: string }>;
  };
  readonly auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

// Narrow Prisma surface required by this orchestrator.
export interface BucketCreatePrisma {
  $transaction<T>(fn: (tx: BucketCreateTxHandle) => Promise<T>): Promise<T>;
}

interface BucketCreatePrismaLike {
  $transaction(fn: (tx: unknown) => Promise<unknown>): Promise<unknown>;
}

export function asBucketCreatePrisma(
  client: BucketCreatePrismaLike,
): BucketCreatePrisma {
  return client as unknown as BucketCreatePrisma;
}

// Abstraction over the S3 side — lets tests run without hitting AWS.
export interface BucketS3Runner {
  create(input: {
    name: string;
    region: string;
  }): Promise<{ name: string; region: string; cloudTrailConfigured: boolean }>;
  deleteEmpty(name: string): Promise<void>;
}

export const defaultS3Runner: BucketS3Runner = {
  create: (input) => createHipaaBucket(input),
  deleteEmpty: (name) => deleteEmptyHipaaBucket(name),
};

// Duck-type P2002 detection — keeps tests from depending on Prisma's
// concrete error classes. Prisma's runtime class exposes `.code` on
// PrismaClientKnownRequestError; matching on that alone is enough and
// keeps the module import-light on the client test path.
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

export async function createBucketForTenant(
  prisma: BucketCreatePrisma,
  s3: BucketS3Runner,
  input: BucketCreateInput,
  ctx: BucketCreateContext,
): Promise<CreatedBucket> {
  // Re-validate at the lib boundary — defense against a route that
  // forgets to parse OR a future caller that bypasses the route.
  const parsed = bucketCreateInputSchema.parse(input);

  // S3 first — createHipaaBucket carries its own internal rollback,
  // so an S3-side failure leaves nothing behind on AWS and the DB
  // transaction never starts.
  await s3.create({ name: parsed.name, region: parsed.awsRegion });

  // bucket.create + auditLog.create are bundled in one Prisma
  // interactive transaction so an audit-log write failure rolls the
  // bucket row back. Any uniqueness collision surfaces as a P2002 from
  // `bucket.create` and we rewrap it as DuplicateBucketNameError after
  // rolling back the S3 bucket — no orphans on AWS.
  let created: { id: string; name: string; awsRegion: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const row = await tx.bucket.create({
        data: {
          name: parsed.name,
          awsRegion: parsed.awsRegion,
          description: parsed.description ?? null,
          createdById: ctx.createdById,
          isActive: true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: ctx.createdById,
          action: "BUCKET_CREATE",
          targetType: "bucket",
          targetId: row.id,
          metadata: {
            name: row.name,
            awsRegion: row.awsRegion,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return row;
    });
  } catch (err) {
    // Transaction rolled back automatically — roll back S3 too so the
    // create is fully atomic from the caller's perspective. Swallow
    // the delete error so the ORIGINAL error (P2002 / whatever) still
    // surfaces to the caller rather than a secondary rollback failure.
    try {
      await s3.deleteEmpty(parsed.name);
    } catch {
      /* noop — original error surfaces */
    }
    if (isUniqueConstraintError(err)) {
      throw new DuplicateBucketNameError(parsed.name);
    }
    throw err;
  }

  return {
    id: created.id,
    name: created.name,
    region: created.awsRegion,
  };
}
