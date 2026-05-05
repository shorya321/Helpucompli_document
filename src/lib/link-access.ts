import type { NextRequest } from "next/server";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { auth0 } from "@/lib/auth0";
import { ensureUser } from "@/lib/ensure-user";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asPolicyEnginePrisma,
  enforcePolicy,
  linkDefaultPolicy,
  resolvePolicyOrNull,
  type EffectivePolicy,
} from "@/lib/policy-engine";
import {
  MAX_GET_TTL_SECONDS,
  MIN_TTL_SECONDS,
  presignGetUrl,
} from "@/lib/s3-presign";
import { computeLinkStatus } from "@/lib/link-list";
import { createRateLimiter } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Shared link access helper. Both the legacy 302 redirect route
// (/api/links/<token>) and the new embeddable HTML viewer
// (/l/<token>) call this. Lifting the logic keeps authorization, audit,
// rate-limit, and counter semantics byte-identical across both paths.
// Never in-line this into a route — one source of truth prevents drift.
// ---------------------------------------------------------------------------

export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
export const LINK_ABORT_FLOOR_SEC = 30;

// Shared per-token quota. Both routes use the same Redis prefix so an
// attacker cannot get double the quota by alternating paths.
const limiter = createRateLimiter({
  max: 60,
  windowMs: 60_000,
  prefix: "@helpucompli/link-access",
});

export interface LinkAccessDoc {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string | null;
  readonly bucketName: string;
  readonly s3Key: string;
}

export interface LinkAccessOk {
  readonly kind: "ok";
  readonly link: {
    readonly id: string;
    readonly documentId: string;
    readonly policyId: string | null;
    readonly allowPublicEmbed: boolean;
    // null = perpetual link (no DB-side expiry). Surfaces that mint
    // long-lived embed tokens (og:image / og:video / oEmbed photo /
    // dashboard Image URL) clamp the token TTL to the link's lifetime.
    readonly expiresAt: Date | null;
  };
  readonly document: LinkAccessDoc;
  readonly effective: EffectivePolicy;
  readonly presignedUrl: string;
}

export type LinkAccessResult =
  | { readonly kind: "forbidden" }
  | { readonly kind: "rateLimited"; readonly retryAfterSec: number }
  | LinkAccessOk;

function effectiveFromStored(
  policy: {
    id?: string;
    linkTtlSeconds: number | null;
    maxDownloads: number | null;
    requireAuth: boolean;
    allowedDomains: string[];
    allowedIpRanges: string[];
  } | null,
): EffectivePolicy | null {
  if (!policy) return null;
  return {
    source: "object",
    policyId: policy.id ?? null,
    linkTtlSeconds: policy.linkTtlSeconds ?? MAX_GET_TTL_SECONDS,
    maxDownloads: policy.maxDownloads,
    requireAuth: policy.requireAuth,
    allowedDomains: policy.allowedDomains,
    allowedIpRanges: policy.allowedIpRanges,
  };
}

async function writeAudit(
  action: "LINK_ACCESS" | "LINK_DENIED",
  link: {
    id: string;
    documentId: string;
    policyId: string | null;
    // Forensic fields — additive. When present, recorded in the audit
    // metadata so admins debugging "embed view didn't count" can
    // correlate the event with the cap snapshot, the post-event counter
    // value, and whether the hit was a sub-resource (no increment).
    maxDownloads?: number | null;
    allowPublicEmbed?: boolean;
    downloadCountAfter?: number;
  },
  ctx: {
    ipAddress: string;
    userAgent: string;
    userId: string | null;
    reason?: string;
    tokenKind?: "sub-fetch" | "external-embed" | null;
    isSubResource?: boolean;
  },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action,
        targetType: "link",
        targetId: link.id,
        metadata: {
          documentId: link.documentId,
          policyId: link.policyId,
          ...(link.maxDownloads !== undefined
            ? { maxDownloads: link.maxDownloads }
            : {}),
          ...(link.allowPublicEmbed !== undefined
            ? { allowPublicEmbed: link.allowPublicEmbed }
            : {}),
          ...(link.downloadCountAfter !== undefined
            ? { downloadCountAfter: link.downloadCountAfter }
            : {}),
          ...(ctx.isSubResource !== undefined
            ? { isSubResource: ctx.isSubResource }
            : {}),
          ...(ctx.reason ? { reason: ctx.reason } : {}),
          ...(ctx.tokenKind ? { tokenKind: ctx.tokenKind } : {}),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  } catch {
    // Best-effort. Access decision must not block on the audit row.
  }
}

export interface ResolveAndAuthorizeOptions {
  // Set true by /l/[hash]/raw when the request carries a valid HMAC
  // sub-fetch raw-fetch token. Forwarded into enforcePolicy so the
  // publicEmbed referer-refinement branch trusts an already-authorized
  // sub-fetch. external-embed tokens MUST NOT set this flag — they
  // come from externally-pasted URLs whose browser referer was never
  // validated. See src/lib/raw-fetch-token.ts and policy-engine.ts.
  readonly bypassRefererRefinement?: boolean;
  // The kind claim from the verified raw-fetch token, if any. Plumbed
  // into LINK_ACCESS / LINK_DENIED audit metadata so admins can tell
  // inline viewer sub-fetches apart from external Iframely / og:image
  // / share-info image-URL traffic.
  readonly tokenKind?: "sub-fetch" | "external-embed" | null;
  // Set true by /l/[hash]/raw — that route serves bytes for an
  // already-rendered parent page (inline viewer image, Iframely media
  // sub-resource, og:image discovery). Counting these hits would
  // multiply the per-render view count by the number of media assets
  // and inflate the dashboard counter. Primary HTML viewer / 302-
  // redirect download routes leave this `false` so they still count.
  readonly isSubResource?: boolean;
}

export async function resolveAndAuthorizeLink(
  req: NextRequest,
  hash: string,
  options: ResolveAndAuthorizeOptions = {},
): Promise<LinkAccessResult> {
  const ipAddress = extractIp(req);
  const userAgent = extractUserAgent(req);

  if (!LINK_TOKEN_RE.test(hash)) {
    return { kind: "forbidden" };
  }
  const quota = await limiter.limit(`link-access:${hash}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return { kind: "rateLimited", retryAfterSec: retrySec };
  }

  const link = (await prisma.generatedLink.findUnique({
    where: { presignedUrlHash: hash },
    include: {
      document: {
        select: {
          id: true,
          filename: true,
          contentType: true,
          s3Key: true,
          isDeleted: true,
          bucket: { select: { name: true } },
        },
      },
      policy: {
        select: {
          id: true,
          linkTtlSeconds: true,
          maxDownloads: true,
          requireAuth: true,
          allowedDomains: true,
          allowedIpRanges: true,
        },
      },
    },
  })) as
    | (Record<string, unknown> & {
        id: string;
        documentId: string;
        policyId: string | null;
        allowPublicEmbed: boolean;
        document: {
          id: string;
          filename: string;
          contentType: string | null;
          s3Key: string;
          isDeleted: boolean;
          bucket: { name: string };
        } | null;
        policy: {
          id: string;
          linkTtlSeconds: number | null;
          maxDownloads: number | null;
          requireAuth: boolean;
          allowedDomains: string[];
          allowedIpRanges: string[];
        } | null;
      })
    | null;

  if (!link) return { kind: "forbidden" };

  const session = await auth0.getSession();
  let dbUserId: string | null = null;
  if (session) {
    try {
      const role = (await resolveRole(session)) ?? "viewer";
      const dbu = await ensureUser(prisma, { session, role });
      dbUserId = dbu.id;
    } catch {
      dbUserId = null;
    }
  }

  // The `allowPublicEmbed` flag is the SOLE embed-enable signal.
  // `policy.allowedDomains` is enforced strictly by the policy
  // engine per F9.3 / F8.7 ("If ANY check fails: return 403"). When
  // the link is also embeddable, `allowedDomains` additionally
  // narrows the CSP `frame-ancestors` so only those parents may
  // iframe it. The two responsibilities never collapse — a domain-
  // restricted policy on a non-embeddable link must still gate
  // direct browser navigation.
  //
  // `maxDownloads` is enforced strictly for both embed and non-embed
  // links: each canonical /l/<hash> hit increments the counter once,
  // /api/oembed does not increment, and /raw passes
  // isSubResource=true to skip increment. So a configured cap of N
  // means at most N parent-page renders, matching admin intent.
  const isEmbeddableLink = link.allowPublicEmbed === true;
  const status = computeLinkStatus({
    isRevoked: link.isRevoked as boolean,
    expiresAt: (link.expiresAt as Date | null) ?? null,
    downloadCount: link.downloadCount as number,
    maxDownloads: (link.maxDownloads as number | null) ?? null,
  });
  if (status !== "active" || !link.document || link.document.isDeleted) {
    await writeAudit(
      "LINK_DENIED",
      {
        id: link.id,
        documentId: link.documentId,
        policyId: link.policyId,
        maxDownloads: (link.maxDownloads as number | null) ?? null,
        allowPublicEmbed: link.allowPublicEmbed === true,
        downloadCountAfter: link.downloadCount as number,
      },
      {
        ipAddress,
        userAgent,
        userId: dbUserId,
        reason: !link.document
          ? "document-missing"
          : link.document.isDeleted
            ? "document-deleted"
            : status,
      },
    );
    return { kind: "forbidden" };
  }

  const effective: EffectivePolicy =
    effectiveFromStored(link.policy) ??
    (await resolvePolicyOrNull(asPolicyEnginePrisma(prisma), {
      bucketName: link.document.bucket.name,
      s3Key: link.document.s3Key,
    })) ??
    linkDefaultPolicy;

  const referer = req.headers.get("referer");
  const secFetchDest = req.headers.get("sec-fetch-dest");
  const secFetchSite = req.headers.get("sec-fetch-site");
  const isPublicEmbed = isEmbeddableLink;
  const decision = enforcePolicy(effective, {
    ipAddress,
    referer,
    isAuthenticated: !!session,
    // When the link is opted into public embedding, the policy
    // engine's Referer + IP checks would block server-side oEmbed
    // discovery (no Referer; arbitrary crawler IPs). With this
    // flag set, `enforcePolicy` skips both gates and the browser-
    // side CSP `frame-ancestors` (sourced from the policy's
    // `allowedDomains`) becomes the parent-host gate instead.
    // `requireAuth` is intentionally NOT bypassed.
    //
    // Refinement: when `allowedDomains` is non-empty AND the
    // request carries `Sec-Fetch-Dest` (modern browser), the
    // engine ALSO requires the Referer to match those domains.
    // Server-side oEmbed crawlers (no Sec-Fetch-Dest header) keep
    // bypassing so WP / Notion discovery still works. This stops a
    // user from opening a public-embed-with-allowedDomains link
    // directly in a browser tab — they must reach it via an iframe
    // on one of the listed parent sites.
    publicEmbedBypass: isPublicEmbed,
    secFetchDest,
    secFetchSite,
    bypassRefererRefinement: options.bypassRefererRefinement === true,
  });

  if (!decision.allow) {
    await writeAudit(
      "LINK_DENIED",
      {
        id: link.id,
        documentId: link.documentId,
        policyId: link.policyId,
        maxDownloads: (link.maxDownloads as number | null) ?? null,
        allowPublicEmbed: link.allowPublicEmbed === true,
        downloadCountAfter: link.downloadCount as number,
      },
      {
        ipAddress,
        userAgent,
        userId: dbUserId,
        reason: "policy-deny",
        tokenKind: options.tokenKind ?? null,
        isSubResource: options.isSubResource === true,
      },
    );
    return { kind: "forbidden" };
  }

  const linkExpiresAt = link.expiresAt as Date | null;
  let remainingSecForClamp: number;
  if (linkExpiresAt === null) {
    remainingSecForClamp = MAX_GET_TTL_SECONDS;
  } else {
    const remainingMs = linkExpiresAt.getTime() - Date.now();
    const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
    if (remainingSec < LINK_ABORT_FLOOR_SEC) {
      await writeAudit(
        "LINK_DENIED",
        {
          id: link.id,
          documentId: link.documentId,
          policyId: link.policyId,
          maxDownloads: (link.maxDownloads as number | null) ?? null,
          allowPublicEmbed: link.allowPublicEmbed === true,
          downloadCountAfter: link.downloadCount as number,
        },
        {
          ipAddress,
          userAgent,
          userId: dbUserId,
          reason: "remaining-ttl-too-low",
        },
      );
      return { kind: "forbidden" };
    }
    remainingSecForClamp = remainingSec;
  }
  const desired = decision.linkTtlSeconds;
  const presignTtl = Math.max(
    MIN_TTL_SECONDS,
    Math.min(desired, remainingSecForClamp, MAX_GET_TTL_SECONDS),
  );

  // Counter semantics:
  //   - Sub-resource hits (/l/<hash>/raw — inline viewer image bytes,
  //     Iframely media, og:image discovery) NEVER increment. Each
  //     parent render pulls N media assets; counting them would
  //     multiply the dashboard view count by N.
  //   - Primary access (canonical /l/<hash> HTML viewer or 302
  //     download): cap-gated `updateMany` — race-loss returns
  //     `forbidden` with `LINK_DENIED reason='race-lost-or-just-
  //     exhausted'`. Applies uniformly to embed and non-embed: each
  //     parent render is one increment, /api/oembed never increments,
  //     so a configured maxDownloads of N admits exactly N renders.
  // Audit row below fires for every accepted access regardless.
  const isSubResource = options.isSubResource === true;
  const incrementedCounter = !isSubResource;
  if (!isSubResource) {
    const cap = link.maxDownloads as number | null;
    const now = new Date();
    const where: Record<string, unknown> = {
      id: link.id,
      isRevoked: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    if (cap !== null) where.downloadCount = { lt: cap };
    const updated = await prisma.generatedLink.updateMany({
      where: where as Parameters<
        typeof prisma.generatedLink.updateMany
      >[0]["where"],
      data: { downloadCount: { increment: 1 } },
    });
    if (updated.count === 0) {
      await writeAudit(
        "LINK_DENIED",
        {
          id: link.id,
          documentId: link.documentId,
          policyId: link.policyId,
          maxDownloads: (link.maxDownloads as number | null) ?? null,
          allowPublicEmbed: link.allowPublicEmbed === true,
          // Race-loss: counter unchanged at the snapshot value because
          // the cap-gated WHERE clause matched zero rows.
          downloadCountAfter: link.downloadCount as number,
        },
        {
          ipAddress,
          userAgent,
          userId: dbUserId,
          reason: "race-lost-or-just-exhausted",
        },
      );
      return { kind: "forbidden" };
    }
  }

  let presignedUrl: string;
  try {
    presignedUrl = await presignGetUrl({
      bucket: link.document.bucket.name,
      key: link.document.s3Key,
      ttlSeconds: presignTtl,
      responseContentDisposition: "inline",
    });
  } catch {
    // Only roll back the counter we actually incremented. Sub-
    // resource paths skipped the increment above so they must skip
    // the decrement here too — otherwise a presign failure on a
    // /raw fetch would push downloadCount below zero.
    if (incrementedCounter) {
      await prisma.generatedLink
        .update({
          where: { id: link.id },
          data: { downloadCount: { decrement: 1 } },
        })
        .catch(() => {});
    }
    await writeAudit(
      "LINK_DENIED",
      {
        id: link.id,
        documentId: link.documentId,
        policyId: link.policyId,
        maxDownloads: (link.maxDownloads as number | null) ?? null,
        allowPublicEmbed: link.allowPublicEmbed === true,
        // Presign failed AFTER any successful increment was rolled back
        // (decrement above), so the counter nets back to the snapshot.
        downloadCountAfter: link.downloadCount as number,
      },
      {
        ipAddress,
        userAgent,
        userId: dbUserId,
        reason: "presign-failed",
        isSubResource: options.isSubResource === true,
      },
    );
    return { kind: "forbidden" };
  }

  await writeAudit(
    "LINK_ACCESS",
    {
      id: link.id,
      documentId: link.documentId,
      policyId: link.policyId,
      maxDownloads: (link.maxDownloads as number | null) ?? null,
      allowPublicEmbed: link.allowPublicEmbed === true,
      // /raw sub-resources skip the increment so the counter is
      // unchanged; the canonical /l/<hash> path always +1's.
      downloadCountAfter: incrementedCounter
        ? (link.downloadCount as number) + 1
        : (link.downloadCount as number),
    },
    {
      ipAddress,
      userAgent,
      userId: dbUserId,
      tokenKind: options.tokenKind ?? null,
      isSubResource: options.isSubResource === true,
    },
  );

  return {
    kind: "ok",
    link: {
      id: link.id,
      documentId: link.documentId,
      policyId: link.policyId,
      allowPublicEmbed: link.allowPublicEmbed === true,
      expiresAt: (link.expiresAt as Date | null) ?? null,
    },
    document: {
      id: link.document.id,
      filename: link.document.filename,
      contentType: link.document.contentType,
      bucketName: link.document.bucket.name,
      s3Key: link.document.s3Key,
    },
    effective,
    presignedUrl,
  };
}
