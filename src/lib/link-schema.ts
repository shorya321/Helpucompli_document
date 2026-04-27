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
    // Superadmin-gated on the API route. When true, server stores
    // expiresAt=null and ttlSecondsOverride is ignored.
    neverExpires: z.boolean().default(false),
    // Per-link opt-in for cross-platform iframe embedding. Default
    // false → CSP `frame-ancestors 'none'` for unconfigured links and
    // /api/oembed returns 404. Setting true makes the link embeddable
    // on any HTTPS site (oEmbed discovery + CSP `https:` source).
    // HIPAA: caller is responsible for not enabling on PHI-containing
    // documents. Audited at create time + on every oEmbed fetch.
    allowPublicEmbed: z.boolean().default(false),
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
    // Sec-review M2: cursor is a link.id (UUID) — validate strictly so
    // an admin cannot probe arbitrary string IDs via 404/500 oracle.
    cursor: uuidString.optional(),
    limit: z.coerce.number().int().optional(),
  })
  .strict();

export type LinkListQuery = z.infer<typeof linkListQuerySchema>;
