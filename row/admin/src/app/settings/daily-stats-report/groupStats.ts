export type Metric = { metric: string; count: number };
export type Stat = { label: string; count: number; note?: string; total?: boolean };
export type StatGroup = { title: string; rows: Stat[] };

type Place = { to: "headline" | "Projects this year" | "Added yesterday" | "Photos"; label: string; note?: string; total?: boolean };

// The API sends one flat list (the same labels are in the email and the Excel). Each line gets a place and a shorter
// name here, in this order.
const PLACES: [RegExp, Place][] = [
  [/^total members/i, { to: "headline", label: "Members" }],
  [/^total sync clubs/i, { to: "headline", label: "Synced clubs", note: "From Rotary.org" }],
  [/^total non-sync clubs/i, { to: "headline", label: "Clubs not synced", note: "Exempt districts left out" }],
  [/^total newsletters/i, { to: "headline", label: "Newsletters", note: "This Rotary year" }],
  [/^total projects .*one-time/i, { to: "Projects this year", label: "One-time" }],
  [/^total projects .*ongoing/i, { to: "Projects this year", label: "Ongoing" }],
  [/^total projects .*total/i, { to: "Projects this year", label: "Total, as on the website", total: true }],
  [/^clubs involved/i, { to: "Projects this year", label: "Clubs involved" }],
  [/^not counted/i, { to: "Projects this year", label: "Repeat entries, not counted" }],
  [/^total club service/i, { to: "Projects this year", label: "Club Service meetings" }],
  [/^projects added yesterday.*one-time/i, { to: "Added yesterday", label: "One-time" }],
  [/^projects added yesterday.*ongoing/i, { to: "Added yesterday", label: "Ongoing" }],
  [/^projects added yesterday.*total/i, { to: "Added yesterday", label: "Total", total: true }],
  [/^total project photos.*all years/i, { to: "Photos", label: "All years", total: true }],
  [/^total project photos/i, { to: "Photos", label: "This Rotary year" }],
];

/** Puts the report's flat list into the headline figures and panels. A line it does not know is never dropped: it
 *  goes, under its own name, to "Other figures". */
export function groupStats(metrics: Metric[]): { headline: Stat[]; groups: StatGroup[] } {
  const year = metrics.map((m) => /\((\d{4}-\d{2})\)/.exec(m.metric)?.[1]).find(Boolean);
  const left = [...metrics];
  const placed: { to: string; stat: Stat }[] = [];
  for (const [pattern, { to, ...stat }] of PLACES) {
    const i = left.findIndex((m) => pattern.test(m.metric));
    if (i >= 0) placed.push({ to, stat: { ...stat, count: left.splice(i, 1)[0].count } });
  }
  const rowsOf = (to: string) => placed.filter((p) => p.to === to).map((p) => p.stat);
  const groups = [
    { title: year ? `Projects ${year}` : "Projects this year", rows: rowsOf("Projects this year") },
    { title: "Added yesterday", rows: rowsOf("Added yesterday") },
    { title: "Photos", rows: rowsOf("Photos") },
    { title: "Other figures", rows: left.map((m) => ({ label: m.metric.replace(/\s*—\s*/g, ": "), count: m.count })) },
  ];
  return { headline: rowsOf("headline"), groups: groups.filter((g) => g.rows.length > 0) };
}
