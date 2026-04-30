/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Smoke test for the user-reported question:
//   "Do 'never-expires' generated links keep working past 7 days when
//    embedded as <img>/<video> on Circle.so / Compass / etc.?"
//
// Pre-fix findings (preserved here for the regression record):
//   - DB row (GeneratedLink.expiresAt = null) is genuinely perpetual.
//   - Server-side S3 presigned URL is re-minted on every /raw hit and
//     never reaches the browser, so the SigV4 7-day cap is not the
//     binding constraint at the embed layer.
//   - HOWEVER — the URL the browser sees was /l/<hash>/raw?t=<HMAC>,
//     and the HMAC token was hardcoded to a 7-day TTL at three call
//     sites (share-info embedImageUrl, viewer og:image / og:video,
//     oEmbed photo.url). After 7d /raw rejected the request with
//     InvalidRawFetchTokenError("expired") → 403 and the embed broke
//     on the third-party page.
//
// Post-fix (src/lib/embed-token-ttl.ts):
//   - chooseEmbedTokenTtlSec(null) → EMBED_TOKEN_PERPETUAL_TTL_SEC
//     (10 years), so a perpetual link's embed token survives well
//     past any plausible third-party cache window.
//   - Finite links keep the existing min(7d, remaining) clamp.
//   - Revocation is still the kill switch — /raw checks
//     link.isRevoked on every request.
//
// This test file proves the post-fix behavior deterministically (no
// real wait):
//   - Phase A: chooseEmbedTokenTtlSec(null) returns the 10y constant;
//     issued external-embed token's `exp` claim is now + 10y.
//   - Phase B: time-travel via vi.setSystemTime — token issued at T0
//     still verifies at T0+10d, T0+30d, T0+1y, T0+5y. Fails only at
//     T0+11y (well beyond any realistic embed lifetime).
//   - Phase C: finite-link clamp still works (regression guard).
//   - Phase D: revocation gate is still load-bearing — a perpetual
//     embed token can be killed instantly by setting isRevoked=true,
//     which /raw checks on every request (covered by route tests).

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    AUTH0_SECRET:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  }),
}));

import {
  InvalidRawFetchTokenError,
  issueRawFetchToken,
  verifyRawFetchToken,
} from "@/lib/raw-fetch-token";
import {
  chooseEmbedTokenTtlSec,
  EMBED_TOKEN_FINITE_DEFAULT_TTL_SEC,
  EMBED_TOKEN_FLOOR_TTL_SEC,
  EMBED_TOKEN_PERPETUAL_TTL_SEC,
} from "@/lib/embed-token-ttl";

const HASH = "perpetual_link_hash_value_for_durability_test";
const SEVEN_DAYS_SEC = 7 * 24 * 3600;
const TEN_YEARS_SEC = 10 * 365 * 24 * 3600;
const T0 = new Date("2026-04-30T00:00:00Z");

interface SerializedClaims {
  readonly hash: string;
  readonly exp: number;
  readonly kind: "sub-fetch" | "external-embed";
}

function decodeClaims(token: string): SerializedClaims {
  const [payloadB64] = token.split(".");
  const payloadJson = Buffer.from(
    (payloadB64 ?? "").replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
  return JSON.parse(payloadJson) as SerializedClaims;
}

describe("embed-token durability for never-expires links", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  // ------------------------------------------------------------------
  // Phase A — TTL-resolver inspection (no time travel)
  // ------------------------------------------------------------------

  describe("Phase A — TTL-resolver inspection", () => {
    it("perpetual link (expiresAt=null) → embed token TTL is 10 years (post-fix)", () => {
      const ttl = chooseEmbedTokenTtlSec(null);
      expect(ttl).toBe(TEN_YEARS_SEC);
      expect(ttl).toBe(EMBED_TOKEN_PERPETUAL_TTL_SEC);
    });

    it("issued external-embed token carries exp = now + 10 years for a perpetual link", () => {
      const ttl = chooseEmbedTokenTtlSec(null);
      const token = issueRawFetchToken(HASH, ttl, "external-embed");

      const claims = decodeClaims(token);
      const nowSec = Math.floor(T0.getTime() / 1000);

      expect(claims.kind).toBe("external-embed");
      expect(claims.hash).toBe(HASH);
      expect(claims.exp).toBe(nowSec + TEN_YEARS_SEC);
      expect(claims.exp - nowSec).toBeGreaterThan(SEVEN_DAYS_SEC);
    });

    it("finite link (expiresAt < 7 days away) → token TTL clamps to remaining", () => {
      const expiresAt = new Date(T0.getTime() + 3 * 24 * 3600 * 1000); // +3d
      const ttl = chooseEmbedTokenTtlSec(expiresAt);

      expect(ttl).toBeLessThanOrEqual(3 * 24 * 3600);
      expect(ttl).toBeLessThan(EMBED_TOKEN_FINITE_DEFAULT_TTL_SEC);
    });

    it("finite link (expiresAt > 7 days away) → token TTL caps at 7d", () => {
      const expiresAt = new Date(T0.getTime() + 30 * 24 * 3600 * 1000); // +30d
      const ttl = chooseEmbedTokenTtlSec(expiresAt);
      expect(ttl).toBe(EMBED_TOKEN_FINITE_DEFAULT_TTL_SEC);
    });

    it("finite link already past expiry → returns the 60s floor", () => {
      const expiresAt = new Date(T0.getTime() - 60 * 1000); // 60s ago
      const ttl = chooseEmbedTokenTtlSec(expiresAt);
      expect(ttl).toBe(EMBED_TOKEN_FLOOR_TTL_SEC);
    });
  });

  // ------------------------------------------------------------------
  // Phase B — time-travel verification (proves post-fix durability)
  // ------------------------------------------------------------------

  describe("Phase B — time-travel verification (10+ day equivalent)", () => {
    it("perpetual-link token issued at T0 still verifies at T0 + 10 days", () => {
      const token = issueRawFetchToken(
        HASH,
        chooseEmbedTokenTtlSec(null),
        "external-embed",
      );

      vi.setSystemTime(new Date(T0.getTime() + 10 * 24 * 3600 * 1000));
      expect(verifyRawFetchToken(token, HASH)).toEqual({
        kind: "external-embed",
      });
    });

    it("perpetual-link token issued at T0 still verifies at T0 + 30 days", () => {
      const token = issueRawFetchToken(
        HASH,
        chooseEmbedTokenTtlSec(null),
        "external-embed",
      );

      vi.setSystemTime(new Date(T0.getTime() + 30 * 24 * 3600 * 1000));
      expect(verifyRawFetchToken(token, HASH)).toEqual({
        kind: "external-embed",
      });
    });

    it("perpetual-link token issued at T0 still verifies at T0 + 1 year", () => {
      const token = issueRawFetchToken(
        HASH,
        chooseEmbedTokenTtlSec(null),
        "external-embed",
      );

      vi.setSystemTime(new Date(T0.getTime() + 365 * 24 * 3600 * 1000));
      expect(verifyRawFetchToken(token, HASH)).toEqual({
        kind: "external-embed",
      });
    });

    it("perpetual-link token issued at T0 still verifies at T0 + 5 years", () => {
      const token = issueRawFetchToken(
        HASH,
        chooseEmbedTokenTtlSec(null),
        "external-embed",
      );

      vi.setSystemTime(new Date(T0.getTime() + 5 * 365 * 24 * 3600 * 1000));
      expect(verifyRawFetchToken(token, HASH)).toEqual({
        kind: "external-embed",
      });
    });

    it("perpetual-link token issued at T0 FAILS at T0 + 11 years (long-tail upper bound)", () => {
      const token = issueRawFetchToken(
        HASH,
        chooseEmbedTokenTtlSec(null),
        "external-embed",
      );

      vi.setSystemTime(new Date(T0.getTime() + 11 * 365 * 24 * 3600 * 1000));
      expect(() => verifyRawFetchToken(token, HASH)).toThrow(
        InvalidRawFetchTokenError,
      );
      expect(() => verifyRawFetchToken(token, HASH)).toThrow(/expired/);
    });
  });

  // ------------------------------------------------------------------
  // Phase C — finite-link regression guard
  // ------------------------------------------------------------------

  describe("Phase C — finite-link regression guard (no behavior change)", () => {
    it("3-day finite link: token still verifies at T0 + 2d, fails at T0 + 4d", () => {
      const expiresAt = new Date(T0.getTime() + 3 * 24 * 3600 * 1000);
      const token = issueRawFetchToken(
        HASH,
        chooseEmbedTokenTtlSec(expiresAt),
        "external-embed",
      );

      vi.setSystemTime(new Date(T0.getTime() + 2 * 24 * 3600 * 1000));
      expect(verifyRawFetchToken(token, HASH)).toEqual({
        kind: "external-embed",
      });

      vi.setSystemTime(new Date(T0.getTime() + 4 * 24 * 3600 * 1000));
      expect(() => verifyRawFetchToken(token, HASH)).toThrow(
        InvalidRawFetchTokenError,
      );
    });
  });

  // ------------------------------------------------------------------
  // Phase D — revocation contract (kill switch is still load-bearing)
  // ------------------------------------------------------------------

  describe("Phase D — revocation kill switch unchanged", () => {
    it("token verification only checks signature + hash + exp; revocation is enforced elsewhere", () => {
      // verifyRawFetchToken is intentionally unaware of DB state — it
      // gates on cryptographic + temporal claims only. Revocation is
      // enforced by /raw via link-access.ts (computeLinkStatus →
      // status='revoked' → 403). This test pins that contract so a
      // future refactor that bakes a DB lookup into the verifier
      // would have to update the route layer in lockstep.
      const token = issueRawFetchToken(
        HASH,
        chooseEmbedTokenTtlSec(null),
        "external-embed",
      );

      // Token verifies regardless of revocation state — by design.
      vi.setSystemTime(new Date(T0.getTime() + 30 * 24 * 3600 * 1000));
      expect(verifyRawFetchToken(token, HASH)).toEqual({
        kind: "external-embed",
      });

      // /raw still rejects revoked links — covered exhaustively by
      // src/__tests__/links/link-raw-route.test.ts (status='revoked'
      // path) and src/__tests__/links/link-access.test.ts.
    });
  });
});
