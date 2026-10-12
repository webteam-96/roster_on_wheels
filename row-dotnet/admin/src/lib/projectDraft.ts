/**
 * Cross-project-type "switch" carry-over.
 *
 * When the AI classification detects that a project fits a DIFFERENT project type (module) better,
 * the user can switch. We stash whatever they've filled so far into sessionStorage, navigate to the
 * target module's v2 Add page, and that page hydrates the draft + preselects the suggested category.
 *
 * "Carry everything possible": the draft is a flat bag of the source form's fields. The target page
 * reads only the keys it recognises; unknown keys are simply ignored. Photos travel as their already
 * uploaded temp paths (the source project was never saved, so /tempdocument/ paths are still valid).
 */

const DRAFT_KEY = "rotary:projectSwitchDraft";

// The six service-avenue modules that have a v2 Add page. moduleKey → URL segment is a plain
// underscore→hyphen swap for all of them, but we keep an explicit allow-list so a "better fit" hint
// never points at a module without an Add page.
const MODULE_ROUTE_SEGMENT: Record<string, string> = {
  community_service: "community-service",
  club_service: "club-service",
  vocational_service: "vocational-service",
  international_service: "international-service",
  new_generation_service: "new-generation-service",
  public_image_initiative: "public-image-initiative",
};

export function isRoutableModule(moduleKey?: string | null): boolean {
  return !!moduleKey && moduleKey in MODULE_ROUTE_SEGMENT;
}

// v2 Add route for a module, or null if it isn't a routable service avenue.
export function moduleAddPath(clubId: number, moduleKey?: string | null): string | null {
  if (!moduleKey || !(moduleKey in MODULE_ROUTE_SEGMENT)) return null;
  return `/clubs/${clubId}/${MODULE_ROUTE_SEGMENT[moduleKey]}/v2/add`;
}

export interface SuggestedClassification {
  areaOfFocusId: number;
  categoryId: number | null;
  subCategoryId: number | null;
}

export interface ProjectSwitchDraft {
  targetModuleKey: string;             // module the draft is FOR — target page checks this matches
  fields: Record<string, unknown>;     // flat bag of source form fields (title, description, …)
  suggested: SuggestedClassification;  // the AI's cross-module classification to preselect
  savedAt: number;
}

// Stash the draft for the target module. Returns the target Add route (or null if not routable).
export function stashProjectSwitchDraft(
  clubId: number,
  targetModuleKey: string,
  fields: Record<string, unknown>,
  suggested: SuggestedClassification,
  savedAt: number,
): string | null {
  const path = moduleAddPath(clubId, targetModuleKey);
  if (!path) return null;
  try {
    const draft: ProjectSwitchDraft = { targetModuleKey, fields, suggested, savedAt };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    return null; // storage blocked/full → caller just navigates without carry-over
  }
  return path;
}

// Read + CONSUME the draft if it targets this module (one-shot: cleared so a refresh won't re-hydrate).
export function consumeProjectSwitchDraft(currentModuleKey: string): ProjectSwitchDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as ProjectSwitchDraft;
    if (draft?.targetModuleKey !== currentModuleKey) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    return draft;
  } catch {
    return null;
  }
}
