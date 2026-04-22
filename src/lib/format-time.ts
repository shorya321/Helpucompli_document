// Shared relative-time formatter used by the dashboard activity feed
// and the bucket details Recent Documents list. Locale-aware via
// Intl.RelativeTimeFormat — no new dep, picks up the user's browser
// language. Granularity: seconds → minutes → hours → days, capped at
// days so the label never reads "5 weeks ago" (we'd rather show the
// exact ISO via a tooltip at that point).

export function formatRelative(when: Date, now: Date = new Date()): string {
  const diffSec = Math.round((when.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}
