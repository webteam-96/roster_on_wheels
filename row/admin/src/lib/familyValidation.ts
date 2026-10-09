/**
 * Same rules the API enforces on member save (MemberService.CheckSingleSpouse): one Spouse, and the
 * same person (name + relation) only once. Duplicates are what piled hundreds of family rows onto a
 * member, so the form stops them before the API has to.
 */
export function familyDuplicateError(
  family: Array<{ name?: string | null; relation?: string | null }> | null | undefined,
): string | null {
  const list = (family ?? []).filter((f) => (f.name ?? "").trim());
  const spouses = (family ?? []).filter((f) => (f.relation ?? "").trim().toLowerCase() === "spouse").length;
  if (spouses > 1) return "Only one family member can be the Spouse.";
  const seen = new Set<string>();
  for (const f of list) {
    const key = `${(f.name ?? "").trim().toLowerCase()}|${(f.relation ?? "").trim().toLowerCase()}`;
    if (seen.has(key)) {
      const rel = (f.relation ?? "").trim() || "no relation";
      return `${(f.name ?? "").trim()} (${rel}) is added more than once in family details.`;
    }
    seen.add(key);
  }
  return null;
}
