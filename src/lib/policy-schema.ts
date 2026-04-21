import { z } from "zod";
import { cidrSchema, domainSchema } from "@/lib/validation";

// Re-exported from validation.ts so legacy callers keep working without
// a churn-heavy rename pass. validation.ts is the canonical home.
export { cidrSchema, domainSchema };

const TTL_MIN = 60;
const TTL_MAX = 604_800;
const MAX_DOWNLOADS_MAX = 99_999;
const ARRAY_MAX = 50;
const NAME_MAX = 128;
const TARGET_MAX = 1024;

export const policyTargetTypeSchema = z.enum(["bucket", "prefix", "object"]);

export const policyInputSchema = z
  .object({
    name: z.string().min(1).max(NAME_MAX),
    targetType: policyTargetTypeSchema,
    targetValue: z.string().min(1).max(TARGET_MAX),
    allowedDomains: z.array(domainSchema).max(ARRAY_MAX).default([]),
    allowedIpRanges: z.array(cidrSchema).max(ARRAY_MAX).default([]),
    // null = "never expires" — superadmin-gated on write. Policy TTL
    // feeds link-create as the ceiling; null = no ceiling, inherit from
    // override or fall back to MAX on the access side.
    linkTtlSeconds: z.number().int().min(TTL_MIN).max(TTL_MAX).nullable(),
    maxDownloads: z
      .number()
      .int()
      .positive()
      .max(MAX_DOWNLOADS_MAX)
      .nullable(),
    requireAuth: z.boolean(),
  })
  .strict();

export type PolicyInput = z.infer<typeof policyInputSchema>;

// Sec-review H2: targetType and targetValue must move together — a
// patch that flips targetType from `bucket` to `object` while leaving
// the old bucket name as targetValue would orphan the policy. Force
// callers to send both or neither.
export const policyUpdateSchema = policyInputSchema
  .partial()
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Patch must contain at least one field",
  })
  .refine(
    (obj) =>
      (obj.targetType === undefined) === (obj.targetValue === undefined),
    {
      message: "targetType and targetValue must be updated together",
    },
  );

export type PolicyUpdate = z.infer<typeof policyUpdateSchema>;
