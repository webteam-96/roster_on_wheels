// src/lib/addToOrg.ts
//
// Bridge to the "Rotary Add to Org" browser extension. After a project is saved,
// we hand the extension a ready-made export of the project; it opens the Rotary
// International Service Project Center (spc.rotary.org) in a new tab, signs in,
// and fills the wizard for the user to review and publish. Nothing here leaves the
// browser — it's a same-origin window.postMessage to the extension's content script.

import type { ProjectDetail } from "@/types/project";
import { getClubRotaryOrgCredentials, getRotaryOrgSyncToken } from "@/services/api";

// Original single-club early-rollout target. Kept for reference; the feature is
// now open to ALL clubs via isFlowBotEnabled() below.
export const BOT_TEST_CLUB_ID = 2765;

/**
 * Single rollout gate for the whole RI Flow-Bot feature (dashboard card,
 * list-page sync button, post-save auto-trigger). Currently enabled for EVERY
 * club. To re-scope, return `clubId === BOT_TEST_CLUB_ID` (single test club) or
 * wire a DB flag (e.g. club_master.IsRotaryOrgSyncEnabled) here.
 */
export function isFlowBotEnabled(_clubId: number): boolean {
  return true;
}

// Avenue label sent to the extension as OrgExport.meta.avenue. Hardcoded rather
// than derived from getModules()'s moduleName — they don't always match (e.g.
// public_image_initiative's DB moduleName is "Public Image Initiative" but the
// export string every add page already sends is "Public Image Initiative
// Service"). Keep these in sync with each add page's own buildOrgExport().
export const AVENUE_LABELS: Record<string, string> = {
  community_service: "Community Service",
  vocational_service: "Vocational Service",
  international_service: "International Service",
  new_generation_service: "New Generation Service",
  public_image_initiative: "Public Image Initiative Service",
  club_service: "Club Service",
};

// 5-way funding classifier for the extension's FundingClass enum, so it can map
// to the right SPC grant path. Duplicated locally in each add page today; this
// shared copy is only for buildOrgExportFromDetail below — the existing local
// copies are left as-is.
export function classifyFundingClass(name?: string | null): FundingClass {
  const n = (name || "").trim().toLowerCase();
  if (!n) return "";
  if (n.includes("global grant")) return "global_grant";
  if (n.includes("district grant")) return "district_grant";
  if (n === "csr" || n.startsWith("csr ") || n.includes(" csr") || n.includes("(csr)")) return "csr";
  if (n.includes("self funded") || n === "self" || n.includes("self-funded")) return "self";
  return "other";
}

export interface OrgExportPhoto {
  url: string;
  isPrimary: boolean;
  caption?: string;
}

/** Funding class derived from the ROW funding name (drives the SPC grant path). */
export type FundingClass =
  | "global_grant"
  | "csr"
  | "district_grant"
  | "self"
  | "other"
  | "";

/**
 * Financial & Impact funding detail. Amounts are in ₹ (the extension converts to
 * US$ at the live rate, like projectCostINR). All fields optional so older
 * producers that omit `financial` remain valid.
 */
export interface OrgExportFinancial {
  fundingClass: FundingClass;
  globalGrantNumber?: string | null;
  amountSanctionedINR?: number | null;
  amountReceivedINR?: number | null;
  amountSpentINR?: number | null;
  hostClubsDistricts?: string | null;
  globalPartnerClubsDistricts?: string | null;
  csrCompanyName?: string | null;
}

export interface OrgExport {
  title: string;
  description: string;
  meta: { avenue: string };
  classification: { areaOfFocus: string };
  locationText: string;
  dateOfProject: string; // YYYY-MM-DD
  projectType: string;
  projectCostINR: number;
  funding: string;
  financial?: OrgExportFinancial; // optional → legacy producers stay valid
  directBeneficiaries: number;
  manHours: number;
  rotariansInvolved: number;
  rotaractorsInvolved: number;
  rccInvolved: number;
  photos: OrgExportPhoto[];
}

// Live Chrome Web Store listing for the RI Flow-Bot extension.
export const ADD_TO_ORG_WEBSTORE_URL =
  "https://chromewebstore.google.com/detail/ri-flow-bot/ananaeipaokdlobfaokdpdmlloeigljk";

const SITE = "ROW-add-to-org"; // messages we send TO the extension
const EXT = "ROW-add-to-org-ext"; // messages the extension sends back

/** Resolve true if the extension is installed (it sets a marker + answers PING). */
export function detectExtension(timeoutMs = 700): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (document.documentElement.getAttribute("data-add-to-org-ext") === "1") {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      resolve(v);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data as { source?: string; type?: string } | null;
      if (d && d.source === EXT && (d.type === "PONG" || d.type === "READY")) finish(true);
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: SITE, type: "PING" }, location.origin);
    setTimeout(
      () => finish(document.documentElement.getAttribute("data-add-to-org-ext") === "1"),
      timeoutMs,
    );
  });
}

/**
 * Read a File into a base64 `data:` URL. Photos are embedded as data URLs in the
 * export (not server URLs) so the extension never fetches them from the backend:
 * the temp upload path (`/tempdocument/…`) is MOVED server-side when the project is
 * saved — the export runs after save, so that path 404s — and a cross-origin API
 * can also reject a credentialed image fetch. Embedding the bytes avoids both.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

/** Per-club rotary.org sign-in forwarded to the extension so it doesn't re-prompt. */
export interface OrgCredentials {
  username: string;
  password: string;
}

/** Post the ADD_TO_ORG_REQUEST message, optionally carrying the club's sign-in + a sync token. */
function postAddToOrg(
  projectId: number | null,
  exportData: OrgExport,
  credentials: OrgCredentials | null,
  syncToken: string | null,
): void {
  if (typeof window === "undefined") return;
  const payload: {
    projectId: number | null; export: OrgExport; credentials?: OrgCredentials; syncToken?: string;
  } = { projectId, export: exportData };
  if (credentials) payload.credentials = credentials;
  // Signed token the extension echoes back to us after the user publishes on SPC, so we can flip
  // this project's synced flag and drop its "Sync" button. Only meaningful for a real saved project.
  if (syncToken) payload.syncToken = syncToken;
  window.postMessage({ source: SITE, type: "ADD_TO_ORG_REQUEST", payload }, location.origin);
}

/**
 * Hand a just-saved (or existing) project to the extension.
 *
 * When `clubId` is supplied, the club's saved rotary.org login
 * (club_rotary_org_credentials) is fetched and included as `payload.credentials`
 * so the extension can sign in without showing its own "My Rotary sign-in" prompt.
 * Fire-and-forget: any fetch failure (or a club with no saved login) falls back to
 * posting without credentials, and the extension prompts as before. Omit `clubId`
 * for the legacy behaviour (no credentials attached).
 */
export function triggerAddToOrg(
  projectId: number | null,
  exportData: OrgExport,
  clubId?: number,
): void {
  if (typeof window === "undefined") return;
  if (!clubId) {
    postAddToOrg(projectId, exportData, null, null);
    return;
  }
  // Fetch the club's saved sign-in AND a per-project sync token in parallel; either can fail
  // independently without blocking the handoff (fire-and-forget, degrade gracefully).
  const credsP = getClubRotaryOrgCredentials(clubId)
    .then((c) =>
      c?.hasCredentials && c.username && c.password
        ? { username: c.username, password: c.password }
        : null,
    )
    .catch(() => null);
  const tokenP =
    projectId && projectId > 0
      ? getRotaryOrgSyncToken(projectId, clubId).then((t) => t?.token ?? null).catch(() => null)
      : Promise.resolve(null);
  Promise.all([credsP, tokenP]).then(([creds, token]) =>
    postAddToOrg(projectId, exportData, creds, token),
  );
}

/**
 * Builds an OrgExport from an EXISTING, already-saved project (fetched via
 * getProject(clubId, yearId, id)) — the list-page "sync" button's counterpart
 * to each add page's own in-memory-form buildOrgExport(). Synchronous: unlike
 * a freshly-picked File, a saved project's photo.imagePath is already the
 * permanent server path (the temp-upload path is moved on save), so no
 * fileToDataUrl() round-trip is needed — `${apiBaseUrl}${imagePath}` is
 * directly usable. Fields club-service never populates (classification, cost,
 * funding, beneficiaries, man-hours) default to ""/0, which is what lets a
 * club-service project map cleanly here too.
 */
export function buildOrgExportFromDetail(
  detail: ProjectDetail,
  avenueLabel: string,
  apiBaseUrl: string,
): OrgExport {
  const fundingName = detail.fundingName || "";
  const showGlobalGrantBlock = classifyFundingClass(fundingName) === "global_grant";
  const showCsrBlock = classifyFundingClass(fundingName) === "csr";
  return {
    title: detail.title || "",
    description: detail.description || "",
    meta: { avenue: avenueLabel },
    classification: {
      areaOfFocus: detail.otherAreaOfFocus || detail.areaOfFocusName || "",
    },
    locationText: detail.location || "",
    dateOfProject: detail.projectDate || "",
    projectType: detail.projectType === "one_time" ? "One Time Project" : "Ongoing / Repeat Project",
    projectCostINR: detail.projectCost || 0,
    funding: fundingName,
    financial: {
      fundingClass: classifyFundingClass(fundingName),
      globalGrantNumber: showGlobalGrantBlock ? detail.globalGrantNumber : null,
      amountSanctionedINR: (showGlobalGrantBlock || showCsrBlock) ? detail.amountSanctioned : null,
      amountReceivedINR: (showGlobalGrantBlock || showCsrBlock) ? detail.amountReceived : null,
      amountSpentINR: showGlobalGrantBlock ? detail.amountSpent : null,
      hostClubsDistricts: showGlobalGrantBlock ? detail.hostClubsDistricts : null,
      globalPartnerClubsDistricts: showGlobalGrantBlock ? detail.globalPartnerClubsDistricts : null,
      csrCompanyName: showCsrBlock ? detail.csrCompanyName : null,
    },
    directBeneficiaries: detail.directBeneficiaries || 0,
    manHours: detail.manHours || 0,
    rotariansInvolved: detail.rotariansInvolved || 0,
    rotaractorsInvolved: detail.rotaractorsInvolved || 0,
    rccInvolved: detail.rccInvolved || 0,
    photos: (detail.photos || []).map((p) => ({
      url: `${apiBaseUrl}${p.imagePath}`,
      isPrimary: p.isPrimary,
      caption: p.description || "",
    })),
  };
}
