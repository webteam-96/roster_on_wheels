import { describe, expect, it } from "vitest";
import { groupStats } from "./groupStats";

// The labels DailyStatsReportService sends.
const LABELS = [
  "Total Sync Clubs (the zones)",
  "Total Members (the zones)",
  "Total Non-Sync Clubs (excluding exempt districts)",
  "Total Newsletters (2026-27)",
  "Total Project Photos — 2026-27",
  "Total Project Photos — All Years",
  "Projects Added Yesterday — One-Time",
  "Projects Added Yesterday — Ongoing",
  "Projects Added Yesterday — Total",
  "Total Club Service (2026-27)",
  "Total Projects (2026-27) — One-Time",
  "Total Projects (2026-27) — Ongoing",
  "Total Projects (2026-27) — Total (= website)",
  "Not counted — repeat entries of ongoing projects",
  "Clubs Involved in Projects (2026-27)",
];
const metrics = LABELS.map((metric, i) => ({ metric, count: i + 1 }));

describe("groupStats", () => {
  it("places every line of the report once, with its own number", () => {
    const { headline, groups } = groupStats(metrics);
    const all = [...headline, ...groups.flatMap((g) => g.rows)].map((s) => s.count).sort((a, b) => a - b);
    expect(all).toEqual(metrics.map((m) => m.count));
    expect(groups.map((g) => g.title)).toEqual(["Projects 2026-27", "Added yesterday", "Photos"]);
    expect(headline.map((s) => [s.label, s.count])).toEqual([
      ["Members", 2],
      ["Synced clubs", 1],
      ["Clubs not synced", 3],
      ["Newsletters", 4],
    ]);
    expect(groups[2].rows.map((s) => [s.label, s.count])).toEqual([["All years", 6], ["This Rotary year", 5]]);
  });

  it("keeps a line it does not know", () => {
    const { groups } = groupStats([...metrics, { metric: "Total Grants — New", count: 99 }]);
    expect(groups.at(-1)).toEqual({ title: "Other figures", rows: [{ label: "Total Grants: New", count: 99 }] });
  });
});
