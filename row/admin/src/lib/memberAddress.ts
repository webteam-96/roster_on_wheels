// A member keeps ONE Business and ONE home address (upstream 2026-11-02). The home address is stored as
// "Residence" (directory / migrated data) or "Residential" (sync / older forms): the same address under
// two names. The member forms treat them as one slot and never send two home rows.

export const isHomeAddressType = (t?: string | null): boolean => t === "Residence" || t === "Residential";

/** Same slot: equal types, or both the home address. */
export const sameAddressType = (a?: string | null, b?: string | null): boolean =>
  a === b || (isHomeAddressType(a) && isHomeAddressType(b));

/** Keeps the first address of each slot (the one the form edits); drops the rest. */
export function onePerAddressType<T extends { addressType?: string | null }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = isHomeAddressType(a.addressType) ? "home" : (a.addressType ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
