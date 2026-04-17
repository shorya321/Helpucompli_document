import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installBigIntJsonSerializer, toJsonSafe } from "@/lib/bigint";

describe("toJsonSafe — BigInt + nested shape handling", () => {
  it("serializes small BigInt as a number (within safe-integer range)", () => {
    expect(toJsonSafe(BigInt(42))).toBe(42);
    expect(toJsonSafe(BigInt(0))).toBe(0);
    expect(toJsonSafe(BigInt(-1000))).toBe(-1000);
  });

  it("serializes huge BigInt as a string (avoids precision loss past 2^53)", () => {
    const big = BigInt("9007199254740993"); // MAX_SAFE_INT + 2
    expect(toJsonSafe(big)).toBe("9007199254740993");
  });

  it("walks arrays and converts BigInts element-wise", () => {
    expect(toJsonSafe([BigInt(1), "x", BigInt("99999999999999999999")])).toEqual([
      1,
      "x",
      "99999999999999999999",
    ]);
  });

  it("walks object values and converts BigInts inline", () => {
    const input = {
      id: "doc-1",
      sizeBytes: BigInt(5_368_709_120), // exactly 5 GB
      nested: { bytes: BigInt(999) },
    };
    expect(toJsonSafe(input)).toEqual({
      id: "doc-1",
      sizeBytes: 5_368_709_120,
      nested: { bytes: 999 },
    });
  });

  it("coerces Date to ISO string", () => {
    const d = new Date("2026-04-17T10:00:00Z");
    expect(toJsonSafe(d)).toBe("2026-04-17T10:00:00.000Z");
  });

  it("produces JSON that JSON.stringify can round-trip", () => {
    const safe = toJsonSafe({ size: BigInt(5_368_709_120) });
    expect(() => JSON.stringify(safe)).not.toThrow();
    expect(JSON.parse(JSON.stringify(safe))).toEqual({ size: 5_368_709_120 });
  });
});

describe("installBigIntJsonSerializer — global shim", () => {
  const originalToJSON = (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON;

  beforeEach(() => {
    // ensure clean slate per test
    delete (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON;
  });

  afterEach(() => {
    if (typeof originalToJSON === "function") {
      Object.defineProperty(BigInt.prototype, "toJSON", {
        value: originalToJSON,
        configurable: true,
        writable: true,
      });
    } else {
      delete (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON;
    }
  });

  it("makes ambient JSON.stringify(BigInt) work after install", () => {
    expect(() => JSON.stringify(BigInt(42))).toThrow(/BigInt/);
    installBigIntJsonSerializer();
    // after shim: small -> number, huge -> string
    expect(JSON.stringify({ a: BigInt(42) })).toBe('{"a":42}');
    expect(JSON.stringify({ a: BigInt("99999999999999999999") })).toBe(
      '{"a":"99999999999999999999"}',
    );
  });

  it("is idempotent — calling twice does not double-wrap", () => {
    installBigIntJsonSerializer();
    const first = (BigInt.prototype as unknown as { toJSON: unknown }).toJSON;
    installBigIntJsonSerializer();
    const second = (BigInt.prototype as unknown as { toJSON: unknown }).toJSON;
    expect(first).toBe(second);
  });
});
