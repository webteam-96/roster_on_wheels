// Goal categories that are ANNUAL ONLY (user 2026-09-25).
//
// Youth Service and Public Image keep everything else exactly as it is — their forms, their Till
// Date figures, their Till Date report columns. They simply have no month-wise concept: no
// Month-wise tab, no month columns, no Month-wise report sheet. Open Month-wise anywhere and only
// Membership and TRF are there.
//
// The API enforces the same rule (GoalSettingService.AnnualOnlyCategories); this copy only keeps
// the UI from offering a button that would come back empty.
const ANNUAL_ONLY = ["youth service", "public image"];

export function isAnnualOnlyCategory(categoryName?: string | null): boolean {
  if (!categoryName) return false;
  return ANNUAL_ONLY.includes(categoryName.trim().toLowerCase());
}

// A month-wise row's name. Membership's three collected fields are all labelled "Achieved" in
// goal_fields — what tells them apart is the GROUP ("Total Clubs", "Total Members", "Total New
// women members"), so a table that prints fieldLabel alone shows "Achieved" three times over
// (user 2026-09-29). The Excel report has always done this (GoalSettingService.MonthlyMetricLabel);
// this is the same rule for the screens, in one place so the next table cannot drift from it.
export function monthlyFieldLabel(f: { fieldLabel: string; groupName?: string | null }): string {
  return f.fieldLabel?.trim().toLowerCase() === "achieved" && f.groupName
    ? f.groupName
    : f.fieldLabel;
}
