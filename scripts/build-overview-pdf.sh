#!/usr/bin/env bash
# Build docs/PLATFORM-OVERVIEW.pdf from docs/PLATFORM-OVERVIEW.md.
#
# Picks the first available pandoc PDF engine, in order of preference:
#   1. xelatex   - best Unicode + font handling
#   2. lualatex  - same family, fallback
#   3. pdflatex  - lightest LaTeX
#   4. wkhtmltopdf - HTML route, no LaTeX needed
#   5. weasyprint  - pure Python HTML route
#
# Usage:
#   bash scripts/build-overview-pdf.sh
#
# Output:
#   docs/PLATFORM-OVERVIEW.pdf

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/docs/PLATFORM-OVERVIEW.md"
OUT="$REPO_ROOT/docs/PLATFORM-OVERVIEW.pdf"

if [[ ! -f "$SRC" ]]; then
  echo "error: source markdown not found at $SRC" >&2
  exit 1
fi

if ! command -v pandoc >/dev/null 2>&1; then
  echo "error: pandoc not installed. Install via: brew install pandoc" >&2
  exit 1
fi

ENGINE=""
for candidate in xelatex lualatex pdflatex wkhtmltopdf weasyprint; do
  if command -v "$candidate" >/dev/null 2>&1; then
    ENGINE="$candidate"
    break
  fi
done

CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  if [[ -x "$c" ]]; then
    CHROME="$c"
    break
  fi
done

if [[ -z "$ENGINE" && -z "$CHROME" ]]; then
  cat >&2 <<EOF
error: no PDF engine found. Install one of:
  brew install --cask basictex          # provides pdflatex/xelatex
  brew install wkhtmltopdf
  brew install weasyprint
or have Google Chrome / Chromium / Edge installed (we will use headless).
EOF
  exit 1
fi

# If no LaTeX/wkhtmltopdf engine but Chrome exists, take the HTML+Chrome path.
if [[ -z "$ENGINE" && -n "$CHROME" ]]; then
  ENGINE="chrome-headless"
fi

echo "Building $OUT using engine: $ENGINE"

if [[ "$ENGINE" == "chrome-headless" ]]; then
  TMPHTML="$(mktemp -t platform-overview-XXXXXX).html"
  trap 'rm -f "$TMPHTML"' EXIT

  CSS_FILE="$(mktemp -t overview-css-XXXXXX).css"
  cat > "$CSS_FILE" <<'CSS'
@page { size: Letter; margin: 1in; }
html { font-size: 11pt; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  color: #111;
  line-height: 1.5;
  max-width: 7in;
  margin: 0 auto;
}
h1 { font-size: 1.7rem; border-bottom: 2px solid #222; padding-bottom: .3rem; margin-top: 2rem; }
h2 { font-size: 1.3rem; margin-top: 1.6rem; }
h3 { font-size: 1.1rem; margin-top: 1.2rem; }
h1, h2, h3 { page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
code, pre { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9.5pt; }
pre {
  background: #f4f4f4;
  border: 1px solid #ddd;
  padding: .8rem 1rem;
  border-radius: 4px;
  white-space: pre;
  overflow-x: auto;
  page-break-inside: avoid;
}
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 10pt; page-break-inside: avoid; }
th, td { border: 1px solid #bbb; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #eee; }
blockquote {
  border-left: 4px solid #888; margin-left: 0; padding: .3rem 1rem;
  background: #f9f9f9; color: #333;
}
hr { border: 0; border-top: 1px solid #bbb; margin: 2rem 0; }
a { color: #0a4ea3; }
nav#TOC ul { list-style: none; padding-left: 1rem; }
nav#TOC > ul { padding-left: 0; }
header#title-block-header { text-align: center; margin: 1rem 0 3rem 0; }
header#title-block-header .title { font-size: 1.8rem; font-weight: 700; }
header#title-block-header .subtitle { font-size: 1.1rem; color: #555; margin-top: .4rem; }
header#title-block-header .author, header#title-block-header .date { color: #666; margin-top: .3rem; }
CSS
  trap 'rm -f "$TMPHTML" "$CSS_FILE"' EXIT

  pandoc "$SRC" \
    -o "$TMPHTML" \
    --standalone \
    --toc --toc-depth=2 \
    --css="$CSS_FILE" \
    --self-contained \
    --metadata=title="HelpUcompli Document Repository — Platform Overview" \
    --metadata=author="HelpUcompli" \
    --metadata=date="April 2026"

  "$CHROME" \
    --headless \
    --disable-gpu \
    --no-pdf-header-footer \
    --print-to-pdf="$OUT" \
    --print-to-pdf-no-header \
    --no-margins \
    --virtual-time-budget=10000 \
    "file://$TMPHTML"
else
  ARGS=(
    "$SRC"
    -o "$OUT"
    --pdf-engine="$ENGINE"
    --toc
    --toc-depth=2
    --metadata=title="HelpUcompli Document Repository — Platform Overview"
    --metadata=author="HelpUcompli"
    --metadata=date="April 2026"
  )

  case "$ENGINE" in
    xelatex|lualatex|pdflatex)
      ARGS+=(
        -V geometry:margin=1in
        -V fontsize=11pt
        -V documentclass=article
        -V colorlinks=true
        -V linkcolor=black
        -V urlcolor=black
      )
      ;;
    wkhtmltopdf)
      ARGS+=(
        -V margin-top=20mm
        -V margin-bottom=20mm
        -V margin-left=20mm
        -V margin-right=20mm
      )
      ;;
  esac

  pandoc "${ARGS[@]}"
fi

echo "Wrote $OUT"
ls -lh "$OUT"
