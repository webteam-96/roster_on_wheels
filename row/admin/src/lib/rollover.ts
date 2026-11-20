import type { RolloverApplyBody, RolloverPreview } from "@/services/api";

/** What the admin has ticked on the rollover page. */
export interface RolloverSelection {
  committees: Record<number, boolean>;
  members: Record<string, boolean>;
  officers: Record<number, boolean>;
  includeIpp: boolean;
}

/**
 * Starting ticks: every committee with something to add and every member still in the club; officers are left
 * unticked (offices change each year, so carrying one over is a deliberate choice); the IPP when it is missing.
 */
export function defaultSelection(p: RolloverPreview): RolloverSelection {
  const committees: Record<number, boolean> = {};
  const members: Record<string, boolean> = {};
  for (const c of p.committees) {
    const adds = c.members.filter((m) => m.action === "add");
    committees[c.sourceId] = c.action === "add" || adds.length > 0;
    for (const m of adds) members[m.key] = true;
  }
  return { committees, members, officers: {}, includeIpp: p.ipp?.action === "add" };
}

/** The apply request for the ticks; rows already in the new year are never sent. */
export function buildApplyBody(p: RolloverPreview, s: RolloverSelection): RolloverApplyBody {
  return {
    fromYearId: p.fromYear.id,
    includeIpp: s.includeIpp && p.ipp?.action === "add",
    officerIds: p.officers.filter((o) => o.action === "add" && s.officers[o.sourceId]).map((o) => o.sourceId),
    committees: p.committees
      .filter((c) => s.committees[c.sourceId])
      .map((c) => ({ sourceId: c.sourceId, memberKeys: c.members.filter((m) => m.action === "add" && s.members[m.key]).map((m) => m.key) })),
  };
}

/** How many rows the apply will insert (committees new to the year, members, officers, IPP). */
export function countChanges(p: RolloverPreview, body: RolloverApplyBody): number {
  const newCommittees = body.committees.filter((b) => p.committees.find((c) => c.sourceId === b.sourceId)?.action === "add").length;
  return newCommittees + body.committees.reduce((n, c) => n + c.memberKeys.length, 0) + body.officerIds.length + (body.includeIpp ? 1 : 0);
}

/** "committee: 1, member: 2" from the run's summary JSON. */
export function summaryText(summary: string | null): string {
  if (!summary) return "";
  try {
    const counts = JSON.parse(summary) as Record<string, number>;
    const label: Record<string, string> = { committee: "committees", subcommittee: "sub-groups", member: "members", officer: "officers", ipp: "IPP" };
    return Object.entries(counts).map(([k, v]) => `${label[k] ?? k}: ${v}`).join(", ");
  } catch {
    return "";
  }
}
