import type { PolicyTargetType } from "@/types";

export interface PolicyPreviewInput {
  readonly targetType: PolicyTargetType;
  readonly targetValue: string;
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
  // null = policy issues perpetual links (superadmin-gated).
  readonly linkTtlSeconds: number | null;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
}

export interface PolicyDescription {
  readonly target: string;
  readonly ttl: string;
  readonly maxDownloads: string;
  readonly ipRestriction: string;
  readonly domainRestriction: string;
  readonly requireAuth: "yes" | "no";
}

const TTL_NAMES: ReadonlyMap<number, string> = new Map([
  [900, "15 minutes"],
  [3600, "1 hour"],
  [86_400, "24 hours"],
  [604_800, "7 days"],
]);

function ttlLabel(seconds: number): string {
  const named = TTL_NAMES.get(seconds);
  if (named) return named;
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

function pluralise(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function describePolicy(p: PolicyPreviewInput): PolicyDescription {
  return {
    target: `${p.targetType} ${p.targetValue || "(unset)"}`,
    ttl: p.linkTtlSeconds === null ? "never expires" : ttlLabel(p.linkTtlSeconds),
    maxDownloads:
      p.maxDownloads === null || p.maxDownloads === undefined
        ? "unlimited"
        : pluralise(p.maxDownloads, "download", "downloads"),
    ipRestriction:
      p.allowedIpRanges.length === 0
        ? "none (any IP)"
        : pluralise(p.allowedIpRanges.length, "range", "ranges"),
    domainRestriction:
      p.allowedDomains.length === 0
        ? "none (any referrer)"
        : pluralise(p.allowedDomains.length, "domain", "domains"),
    requireAuth: p.requireAuth ? "yes" : "no",
  };
}
