#!/usr/bin/env node
// Copy pdfjs-dist runtime files into public/pdfjs/ so the embeddable
// link viewer can reference them as same-origin static assets:
//   - public/pdfjs/pdf.min.mjs        (library, ESM)
//   - public/pdfjs/pdf.worker.min.mjs (background worker)
//
// Why a copy script instead of `import "pdfjs-dist"`:
//   - The PDF preview is rendered by a static HTML page at
//     public/pdfjs/viewer.html which loads the library via a relative
//     URL. The page sits OUTSIDE the Next.js build (it's only ever
//     served as a static asset under /pdfjs/), so the bundler is not
//     in play. The JS files have to physically live next to viewer.html.
//   - Wired through `postinstall`, so a fresh `npm install` always
//     produces the public/pdfjs/* files. CI containers + new clones
//     get a working setup without an extra build step.
//
// Skip silently on platforms / installs that don't have the source
// files (e.g. partial monorepo installs). The viewer route falls back
// to direct /raw rendering if pdfjs assets are missing — but that's
// the failure mode we already saw on Chrome, so make the missing
// files loud.
import { cpSync, existsSync, mkdirSync } from "node:fs";

const FILES = ["pdf.min.mjs", "pdf.worker.min.mjs"];
const SRC_DIR = "node_modules/pdfjs-dist/build";
const DST_DIR = "public/pdfjs";

if (!existsSync(SRC_DIR)) {
  console.warn(
    `[copy-pdfjs] ${SRC_DIR} missing; skipping (run \`npm install pdfjs-dist\` first).`,
  );
  process.exit(0);
}

mkdirSync(DST_DIR, { recursive: true });
for (const file of FILES) {
  const src = `${SRC_DIR}/${file}`;
  const dst = `${DST_DIR}/${file}`;
  if (!existsSync(src)) {
    console.error(`[copy-pdfjs] missing ${src}`);
    process.exit(1);
  }
  cpSync(src, dst);
  console.log(`[copy-pdfjs] ${src} -> ${dst}`);
}
