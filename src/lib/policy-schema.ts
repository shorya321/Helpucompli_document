import { z } from "zod";

const TTL_MIN = 60;
const TTL_MAX = 604_800;
const MAX_DOWNLOADS_MAX = 99_999;
const ARRAY_MAX = 50;
const NAME_MAX = 128;
const TARGET_MAX = 1024;
const DOMAIN_MAX_LEN = 253;

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_RE = new RegExp(
  `^(?:\\*\\.)?(?:${LABEL}\\.)+${LABEL}$`,
  "i",
);

export const domainSchema = z
  .string()
  .min(1)
  .max(DOMAIN_MAX_LEN)
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => DOMAIN_RE.test(s), {
    message: "Invalid domain. Use example.com or *.example.com.",
  });

const CIDR_RE =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(3[0-2]|[12]?\d)$/;

export const cidrSchema = z
  .string()
  .min(1)
  .max(18)
  .refine((s) => CIDR_RE.test(s), {
    message: "Invalid CIDR. Use IPv4 a.b.c.d/mask.",
  });

export const policyTargetTypeSchema = z.enum(["bucket", "prefix", "object"]);

export const policyInputSchema = z
  .object({
    name: z.string().min(1).max(NAME_MAX),
    targetType: policyTargetTypeSchema,
    targetValue: z.string().min(1).max(TARGET_MAX),
    allowedDomains: z.array(domainSchema).max(ARRAY_MAX).default([]),
    allowedIpRanges: z.array(cidrSchema).max(ARRAY_MAX).default([]),
    linkTtlSeconds: z.number().int().min(TTL_MIN).max(TTL_MAX),
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

export const policyUpdateSchema = policyInputSchema
  .partial()
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Patch must contain at least one field",
  });

export type PolicyUpdate = z.infer<typeof policyUpdateSchema>;
