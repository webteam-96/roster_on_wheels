// Typed wrappers around the public read-only API endpoints.
// Every call is server-side (Node runtime) and goes through fetchJson, which
// applies Next.js ISR via the `next: { revalidate }` option.

import "server-only";
import { fetchJson } from "./api";
import {
  inPreview, isSampleId, orSample, sampleAbout, sampleBanners, sampleBoard, sampleCalendar, sampleDirectory,
  sampleEvents, sampleMeetings, sampleNewsletters, samplePastPresidents, sampleProjectDetail, sampleProjects,
  sampleSpeakers,
} from "./sample";

// ── Shared shapes (mirror C# DTOs in ClubWebsitePublicDataController.cs) ──

export interface YearOption {
  id: number;
  yearLabel: string;
  isCurrent: boolean;
}

export interface AboutPayload {
  clubName: string;
  districtNumber: string | null;          // VARCHAR in DB (e.g. "5656", "3030")
  clubLogoPath: string | null;
  content: string | null;            // rich HTML
  contacts: { email: string; phone: string }[];
  socials: { platform: string; linkUrl: string }[];
  // Meeting + address pulled straight from club_master so the home page
  // doesn't have to parse the About HTML.
  meetingDay: string | null;
  meetingFromTime: string | null;    // HH:mm
  meetingToTime: string | null;      // HH:mm
  meetingAddress: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Banner {
  id: number;
  bannerImagePath: string;
  documentPath: string | null;
  linkUrl: string | null;
  description: string | null;
  sortOrder: number;
}

export interface Advertisement {
  id: number;
  advertisementImagePath: string;
  documentPath: string | null;
  linkUrl: string | null;
  description: string | null;
  sortOrder: number;
}

export interface BoardDirector {
  id: number;
  memberId: number;
  memberName: string;
  profilePhotoPath: string | null;
  designation: string;
  sortOrder: number | null;
  designationSortOrder: number | null;
  memberIntroduction: string | null;
}

export interface DirectoryMember {
  memberId: number;
  memberName: string;
  profilePhotoPath: string | null;
  email: string | null;
  mobile: string | null;
  profession: string | null;
  designation: string | null;
  gender: string | null;
  memberIntroduction: string | null;
  isPersonalDetailsVisible: boolean;
}

export interface PastPresident {
  id: number;
  yearId: number;
  yearLabel: string;
  memberId: number;
  memberName: string;
  profilePhotoPath: string | null;
}

export interface CalendarDay {
  date: string;                                                              // ISO date
  timeZone?: string;                                                         // the club's zone (spec 3.3)
  birthdays: { memberId: number; memberName: string; profilePhotoPath: string | null }[];
  anniversaries: { memberId: number; memberName: string; profilePhotoPath: string | null }[];
  events: {
    id: number;
    title: string;
    description: string | null;
    imagePath: string | null;
    eventDate: string;                                                       // ISO datetime
    venue: string | null;
    registrationLink: string | null;
  }[];
}

export interface PublicProject {
  id: number;
  yearId: number;
  yearLabel: string;
  moduleKey: string;                                                         // e.g. "community_service" / "club_service"
  moduleName: string;
  title: string;
  description: string | null;
  location: string | null;
  projectDate: string | null;                                                // ISO date
  areaOfFocus: string | null;
  primaryPhotoPath: string | null;
  createdDate: string | null;                                                // ISO datetime — when uploaded
  modifiedDate: string | null;                                               // ISO datetime — last edit
}

export type MenuLinkType = "page" | "url" | "html" | "external" | "document";

export interface Menu {
  id: number;
  menuName: string;
  linkType: MenuLinkType;
  linkValue: string;
  contentHtml: string | null;       // populated when linkType === "html"
  isDefault: boolean;
  sortOrder: number;
  subMenus: SubMenu[];
  /** The default-language name when menuName is a translation (lib/siteLanguage); routes and slugs use it. */
  sourceName?: string;
}
export interface SubMenu {
  id: number;
  subMenuName: string;
  linkType: MenuLinkType;
  linkValue: string;
  sortOrder: number;
  sourceName?: string;
}

// ── Calls ──────────────────────────────────────────────────────────────────
// `revalidate` defaults are tuned per shape:
//   - banners / about / menus / past-presidents → 5 min (rarely change)
//   - bod / directory / projects / meetings    → 1 min (admin edits frequent)
//   - calendar (today)                         → 60 sec (rolls over at midnight)
//   - years                                    → 5 min

function withYear(path: string, yearId?: number) {
  return typeof yearId === "number" ? `${path}?yearId=${yearId}` : path;
}

export async function getYears(clubId: number) {
  return fetchJson<YearOption[]>(`/api/public/club/${clubId}/years`, 300);
}
export async function getAbout(clubId: number, yearId?: number) {
  return sampleAbout(await fetchJson<AboutPayload>(withYear(`/api/public/club/${clubId}/about`, yearId), 300));
}
export async function getBanners(clubId: number, yearId?: number) {
  return orSample(fetchJson<Banner[]>(withYear(`/api/public/club/${clubId}/banners`, yearId), 300), sampleBanners);
}
export async function getAdvertisements(clubId: number, yearId?: number) {
  return fetchJson<Advertisement[]>(withYear(`/api/public/club/${clubId}/advertisements`, yearId), 300);
}
export async function getBoardOfDirectors(clubId: number, yearId?: number) {
  return orSample(fetchJson<BoardDirector[]>(withYear(`/api/public/club/${clubId}/bod`, yearId), 60), sampleBoard);
}
export async function getDirectory(clubId: number) {
  return orSample(fetchJson<DirectoryMember[]>(`/api/public/club/${clubId}/directory`, 60), sampleDirectory);
}
export async function getPastPresidents(clubId: number) {
  return orSample(fetchJson<PastPresident[]>(`/api/public/club/${clubId}/past-presidents`, 300), samplePastPresidents);
}
export async function getCalendar(clubId: number, date?: string) {
  const path = date
    ? `/api/public/club/${clubId}/calendar?date=${encodeURIComponent(date)}`
    : `/api/public/club/${clubId}/calendar`;
  return sampleCalendar(await fetchJson<CalendarDay>(path, 60), date);
}
export async function getProjects(clubId: number, yearId?: number) {
  return orSample(fetchJson<PublicProject[]>(withYear(`/api/public/club/${clubId}/projects`, yearId), 60), sampleProjects);
}

// Child sub-project of an ongoing parent (project_type = 'ongoing_repeat').
// Each child carries its own photos (up to 5) so the website can render a
// per-child gallery without an extra round-trip.
export interface ChildProject {
  id: number;
  yearId: number;
  yearLabel: string;
  title: string;
  description: string | null;
  location: string | null;
  projectDate: string | null;
  projectCost: number | null;
  /** ISO 4217; the API sends the instance default when the project has none. */
  currency?: string | null;
  directBeneficiaries: number | null;
  manHours: number | null;
  rotariansInvolved: number | null;
  rotaractorsInvolved: number | null;
  photos: string[];
}

export interface PublicProjectDetail {
  id: number;
  yearId: number;
  yearLabel: string;
  moduleKey: string;
  moduleName: string;
  title: string;
  description: string | null;
  location: string | null;
  projectDate: string | null;
  areaOfFocus: string | null;
  projectType: string | null;
  ongoingGroupTitle: string | null;
  isJointProject: boolean | null;
  coHostName: string | null;
  clubRole: string | null;
  funding: string | null;
  projectCost: number | null;
  /** ISO 4217; the API sends the instance default when the project has none. */
  currency?: string | null;
  directBeneficiaries: number | null;
  manHours: number | null;
  rotariansInvolved: number | null;
  rotaractorsInvolved: number | null;
  createdDate: string | null;
  modifiedDate: string | null;
  photos: string[];          // up to 5, primary first
  // Populated only when projectType === 'ongoing' (parent rows). For non-ongoing
  // detail responses the API returns children: [] and the summed* fields null.
  children: ChildProject[];
  summedProjectCost: number | null;
  summedDirectBeneficiaries: number | null;
  summedManHours: number | null;
  summedRotariansInvolved: number | null;
  summedRotaractorsInvolved: number | null;
}

export async function getProjectDetail(clubId: number, projectId: number) {
  if (isSampleId(projectId) && inPreview()) return sampleProjectDetail(projectId);
  return fetchJson<PublicProjectDetail>(`/api/public/club/${clubId}/projects/${projectId}`, 60);
}
export async function getMeetings(clubId: number, yearId?: number) {
  return orSample(fetchJson<PublicProject[]>(withYear(`/api/public/club/${clubId}/meetings`, yearId), 60), sampleMeetings);
}
export async function getMenus(clubId: number) {
  return fetchJson<Menu[]>(`/api/public/club/${clubId}/menus`, 300);
}

// ── Dignitaries / Leaders / Events / Newsletters (home page) ───────────────

export interface InternationalPresident {
  id: number;
  yearId: number;
  yearLabel: string;
  name: string;
  designation: string | null;
  profilePhotoPath: string | null;
  description: string | null;
}

export interface DistrictGovernor {
  id: number;
  yearId: number;
  yearLabel: string;
  memberName: string;
  profilePhoto: string | null;
  description: string | null;
}

export interface PublicUpcomingEvent {
  id: number;
  title: string;
  description: string | null;
  venue: string | null;
  eventDate: string;                                                          // ISO date
  imagePath: string | null;
  registrationLink: string | null;
}

export interface PublicNewsletter {
  id: number;
  yearId: number;
  title: string;
  publishDateTime: string;                                                    // ISO date
  filePath: string | null;
  linkUrl: string | null;
  attachmentType: string | null;
}

export async function getInternationalPresident(clubId: number, yearId?: number) {
  return fetchJson<InternationalPresident | null>(withYear(`/api/public/club/${clubId}/international-president`, yearId), 300);
}
export async function getDistrictGovernor(clubId: number, yearId?: number) {
  return fetchJson<DistrictGovernor | null>(withYear(`/api/public/club/${clubId}/district-governor`, yearId), 300);
}
export async function getUpcomingEvents(clubId: number, limit: number = 6) {
  return orSample(fetchJson<PublicUpcomingEvent[]>(`/api/public/club/${clubId}/upcoming-events?limit=${limit}`, 60), sampleEvents);
}
export async function getNewsletters(clubId: number, yearId?: number, limit: number = 6) {
  const params = new URLSearchParams();
  if (yearId) params.set("yearId", String(yearId));
  params.set("limit", String(limit));
  return orSample(fetchJson<PublicNewsletter[]>(`/api/public/club/${clubId}/newsletters?${params.toString()}`, 300), sampleNewsletters);
}

// ── Speakers (module "volunteers"; null while it is switched off) ──────────

export interface PublicSpeaker {
  meetingDate: string;                                                        // ISO date
  name: string;
  topic: string | null;
  bio: string | null;
  photoPath: string | null;
}

export async function getUpcomingSpeakers(clubId: number, limit: number = 6) {
  return orSample(fetchJson<PublicSpeaker[]>(`/api/public/club/${clubId}/speakers?limit=${limit}`, 60), sampleSpeakers);
}

// ── v2 endpoints used by the club website themes (themes/registry.ts) ──────────────────────────────────────────
export interface AboutV2 extends AboutPayload {
  rotaryLogoPath: string | null;
  currency: string;
  timeZone?: string; // the club's IANA zone (API builds from 2026-10-30)
}

export async function getAboutV2(clubId: number, yearId?: number | null) {
  return fetchJson<AboutV2>(withYear(`/api/public/club/${clubId}/v2/about`, yearId ?? undefined), 0);
}

/** Any public club endpoint, year-scoped when yearId is given; null on failure. Shapes pass through to the views. */
export async function getClubData<T = unknown>(clubId: number, segment: string, yearId?: number | null) {
  const path = `/api/public/club/${clubId}/${segment}`;
  const year = typeof yearId === "number" ? `${path.includes("?") ? "&" : "?"}yearId=${yearId}` : "";
  return fetchJson<T>(path + year, 0);
}
