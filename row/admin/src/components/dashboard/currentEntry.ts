import type { DashboardEntry } from "@/services/api";

type Selected = { clubId: number | null; districtId: number | null; zoneId: number | null };

/**
 * The switcher entry of the dashboard on screen. Entries carry their parents too (a district names its zone, a club
 * its district), so only an entry's own level may match: comparing the parents as well marked the first district of
 * the same zone as current whichever district was open.
 */
export function currentEntryOf(entries: DashboardEntry[], kind: string, selected: Selected): DashboardEntry | undefined {
  const sameKind = entries.filter((e) => e.kind === kind);
  const own = sameKind.find((e) => {
    if (e.clubId != null) return e.clubId === selected.clubId;
    if (e.districtId != null) return e.districtId === selected.districtId;
    return e.zoneId != null && e.zoneId === selected.zoneId;
  });
  return own ?? sameKind[0];
}
