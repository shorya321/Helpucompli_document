#!/usr/bin/env node
/**
 * lint:tokens — enforces the single-source-of-truth CSS rule.
 *
 * Bans anywhere under src/components/ and src/app/(dashboard)/:
 *   - hex color literals (#RRGGBB, #RGB, #RRGGBBAA)
 *   - Tailwind arbitrary color values: bg-[#...], text-[#...], border-[#...], etc.
 *
 * Permanent whitelist (hex always allowed):
 *   src/components/ui/**, src/lib/email.ts, src/lib/auth0-branding.ts,
 *   src/app/globals.css, src/lib/brand.ts.
 *
 * Transitional allowlist (see scripts/lint-tokens-allowlist.txt):
 *   Files still awaiting migration during Phases B/C/D. Lines are removed
 *   as each module is migrated to semantic Tailwind tokens.
 *
 * All design tokens live in src/app/globals.css. Components reference
 * them only through semantic Tailwind classes (bg-background,
 * text-foreground, border-border, etc.).
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  join(ROOT, "src", "components"),
  join(ROOT, "src", "app", "(dashboard)"),
];

const PERMANENT_WHITELIST_PREFIXES = [
  join(ROOT, "src", "components", "ui") + sep,
  join(ROOT, "src", "lib", "email.ts"),
  join(ROOT, "src", "lib", "auth0-branding.ts"),
  join(ROOT, "src", "app", "globals.css"),
  join(ROOT, "src", "lib", "brand.ts"),
];

const ALLOWLIST_FILE = join(ROOT, "scripts", "lint-tokens-allowlist.txt");
const transitionalAllowlist = new Set();
if (existsSync(ALLOWLIST_FILE)) {
  const raw = readFileSync(ALLOWLIST_FILE, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    transitionalAllowlist.add(join(ROOT, trimmed));
  }
}

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const ARBITRARY_TW_RE =
  /(?:bg|text|border|fill|stroke|ring|from|to|via|outline|shadow|decoration|divide|placeholder|caret|accent)-\[#[0-9a-fA-F]{3,8}\]/;

function isPermanentlyWhitelisted(fullPath) {
  return PERMANENT_WHITELIST_PREFIXES.some(
    (p) => fullPath === p || fullPath.startsWith(p),
  );
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
const stillOnAllowlist = new Set();
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    if (isPermanentlyWhitelisted(file)) continue;
    const content = readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);
    let fileHasHex = false;
    lines.forEach((line, i) => {
      if (ARBITRARY_TW_RE.test(line)) {
        if (transitionalAllowlist.has(file)) {
          fileHasHex = true;
          return;
        }
        violations.push({
          file,
          line: i + 1,
          kind: "arbitrary-tailwind-color",
          snippet: line.trim(),
        });
      } else if (HEX_RE.test(line)) {
        if (transitionalAllowlist.has(file)) {
          fileHasHex = true;
          return;
        }
        violations.push({
          file,
          line: i + 1,
          kind: "hex-literal",
          snippet: line.trim(),
        });
      }
    });
    if (fileHasHex) stillOnAllowlist.add(file);
  }
}

// Detect allowlist drift: files on allowlist that no longer have hex should be removed.
const staleAllowlistEntries = [];
for (const allowed of transitionalAllowlist) {
  if (!existsSync(allowed)) continue;
  if (!stillOnAllowlist.has(allowed)) {
    staleAllowlistEntries.push(relative(ROOT, allowed));
  }
}

if (violations.length > 0) {
  console.error(`\nlint:tokens FAILED — ${violations.length} violation(s):\n`);
  for (const v of violations) {
    const rel = relative(ROOT, v.file);
    console.error(`  ${rel}:${v.line}  [${v.kind}]`);
    console.error(`    ${v.snippet.slice(0, 160)}`);
  }
  console.error(
    `\nFix: replace with semantic Tailwind classes (bg-background, text-foreground, border-border, etc.). All tokens are defined in src/app/globals.css.\n`,
  );
  process.exit(1);
}

if (staleAllowlistEntries.length > 0) {
  console.error(
    `\nlint:tokens — ${staleAllowlistEntries.length} file(s) on the transitional allowlist no longer contain hex literals. Remove these lines from scripts/lint-tokens-allowlist.txt:\n`,
  );
  for (const entry of staleAllowlistEntries) {
    console.error(`  ${entry}`);
  }
  console.error("");
  process.exit(1);
}

const remaining = transitionalAllowlist.size;
if (remaining > 0) {
  console.log(
    `lint:tokens OK — no new hex literals. ${remaining} file(s) still on transitional allowlist (shrinks as modules migrate).`,
  );
} else {
  console.log(
    "lint:tokens OK — single-source-of-truth fully enforced. Consider deleting scripts/lint-tokens-allowlist.txt.",
  );
}
