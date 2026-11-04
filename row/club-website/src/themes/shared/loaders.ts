// Server-side data loaders for the club website pages. They call the same API client the RIZones club site
// used (site/clubApi.js), so the views receive exactly the shapes they were written for.

import type { PageShell } from "@/lib/pageShell";
import type { PageKey } from "@/themes/registry";
import * as api from "@/site/clubApi.js";
import { getClubData } from "@/lib/publicApi";

/** Everything themes/shared/homeData.js builds the home pages from, for the picked year. */
export async function loadHome({ tenant, currentYearId: yearId }: PageShell) {
  const clubId = tenant.clubId;
  const [banners, ads, impact, projects, meetings, directory, about, upcoming, newsletters, ip, dg, bod] =
    await Promise.all([
      api.getBanners(clubId, yearId),
      api.getAdvertisements(clubId, yearId),
      api.getImpact(clubId, yearId),
      api.getProjects(clubId, yearId),
      api.getMeetings(clubId, yearId),
      api.getDirectory(clubId),
      api.getAbout(clubId, yearId),
      api.getUpcomingEvents(clubId, 99),
      api.getNewsletters(clubId, yearId, 12),
      api.getInternationalPresident(clubId, yearId),
      api.getDistrictGovernor(clubId, yearId),
      api.getBod(clubId, yearId),
    ]);
  return { home: { banners, ads, impact, projects, meetings, directory, about, upcoming, newsletters, ip, dg, bod } };
}

type Params = Record<string, string | string[] | undefined>;
type Loader = (shell: PageShell, params: Params) => Promise<Record<string, unknown>>;

const param = (p: Params, k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
const intParam = (p: Params, k: string) => parseInt(param(p, k), 10) || 0;

interface ProjectRow { id: number; yearId?: number | null; parentProjectId?: number | null }
interface ProjectDetailRaw { yearId?: number | null; children?: unknown[] | null; ongoingGroupTitle?: string | null }

/**
 * A project and, when the detail payload carries no updates but the project belongs to an ongoing group, its
 * updates rebuilt from the year's list (same rule as ProjectDetail.jsx loadProject).
 */
async function loadProjectRaw(clubId: number, pid: number, yearId: number | null) {
  if (pid <= 0) return null;
  const detail = (await api.getProjectDetail(clubId, pid, yearId, true)) as ProjectDetailRaw | null;
  if (!detail) return null;
  const group = (detail.ongoingGroupTitle ?? "").trim();
  if ((detail.children?.length ?? 0) > 0 || !group) return { detail, kids: null };
  const year = detail.yearId ?? yearId;
  const rows = ((await api.getProjects(clubId, year)) ?? []) as ProjectRow[];
  const kids = rows.filter((r) => r && r.parentProjectId === pid);
  const full = await Promise.all(kids.map(async (k) => (await api.getProjectDetail(clubId, k.id, k.yearId || year, true)) || k));
  return { detail, kids: full };
}

/** The month the calendar shows: ?date=YYYY-MM-DD, else ?month=YYYY-MM, else this month. */
function monthOf(params: Params) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(param(params, "date").trim())
    ?? /^(\d{4})-(\d{2})$/.exec(param(params, "month").trim());
  const now = new Date();
  return m ? { year: +m[1], month: +m[2] } : { year: now.getFullYear(), month: now.getMonth() + 1 };
}

interface EventRow { id: number }

/** Each inner page's server data, from the same API calls the RIZones page made in the browser. */
export const loaders: Record<PageKey, Loader> = {
  // About reads the shell's about (already for the picked year and in the visitor's language); Gold's About
  // also shows the president and secretary.
  // photo-collage's About also lends gallery photos to its headings.
  About: async ({ tenant, currentYearId, themeKey }) => ({
    bod: await api.getBod(tenant.clubId, currentYearId),
    gallery: themeKey === "photo-collage" ? await api.getGallery(tenant.clubId, currentYearId, 1, 24) : null,
  }),
  Projects: async ({ tenant, currentYearId }, params) => ({
    projects: param(params, "pr").toUpperCase() === "CE"
      ? await api.getMeetings(tenant.clubId, currentYearId)
      : await api.getProjects(tenant.clubId, currentYearId),
  }),
  ProjectDetail: async ({ tenant, currentYearId }, params) => ({
    project: await loadProjectRaw(tenant.clubId, intParam(params, "pid"), currentYearId),
  }),
  Directory: async ({ tenant }) => ({ directory: await api.getDirectory(tenant.clubId) }),
  Directors: async ({ tenant, currentYearId }) => ({ bod: await api.getBod(tenant.clubId, currentYearId) }),
  PastPresidents: async ({ tenant }) => ({ pastPresidents: await api.getPastPresidents(tenant.clubId) }),
  Newsletters: async ({ tenant, currentYearId }) => ({ newsletters: await api.getNewsletters(tenant.clubId, currentYearId, 500) }),
  Gallery: async ({ tenant, currentYearId }, params) => ({
    gallery: await api.getGallery(tenant.clubId, currentYearId, Math.max(1, intParam(params, "page")), 24),
  }),
  Events: async ({ tenant }) => ({ upcoming: await api.getUpcomingEvents(tenant.clubId, 99) }),
  EventDetail: async ({ tenant }, params) => {
    const id = intParam(params, "id");
    const upcoming = ((await api.getUpcomingEvents(tenant.clubId, 99)) ?? []) as EventRow[];
    const event = upcoming.find((x) => x.id === id)
      ?? (((await api.getPastEvents(tenant.clubId, null, 99)) ?? []) as EventRow[]).find((x) => x.id === id);
    return { event: event ?? null };
  },
  Calendar: async ({ tenant }, params) => {
    const { year, month } = monthOf(params);
    return { month: await api.getCalendarMonth(tenant.clubId, year, month) };
  },
  Dignitary: async ({ tenant, currentYearId }) => {
    const [ip, dg, bod] = await Promise.all([
      api.getInternationalPresident(tenant.clubId, currentYearId),
      api.getDistrictGovernor(tenant.clubId, currentYearId),
      api.getBod(tenant.clubId, currentYearId),
    ]);
    return { ip, dg, bod };
  },
  SisterClubs: async () => ({}),
  YouthPartners: async () => ({}),
  Meetings: async ({ tenant, currentYearId }) => {
    const [meetings, speakers] = await Promise.all([
      api.getMeetings(tenant.clubId, currentYearId),
      getClubData(tenant.clubId, "speakers?limit=6"),
    ]);
    return { meetings, speakers: speakers ?? [] };
  },
};
