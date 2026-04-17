// BigInt JSON-serialization helpers for Module 06 API routes.
//
// `JSON.stringify(BigInt(1))` throws `TypeError: Do not know how to
// serialize a BigInt`. Document.sizeBytes is declared BigInt in Prisma
// so size values > 2^53 survive 5 GB+ files, but any API route that
// returns the value via `NextResponse.json(doc)` blows up.
//
// Two patterns are supported:
//   1. `toJsonSafe(value)` — recursively replaces BigInt with a numeric
//      string (or number when safe). Use at the response boundary.
//   2. `installBigIntJsonSerializer()` — monkey-patches BigInt.prototype
//      so ambient JSON.stringify works. Use ONLY in server bootstrap
//      (instrumentation.ts) when the response boundary cannot wrap every
//      call.
//
// Prefer (1) — explicit, side-effect free, and the serialization choice
// is visible at the call site.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Max safe integer that JSON `number` can hold without loss. */
const JS_MAX_SAFE_INT = BigInt(Number.MAX_SAFE_INTEGER);
const JS_MIN_SAFE_INT = BigInt(Number.MIN_SAFE_INTEGER);

function bigIntToJson(v: bigint): string | number {
  // Preserve numeric semantics for small-ish values; fall back to
  // string to avoid precision loss past 2^53.
  if (v <= JS_MAX_SAFE_INT && v >= JS_MIN_SAFE_INT) return Number(v);
  return v.toString();
}

export function toJsonSafe<T>(value: T): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return bigIntToJson(value);
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => toJsonSafe(v));
  if (typeof value === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafe(v);
    }
    return out;
  }
  // functions, symbols — drop (matches JSON.stringify semantics)
  return null;
}

/**
 * Install a global BigInt.prototype.toJSON shim so ambient JSON.stringify
 * emits a numeric string for large values. Call ONCE at server startup
 * (instrumentation.ts). Callers should prefer `toJsonSafe(value)` at the
 * response boundary — this shim exists for legacy callsites only.
 */
export function installBigIntJsonSerializer(): void {
  if (typeof (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON === "function") {
    return;
  }
  Object.defineProperty(BigInt.prototype, "toJSON", {
    value: function toJSON(this: bigint): string | number {
      return bigIntToJson(this);
    },
    configurable: true,
    writable: true,
  });
}
