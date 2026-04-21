// Shared builder for the iframe snippet shown in the generate-link
// result panel AND the link-table copy-embed action. Keeping one source
// of truth avoids the two UIs drifting (different width / height /
// sandbox). If HIPAA review requires a `sandbox` attribute later, update
// it here only.

// HTML-attribute escape. The shareable URL is built from the request
// origin + randomBytes token and normally contains no unsafe chars, but
// defense-in-depth: if a malicious caller ever injects quotes into the
// URL, we must NOT let them break out of the `src="..."` attribute and
// inject `onload=` handlers.
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildEmbedCode(shareableUrl: string): string {
  const safe = escapeAttr(shareableUrl);
  return `<iframe
  src="${safe}"
  width="100%"
  height="600"
  style="border:0"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
  allow="fullscreen"
></iframe>`;
}
