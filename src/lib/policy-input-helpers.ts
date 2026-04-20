import { domainSchema, cidrSchema } from "@/lib/policy-schema";

export type AddResult =
  | { readonly ok: true; readonly next: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "duplicate";
      readonly message: string;
    };

export function addDomain(
  current: readonly string[],
  raw: string,
): AddResult {
  const parsed = domainSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: "Invalid domain. Use example.com or *.example.com.",
    };
  }
  if (current.includes(parsed.data)) {
    return { ok: false, reason: "duplicate", message: "Already added." };
  }
  return { ok: true, next: [...current, parsed.data] };
}

export function addCidr(current: readonly string[], raw: string): AddResult {
  const parsed = cidrSchema.safeParse(raw.trim());
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: "Invalid CIDR. Use IPv4 a.b.c.d/mask (e.g. 10.0.0.0/8).",
    };
  }
  if (current.includes(parsed.data)) {
    return { ok: false, reason: "duplicate", message: "Already added." };
  }
  return { ok: true, next: [...current, parsed.data] };
}

export function removeAt(
  current: readonly string[],
  value: string,
): readonly string[] {
  return current.filter((v) => v !== value);
}
