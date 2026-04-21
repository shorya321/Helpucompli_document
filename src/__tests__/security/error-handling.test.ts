import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F12.5 — error handling + monitoring contract. Asserts the Next.js
// app-level boundaries exist, carry the HIPAA-safe properties (no
// raw error echoing), and the health check + instrumentation wire
// up as expected.

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("error page files (F12.5)", () => {
  const ERROR = read("src/app/error.tsx");
  const NOT_FOUND = read("src/app/not-found.tsx");
  const GLOBAL = read("src/app/global-error.tsx");

  it("error.tsx is a client component with reset + digest surface", () => {
    expect(ERROR).toMatch(/["']use client["']/);
    expect(ERROR).toContain("reset");
    expect(ERROR).toContain("digest");
  });

  it("error.tsx does not echo raw error.message to the user (HIPAA leak guard)", () => {
    // The user-visible strings must not include error.message — only
    // a static phrase + reference digest. Matches inline JSX text.
    expect(ERROR).not.toMatch(/\{\s*error\.message\s*\}/);
  });

  it("not-found.tsx is a static page with a back-to-dashboard link", () => {
    expect(NOT_FOUND).toContain("404");
    expect(NOT_FOUND).toContain("/dashboard");
  });

  it("global-error.tsx renders its own <html><body> tree", () => {
    expect(GLOBAL).toMatch(/["']use client["']/);
    expect(GLOBAL).toContain("<html");
    expect(GLOBAL).toContain("<body");
  });
});

describe("/api/health (F12.5)", () => {
  it("GET returns 200 with status + service identifiers", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("helpucompli-document-repository");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("instrumentation graceful shutdown (F12.5 / F2.2 follow-up)", () => {
  const INSTR = read("src/instrumentation.ts");
  const INSTR_NODE = read("src/instrumentation-node.ts");

  it("instrumentation.ts exports async register()", () => {
    expect(INSTR).toMatch(/export async function register\b/);
  });

  it("instrumentation.ts guards NEXT_RUNTIME and dynamic-imports node module", () => {
    expect(INSTR).toContain("NEXT_RUNTIME");
    expect(INSTR).toContain("nodejs");
    expect(INSTR).toMatch(/import\(["']\.\/instrumentation-node["']\)/);
  });

  it("instrumentation-node.ts registers SIGTERM + SIGINT handlers", () => {
    expect(INSTR_NODE).toContain('process.on("SIGTERM"');
    expect(INSTR_NODE).toContain('process.on("SIGINT"');
  });

  it("instrumentation-node.ts flushes prisma via $disconnect on shutdown", () => {
    expect(INSTR_NODE).toContain("prisma.$disconnect");
  });

  it("instrumentation-node.ts exits cleanly with process.exit(0) after flush", () => {
    expect(INSTR_NODE).toContain("process.exit(0)");
  });
});
