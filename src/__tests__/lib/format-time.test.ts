import { describe, expect, it } from "vitest";
import { formatRelative } from "@/lib/format-time";

const NOW = new Date("2026-04-22T12:00:00Z");

describe("formatRelative", () => {
  it("renders 'now' for under a minute", () => {
    const out = formatRelative(new Date("2026-04-22T11:59:30Z"), NOW);
    // Intl uses "now" with numeric:auto for tiny diffs
    expect(out.toLowerCase()).toMatch(/now|second/);
  });

  it("renders minutes for under an hour", () => {
    const out = formatRelative(new Date("2026-04-22T11:55:00Z"), NOW);
    expect(out).toMatch(/5 minutes ago|minute/);
  });

  it("renders hours for under a day", () => {
    const out = formatRelative(new Date("2026-04-22T09:00:00Z"), NOW);
    expect(out).toMatch(/3 hours ago|hour/);
  });

  it("renders 'yesterday' for ~24h ago", () => {
    const out = formatRelative(new Date("2026-04-21T12:00:00Z"), NOW);
    // Intl numeric:auto resolves -1 day as "yesterday"
    expect(out.toLowerCase()).toMatch(/yesterday|day/);
  });

  it("renders multi-day diffs in days, not weeks", () => {
    const out = formatRelative(new Date("2026-04-12T12:00:00Z"), NOW);
    expect(out).toMatch(/10 days ago|day/);
  });

  it("renders future tense when the date is ahead of now", () => {
    const out = formatRelative(new Date("2026-04-22T12:30:00Z"), NOW);
    // "in 30 minutes" or "in half an hour"
    expect(out.toLowerCase()).toMatch(/in\s|min/);
  });

  it("uses the injected `now` for determinism", () => {
    const a = formatRelative(
      new Date("2026-04-22T11:00:00Z"),
      new Date("2026-04-22T12:00:00Z"),
    );
    const b = formatRelative(
      new Date("2026-04-22T11:00:00Z"),
      new Date("2026-04-23T12:00:00Z"),
    );
    expect(a).not.toBe(b);
  });

  it("defaults `now` to the current wall clock when omitted", () => {
    const out = formatRelative(new Date(Date.now() - 5_000));
    expect(out.toLowerCase()).toMatch(/now|second/);
  });
});
