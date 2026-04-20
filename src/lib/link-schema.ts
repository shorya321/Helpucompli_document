import { z } from "zod";
import {
  LINK_MAX_TTL_SECONDS,
  LINK_MIN_TTL_SECONDS,
} from "@/lib/link-create";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidString = z.string().regex(UUID_RE, "Invalid UUID");

export const linkCreateSchema = z
  .object({
    documentId: uuidString,
    policyId: uuidString.nullable().default(null),
    ttlSecondsOverride: z
      .number()
      .int()
      .min(LINK_MIN_TTL_SECONDS)
      .max(LINK_MAX_TTL_SECONDS)
      .nullable()
      .default(null),
    maxDownloadsOverride: z
      .number()
      .int()
      .positive()
      .max(99_999)
      .nullable()
      .default(null),
  })
  .strict();

export type LinkCreateBody = z.infer<typeof linkCreateSchema>;

export const linkListQuerySchema = z
  .object({
    status: z.enum(["all", "active", "expired", "revoked"]).default("all"),
    sort: z
      .enum(["createdAt", "expiresAt", "downloadCount"])
      .default("createdAt"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    cursor: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().optional(),
  })
  .strict();

export type LinkListQuery = z.infer<typeof linkListQuerySchema>;
