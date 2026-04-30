import { describe, expect, it, vi } from "vitest";
import {
  ipInCidr,
  refererAllowed,
  enforcePolicy,
  resolvePolicy,
  resolvePolicyOrNull,
  defaultPolicy,
  linkDefaultPolicy,
  type EffectivePolicy,
  type EnforcementContext,
  type PolicyEnginePrisma,
} from "@/lib/policy-engine";

// ---------------------------------------------------------------------------
// ipInCidr
// ---------------------------------------------------------------------------
describe("ipInCidr", () => {
  it.each([
    ["10.0.0.5", "10.0.0.0/8", true],
    ["10.255.255.255", "10.0.0.0/8", true],
    ["11.0.0.1", "10.0.0.0/8", false],
    ["192.168.1.42", "192.168.1.0/24", true],
    ["192.168.2.1", "192.168.1.0/24", false],
    ["1.2.3.4", "1.2.3.4/32", true],
    ["1.2.3.5", "1.2.3.4/32", false],
    ["1.2.3.4", "0.0.0.0/0", true],
    ["255.255.255.255", "0.0.0.0/0", true],
  ])("ip=%s cidr=%s → %s", (ip, cidr, expected) => {
    expect(ipInCidr(ip, cidr)).toBe(expected);
  });

  it("returns false for malformed inputs (defensive — fail closed)", () => {
    expect(ipInCidr("not-an-ip", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("10.0.0.5", "garbage")).toBe(false);
    expect(ipInCidr("", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("256.0.0.0", "0.0.0.0/0")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// refererAllowed
// ---------------------------------------------------------------------------
describe("refererAllowed", () => {
  it("matches exact host", () => {
    expect(refererAllowed("https://example.com/page", ["example.com"])).toBe(
      true,
    );
  });

  it("rejects different host even with same suffix", () => {
    expect(refererAllowed("https://evil.com/page", ["example.com"])).toBe(
      false,
    );
    expect(
      refererAllowed("https://notexample.com/", ["example.com"]),
    ).toBe(false);
  });

  it("matches wildcard subdomain (*.example.com matches sub.example.com)", () => {
    expect(
      refererAllowed("https://sub.example.com/", ["*.example.com"]),
    ).toBe(true);
    expect(
      refererAllowed("https://deep.sub.example.com/", ["*.example.com"]),
    ).toBe(true);
  });

  it("wildcard does NOT match the bare apex (sec-review L2 — security invariant)", () => {
    expect(refererAllowed("https://example.com/", ["*.example.com"])).toBe(
      false,
    );
    // Also reject zero-label injection: ".example.com" must not pass.
    expect(refererAllowed("https://.example.com/", ["*.example.com"])).toBe(
      false,
    );
  });

  it("is case-insensitive on host", () => {
    expect(
      refererAllowed("https://Example.COM/", ["example.com"]),
    ).toBe(true);
  });

  it("strips port before matching", () => {
    expect(
      refererAllowed("https://example.com:8443/", ["example.com"]),
    ).toBe(true);
  });

  it("returns false for malformed referer (fail closed)", () => {
    expect(refererAllowed("not a url", ["example.com"])).toBe(false);
    expect(refererAllowed("", ["example.com"])).toBe(false);
    expect(refererAllowed(null, ["example.com"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// enforcePolicy
// ---------------------------------------------------------------------------
const openPolicy: EffectivePolicy = {
  source: "default",
  policyId: null,
  linkTtlSeconds: 900,
  maxDownloads: null,
  requireAuth: false,
  allowedDomains: [],
  allowedIpRanges: [],
};

describe("enforcePolicy", () => {
  const baseCtx: EnforcementContext = {
    ipAddress: "1.2.3.4",
    referer: null,
    isAuthenticated: false,
  };

  it("allows when policy has no restrictions", () => {
    expect(enforcePolicy(openPolicy, baseCtx)).toEqual({
      allow: true,
      linkTtlSeconds: 900,
      maxDownloads: null,
    });
  });

  it("denies when requireAuth && !isAuthenticated", () => {
    const policy = { ...openPolicy, requireAuth: true };
    expect(enforcePolicy(policy, baseCtx)).toEqual({ allow: false });
  });

  it("allows when requireAuth && isAuthenticated", () => {
    const policy = { ...openPolicy, requireAuth: true };
    expect(
      enforcePolicy(policy, { ...baseCtx, isAuthenticated: true }),
    ).toEqual({ allow: true, linkTtlSeconds: 900, maxDownloads: null });
  });

  it("denies when ip not in allowed ranges", () => {
    const policy = { ...openPolicy, allowedIpRanges: ["10.0.0.0/8"] };
    expect(enforcePolicy(policy, baseCtx)).toEqual({ allow: false });
  });

  it("allows when ip in allowed ranges (any range matches)", () => {
    const policy = {
      ...openPolicy,
      allowedIpRanges: ["10.0.0.0/8", "1.2.3.0/24"],
    };
    expect(enforcePolicy(policy, baseCtx)).toMatchObject({ allow: true });
  });

  it("denies when referer set on policy but absent on request", () => {
    const policy = { ...openPolicy, allowedDomains: ["example.com"] };
    expect(enforcePolicy(policy, baseCtx)).toEqual({ allow: false });
  });

  it("denies when referer present but not allowed", () => {
    const policy = { ...openPolicy, allowedDomains: ["example.com"] };
    expect(
      enforcePolicy(policy, { ...baseCtx, referer: "https://evil.com/" }),
    ).toEqual({ allow: false });
  });

  it("allows when all checks pass together", () => {
    const policy = {
      ...openPolicy,
      requireAuth: true,
      allowedIpRanges: ["10.0.0.0/8"],
      allowedDomains: ["*.example.com"],
      linkTtlSeconds: 3600,
      maxDownloads: 5,
    };
    expect(
      enforcePolicy(policy, {
        ipAddress: "10.0.0.42",
        referer: "https://app.example.com/",
        isAuthenticated: true,
      }),
    ).toEqual({ allow: true, linkTtlSeconds: 3600, maxDownloads: 5 });
  });

  // ---- publicEmbedBypass — surfaces when link.allowPublicEmbed=true ----
  // Server-side oEmbed discovery (WordPress, Iframely, Notion, Slack) has
  // no Referer and edge IPs the admin cannot enumerate. The viewer route
  // must serve those fetches so consumers can find the discovery <link>;
  // CSP frame-ancestors is the actual parent-host gate at the browser.
  // requireAuth is intentionally NOT bypassed.

  it("publicEmbedBypass=true allows when allowedDomains is set and Referer is null (WP discovery)", () => {
    const policy = { ...openPolicy, allowedDomains: ["partner.example.com"] };
    expect(
      enforcePolicy(policy, { ...baseCtx, publicEmbedBypass: true }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true allows when allowedIpRanges is set and IP does not match (edge crawler)", () => {
    const policy = { ...openPolicy, allowedIpRanges: ["10.0.0.0/8"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        ipAddress: "203.0.113.4",
        publicEmbedBypass: true,
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true STILL denies when requireAuth and unauthenticated (auth wins over public-embed)", () => {
    const policy = { ...openPolicy, requireAuth: true };
    expect(
      enforcePolicy(policy, { ...baseCtx, publicEmbedBypass: true }),
    ).toEqual({ allow: false });
  });

  it("publicEmbedBypass=true allows when requireAuth and authenticated", () => {
    const policy = { ...openPolicy, requireAuth: true };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        isAuthenticated: true,
        publicEmbedBypass: true,
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true + allowedDomains + Referer present and arbitrary value allows (CSP frame-ancestors handles parent-host gating at the browser, not server)", () => {
    // Server-side enforcement is NOT defense-in-depth here. The
    // browser's CSP `frame-ancestors` (sourced from the same
    // `allowedDomains`) refuses to render iframes loaded from non-
    // listed parents. Server-side rejection on Referer mismatch
    // would also block legitimate uses where a logged-in admin opens
    // the bare /l/<hash> URL in a tab to verify the link works.
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        referer: "https://anywhere.example/post/42",
        publicEmbedBypass: true,
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true + empty allowedDomains + arbitrary Referer allows (no domain restriction to enforce)", () => {
    const policy = { ...openPolicy, allowedDomains: [] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        referer: "https://anywhere.example/",
        publicEmbedBypass: true,
      }),
    ).toMatchObject({ allow: true });
  });

  // ---- Sec-Fetch-Dest narrowing on public-embed + allowedDomains ----
  // When the admin enables public embedding AND pins the link to a set
  // of parent domains, the bypass should ONLY apply to server-side
  // oEmbed crawlers (no Sec-Fetch-Dest). Browser-originated requests
  // (direct nav OR iframe) MUST still match `allowedDomains` via the
  // Referer header — otherwise pasting the URL in a fresh Chrome tab
  // would open the document, which contradicts the admin's narrowing
  // intent.

  it("publicEmbedBypass=true + allowedDomains + Sec-Fetch-Dest=document + no Referer → DENIES (direct browser nav)", () => {
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        publicEmbedBypass: true,
        secFetchDest: "document",
        secFetchSite: "none",
      }),
    ).toEqual({ allow: false });
  });

  it("publicEmbedBypass=true + allowedDomains + Sec-Fetch-Dest=document + matching Referer → allows", () => {
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        referer: "https://embed.test.com/post/42",
        publicEmbedBypass: true,
        secFetchDest: "document",
        secFetchSite: "cross-site",
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true + allowedDomains + Sec-Fetch-Dest=iframe + matching Referer → allows (cross-site iframe from allowed parent)", () => {
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        referer: "https://embed.test.com/page",
        publicEmbedBypass: true,
        secFetchDest: "iframe",
        secFetchSite: "cross-site",
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true + allowedDomains + Sec-Fetch-Dest=iframe + Sec-Fetch-Site=cross-site + non-matching Referer → ALLOWS (CSP frame-ancestors is the parent-host gate)", () => {
    // Cross-site iframe loads pass through this branch. Embed-platform
    // proxies (Iframely / Embedly / Circle.so / Compass video player)
    // wrap our /l/<hash> iframe in a sandboxed iframe of their own;
    // the immediate Referer is then the proxy host, not the user-
    // facing parent admins listed in `allowedDomains`. Browser-side
    // CSP `frame-ancestors` (sourced from the same `allowedDomains`)
    // validates the FULL ancestor chain, so a request that survives
    // CSP enforcement is by definition coming from an allowed chain.
    // Server-side Referer refinement therefore adds no defense and
    // breaks legitimate proxy-wrapped embeds.
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        referer: "https://cdn.iframe.ly/api/iframe?u=...",
        publicEmbedBypass: true,
        secFetchDest: "iframe",
        secFetchSite: "cross-site",
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true + allowedDomains + Sec-Fetch-Dest=iframe + Sec-Fetch-Site=cross-site + null Referer → ALLOWS (sandboxed proxy iframe with stripped referer)", () => {
    // Same carve-out as above with the harshest Referer case (Iframely-
    // sandboxed iframe with `Referrer-Policy: no-referrer`). CSP
    // `frame-ancestors` still gates the chain at the browser, so
    // letting the bytes flow does not weaken the parent-host
    // restriction admins configured.
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        referer: null,
        publicEmbedBypass: true,
        secFetchDest: "iframe",
        secFetchSite: "cross-site",
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true + allowedDomains + Sec-Fetch-Dest=iframe + Sec-Fetch-Site=same-origin + non-matching Referer → DENIES (same-origin iframe still under refinement)", () => {
    // Same-origin iframe loads do NOT get the proxy carve-out —
    // there is no embed-proxy intermediary involved, so a non-
    // matching Referer means the request is not coming from an
    // allowed parent on this origin. Keep strict refinement.
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        referer: "https://attacker.example/foo",
        publicEmbedBypass: true,
        secFetchDest: "iframe",
        secFetchSite: "same-origin",
      }),
    ).toEqual({ allow: false });
  });

  it("publicEmbedBypass=true + allowedDomains + Sec-Fetch-Dest=image + Sec-Fetch-Site=cross-site + non-matching Referer → DENIES (image refinement preserved)", () => {
    // Image embeds (oEmbed type:photo URL inlined as <img>) never go
    // through a wrapper iframe — Referer is preserved end-to-end. The
    // F9.10 strict refinement on image-direct embeds is unchanged.
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        referer: "https://attacker.example/foo",
        publicEmbedBypass: true,
        secFetchDest: "image",
        secFetchSite: "cross-site",
      }),
    ).toEqual({ allow: false });
  });

  it("publicEmbedBypass=true + allowedDomains + NO Sec-Fetch-Dest header (server-side oEmbed crawler) → allows even with no Referer", () => {
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        publicEmbedBypass: true,
        secFetchDest: null,
        secFetchSite: null,
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=true + EMPTY allowedDomains + Sec-Fetch-Dest=document + no Referer → allows (no narrowing to enforce — admin signaled embed-anywhere)", () => {
    const policy = { ...openPolicy, allowedDomains: [] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        publicEmbedBypass: true,
        secFetchDest: "document",
        secFetchSite: "none",
      }),
    ).toMatchObject({ allow: true });
  });

  it("publicEmbedBypass=false (default / undefined) preserves the legacy deny — regression guard", () => {
    const policy = { ...openPolicy, allowedDomains: ["example.com"] };
    // Explicit false:
    expect(
      enforcePolicy(policy, { ...baseCtx, publicEmbedBypass: false }),
    ).toEqual({ allow: false });
    // Undefined (existing call sites that haven't been updated):
    expect(enforcePolicy(policy, baseCtx)).toEqual({ allow: false });
  });

  // ---- bypassRefererRefinement — sub-fetch token carve-out ----
  // /l/[hash]/raw flips this on when the request carries a valid
  // raw-fetch HMAC token (minted by the outer /l/[hash] page after
  // it already passed the Referer check). The flag must skip the
  // publicEmbedBypass referer-refinement gate without touching
  // requireAuth or allowedIpRanges.

  it("bypassRefererRefinement=true allows publicEmbed + allowedDomains + Sec-Fetch-Dest set + null Referer (sub-fetch path)", () => {
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        publicEmbedBypass: true,
        secFetchDest: "empty",
        secFetchSite: "same-origin",
        bypassRefererRefinement: true,
      }),
    ).toMatchObject({ allow: true });
  });

  it("bypassRefererRefinement=true does NOT bypass requireAuth (auth still wins)", () => {
    const policy = {
      ...openPolicy,
      allowedDomains: ["embed.test.com"],
      requireAuth: true,
    };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        publicEmbedBypass: true,
        secFetchDest: "empty",
        secFetchSite: "same-origin",
        bypassRefererRefinement: true,
      }),
    ).toEqual({ allow: false });
  });

  it("bypassRefererRefinement=true ignored when publicEmbedBypass=false (non-embeddable link still gated by allowedDomains)", () => {
    const policy = { ...openPolicy, allowedDomains: ["embed.test.com"] };
    expect(
      enforcePolicy(policy, {
        ...baseCtx,
        publicEmbedBypass: false,
        bypassRefererRefinement: true,
      }),
    ).toEqual({ allow: false });
  });
});

// ---------------------------------------------------------------------------
// resolvePolicy (inheritance)
// ---------------------------------------------------------------------------
function makeStub(policies: ReadonlyArray<Record<string, unknown>>) {
  const calls: Record<string, unknown>[] = [];
  const client: PolicyEnginePrisma = {
    accessPolicy: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        calls.push(args);
        // Return rows whose targetType+targetValue match the OR clauses;
        // keep the stub naive so the engine's filtering logic is what is
        // actually under test.
        return [...policies];
      }),
    },
  };
  return { client, calls };
}

const documentInfo = {
  bucketName: "alpha-bucket",
  s3Key: "shared/contracts/q4.pdf",
};

describe("resolvePolicy (inheritance order)", () => {
  it("returns default policy when nothing matches", async () => {
    const stub = makeStub([]);
    const policy = await resolvePolicy(stub.client, documentInfo);
    expect(policy.source).toBe("default");
    expect(policy.policyId).toBeNull();
    expect(policy).toMatchObject(defaultPolicy);
    // Sec-review H3: HIPAA-safe default requires authentication.
    expect(policy.requireAuth).toBe(true);
  });

  it("object policy beats prefix and bucket", async () => {
    const stub = makeStub([
      {
        id: "p-bucket",
        targetType: "bucket",
        targetValue: "alpha-bucket",
        allowedDomains: [],
        allowedIpRanges: [],
        linkTtlSeconds: 900,
        maxDownloads: null,
        requireAuth: false,
      },
      {
        id: "p-prefix",
        targetType: "prefix",
        targetValue: "shared/",
        allowedDomains: [],
        allowedIpRanges: [],
        linkTtlSeconds: 900,
        maxDownloads: null,
        requireAuth: false,
      },
      {
        id: "p-obj",
        targetType: "object",
        targetValue: "shared/contracts/q4.pdf",
        allowedDomains: [],
        allowedIpRanges: [],
        linkTtlSeconds: 60,
        maxDownloads: null,
        requireAuth: true,
      },
    ]);
    const policy = await resolvePolicy(stub.client, documentInfo);
    expect(policy.source).toBe("object");
    expect(policy.policyId).toBe("p-obj");
    expect(policy.requireAuth).toBe(true);
    expect(policy.linkTtlSeconds).toBe(60);
  });

  it("longest matching prefix wins when no object policy exists", async () => {
    const stub = makeStub([
      {
        id: "p-short",
        targetType: "prefix",
        targetValue: "shared/",
        allowedDomains: [],
        allowedIpRanges: [],
        linkTtlSeconds: 1800,
        maxDownloads: null,
        requireAuth: false,
      },
      {
        id: "p-long",
        targetType: "prefix",
        targetValue: "shared/contracts/",
        allowedDomains: [],
        allowedIpRanges: [],
        linkTtlSeconds: 600,
        maxDownloads: null,
        requireAuth: true,
      },
    ]);
    const policy = await resolvePolicy(stub.client, documentInfo);
    expect(policy.source).toBe("prefix");
    expect(policy.policyId).toBe("p-long");
    expect(policy.linkTtlSeconds).toBe(600);
  });

  it("ignores prefix policies that are not actually a prefix of the key", async () => {
    const stub = makeStub([
      {
        id: "p-other",
        targetType: "prefix",
        targetValue: "private/",
        allowedDomains: [],
        allowedIpRanges: [],
        linkTtlSeconds: 60,
        maxDownloads: null,
        requireAuth: true,
      },
    ]);
    const policy = await resolvePolicy(stub.client, documentInfo);
    expect(policy.source).toBe("default");
  });

  it("resolvePolicyOrNull returns null when nothing matches (no defaultPolicy fallback)", async () => {
    const stub = makeStub([]);
    const r = await resolvePolicyOrNull(stub.client, documentInfo);
    expect(r).toBeNull();
  });

  it("resolvePolicyOrNull returns the matched row when something matches", async () => {
    const stub = makeStub([
      {
        id: "p-bucket",
        targetType: "bucket",
        targetValue: "alpha-bucket",
        allowedDomains: [],
        allowedIpRanges: [],
        linkTtlSeconds: 900,
        maxDownloads: null,
        requireAuth: false,
      },
    ]);
    const r = await resolvePolicyOrNull(stub.client, documentInfo);
    expect(r?.policyId).toBe("p-bucket");
  });

  it("linkDefaultPolicy permits anonymous (requireAuth=false), distinct from defaultPolicy", () => {
    expect(linkDefaultPolicy.requireAuth).toBe(false);
    expect(defaultPolicy.requireAuth).toBe(true);
  });

  it("falls back to bucket policy when no object/prefix matches", async () => {
    const stub = makeStub([
      {
        id: "p-bucket",
        targetType: "bucket",
        targetValue: "alpha-bucket",
        allowedDomains: ["app.example.com"],
        allowedIpRanges: [],
        linkTtlSeconds: 1800,
        maxDownloads: null,
        requireAuth: false,
      },
    ]);
    const policy = await resolvePolicy(stub.client, documentInfo);
    expect(policy.source).toBe("bucket");
    expect(policy.policyId).toBe("p-bucket");
    expect(policy.allowedDomains).toEqual(["app.example.com"]);
  });
});
