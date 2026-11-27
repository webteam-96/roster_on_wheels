/**
 * Per-module settings for the shared one-time service-project form used by the v2 add and edit pages of
 * Vocational, International and New Generation Service. Every value here is what that module's own page
 * had before the pages were merged (texts, limits, validation, classes), so each page renders and saves
 * exactly as it did.
 */
export type ServiceFormConfig = {
  moduleKey: string;
  /** Route segment under /clubs/[id]/ (listing = /clubs/[id]/<slug>/v2). */
  slug: string;
  /** "Vocational Service" etc., used in "Add <name> Project" / "Edit <name> Project". */
  name: string;
  addSubtitle: string;
  editSubtitle: string;
  topMessage: string;
  agreeMessage: string;
  /** Per-file size limit on photo select, in MB; null = no check on this page. */
  maxPhotoMb: number | null;
  /** Rotaractors Involved is mandatory (New Generation only). */
  requireRotaractors: boolean;
  /** Pass selectedAreaId to ClassificationAssist (International did not). */
  passSelectedAreaId: boolean;
  /** Add page CSR amount labels used the app-default symbol instead of the chosen currency (Vocational only). */
  csrAppSymbolOnAdd: boolean;
  /** Edit page: when ?yearId= is missing, probe the club's project years to find the project (New Generation only). */
  probeYears: boolean;
  /** Edit page: after a cross-year move, go to the listing instead of honouring ?returnTo= (International only). */
  moveGoesToListing: boolean;
  look: {
    ggBox: string;
    ggTitle: string;
    csrBox: string;
    csrTitle: string;
    /** "grid" = square tiles with the Add tile inside the grid; "wide" = 16:9 tiles, full-width Add button. */
    photoLayout: "grid" | "wide";
    photoTile: string;
    photoInner: string;
    photoDescPlaceholder: string;
    primaryAriaLabel: string;
    /** Notification block: null = plain bordered box, else a numbered SectionCard with this title. */
    notifyTitle: string | null;
    checkboxClass: string;
    /** Edit success dialog OK button had type="button". */
    okTypeButton: boolean;
  };
};

const AMBER_BOX = "sm:col-span-2 lg:col-span-3 space-y-3 border border-amber-200 bg-amber-50/40 rounded-md p-4";

export const VOCATIONAL_SERVICE: ServiceFormConfig = {
  moduleKey: "vocational_service",
  slug: "vocational-service",
  name: "Vocational Service",
  addSubtitle: "Create a new vocational service initiative",
  editSubtitle: "Update vocational service project details",
  topMessage: "Please post all the Vocational services executed by your club. The content posted here will be displayed in District website, Club Monthly Report & ROW integrated Club website.",
  agreeMessage: `The data I will enter is for a Vocational service project conducted by my club that has benefitted my community. E.g., Career Guidance and Skill Development, Computer Literacy, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
  maxPhotoMb: 10,
  requireRotaractors: false,
  passSelectedAreaId: true,
  csrAppSymbolOnAdd: true,
  probeYears: false,
  moveGoesToListing: false,
  look: {
    ggBox: AMBER_BOX,
    ggTitle: "row-h3 text-amber-700",
    csrBox: AMBER_BOX,
    csrTitle: "row-h3 text-amber-700",
    photoLayout: "grid",
    photoTile: "relative group rounded-lg overflow-hidden border border-slate-200 bg-muted/30",
    photoInner: "aspect-square relative",
    photoDescPlaceholder: "Photo description (max 500 chars)",
    primaryAriaLabel: "Set as primary photo",
    notifyTitle: null,
    checkboxClass: "accent-blue-600 h-4 w-4",
    okTypeButton: false,
  },
};

export const INTERNATIONAL_SERVICE: ServiceFormConfig = {
  moduleKey: "international_service",
  slug: "international-service",
  name: "International Service",
  addSubtitle: "Create a new international service initiative",
  editSubtitle: "Update international service project details",
  topMessage: "Please post all the International Services executed by your club. The content posted here will be displayed in District website, Club Monthly Report & ROW integrated Club website.",
  agreeMessage: `The data I will enter is for a International Service project conducted by my club that has benefitted my community. E.g., Rotary Youth Exchange, Rotary Friendship Exchange, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
  maxPhotoMb: 5,
  requireRotaractors: false,
  passSelectedAreaId: false,
  csrAppSymbolOnAdd: false,
  probeYears: false,
  moveGoesToListing: true,
  look: {
    ggBox: "sm:col-span-2 lg:col-span-3 space-y-3 border border-slate-200 bg-slate-50/40 rounded-md p-4 mt-1",
    ggTitle: "row-h3",
    csrBox: "sm:col-span-2 lg:col-span-3 space-y-3 border border-teal-200 bg-teal-50/40 rounded-md p-4 mt-1",
    csrTitle: "row-h3 text-teal-700",
    photoLayout: "grid",
    photoTile: "relative group rounded-lg overflow-hidden border border-slate-200",
    photoInner: "relative aspect-square",
    photoDescPlaceholder: "Photo description (max 500)",
    primaryAriaLabel: "Set as primary photo",
    notifyTitle: "Notification",
    checkboxClass: "accent-emerald-600 h-4 w-4",
    okTypeButton: true,
  },
};

export const NEW_GENERATION_SERVICE: ServiceFormConfig = {
  moduleKey: "new_generation_service",
  slug: "new-generation-service",
  name: "New Generation Service",
  addSubtitle: "Create a new new-generation service initiative",
  editSubtitle: "Update new-generation service project details",
  topMessage: "Please post all the New Generation services executed by your club. The content posted here will be displayed in District website, Club Monthly Report & ROW integrated Club website.",
  agreeMessage: `The data I will enter is for a New generation Service Project conducted by my club that has benefitted my community. E.g., Formation of an Interact Club, Formation of a Rotaract Club, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
  maxPhotoMb: null,
  requireRotaractors: true,
  passSelectedAreaId: true,
  csrAppSymbolOnAdd: false,
  probeYears: true,
  moveGoesToListing: false,
  look: {
    ggBox: `${AMBER_BOX} mt-1`,
    ggTitle: "row-h3 text-amber-700",
    csrBox: `${AMBER_BOX} mt-1`,
    csrTitle: "row-h3 text-amber-700",
    photoLayout: "wide",
    photoTile: "relative group rounded-xl border border-slate-200 overflow-hidden bg-slate-50/50",
    photoInner: "relative aspect-video",
    photoDescPlaceholder: "Photo description (max 500 chars)",
    primaryAriaLabel: "Set primary",
    notifyTitle: "Notify Members",
    checkboxClass: "accent-emerald-600 h-4 w-4",
    okTypeButton: false,
  },
};
