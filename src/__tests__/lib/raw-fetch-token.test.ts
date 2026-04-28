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

  it("signs and verifies a token", () => {
    const t = issueRawFetchToken(HASH, 120);
    expect(verifyRawFetchToken(t, HASH)).toBe(true);
  });

  it("fails when the hash differs", () => {
    const t = issueRawFetchToken(HASH, 120);
    expect(() => verifyRawFetchToken(t, "different_hash_value_xxx")).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("fails when the token is expired", () => {
    const t = issueRawFetchToken(HASH, 60);
    vi.setSystemTime(new Date("2026-04-28T00:02:00Z")); // +120s
    expect(() => verifyRawFetchToken(t, HASH)).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("fails on tampered signature", () => {
    const t = issueRawFetchToken(HASH, 120);
    const tampered = t.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(() => verifyRawFetchToken(tampered, HASH)).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("rejects malformed (non-dot-separated) input", () => {
    expect(() => verifyRawFetchToken("garbage", HASH)).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("rejects empty hash at issue time", () => {
    expect(() => issueRawFetchToken("", 120)).toThrow(
      InvalidRawFetchTokenError,
    );
  });

  it("rejects non-positive ttl at issue time", () => {
    expect(() => issueRawFetchToken(HASH, 0)).toThrow(
      InvalidRawFetchTokenError,
    );
    expect(() => issueRawFetchToken(HASH, -1)).toThrow(
      InvalidRawFetchTokenError,
    );
  });
});
