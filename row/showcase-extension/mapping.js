// Rotary Showcase field mapping (build spec 3.12). Rotary Showcase's add-project form is not documented and RI can
// change it: the selectors below are a best guess, kept in this one file so they can be fixed without touching the
// rest. Each Showcase field lists selectors tried in order; the first one found on the page is filled.
// shortcut: guessed selectors, unverified against the live form; check them with a Showcase account before publishing.

export const SHOWCASE_FIELDS = {
  title: ["#edit-title", "input[name='title']", "input[name*='title' i]"],
  description: ["#edit-description", "textarea[name='description']", "textarea[name*='description' i]"],
  startDate: ["#edit-start-date", "input[name*='start' i][type='date']", "input[name*='date' i]"],
  location: ["#edit-location", "input[name*='location' i]", "input[name*='city' i]"],
  areaOfFocus: ["#edit-area-of-focus", "select[name*='focus' i]"],
  cost: ["#edit-funds", "input[name*='fund' i]", "input[name*='cost' i]"],
  beneficiaries: ["#edit-beneficiaries", "input[name*='beneficiar' i]"],
  volunteerHours: ["#edit-volunteer-hours", "input[name*='hour' i]"],
};

/** The values to put in the Showcase form for a ROW project (from GET /api/clubs/{id}/showcase/projects). */
export function showcaseValues(p) {
  const date = (p.projectDate || "").slice(0, 10);
  return {
    title: (p.title || "").trim(),
    description: (p.description || "").trim(),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    location: (p.location || "").trim(),
    areaOfFocus: (p.areaOfFocus || "").trim(),
    cost: p.projectCost != null ? String(p.projectCost) : "",
    beneficiaries: p.directBeneficiaries != null ? String(p.directBeneficiaries) : "",
    volunteerHours: p.manHours != null ? String(p.manHours) : "",
  };
}
