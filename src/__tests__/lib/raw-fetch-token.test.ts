/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const HASH = "abc_hash_value_with_long_enough_token_xyz";

describe("raw-fetch token", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T00:00:00Z"));
  });

  it("signs and verifies a sub-fetch token", () => {
    const t = issueRawFetchToken(HASH, 120, "sub-fetch");
    expect(verifyRawFetchToken(t, HASH)).toEqual({ kind: "sub-fetch" });
  });

  it("signs and verifies an external-embed token", () => {
    const t = issueRawFetchToken(HASH, 7 * 24 * 3600, "external-embed");
    expect(verifyRawFetchToken(t, HASH)).toEqual({ kind: "external-embed" });
  });

  it("fails when the hash differs", () => {
    const t = issueRawFetchToken(HASH, 120, "sub-fetch");
    expect(() => verifyRawFetchToken(t, "different_hash_value_xxx")).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("fails when the token is expired", () => {
    const t = issueRawFetchToken(HASH, 60, "sub-fetch");
    vi.setSystemTime(new Date("2026-04-28T00:02:00Z")); // +120s
    expect(() => verifyRawFetchToken(t, HASH)).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("fails on tampered signature", () => {
    const t = issueRawFetchToken(HASH, 120, "sub-fetch");
    const tampered = t.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(() => verifyRawFetchToken(tampered, HASH)).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("fails when the kind claim is tampered (signature must break)", () => {
    // Kind is part of the signed payload — flipping it must invalidate
    // the signature. Otherwise an attacker could downgrade an
    // external-embed token to sub-fetch and bypass refinement.
    const t = issueRawFetchToken(HASH, 120, "external-embed");
    const [payloadB64, sigB64] = t.split(".");
    const payloadJson = Buffer.from(payloadB64!, "base64").toString("utf8");
    const tamperedJson = payloadJson.replace(
      '"kind":"external-embed"',
      '"kind":"sub-fetch"',
    );
    const tamperedB64 = Buffer.from(tamperedJson)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const downgrade = `${tamperedB64}.${sigB64}`;
    expect(() => verifyRawFetchToken(downgrade, HASH)).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("rejects malformed (non-dot-separated) input", () => {
    expect(() => verifyRawFetchToken("garbage", HASH)).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("rejects empty hash at issue time", () => {
    expect(() => issueRawFetchToken("", 120, "sub-fetch")).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("rejects non-positive ttl at issue time", () => {
    expect(() => issueRawFetchToken(HASH, 0, "sub-fetch")).toThrow(
      InvalidRawFetchTokenError,
    );
    expect(() => issueRawFetchToken(HASH, -1, "sub-fetch")).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("rejects an unknown kind at issue time", () => {
    expect(() =>
      issueRawFetchToken(HASH, 120, "bogus" as unknown as "sub-fetch"),
    ).toThrow(InvalidRawFetchTokenError);
  });
});
