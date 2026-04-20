import type { PolicyTargetType } from "@/types";

// ---------------------------------------------------------------------------
// Effective policy + decision shapes
// ---------------------------------------------------------------------------

export type PolicySource = "object" | "prefix" | "bucket" | "default";

export interface EffectivePolicy {
  readonly source: PolicySource;
  readonly policyId: string | null;
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
}

export interface EnforcementContext {
  readonly ipAddress: string;
  readonly referer: string | null;
  readonly isAuthenticated: boolean;
}

export type EnforcementDecision =
  | {
      readonly allow: true;
      readonly linkTtlSeconds: number;
      readonly maxDownloads: number | null;
    }
  | { readonly allow: false };

// ---------------------------------------------------------------------------
// Default policy — applies when nothing matches the doc.
// ---------------------------------------------------------------------------
// Sec-review H3: HIPAA-safe default — when no policy matches the doc,
// require an authenticated session before issuing a presigned URL. A
// missing policy is a configuration gap, not an invitation to share
// publicly. Operators must explicitly attach an open policy if they
// want anonymous access.
export const defaultPolicy: EffectivePolicy = {
  source: "default",
  policyId: null,
  linkTtlSeconds: 900, // 15 min
  maxDownloads: null,
  requireAuth: true,
  allowedDomains: [],
  allowedIpRanges: [],
} as const;

// ---------------------------------------------------------------------------
// IP CIDR membership — pure, dependency-free, IPv4 only.
// Returns false on any malformed input (fail closed).
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return null;
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    acc = acc * 256 + n;
  }
  // Force unsigned 32-bit so we can compare with bitwise mask without
  // sign-bit surprises (top-octet ≥128 would otherwise be negative).
  return acc >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  if (slash < 0) return false;
  const network = ipv4ToInt(cidr.slice(0, slash));
  const bitsRaw = cidr.slice(slash + 1);
  if (network === null) return false;
  if (!/^\d+$/.test(bitsRaw)) return false;
  const bits = Number(bitsRaw);
  if (bits < 0 || bits > 32) return false;

  const target = ipv4ToInt(ip);
  if (target === null) return false;

  // /0 → mask is 0; (target & 0) === (network & 0) trivially true.
  // Use unsigned shift to avoid sign-bit surprises at /1 .. /31.
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (target & mask) === (network & mask);
}

// ---------------------------------------------------------------------------
// Referer allowlist — extract host from URL, lowercase-compare against
// each pattern; "*.example.com" matches `sub.example.com` but NOT the
// bare apex (matches Auth0/CloudFront semantics).
// ---------------------------------------------------------------------------

function parseHost(referer: string): string | null {
  try {
    const u = new URL(referer);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function patternMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    // Subdomain MUST be at least one label (".sub.suffix" — host longer
    // than suffix and ends with ".suffix"). Bare apex is excluded.
    return host.length > suffix.length + 1 && host.endsWith(`.${suffix}`);
  }
  return host === p;
}

export function refererAllowed(
  referer: string | null,
  allowed: readonly string[],
): boolean {
  if (!referer) return false;
  const host = parseHost(referer);
  if (!host) return false;
  return allowed.some((pat) => patternMatches(host, pat));
}

// ---------------------------------------------------------------------------
// enforcePolicy — apply effective policy to a request context.
// Returns decision; caller writes audit row LINK_ACCESS or LINK_DENIED.
// ---------------------------------------------------------------------------

export function enforcePolicy(
  policy: EffectivePolicy,
  ctx: EnforcementContext,
): EnforcementDecision {
  if (policy.requireAuth && !ctx.isAuthenticated) {
    return { allow: false };
  }
  if (policy.allowedIpRanges.length > 0) {
    const matched = policy.allowedIpRanges.some((cidr) =>
      ipInCidr(ctx.ipAddress, cidr),
    );
    if (!matched) return { allow: false };
  }
  if (policy.allowedDomains.length > 0) {
    if (!refererAllowed(ctx.referer, policy.allowedDomains)) {
      return { allow: false };
    }
  }
  return {
    allow: true,
    linkTtlSeconds: policy.linkTtlSeconds,
    maxDownloads: policy.maxDownloads,
  };
}

// ---------------------------------------------------------------------------
// resolvePolicy — fetch matching object/prefix/bucket rows in a single
// query, then pick the most specific (object > longest prefix > bucket).
// ---------------------------------------------------------------------------

export interface DocumentInfo {
  readonly bucketName: string;
  readonly s3Key: string;
}

export interface PolicyEnginePrisma {
  readonly accessPolicy: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }) => Promise<Array<Record<string, unknown>>>;
  };
}

interface RawPolicy {
  readonly id: string;
  readonly targetType: PolicyTargetType;
  readonly targetValue: string;
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
}

function rowToRaw(row: Record<string, unknown>): RawPolicy {
  return {
    id: row.id as string,
    targetType: row.targetType as PolicyTargetType,
    targetValue: row.targetValue as string,
    allowedDomains: (row.allowedDomains as string[]) ?? [],
    allowedIpRanges: (row.allowedIpRanges as string[]) ?? [],
    linkTtlSeconds: row.linkTtlSeconds as number,
    maxDownloads: (row.maxDownloads as number | null) ?? null,
    requireAuth: row.requireAuth as boolean,
  };
}

function toEffective(raw: RawPolicy, source: PolicySource): EffectivePolicy {
  return {
    source,
    policyId: raw.id,
    linkTtlSeconds: raw.linkTtlSeconds,
    maxDownloads: raw.maxDownloads,
    requireAuth: raw.requireAuth,
    allowedDomains: raw.allowedDomains,
    allowedIpRanges: raw.allowedIpRanges,
  };
}

export async function resolvePolicy(
  prisma: PolicyEnginePrisma,
  doc: DocumentInfo,
): Promise<EffectivePolicy> {
  // Single query: union over the three possible matches. Prefix is
  // narrowed in-app since Prisma can't express "is a prefix of" in an
  // OR clause directly. Sec-review H1: scope prefix matches to keys
  // that actually share leading characters with the document key, so
  // multi-tenant prefix policies do not all flow through the engine.
  // We cannot fully narrow without a server-side starts-with operator,
  // but we can at least filter to prefixes whose leading char appears
  // in the key — the in-app `startsWith` check below is authoritative.
  const firstChar = doc.s3Key.length > 0 ? doc.s3Key[0]! : "";
  const rows = await prisma.accessPolicy.findMany({
    where: {
      OR: [
        { targetType: "object", targetValue: doc.s3Key },
        {
          targetType: "prefix",
          targetValue: { startsWith: firstChar },
        },
        { targetType: "bucket", targetValue: doc.bucketName },
      ],
    },
    select: {
      id: true,
      targetType: true,
      targetValue: true,
      allowedDomains: true,
      allowedIpRanges: true,
      linkTtlSeconds: true,
      maxDownloads: true,
      requireAuth: true,
    },
  });

  const policies = rows.map(rowToRaw);

  const objectMatch = policies.find(
    (p) => p.targetType === "object" && p.targetValue === doc.s3Key,
  );
  if (objectMatch) return toEffective(objectMatch, "object");

  const prefixMatches = policies
    .filter(
      (p) =>
        p.targetType === "prefix" && doc.s3Key.startsWith(p.targetValue),
    )
    // Longest prefix wins; ties resolved by id for stability.
    .sort(
      (a, b) =>
        b.targetValue.length - a.targetValue.length || a.id.localeCompare(b.id),
    );
  if (prefixMatches.length > 0) {
    return toEffective(prefixMatches[0]!, "prefix");
  }

  const bucketMatch = policies.find(
    (p) => p.targetType === "bucket" && p.targetValue === doc.bucketName,
  );
  if (bucketMatch) return toEffective(bucketMatch, "bucket");

  return defaultPolicy;
}

interface PolicyEnginePrismaLike {
  readonly accessPolicy: { findMany(args?: unknown): Promise<unknown[]> };
}
export function asPolicyEnginePrisma(
  client: PolicyEnginePrismaLike,
): PolicyEnginePrisma {
  return client as unknown as PolicyEnginePrisma;
}
