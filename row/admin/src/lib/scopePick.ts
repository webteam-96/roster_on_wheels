// Which club / district the admin opens by default. Pure, so it is unit-tested (scopePick.test.ts).
import type { RoleScopeDto } from "@/types/scope";

// One entry: that id; several: null (the user chooses; selectors fall back to the first).
export function defaultIdFromList<T extends { id: number }>(list: T[] | undefined): number | null {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0].id;
  return null;
}

// The first accessible club the user ADMINISTERS. accessibleClubs also holds clubs the user only belongs to, where
// every club-admin endpoint answers 403.
export function adminClubId(roles: RoleScopeDto[] | undefined, clubs: { id: number }[] | undefined): number | null {
  return (roles ?? [])
    .filter((r) => (r.roleName === "Admin" || r.roleName === "Club Admin") && r.scope === "club" && !!r.clubId)
    .map((r) => r.clubId as number)
    .find((id) => (clubs ?? []).some((c) => c.id === id)) ?? null;
}

// Same rule for districts: a district the user only reaches through club membership 403s the district dashboard.
export function adminDistrictId(roles: RoleScopeDto[] | undefined, districts: { id: number }[] | undefined): number | null {
  return (roles ?? [])
    .filter((r) => (r.roleName === "Admin" || r.roleName === "District Admin") && r.scope === "district" && !!r.districtId)
    .map((r) => r.districtId as number)
    .find((id) => (districts ?? []).some((d) => d.id === id)) ?? null;
}

// Keep the previous choice while it is still accessible; otherwise the preferred (administered) id, then the first.
export function reconcileSelected<T extends { id: number }>(
  previous: number | null,
  list: T[] | undefined,
  preferred: number | null = null,
): number | null {
  if (!list || list.length === 0) return null;
  if (previous !== null && list.some((x) => x.id === previous)) return previous;
  if (preferred !== null && list.some((x) => x.id === preferred)) return preferred;
  return list[0].id;
}
