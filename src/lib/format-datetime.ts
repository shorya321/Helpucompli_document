// Fixed locale + options keep SSR output byte-identical to client hydration
// output. Without this, Node (en-US default) and the browser (user locale)
// diverge and React 19 throws a hydration-mismatch error.
const LOCALE = "en-US";

const DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "2-digit",
};

export function formatDateTime(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat(LOCALE, DATETIME_OPTS).format(date);
}

export function formatDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat(LOCALE, DATE_OPTS).format(date);
}
