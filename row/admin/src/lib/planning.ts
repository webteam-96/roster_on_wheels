import type { LaunchpadItem, PlanningRole } from "@/types/planning";

// Planning workspace helpers (app/planning, components/planning).

/** True when a date or date-time falls in a Rotary year (start and end inclusive, by calendar day). */
export function inYear(date: string | null | undefined, start: string | null | undefined, end: string | null | undefined): boolean {
  if (!date || !start || !end) return false;
  const d = date.slice(0, 10);
  return d >= start.slice(0, 10) && d <= end.slice(0, 10);
}

/** Launchpad progress over the items that are built (the RI stub does not count). */
export function launchpadProgress(items: LaunchpadItem[]): { done: number; total: number } {
  const built = items.filter((i) => !i.stub);
  return { done: built.filter((i) => i.done).length, total: built.length };
}

export interface PlanningScope {
  kind: "district" | "club";
  districtId: number;
  clubId: number;
  label: string;
  roles: PlanningRole[];
}

/** One workspace per district (DGE, DS, DT) and per club (PE, SE) the member is active in. */
export function planningScopes(roles: PlanningRole[]): PlanningScope[] {
  const scopes = new Map<string, PlanningScope>();
  for (const r of roles) {
    if (r.status !== "active") continue;
    const kind = r.clubId > 0 ? "club" : "district";
    const key = kind === "club" ? `club-${r.clubId}` : `district-${r.districtId}`;
    const scope = scopes.get(key) ?? {
      kind,
      districtId: r.districtId,
      clubId: r.clubId,
      label: kind === "club" ? r.clubName ?? `Club ${r.clubId}` : `District ${r.districtNumber ?? r.districtId}`,
      roles: [],
    };
    scope.roles.push(r);
    scopes.set(key, scope);
  }
  return [...scopes.values()];
}

/** The API sends cut-over times in UTC without a zone: mark them so they show in the instance's zone. */
export function asUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
}

/** An event date-time for the API from a date input (evening, the planning calendar's default time). */
export function eventDateTime(day: string, time = "18:00"): string {
  return `${day}T${time}:00`;
}
