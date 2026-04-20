import { z } from "zod";
import { BUCKET_NAME_RE } from "@/lib/bucket-constants";

// F11.3 — Shared Zod primitives for every API route input. Consolidate
// identifier / address / naming validation so one authoritative regex
// exists per primitive. Route-specific composite schemas (link create,
// policy input, user invite, etc.) live next to their orchestrators.
//
// HIPAA Technical Safeguard 164.312(e)(1) + 164.312(c)(1): fail-fast
// rejection of malformed input at the system boundary.

const EMAIL_MAX_LEN = 254; // RFC 5321
const FILE_NAME_MAX_LEN = 255; // common filesystem cap
const DOMAIN_MAX_LEN = 253; // RFC 1035

export const uuidSchema = z.string().uuid({ message: "Invalid UUID" });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LEN, "Email exceeds 254 characters")
  .email("Invalid email");

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_RE = new RegExp(`^(?:\\*\\.)?(?:${LABEL}\\.)+${LABEL}$`, "i");

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

export const bucketNameSchema = z
  .string()
  .min(3, "Bucket name must be 3-63 characters")
  .max(63, "Bucket name must be 3-63 characters")
  .refine((s) => BUCKET_NAME_RE.test(s), {
    message:
      "Bucket name must be lowercase letters, digits, or hyphens; must start and end with a letter or digit.",
  });

// File-name safety: reject anything that could escape its directory
// (path traversal), contain OS path separators, or carry a null byte
// (some filesystems + logging sinks terminate on \0 which can mask
// log-injection). No PHI in filename per HIPAA data classification.
export const fileNameSchema = z
  .string()
  .min(1, "File name required")
  .max(FILE_NAME_MAX_LEN, "File name exceeds 255 characters")
  .refine((s) => !s.includes("\0"), { message: "File name contains NUL" })
  .refine((s) => !s.includes("/") && !s.includes("\\"), {
    message: "File name must not contain path separators",
  })
  .refine((s) => s !== "." && s !== ".." && !s.startsWith("../") && !s.startsWith("..\\"), {
    message: "File name must not reference parent directory",
  });
