import axios, { type InternalAxiosRequestConfig } from "axios";
import { toast } from "@/hooks/use-toast";
import { validateImagePhoto } from "@/utils/validateImagePhoto";
import { fileTimestamp } from "@/lib/dateUtils";
import { downloadProgressListener } from "@/lib/downloadProgress";
import { validateAndProcessUpload, UploadValidationError } from "@/lib/uploadValidate";
import type { Override } from "@/i18n/messages";
import { postTranslate } from "@/i18n/postTranslate";

// ─── Project-wide upload caps ────────────────────────────────────────────────
// Every upload* function below routes its incoming File through one of these
// helpers BEFORE building FormData. The validator:
//   - rejects files over the 50 MB hard cap (alerts the user)
//   - rejects documents over 5 MB (no safe auto-compress for PDFs)
//   - auto-compresses images between 5 MB and 50 MB down to ≤ 5 MB (canvas
//     resize + iterative JPEG quality, never below the clarity floor)
//   - passes files already ≤ 5 MB straight through
// Throws UploadValidationError on rejection — callers should catch and surface
// the message. The same caps are enforced server-side in Program.cs + web.config
// as a safety net for any client that bypasses the UI.
async function processImageBeforeUpload(file: File): Promise<File> {
  return await validateAndProcessUpload(file, /* treatAsImage */ true);
}
async function processDocumentBeforeUpload(file: File): Promise<File> {
  return await validateAndProcessUpload(file, /* treatAsImage */ false);
}
// Re-export so individual pages can `import { UploadValidationError } from "@/services/api"`
// and pattern-match in their catch blocks if they need to.
export { UploadValidationError };
import { Country, Member, MemberListItem, PagedResult } from "@/types/member";
import {
  LoginRequest,
  LoginResponse,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
  AssignRoleRequest,
  RemoveRoleRequest, AdminYearOptions } from "@/types/auth";
import { DistrictListItem, District, CreateDistrictRequest, UpdateDistrictRequest, DistrictMember } from "@/types/district";
import { ClubListItem, Club, CreateClubRequest, UpdateClubRequest, ClubMemberItem, AddClubMemberRequest, TerminatedMember } from "@/types/club";
import { ZoneListItem, Zone, CreateZoneRequest, UpdateZoneRequest } from "@/types/zone";
import { ModuleCategory, CreateModuleCategoryRequest, UpdateModuleCategoryRequest, Module, CreateModuleRequest, UpdateModuleRequest, ModuleUsageCount, AssignedModule, AvailableModule, DistrictDashboard, ClubDashboard, ModuleComingSoonInfo, UpdateModuleComingSoonRequest } from "@/types/module";
import { RotaryYear } from "@/types/rotaryYear";
import { PastPresident, CreatePastPresidentRequest, UpdatePastPresidentRequest, ClubMemberSearchResult } from "@/types/pastPresident";
import { Designation, CreateDesignationRequest, UpdateDesignationRequest, BoardDirector, CreateBoardDirectorRequest, UpdateBoardDirectorRequest } from "@/types/boardDirector";
import { WebsiteDataModule, CreateWebsiteDataModuleRequest, UpdateWebsiteDataModuleRequest } from "@/types/websiteDataModule";
import { Theme, CreateThemeRequest, UpdateThemeRequest, ClubTheme } from "@/types/theme";
import { ClubBanner, CreateClubBannerRequest, UpdateClubBannerRequest } from "@/types/banner";
import { ClubAdvertisement, CreateClubAdvertisementRequest, UpdateClubAdvertisementRequest } from "@/types/advertisement";
import { ClubSocialLink, CreateClubSocialLinkRequest, UpdateClubSocialLinkRequest } from "@/types/socialLink";
import { ClubMenu, CreateClubMenuRequest, UpdateClubMenuRequest, ClubSubMenu, CreateClubSubMenuRequest, UpdateClubSubMenuRequest } from "@/types/menu";
import { ClubContactDetail, CreateClubContactDetailRequest, UpdateClubContactDetailRequest } from "@/types/contactDetail";
import { ClubAbout, CreateClubAboutRequest, UpdateClubAboutRequest } from "@/types/about";
import { PotentialMember, CreatePotentialMemberRequest, UpdatePotentialMemberRequest } from "@/types/potentialMember";
import {
  AreaOfFocus, Funding,
  ProjectListItem, ProjectDetail, CreateProjectRequest, UpdateProjectRequest,
  OngoingProject,
} from "@/types/project";
import {
  UpcomingEventListItem, UpcomingEventDetail,
  CreateUpcomingEventRequest, UpdateUpcomingEventRequest,
} from "@/types/upcomingEvent";
import {
  AnnouncementListItem, AnnouncementDetail,
  CreateAnnouncementRequest, UpdateAnnouncementRequest,
} from "@/types/announcement";
import {
  NewsletterListItem, NewsletterDetail,
  CreateNewsletterRequest, UpdateNewsletterRequest,
} from "@/types/newsletter";
import {
  DocumentListItem, DocumentDetail,
  CreateDocumentRequest, UpdateDocumentRequest,
} from "@/types/document";
import { GreetingSettings, UpdateGreetingSettingsRequest } from "@/types/greeting";
import { CashfreeKyc, CashfreeVendorDetail } from "@/types/cashfreeKyc";
import { OcvCategory, OcvDocumentType, OcvDocumentListItem, OcvReportItem } from "@/types/ocvGov";
import { AttendanceListItem, AttendanceDetail, CreateAttendanceRequest, UpdateAttendanceRequest, ClubMemberSimple } from "@/types/attendance";
import {
  MonthlyReportListItem, MonthlyReportDetail, TrfEntry, SaveTrfEntry,
  SaveMemberInfo, ReportMeeting, ReportProject, MonthlyReportPreview, ReportYear,
} from "@/types/clubMonthlyReport";
import { TrfFund, TrfContribution } from "@/types/trfContribution";
import { Weblink, WeblinkTree } from "@/types/weblink";
import { Brand, BRAND_ENDPOINT } from "@/lib/brand";
import { AccountOwnerType, ConnectAccountRequest, GatewayCoverage, PaymentAccount } from "@/types/payments";
import { ConsentStatus, PrivacyRequest } from "@/types/privacy";
import { SubGroup, SubGroupDetail, SubGroupMember } from "@/types/subGroup";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const api = axios.create({
  baseURL: API_BASE_URL,
  // Fail slow requests instead of hanging forever on a poor connection, so the
  // network-error toast (below) fires with a clear message. Uploads pass their own
  // longer per-request timeout where needed.
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Public API instance (no auth required)
// The signed-in client (token, time zone, error toasts) for service files kept outside this one.
export { api as apiClient };

const publicApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Every request names the browser's time zone, so a time typed without one ("2026-11-20T18:00") is stored as the
// right UTC instant (the API's ViewerZone).
function addTimeZone(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  if (typeof window !== "undefined") {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) config.headers["X-Time-Zone"] = zone;
  }
  return config;
}
api.interceptors.request.use(addTimeZone);
publicApi.interceptors.request.use(addTimeZone);

// ─── Network-down notification (web) ─────────────────────────────────────────
// A request that gets NO HTTP response (server unreachable, DNS failure, poor
// connection, or the 30s timeout above) is a network problem — navigator.onLine
// can't see this (Wi-Fi can be up while the server is unreachable). Show ONE
// de-duped toast so a burst of failing calls doesn't spam. The offline BANNER
// (NetworkStatusBanner) covers the device-level "no connection at all" case.
let lastNetworkToastAt = 0;
function isNetworkError(error: any): boolean {
  if (error?.response) return false; // got an HTTP status → not a network failure
  const code = error?.code;
  const msg = String(error?.message || "").toLowerCase();
  return (
    code === "ERR_NETWORK" ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    msg === "network error" ||
    msg.includes("timeout")
  );
}
function notifyNetworkError() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastNetworkToastAt < 6000) return; // throttle repeats
  lastNetworkToastAt = now;
  const offline = !navigator.onLine;
  toast({
    variant: "destructive",
    title: offline ? "You are offline" : "Network problem",
    description: offline
      ? "Check your internet connection and try again."
      : "Couldn't reach the server. Please check your connection and try again.",
  });
}

// Request interceptor: attach JWT token
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("auth_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  // Uploads (multipart FormData) can legitimately take longer than the default
  // 30s timeout on a slow connection — give them a generous 2-minute window so a
  // real upload isn't cut off (the 30s cap is meant for stuck GET/POST calls).
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    config.timeout = 120000;
  }
  // Report download progress in the clicked button (lib/downloadProgress): report the file transfer of a blob
  // download while one runs, unless the call already tracks its own progress.
  const dl = downloadProgressListener();
  if (dl && config.responseType === "blob" && !config.onDownloadProgress) {
    config.onDownloadProgress = (e) => { if (e.total) dl(e.loaded / e.total); };
  }
  return config;
});

// Response interceptor: surface network failures + handle 401 by clearing auth and redirecting
api.interceptors.response.use(
  (response) => response,
  (error) => {
    ensureErrorMessage(error);
    if (isNetworkError(error)) notifyNetworkError();
    const isAuthEndpoint = error.config?.url?.startsWith("/api/auth/");
    if (error.response?.status === 401 && typeof window !== "undefined" && !isAuthEndpoint) {
      localStorage.removeItem("auth_token");
      // Report links send the reader back to the report after sign-in.
      const here = stripBase(window.location.pathname);
      window.location.href = withBase(here.startsWith("/report/") ? `/login?returnUrl=${encodeURIComponent(here)}` : "/login");
    }
    // KIS/ROW/SUB/01: the whole club or district is closed (no working subscription, or not an executive). Pages
    // outside the dashboards have no locked screen of their own, so they land on the subscription page.
    const lockCode = error.response?.status === 403 ? error.response?.data?.code : undefined;
    if (typeof window !== "undefined" && (lockCode === "subscription_required" || lockCode === "executives_only")) {
      const here = stripBase(window.location.pathname);
      const area = /^\/(district-admin-dashboard|ag-dashboard|districts)(\/|$)/.test(here) ? "district" : "club";
      if (!/-admin-dashboard(\/|$)/.test(here)) window.location.href = withBase(`/${area}-admin-dashboard/subscription?locked=${lockCode}`);
    }
    // A temporary-password session outside the sign-in page's change dialog (reload, typed address).
    if (error.response?.data?.code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined" && !window.location.pathname.endsWith("/login")) {
      localStorage.removeItem("auth_token");
      window.location.href = withBase("/login");
    }
    return Promise.reject(error);
  }
);

// Public instance: same network-failure toast (no auth/redirect handling).
publicApi.interceptors.response.use(
  (response) => response,
  (error) => {
    ensureErrorMessage(error);
    if (isNetworkError(error)) notifyNetworkError();
    return Promise.reject(error);
  }
);

// Instance brand (name, logos, contacts, locale defaults, feature flags). Anonymous;
// the server caches it for an hour. Callers fall back to DEFAULT_BRAND on any error.
export async function getPublicBrand(): Promise<Partial<Brand>> {
  const res = await publicApi.get(BRAND_ENDPOINT);
  return res.data;
}

// Store the signed-in member's interface language (ISO code) so it follows them
// to other browsers and the app (master plan WS2-03).
export async function updateMyLanguage(language: string): Promise<void> {
  await api.put("/api/members/me/language", { language });
}

export async function getCountries(): Promise<Country[]> {
  const response = await api.get("/api/countries");
  return response.data;
}

// District admin's per-(district, year) Club Monthly Report submission-email settings:
// Yes/No for emailing the District Governor + extra comma-separated CC addresses.
export interface DistrictCmrEmailSettings {
  sendToDistrictGovernor: boolean;
  ccEmails: string;
}

export async function getDistrictCmrEmailSettings(
  districtId: number,
  yearId: number
): Promise<DistrictCmrEmailSettings> {
  const response = await api.get(`/api/districts/${districtId}/cmr-email-settings`, {
    params: { yearId },
  });
  return response.data;
}

export async function saveDistrictCmrEmailSettings(
  districtId: number,
  yearId: number,
  payload: DistrictCmrEmailSettings
): Promise<void> {
  await api.put(`/api/districts/${districtId}/cmr-email-settings`, payload, {
    params: { yearId },
  });
}

// Daily statistics report (SuperAdmin) — preview counts / download Excel / send the email now.
export interface DailyStatsBreakdownRow {
  avenue: string;
  oneTime: number;
  ongoing: number;
  total: number;
}
export interface DailyStatsBreakdown {
  title: string;
  rows: DailyStatsBreakdownRow[];
}
export async function getDailyStatsReportCounts(): Promise<{
  subject: string;
  counts: { metric: string; count: number }[];
  breakdowns?: DailyStatsBreakdown[];
}> {
  const response = await api.get("/api/daily-stats-report/preview", { params: { format: "counts" } });
  return response.data;
}

// Club member directory (club managers only): Excel sheet or printable PDF, same filters as the members list.
export async function downloadClubMembersExport(
  clubId: number,
  format: "xlsx" | "pdf",
  filters?: { search?: string; year?: number; designation?: string; classification?: string },
): Promise<Blob> {
  const response = await api.get(`/api/clubs/${clubId}/members/export`, {
    params: { format, ...filters },
    responseType: "blob",
    timeout: 120000,
  });
  return response.data;
}

export type PrintKind = "labels" | "badges" | "tents";
export type PrintPaper = "a4" | "letter";

// Printable club outputs (club managers only). withoutAddress: members left off the labels for lack of an address.
export async function downloadClubMembersPrint(
  clubId: number,
  kind: PrintKind,
  paper: PrintPaper,
  search?: string,
): Promise<{ blob: Blob; withoutAddress: number }> {
  const response = await api.get(`/api/clubs/${clubId}/members/print`, {
    params: { kind, paper, search },
    responseType: "blob",
    timeout: 120000,
  });
  return { blob: response.data, withoutAddress: Number(response.headers["x-members-without-address"] ?? 0) };
}

export async function downloadDailyStatsReportExcel(): Promise<Blob> {
  const response = await api.get("/api/daily-stats-report/preview", { responseType: "blob" });
  return response.data;
}

export async function sendDailyStatsReportNow(): Promise<{ message: string }> {
  const response = await api.post("/api/daily-stats-report/run");
  return response.data;
}

// ── District Performance Report (SuperAdmin: Settings → District Performance Report) ──
export interface PerformanceReportItem { label: string; value: string; url?: string | null; }
export interface PerformanceReportHighlight { group?: string | null; label: string; value: string; sub?: string | null; percent?: number | null; newRow?: boolean; }
export interface PerformanceReportSection {
  part: string;
  partSubtitle?: string | null;
  title: string;
  intro?: string | null;
  items: PerformanceReportItem[];
  tableHeaders?: string[] | null;
  tableRows?: string[][] | null;
  note?: string | null;
}
export interface DistrictPerformanceReportView {
  districtId: number;
  districtNumber: string;
  zoneName: string;
  yearId: number;
  yearLabel: string;
  periodLabel: string;
  governorName?: string | null;
  governorEmail?: string | null;
  governorMobile?: string | null;
  subject: string;
  highlights: PerformanceReportHighlight[];
  sections: PerformanceReportSection[];
  scopeNote?: string | null;   // plain line under the tiles: counts cover synced clubs only
  html?: string | null;        // the email body itself — used by the screen's "Print"
}
export interface PerformanceReportDistrictOption { districtId: number; districtNumber: string; zoneName?: string | null; }
export interface PerformanceReportLogRow {
  id: number;
  districtNumber?: string | null;
  runType: string;
  toEmail?: string | null;
  ccEmails?: string | null;
  status: string;
  message?: string | null;
  createdDate: string;
}
export interface PerformanceReportSettings {
  scheduleEnabled: boolean;
  mode: string;
  hour: number;
  testDistricts: string[];
  testRecipients: string[];
  liveCc: string[];
  liveDays: number[];
  recentRuns: PerformanceReportLogRow[];
}

export async function getDistrictPerformanceReportSettings(): Promise<PerformanceReportSettings> {
  const response = await api.get("/api/district-performance-report/settings");
  return response.data;
}

export async function getDistrictPerformanceReportDistricts(): Promise<PerformanceReportDistrictOption[]> {
  const response = await api.get("/api/district-performance-report/districts");
  return response.data;
}

export async function getDistrictPerformanceReportView(districtId: number): Promise<DistrictPerformanceReportView> {
  const response = await api.get("/api/district-performance-report/view", { params: { districtId }, timeout: 120000 });
  return response.data;
}

// The Excel carries the all-clubs Goal Setting workbook, so it can take a while — long timeout.
export async function downloadDistrictPerformanceReportExcel(districtId: number): Promise<Blob> {
  const response = await api.get("/api/district-performance-report/excel", { params: { districtId }, responseType: "blob", timeout: 300000 });
  return response.data;
}

// Sends to the configured TEST recipients only (never the District Governor).
export async function sendDistrictPerformanceReportTest(districtId: number): Promise<{ message: string }> {
  const response = await api.post("/api/district-performance-report/send-test", null, { params: { districtId }, timeout: 300000 });
  return response.data;
}

export async function getMembers(
  page: number = 1,
  pageSize: number = 12,
  search?: string,
  bloodGroup?: string,
  gender?: string
): Promise<PagedResult<MemberListItem>> {
  const params: Record<string, string | number> = { page, pageSize };
  if (search) params.search = search;
  if (bloodGroup) params.bloodGroup = bloodGroup;
  if (gender) params.gender = gender;

  const response = await api.get("/api/members", { params });
  return response.data;
}

export async function getMember(id: number, clubId?: number): Promise<Member> {
  // clubId scopes the per-club join date (club_members.JoinedDate) to the club being edited.
  const response = await api.get(`/api/members/${id}`, clubId ? { params: { clubId } } : undefined);
  return response.data;
}

export async function createMember(
  data: Partial<Member>
): Promise<{ id: number }> {
  const response = await api.post("/api/members", data);
  return response.data;
}

export async function updateMember(
  id: number,
  data: Partial<Member>
): Promise<void> {
  await api.put(`/api/members/${id}`, data);
}

export async function deleteMember(id: number): Promise<void> {
  await api.delete(`/api/members/${id}`);
}

export async function uploadPhoto(
  file: File,
  type: "profile" | "family" | "familymember"
): Promise<{ path: string }> {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);

  const response = await api.post(`/api/members/upload?type=${type}`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
}

// Auth APIs
/** KIS/ROW/SUB/01: club executives get a sign-in code by email (no password). */
export async function requestExecutiveCode(email: string): Promise<{ message: string }> {
  const response = await api.post("/api/auth/exec-code/request", { email });
  return response.data;
}

export async function verifyExecutiveCode(email: string, code: string): Promise<LoginResponse> {
  const response = await api.post("/api/auth/exec-code/verify", { email, code });
  return response.data;
}

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const response = await api.post("/api/auth/login", data);
  return response.data;
}

// Mobile→web SSO: exchange a one-time token (from the mobile app) for a full web login session.
// Returns the same shape as login(); public endpoint (no prior auth needed).
export async function ssoExchange(token: string): Promise<LoginResponse> {
  const response = await api.post("/api/auth/sso-exchange", { token });
  return response.data;
}

export interface DashboardEntry {
  kind: string;
  route: string;
  label: string;
  // Wave 9A: optional scope fields. Multi-scope users get one entry per scope of the same kind.
  clubId?: number | null;
  clubName?: string | null;
  districtId?: number | null;
  districtNumber?: string | null;
  zoneId?: number | null;
  zoneName?: string | null;
}

export interface DashboardLandingRoute {
  route: string;
  reason: string;
  available: DashboardEntry[];
}

export async function resolveDashboardLanding(): Promise<DashboardLandingRoute> {
  const response = await api.get("/api/dashboard/resolve-landing");
  return response.data;
}

// AG Dashboard endpoints — typed wrappers around /api/ag-dashboard/*
import type {
  AgClubsResponse,
  AgClubDetailResponse,
  AgMembershipResponse,
  AgTrfResponse,
  AgExcellenceResponse,
  AgYouthResponse,
  AgProjectsResponse,
  AgProjectDetail,
  AgDistrictResponse,
} from "@/types/agDashboard";

function agParams(yearId?: number | null, clubId?: number | null, districtId?: number | null) {
  const p: Record<string, number> = {};
  if (yearId && yearId > 0) p.yearId = yearId;
  if (clubId != null && clubId > 0) p.clubId = clubId;
  // Wave 9G: when an AG with multi-district assignments has picked a district
  // from the topbar, scope the fan-out endpoints to that district only.
  if (districtId != null && districtId > 0) p.districtId = districtId;
  return Object.keys(p).length > 0 ? p : undefined;
}

// Full detail + photos for one AG project (row-click popup). yearId picks the year table.
export async function getAgProjectDetail(projectId: number, yearId?: number | null, districtId?: number | null): Promise<AgProjectDetail> {
  const response = await api.get(`/api/ag-dashboard/projects/${projectId}`, {
    params: agParams(yearId, undefined, districtId),
  });
  return response.data;
}

// Years for the AG topbar picker — only years the AG's OWN clubs have data for.
export async function getAgAvailableYears(districtId?: number | null): Promise<{
  currentYearId: number | null;
  currentYearLabel: string;
  years: Array<{ id: number; yearLabel: string; isCurrent: boolean }>;
}> {
  const r = await api.get("/api/ag-dashboard/available-years", {
    params: agParams(undefined, undefined, districtId),
  });
  return r.data;
}

export async function getAgDashboardClubs(yearId?: number | null, clubId?: number | null, districtId?: number | null): Promise<AgClubsResponse> {
  const response = await api.get("/api/ag-dashboard/clubs", { params: agParams(yearId, clubId, districtId) });
  return response.data;
}

export async function getAgDashboardClubDetail(clubId: number, yearId?: number | null): Promise<AgClubDetailResponse> {
  const response = await api.get(`/api/ag-dashboard/clubs/${clubId}`, { params: agParams(yearId) });
  return response.data;
}

export async function getAgDashboardMembership(yearId?: number | null, clubId?: number | null, districtId?: number | null): Promise<AgMembershipResponse> {
  const response = await api.get("/api/ag-dashboard/membership", { params: agParams(yearId, clubId, districtId) });
  return response.data;
}

export async function getAgDashboardTrf(yearId?: number | null, clubId?: number | null, districtId?: number | null): Promise<AgTrfResponse> {
  const response = await api.get("/api/ag-dashboard/trf", { params: agParams(yearId, clubId, districtId) });
  return response.data;
}

export async function getAgDashboardExcellence(yearId?: number | null, clubId?: number | null, districtId?: number | null): Promise<AgExcellenceResponse> {
  const response = await api.get("/api/ag-dashboard/excellence", { params: agParams(yearId, clubId, districtId) });
  return response.data;
}

export async function getAgDashboardYouth(yearId?: number | null, clubId?: number | null, districtId?: number | null): Promise<AgYouthResponse> {
  const response = await api.get("/api/ag-dashboard/youth", { params: agParams(yearId, clubId, districtId) });
  return response.data;
}

export async function getAgDashboardProjects(yearId?: number | null, clubId?: number | null, districtId?: number | null): Promise<AgProjectsResponse> {
  const response = await api.get("/api/ag-dashboard/projects", { params: agParams(yearId, clubId, districtId) });
  return response.data;
}

export async function getAgDashboardDistrict(yearId?: number | null, clubId?: number | null, districtId?: number | null): Promise<AgDistrictResponse> {
  const response = await api.get("/api/ag-dashboard/district", { params: agParams(yearId, clubId, districtId) });
  return response.data;
}

// Club Admin Dashboard endpoints
import type {
  ClubAdminOverviewResponse,
  ClubAdminFoundationResponse,
  ClubAdminMembershipResponse,
  ClubAdminAvenueResponse,
  ClubAdminEGovernanceResponse,
  ClubAdminCommunicationResponse,
  ClubAdminWebsiteResponse,
  ClubAdminPaymentsResponse,
} from "@/types/clubAdminDashboard";

function caParams(yearId?: number | null, clubId?: number | null) {
  const p: Record<string, number> = {};
  if (yearId && yearId > 0) p.yearId = yearId;
  if (clubId != null && clubId > 0) p.clubId = clubId;
  return Object.keys(p).length > 0 ? p : undefined;
}

// Live fetch of terminated members from Rotary.org (display only — backend
// never persists these). Used by /club-admin-dashboard/dashboard/rotary-network
// to populate the Terminated Members view.
export async function getRotaryOrgTerminatedMembers(clubId?: number | null): Promise<{
  clubId: number;
  clubName: string;
  rotaryOrgClubId?: number;
  clubType?: string;
  members: Array<{
    id: number;
    memberId: string;
    memberType: string;
    firstName: string;
    middleName: string;
    lastName: string;
    admissionDate: string | null;
    terminationDate: string | null;
    terminationReason: string;
    mobile?: string | null;
    email?: string | null;
  }>;
  totalCount?: number;
  warning?: string;
}> {
  const r = await api.get("/api/club-admin-dashboard/rotary-org-terminated-members", {
    params: caParams(undefined, clubId),
  });
  return r.data;
}

// Powers the global year dropdown in the dashboard topbar. Returns only years
// with actual data for this club, plus the current year as default.
export async function getClubAdminAvailableYears(clubId?: number | null): Promise<{
  clubId: number;
  currentYearId: number | null;
  currentYearLabel: string;
  years: Array<{ id: number; yearLabel: string; isCurrent: boolean }>;
}> {
  const r = await api.get("/api/club-admin-dashboard/available-years", {
    params: caParams(undefined, clubId),
  });
  return r.data;
}

export async function getClubAdminOverview(yearId?: number | null, clubId?: number | null): Promise<ClubAdminOverviewResponse> {
  const r = await api.get("/api/club-admin-dashboard/overview", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminFoundation(yearId?: number | null, clubId?: number | null): Promise<ClubAdminFoundationResponse> {
  const r = await api.get("/api/club-admin-dashboard/foundation", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminMembership(yearId?: number | null, clubId?: number | null): Promise<ClubAdminMembershipResponse> {
  const r = await api.get("/api/club-admin-dashboard/membership", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminAvenue(yearId?: number | null, clubId?: number | null): Promise<ClubAdminAvenueResponse> {
  const r = await api.get("/api/club-admin-dashboard/avenue", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminEGovernance(yearId?: number | null, clubId?: number | null): Promise<ClubAdminEGovernanceResponse> {
  const r = await api.get("/api/club-admin-dashboard/egovernance", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminCommunication(yearId?: number | null, clubId?: number | null): Promise<ClubAdminCommunicationResponse> {
  const r = await api.get("/api/club-admin-dashboard/communication", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminWebsite(yearId?: number | null, clubId?: number | null): Promise<ClubAdminWebsiteResponse> {
  const r = await api.get("/api/club-admin-dashboard/website", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminPayments(yearId?: number | null, clubId?: number | null): Promise<ClubAdminPaymentsResponse> {
  const r = await api.get("/api/club-admin-dashboard/payments", { params: caParams(yearId, clubId) });
  return r.data;
}

// Dashboard sub-tabs (Phase B)
import type {
  ClubAdminDashboardDirectoryResponse,
  ClubAdminDashboardBodResponse,
  ClubAdminDashboardRotaryNetworkResponse,
} from "@/types/clubAdminDashboard";

export async function getClubAdminDashboardDirectory(yearId?: number | null, clubId?: number | null): Promise<ClubAdminDashboardDirectoryResponse> {
  const r = await api.get("/api/club-admin-dashboard/dashboard-directory", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminDashboardBod(yearId?: number | null, clubId?: number | null): Promise<ClubAdminDashboardBodResponse> {
  const r = await api.get("/api/club-admin-dashboard/dashboard-bod", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getClubAdminDashboardRotaryNetwork(yearId?: number | null, clubId?: number | null): Promise<ClubAdminDashboardRotaryNetworkResponse> {
  const r = await api.get("/api/club-admin-dashboard/dashboard-rotary-network", { params: caParams(yearId, clubId) });
  return r.data;
}

// Service Projects & Public Image (Phase C)
import type {
  ServiceProjectsOverviewResponse,
  ServiceProjectsAvenueDetailResponse,
} from "@/types/clubAdminDashboard";

export async function getServiceProjectsOverview(yearId?: number | null, clubId?: number | null): Promise<ServiceProjectsOverviewResponse> {
  const r = await api.get("/api/club-admin-dashboard/service-projects-overview", { params: caParams(yearId, clubId) });
  return r.data;
}
export async function getServiceProjectsAvenue(avenueKey: string, yearId?: number | null, clubId?: number | null): Promise<ServiceProjectsAvenueDetailResponse> {
  const params: Record<string, unknown> = { avenueKey };
  if (yearId != null) params.yearId = yearId;
  if (clubId != null) params.clubId = clubId;
  const r = await api.get("/api/club-admin-dashboard/service-projects-avenue", { params });
  return r.data;
}

// Foundation Collection Goals (Phase C)
import type {
  FoundationGoalListResponse,
  FoundationGoalDto,
  FoundationGoalSaveRequest,
} from "@/types/clubAdminDashboard";

export async function getFoundationGoalsList(yearId?: number | null, clubId?: number | null): Promise<FoundationGoalListResponse> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (clubId != null) params.clubId = clubId;
  const r = await api.get("/api/club-foundation-goals/list", { params });
  return r.data;
}
export async function saveFoundationGoal(body: FoundationGoalSaveRequest, clubId?: number | null): Promise<FoundationGoalDto> {
  const params: Record<string, unknown> = {};
  if (clubId != null) params.clubId = clubId;
  const r = await api.post("/api/club-foundation-goals", body, { params });
  return r.data;
}
export async function deleteFoundationGoal(yearId: number, clubId?: number | null): Promise<void> {
  const params: Record<string, unknown> = {};
  if (clubId != null) params.clubId = clubId;
  await api.delete(`/api/club-foundation-goals/${yearId}`, { params });
}

// Goal Setting module (Membership / Foundation / Youth / Public Image, Club + District level)
import type {
  GoalCategoryDto,
  GoalCategoryFormDto,
  SaveGoalEntriesRequest,
  GoalClubMatrixDto,
  GoalClubMonthlyMatrixDto,
  GoalDistrictSummaryMatrixDto,
  GoalDistrictSummaryDto,
  GoalCommentDto,
  GoalDistrictMessagesDto,
  GoalDistrictConversationDto,
  GoalFoundationImportResultDto,
  GoalOverviewMatrixDto,
  GoalDirectContactDto,
  GoalDirectConversationDto,
  GoalGroupDto,
  GoalGroupConversationDto,
} from "@/types/goalSetting";

export async function getGoalCategories(): Promise<GoalCategoryDto[]> {
  const r = await api.get("/api/goal-setting/categories");
  return r.data;
}

// SuperAdmin read-only Overview matrix: one zone × one category × one year.
export async function getGoalOverview(
  zoneId: number, categoryId: number, yearId?: number | null,
): Promise<GoalOverviewMatrixDto> {
  const params: Record<string, unknown> = { zoneId, categoryId };
  if (yearId != null) params.yearId = yearId;
  const r = await api.get("/api/goal-setting/overview", { params });
  return r.data;
}

// Foundation benchmark import (SuperAdmin, cumulative till-date) — upload the master Excel
// for a year. Returns imported districts + skipped (unrecognised) rows with reasons.
export async function importGoalFoundationMonthly(
  yearId: number, file: File, month = 0,
): Promise<GoalFoundationImportResultDto> {
  const fd = new FormData();
  fd.append("File", file);
  fd.append("YearId", String(yearId));
  fd.append("Month", String(month));
  const r = await api.post("/api/goal-setting/foundation-import", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}

// Club Foundation import — all clubs of a district from the Rotary MCR Excel.
export async function importGoalFoundationClub(
  yearId: number, file: File, month = 0,
): Promise<GoalFoundationImportResultDto> {
  const fd = new FormData();
  fd.append("File", file);
  fd.append("YearId", String(yearId));
  fd.append("Month", String(month));
  const r = await api.post("/api/goal-setting/foundation-import/club", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}

// District Membership import (SuperAdmin, 2026-27 on): Rotary.org "Comparison to 1 July" (clubs +
// members) and "Members Admitted by Gender" (women). The month is read from the members file's date.
export async function importGoalDistrictMembership(
  yearId: number, membersFile: File, genderFile: File, rotaractFile?: File | null, interactFile?: File | null,
): Promise<GoalFoundationImportResultDto> {
  const fd = new FormData();
  fd.append("MembersFile", membersFile);
  fd.append("GenderFile", genderFile);
  if (rotaractFile) fd.append("RotaractFile", rotaractFile);   // optional: Youth Service Rotaract Clubs Achieved
  if (interactFile) fd.append("InteractFile", interactFile);   // optional: Interact_Statistics -> Interact Clubs Achieved
  fd.append("YearId", String(yearId));
  const r = await api.post("/api/goal-setting/membership-import", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}

// Download the master import template (District Number + the 9 Foundation columns,
// all active district numbers pre-filled).
export async function downloadGoalFoundationSample(): Promise<Blob> {
  const r = await api.get("/api/goal-setting/foundation-import/sample", { responseType: "blob" });
  return r.data;
}
// Rotary.org MCR -> our club import file: synced clubs only, 2 decimals. Nothing is imported.
export async function convertGoalFoundationClubFile(
  file: File,
): Promise<{ blob: Blob; filled: number; missing: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await api.post("/api/goal-setting/foundation-import/club/convert", fd, {
    headers: { "Content-Type": "multipart/form-data" },
    responseType: "blob",
  });
  return {
    blob: r.data,
    filled: Number(r.headers["x-clubs-filled"] ?? 0),
    missing: Number(r.headers["x-clubs-missing"] ?? 0),
  };
}
// Club Foundation sample (MCR layout, one row per current synced club, 0 baseline).
export async function downloadGoalFoundationClubSample(): Promise<Blob> {
  const r = await api.get("/api/goal-setting/foundation-import/club/sample", { responseType: "blob" });
  return r.data;
}
export async function getClubGoalForm(categoryId: number, yearId?: number | null, clubId?: number | null): Promise<GoalCategoryFormDto> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (clubId != null) params.clubId = clubId;
  const r = await api.get(`/api/goal-setting/clubs/${categoryId}`, { params });
  return r.data;
}
export async function saveClubGoalForm(categoryId: number, body: SaveGoalEntriesRequest, clubId?: number | null): Promise<GoalCategoryFormDto> {
  const params: Record<string, unknown> = {};
  if (clubId != null) params.clubId = clubId;
  const r = await api.post(`/api/goal-setting/clubs/${categoryId}`, body, { params });
  return r.data;
}
export async function getDistrictGoalForm(categoryId: number, yearId?: number | null, districtId?: number | null): Promise<GoalCategoryFormDto> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (districtId != null) params.districtId = districtId;
  const r = await api.get(`/api/goal-setting/districts/${categoryId}`, { params });
  return r.data;
}
export async function saveDistrictGoalForm(categoryId: number, body: SaveGoalEntriesRequest, districtId?: number | null): Promise<GoalCategoryFormDto> {
  const params: Record<string, unknown> = {};
  if (districtId != null) params.districtId = districtId;
  const r = await api.post(`/api/goal-setting/districts/${categoryId}`, body, { params });
  return r.data;
}
// ── Month-wise goals (additive; separate from the annual goal flow above) ──
export interface GoalMonthPeriod { month: number; label: string; calendarYear: number; isAvailable: boolean }
export interface GoalMonthlyField {
  fieldId: number; groupName: string; fieldKey: string; fieldLabel: string;
  dataType: string; unit: string | null;
  annualTarget: number | null;
  baseline: number | null;   // "As on July 1st" — Membership only (clubs/members/women), else null
  monthly: Record<number, number | null>;
  total: number;
  // The yearly target split across the year (user 2026-09-25). The YEAR itself never changes -
  // annualTarget above is still the single figure. These must add up to it exactly.
  monthlyTargets?: Record<number, number | null>;      // month 7..6
  quarterlyTargets?: Record<number, number | null>;    // quarter 1..4 (sum of its 3 months)
  quarterlyAchieved?: Record<number, number | null>;   // quarter 1..4
  targetTotal?: number;
  // What the split must add up to: the GROWTH (target − as-on-July-1st) for a Membership metric,
  // the target itself for TRF, which starts from zero.
  splitBase?: number | null;
  targetsAreSuggested?: boolean;                       // shown, not yet saved
  // false → annual-only field (baselines, RAG, Summary, TRF Total Giving, Youth "Existing/Total",
  // Public Image Other Points + Suggestions): listed with its value, EMPTY month cells, not editable.
  monthlyTracked?: boolean;
  displayText?: string | null;   // Yes/No or text value for those annual-only fields
}
export interface GoalMonthlyForm {
  categoryId: number; categoryName: string; entityType: string;
  clubId: number | null; districtId: number | null; entityName: string;
  yearId: number; yearLabel: string; isEditable: boolean;
  months: GoalMonthPeriod[]; fields: GoalMonthlyField[];
}
export interface SaveGoalMonthlyRequest { yearId: number; month: number; entries: { fieldId: number; numericValue: number | null }[] }

// Save the SPLIT of the yearly target. The yearly figure is never sent. period = "month" (12 values,
// keyed 7..6) or "quarter" (4 values, keyed 1..4). The API refuses anything that does not add up to
// the yearly target exactly, naming the metric and the difference.
export interface SaveGoalTargetSplitRequest {
  yearId: number;
  period: "month" | "quarter";
  fields: { fieldId: number; values: Record<number, number | null> }[];
}

export async function saveClubTargetSplit(categoryId: number, body: SaveGoalTargetSplitRequest, clubId?: number | null): Promise<GoalMonthlyForm> {
  const params: Record<string, unknown> = {};
  if (clubId != null) params.clubId = clubId;
  const r = await api.post(`/api/goal-setting/targets/split/clubs/${categoryId}`, body, { params });
  return r.data;
}

export async function saveDistrictTargetSplit(categoryId: number, body: SaveGoalTargetSplitRequest, districtId?: number | null): Promise<GoalMonthlyForm> {
  const params: Record<string, unknown> = {};
  if (districtId != null) params.districtId = districtId;
  const r = await api.post(`/api/goal-setting/targets/split/districts/${categoryId}`, body, { params });
  return r.data;
}

export async function getClubMonthlyGoals(categoryId: number, yearId?: number | null, clubId?: number | null): Promise<GoalMonthlyForm> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (clubId != null) params.clubId = clubId;
  const r = await api.get(`/api/goal-setting/monthly/clubs/${categoryId}`, { params });
  return r.data;
}
export async function saveClubMonthlyGoals(categoryId: number, body: SaveGoalMonthlyRequest, clubId?: number | null): Promise<GoalMonthlyForm> {
  const params: Record<string, unknown> = {};
  if (clubId != null) params.clubId = clubId;
  const r = await api.post(`/api/goal-setting/monthly/clubs/${categoryId}`, body, { params });
  return r.data;
}
export async function getDistrictMonthlyGoals(categoryId: number, yearId?: number | null, districtId?: number | null): Promise<GoalMonthlyForm> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (districtId != null) params.districtId = districtId;
  const r = await api.get(`/api/goal-setting/monthly/districts/${categoryId}`, { params });
  return r.data;
}
// Goal-oversight read-only month-wise for ANY district in the caller's goal scope.
export async function getDistrictMonthlyGoalsScoped(categoryId: number, districtId: number, yearId?: number | null): Promise<GoalMonthlyForm> {
  const params = { districtId, ...(yearId != null ? { yearId } : {}) };
  const r = await api.get(`/api/goal-setting/monthly/districts/${categoryId}/oversight`, { params });
  return r.data;
}
export async function saveDistrictMonthlyGoals(categoryId: number, body: SaveGoalMonthlyRequest, districtId?: number | null): Promise<GoalMonthlyForm> {
  const params: Record<string, unknown> = {};
  if (districtId != null) params.districtId = districtId;
  const r = await api.post(`/api/goal-setting/monthly/districts/${categoryId}`, body, { params });
  return r.data;
}

// Category-less goal report Excel (all four categories, Till Date + Month wise sheets).
export async function downloadDistrictGoalExcel(yearId?: number | null, districtId?: number | null): Promise<Blob> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (districtId != null) params.districtId = districtId;
  const r = await api.get(`/api/goal-setting/goals-excel/districts`, { params, responseType: "blob" });
  return r.data;
}
export async function downloadClubGoalExcel(yearId?: number | null, clubId?: number | null): Promise<Blob> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (clubId != null) params.clubId = clubId;
  const r = await api.get(`/api/goal-setting/goals-excel/clubs`, { params, responseType: "blob" });
  return r.data;
}
// Club Goal Setting → "All": every club in the district in one workbook.
export async function downloadAllClubsGoalExcel(yearId?: number | null, districtId?: number | null): Promise<Blob> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (districtId != null) params.districtId = districtId;
  const r = await api.get(`/api/goal-setting/goals-excel/clubs-all`, { params, responseType: "blob", timeout: 300000 });
  return r.data;
}

// Club Analytics — per-club counts report (one row per club for a district; one row for a single club).
export async function downloadClubAnalyticsDistrict(yearId?: number | null, districtId?: number | null): Promise<Blob> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (districtId != null) params.districtId = districtId;
  const r = await api.get(`/api/club-analytics/excel`, { params, responseType: "blob" });
  return r.data;
}
export async function downloadClubAnalyticsClub(yearId?: number | null, clubId?: number | null): Promise<Blob> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (clubId != null) params.clubId = clubId;
  const r = await api.get(`/api/club-analytics/excel`, { params, responseType: "blob" });
  return r.data;
}

// Read-only matrix: all clubs × one category's fields (+ per-club RAG). Powers "View club goals".
export async function getDistrictClubsGoalMatrix(categoryId: number, yearId?: number | null, districtId?: number | null): Promise<GoalClubMatrixDto> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (districtId != null) params.districtId = districtId;
  const r = await api.get(`/api/goal-setting/districts/${categoryId}/clubs-matrix`, { params });
  return r.data;
}
export async function getDistrictClubsMonthlyMatrix(categoryId: number, yearId?: number | null, districtId?: number | null): Promise<GoalClubMonthlyMatrixDto> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (districtId != null) params.districtId = districtId;
  const r = await api.get(`/api/goal-setting/districts/${categoryId}/clubs-monthly-matrix`, { params });
  return r.data;
}
// Goal-oversight "Club Goal Setting" popup: clubs matrix for a specific district in the caller's goal
// scope (SuperAdmin Goal Overview).
export async function getScopedDistrictClubsGoalMatrix(categoryId: number, districtId: number, yearId?: number | null): Promise<GoalClubMatrixDto> {
  const params = { districtId, ...(yearId != null ? { yearId } : {}) };
  const r = await api.get(`/api/goal-setting/districts/${categoryId}/clubs-matrix/oversight`, { params, timeout: 180000 });
  return r.data;
}
export async function getScopedDistrictClubsMonthlyMatrix(categoryId: number, districtId: number, yearId?: number | null): Promise<GoalClubMonthlyMatrixDto> {
  const params = { districtId, ...(yearId != null ? { yearId } : {}) };
  const r = await api.get(`/api/goal-setting/districts/${categoryId}/clubs-monthly-matrix/oversight`, { params, timeout: 180000 });
  return r.data;
}
// Goal-oversight "View clubs" popup → the all-clubs "Club Goal Setting" report for that district.
export async function downloadScopedAllClubsGoalReport(districtId: number, yearId?: number | null): Promise<Blob> {
  const params = { districtId, ...(yearId != null ? { yearId } : {}) };
  const r = await api.get(`/api/goal-setting/goals-excel/clubs-all/oversight`, { params, responseType: "blob", timeout: 300000 });
  return r.data;
}

// SuperAdmin only: clear a project's Rotary.org "Synced" flag so the club can sync it again.
// Used from the club listing when a club reports that a project reads Synced but never reached
// Rotary.org (the admin confirmed without clicking Publish there).
export async function resetRotaryOrgSync(projectId: number, clubId: number): Promise<{ ok: boolean; updated: number; message: string }> {
  const r = await api.post("/api/rotary-org-sync/reset", { projectId, clubId });
  return r.data;
}

// SuperAdmin → Settings → Project Sync: the Rotary.org sync log (Sync clicked / Published / Reset).
export interface ProjectSyncClub {
  clubId: number;
  clubName: string;
  districtId: number | null;
  districtNumber: string | null;
}
export interface ProjectSyncRow {
  projectId: number;
  yearId: number;
  yearLabel: string | null;
  title: string | null;
  projectDate: string | null;
  areaOfFocus: string | null;
  status: "Published" | "Published (before log)" | "Pending for publish" | "Reset" | string;
  syncClicks: number;
  lastSyncClickedAt: string | null;
  lastSyncClickedBy: string | null;
  publishedAt: string | null;
  lastResetAt: string | null;
  lastActivity: string | null;
}
export interface ProjectSyncEvent {
  id: number;
  action: "sync_clicked" | "published" | "reset" | string;
  createdDate: string;
  memberId: number | null;
  memberName: string | null;
  clientIp: string | null;
}
export async function searchProjectSyncClubs(q: string): Promise<ProjectSyncClub[]> {
  const r = await api.get("/api/settings/project-sync/clubs", { params: { q } });
  return r.data;
}
export async function getProjectSyncRows(clubId: number): Promise<ProjectSyncRow[]> {
  const r = await api.get(`/api/settings/project-sync/clubs/${clubId}/projects`);
  return r.data;
}
export async function getProjectSyncHistory(clubId: number, projectId: number, yearId?: number): Promise<ProjectSyncEvent[]> {
  const r = await api.get(`/api/settings/project-sync/clubs/${clubId}/projects/${projectId}/history`, {
    params: yearId ? { yearId } : {},
  });
  return r.data;
}

export async function getScopedDistrictsGoalList(categoryId: number, yearId: number): Promise<GoalDistrictSummaryDto[]> {
  const r = await api.get(`/api/goal-setting/scoped/districts/${categoryId}`, { params: { yearId } });
  return r.data;
}

// Messaging (formerly "comments"). clubId 0 = district thread; clubId>0 = club↔district thread.
export async function getGoalComments(categoryId: number, districtId: number, yearId: number, clubId = 0): Promise<GoalCommentDto[]> {
  const r = await api.get(`/api/goal-setting/comments/${categoryId}/${districtId}`, { params: { yearId, clubId } });
  return r.data;
}
export async function postGoalComment(categoryId: number, districtId: number, yearId: number, commentText: string, clubId = 0): Promise<GoalCommentDto> {
  const r = await api.post(`/api/goal-setting/comments/${categoryId}/${districtId}`, { commentText }, { params: { yearId, clubId } });
  return r.data;
}

// Goal-oversight dashboard: districts = rows, compact Target/Achieved/% per overseen category.
export async function getDistrictSummaryMatrix(zoneId: number, yearId?: number | null): Promise<GoalDistrictSummaryMatrixDto> {
  const params = { zoneId, ...(yearId != null ? { yearId } : {}) };
  const r = await api.get(`/api/goal-setting/district-summary-matrix`, { params });
  return r.data;
}
// Goal-oversight district report (YTD + Month-wise, districts × categories horizontal). Scope:
// districtId → that district; else zoneId → that zone's districts; else all the caller's districts.
export async function downloadGoalDistrictReport(zoneId?: number | null, districtId?: number | null, yearId?: number | null): Promise<Blob> {
  const params = {
    ...(zoneId ? { zoneId } : {}),
    ...(districtId ? { districtId } : {}),
    ...(yearId != null ? { yearId } : {}),
  };
  const r = await api.get(`/api/goal-setting/district-report`, { params, responseType: "blob" });
  return r.data;
}
// Goal-oversight row-wise download: the SAME "District Goal Setting" report the district admin gets,
// scope-validated server-side (SuperAdmin Goal Overview).
export async function downloadGoalOversightDistrictReport(districtId: number, yearId?: number | null): Promise<Blob> {
  const params = { ...(yearId != null ? { yearId } : {}) };
  const r = await api.get(`/api/goal-setting/district-report/${districtId}`, { params, responseType: "blob" });
  return r.data;
}
// Red "new message" dot for the Goal Overview Messages popup.
export async function getGoalMessagesHasUnread(zoneId: number, yearId: number): Promise<boolean> {
  const r = await api.get(`/api/goal-setting/messages/has-unread`, { params: { zoneId, yearId } });
  return !!r.data?.hasUnread;
}
// Goal messages report (Excel) for a zone, filtered by category (0=all) + district (0=all). SuperAdmin.
export async function downloadGoalMessagesReport(zoneId: number, yearId: number, categoryId = 0, districtId = 0): Promise<Blob> {
  const params = { zoneId, yearId, categoryId, districtId };
  const r = await api.get(`/api/goal-setting/messages/report`, { params, responseType: "blob" });
  return r.data;
}
// District Admin / District Governor messages (2026-10-09): the district writes per category; the
// SuperAdmin reads. GET marks it read for readers.
export async function getDistrictGoalMessages(categoryId: number, districtId: number, yearId: number): Promise<GoalDistrictMessagesDto> {
  const r = await api.get(`/api/goal-setting/district-messages/${categoryId}/${districtId}`, { params: { yearId } });
  return r.data;
}
export async function postDistrictGoalMessage(categoryId: number, districtId: number, yearId: number, commentText: string): Promise<GoalCommentDto> {
  const r = await api.post(`/api/goal-setting/district-messages/${categoryId}/${districtId}`, { commentText }, { params: { yearId } });
  return r.data;
}
export async function getDistrictGoalMessageInbox(zoneId: number, yearId: number, categoryId = 0, districtId = 0): Promise<GoalDistrictConversationDto[]> {
  const r = await api.get(`/api/goal-setting/district-messages/inbox`, { params: { zoneId, yearId, categoryId, districtId } });
  return r.data;
}

// District Admin Dashboard endpoints
import type {
  DistrictAdminOverviewResponse,
  DistrictAdminMembershipResponse,
  DistrictAdminFoundationResponse,
  DistrictAdminCommunicationResponse,
  DistrictAdminEGovernanceResponse,
  DistrictMembershipGoalDto,
  DistrictFoundationGoalDto,
  DistrictProjectTargetDto,
  DistrictProjectTargetsBulkRequest,
  DistrictAdminRotaryNetworkResponse,
} from "@/types/districtAdminDashboard";

function daParams(yearId?: number | null, districtId?: number | null) {
  const p: Record<string, number> = {};
  if (yearId && yearId > 0) p.yearId = yearId;
  if (districtId != null && districtId > 0) p.districtId = districtId;
  return Object.keys(p).length > 0 ? p : undefined;
}

export async function getDistrictAdminOverview(yearId?: number | null, districtId?: number | null): Promise<DistrictAdminOverviewResponse> {
  const r = await api.get("/api/district-admin-dashboard/overview", { params: daParams(yearId, districtId) });
  return r.data;
}
export async function getDistrictAdminMembership(yearId?: number | null, districtId?: number | null): Promise<DistrictAdminMembershipResponse> {
  const r = await api.get("/api/district-admin-dashboard/membership", { params: daParams(yearId, districtId) });
  return r.data;
}
export async function getDistrictAdminFoundation(yearId?: number | null, districtId?: number | null): Promise<DistrictAdminFoundationResponse> {
  const r = await api.get("/api/district-admin-dashboard/foundation", { params: daParams(yearId, districtId) });
  return r.data;
}
export async function getDistrictAdminCommunication(yearId?: number | null, districtId?: number | null): Promise<DistrictAdminCommunicationResponse> {
  const r = await api.get("/api/district-admin-dashboard/communication", { params: daParams(yearId, districtId) });
  return r.data;
}
export async function getDistrictAdminEGovernance(yearId?: number | null, districtId?: number | null): Promise<DistrictAdminEGovernanceResponse> {
  const r = await api.get("/api/district-admin-dashboard/egovernance", { params: daParams(yearId, districtId) });
  return r.data;
}
export async function getDistrictAdminRotaryNetwork(
  yearId?: number | null,
  districtId?: number | null,
  search?: string,
  clubId?: number | null,
): Promise<DistrictAdminRotaryNetworkResponse> {
  const params: Record<string, string | number> = { ...(daParams(yearId, districtId) || {}) };
  if (search) params.search = search;
  if (clubId != null && clubId > 0) params.clubId = clubId;
  const r = await api.get("/api/district-admin-dashboard/rotary-network", { params });
  return r.data;
}
// Live from Rotary.org for ONE club (fast path when the club filter is active) — writes
// through to the server-side cache. clubId is required; the "all clubs" case reads from
// that cache instead (see getDistrictAdminRotaryNetwork) rather than fetching live.
export async function getDistrictAdminRotaryNetworkLiveTerminated(
  districtId?: number | null,
  clubId?: number | null,
): Promise<{ members: DistrictAdminRotaryNetworkResponse["terminatedMembers"]; clubsQueried: number; clubsSkippedNoRotaryId: number; warning?: string | null }> {
  const params: Record<string, number> = {};
  if (districtId != null && districtId > 0) params.districtId = districtId;
  if (clubId != null && clubId > 0) params.clubId = clubId;
  const r = await api.get("/api/district-admin-dashboard/rotary-network/live-terminated", { params });
  return r.data;
}
export interface DistrictRotaryRefreshJobStatus {
  jobId: number;
  districtId: number;
  status: "Running" | "Done" | "Failed" | "NeverRun";
  totalLinkedClubs: number;
  clubsDone: number;
  startedUtc?: string;
  updatedUtc?: string;
  finishedUtc?: string | null;
  warning?: string | null;
}
// Starts the server-side background refresh job (or returns the already-running one) — this
// survives closing the tab or navigating away, unlike the old client-driven batch loop.
export async function startDistrictRotaryNetworkTerminatedCacheRefresh(
  districtId?: number | null,
): Promise<DistrictRotaryRefreshJobStatus> {
  const params: Record<string, number> = {};
  if (districtId != null && districtId > 0) params.districtId = districtId;
  const r = await api.post("/api/district-admin-dashboard/rotary-network/refresh-terminated-cache/start", null, { params });
  return r.data;
}
// Poll this from anywhere to see the latest/current refresh job's progress for this district.
export async function getDistrictRotaryNetworkTerminatedCacheRefreshStatus(
  districtId?: number | null,
): Promise<DistrictRotaryRefreshJobStatus> {
  const params: Record<string, number> = {};
  if (districtId != null && districtId > 0) params.districtId = districtId;
  const r = await api.get("/api/district-admin-dashboard/rotary-network/refresh-terminated-cache/status", { params });
  return r.data;
}

// ── Wave 13A3 DG goal-setting endpoints ─────────────────────────────────
// GET returns null when no goal row exists yet for (district, year).
// POST upserts on (fkDistrictId, fkYearId); 403 from API if caller is not
// an active District Admin at fkDistrictId.

export async function getDistrictMembershipGoal(
  districtId: number,
  yearId: number,
): Promise<DistrictMembershipGoalDto | null> {
  const r = await api.get("/api/district-admin-dashboard/membership-goal", {
    params: { districtId, yearId },
  });
  return r.data ?? null;
}

export async function saveDistrictMembershipGoal(
  payload: {
    fkDistrictId: number;
    fkYearId: number;
    targetTotal: number;
    targetNewMembers: number;
    targetRetentionPercent: number;
  },
): Promise<DistrictMembershipGoalDto> {
  const r = await api.post("/api/district-admin-dashboard/membership-goal", payload);
  return r.data;
}

/**
 * District Foundation Goal — per-RY USD targets across Annual / PolioPlus /
 * Endowment / Other fund types. GET returns null when no row exists; POST
 * upserts on (fkDistrictId, fkYearId). 403 from API when caller is not an
 * active District Admin at fkDistrictId.
 */
export async function getDistrictFoundationGoal(
  districtId: number,
  yearId: number,
): Promise<DistrictFoundationGoalDto | null> {
  const r = await api.get("/api/district-admin-dashboard/foundation-goal", {
    params: { districtId, yearId },
  });
  return r.data ?? null;
}

export async function saveDistrictFoundationGoal(
  payload: {
    fkDistrictId: number;
    fkYearId: number;
    targetAnnualFundUsd: number;
    targetPolioFundUsd: number;
    targetEndowmentFundUsd: number;
    targetOtherFundUsd: number;
  },
): Promise<DistrictFoundationGoalDto> {
  const r = await api.post("/api/district-admin-dashboard/foundation-goal", payload);
  return r.data;
}

/**
 * District Project Targets — per-avenue per-RY project count targets.
 * GET returns only existing rows (one per fkModuleId for the year). The caller
 * is responsible for merging these against the known set of avenues that
 * should be configurable. POST is a bulk upsert.
 */
export async function getDistrictProjectTargets(
  districtId: number,
  yearId: number,
): Promise<DistrictProjectTargetDto[]> {
  const r = await api.get("/api/district-admin-dashboard/project-targets", {
    params: { districtId, yearId },
  });
  return r.data ?? [];
}

export async function saveDistrictProjectTargets(
  payload: DistrictProjectTargetsBulkRequest,
): Promise<DistrictProjectTargetDto[]> {
  const r = await api.post("/api/district-admin-dashboard/project-targets", payload);
  return r.data ?? [];
}

export async function forgotPassword(
  data: ForgotPasswordRequest
): Promise<{ message: string }> {
  const response = await api.post("/api/auth/forgot-password", data);
  return response.data;
}

export async function resetPassword(
  data: ResetPasswordRequest
): Promise<{ message: string }> {
  const response = await api.post("/api/auth/reset-password", data);
  return response.data;
}

export async function changePassword(
  data: ChangePasswordRequest
): Promise<{ message: string }> {
  const response = await api.post("/api/auth/change-password", data);
  return response.data;
}

// Login Audit Logs
export async function getLoginLogs(
  search = "",
  status = "",
  fromDate = "",
  toDate = "",
  page = 1,
  pageSize = 20
) {
  const params: Record<string, string | number> = { page, pageSize };
  if (search) params.search = search;
  if (status) params.status = status;
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;
  const response = await api.get("/api/auth/login-logs", { params });
  return response.data;
}

// Year-wise Admin Rights: what years the caller may grant, and what the target
// member already holds. Club and district return the SAME shape on purpose, so
// AdminYearsDialog can render either without branching.
export async function getAdminYearOptions(
  scope: { kind: "club"; clubId: number } | { kind: "district"; districtId: number },
  memberId: number
): Promise<AdminYearOptions> {
  const res = scope.kind === "club"
    ? await api.get("/api/admin/club-admin-years", { params: { clubId: scope.clubId, memberId } })
    : await api.get("/api/admin/district-admin-years", { params: { districtId: scope.districtId, memberId } });
  return res.data;
}

// Year-wise Admin Rights — "Edit Years" on an EXISTING admin (no Remove + Make
// Admin). The server only adds/removes years the caller holds; any other granted
// years are kept and named in `keptYears`. Marker: YWAR-EDIT-YEARS
export async function saveAdminYears(
  scope: { kind: "club"; clubId: number } | { kind: "district"; districtId: number },
  memberId: number,
  picked: { yearIds: number[]; allYears: boolean }
): Promise<{ message: string; keptYears: string[] }> {
  const res = scope.kind === "club"
    ? await api.post("/api/admin/club-admin-years", { memberId, roleId: 2, clubId: scope.clubId, ...picked })
    : await api.post(`/api/districts/${scope.districtId}/members/${memberId}/admin-years`, picked);
  return res.data;
}

/** Success wording for saveAdminYears. */
export function adminYearsSavedMessage(name: string, res: { keptYears?: string[] }): string {
  const kept = res.keptYears ?? [];
  return kept.length
    ? `Admin years for ${name} updated. ${kept.join(", ")} kept, not yours to change.`
    : `Admin years for ${name} updated.`;
}

// Admin APIs
export async function assignRole(
  data: AssignRoleRequest
): Promise<{ message: string }> {
  const response = await api.post("/api/admin/assign-role", data);
  return response.data;
}

export async function removeRole(
  data: RemoveRoleRequest
): Promise<{ message: string }> {
  const response = await api.post("/api/admin/remove-role", data);
  return response.data;
}

// Shared context endpoint (web + mobile) — returns roles + accessible scopes
export async function getMyContext() {
  const { data } = await api.get("/api/auth/my-context");
  return data;
}

// Audit log viewer (SuperAdmin only)
export interface AuditLogFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  action?: string;
  entityType?: string;
  fromDate?: string;
  toDate?: string;
}

export async function getAuditLog(filter: AuditLogFilter = {}) {
  const { data } = await api.get("/api/admin/audit-log", { params: filter });
  return data as { items: any[]; totalCount: number; page: number; pageSize: number; entityTypes: string[] };
}

// Email Log (Brevo) — SuperAdmin only
export interface EmailLogFilter {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  recipient?: string;
  subject?: string;
  status?: string;
  emailType?: string;
}

export interface EmailLogItem {
  id: number;
  recipientEmail: string;
  ccEmails: string | null;
  subject: string | null;
  emailType: string | null;
  status: string;
  brevoMessageId: string | null;
  errorMessage: string | null;
  sentAt: string;
}

export interface EmailLogDetail extends EmailLogItem {
  bodyHtml: string | null;
}

export async function getEmailLog(filter: EmailLogFilter = {}) {
  const { data } = await api.get("/api/email-log", { params: filter });
  return data as {
    items: EmailLogItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export async function getEmailLogDetail(id: number) {
  const { data } = await api.get(`/api/email-log/${id}`);
  return data as EmailLogDetail;
}

export async function getEmailLogSummary() {
  const { data } = await api.get("/api/email-log/summary");
  return data as {
    last24h: number;
    last7d: number;
    last30d: number;
    totalSent: number;
    totalFailed: number;
    totalAll: number;
  };
}

// Export the current filtered result set to XLSX (all matching rows, not just the page).
export async function exportEmailLog(filter: Omit<EmailLogFilter, "page" | "pageSize"> = {}) {
  const res = await api.get("/api/email-log/export", { params: filter, responseType: "blob" });
  return res.data as Blob;
}

// Club/District-scoped email log (for the Club/District Admin dashboards). `base` = "club/{id}" | "district/{id}".
export async function getScopedEmailLog(base: string, filter: EmailLogFilter = {}) {
  const { data } = await api.get(`/api/email-log/${base}`, { params: filter });
  return data as { items: EmailLogItem[]; total: number; page: number; pageSize: number; totalPages: number };
}
export async function getScopedEmailLogSummary(base: string) {
  const { data } = await api.get(`/api/email-log/${base}/summary`);
  return data as { last24h: number; last7d: number; last30d: number; totalSent: number; totalFailed: number; totalAll: number };
}
export async function exportScopedEmailLog(base: string, filter: Omit<EmailLogFilter, "page" | "pageSize"> = {}) {
  const res = await api.get(`/api/email-log/${base}/export`, { params: filter, responseType: "blob" });
  return res.data as Blob;
}









// Zone APIs
export async function getZones(
  page: number = 1,
  pageSize: number = 12,
  search?: string,
  isActive?: number,
  includeInactive?: boolean
): Promise<PagedResult<ZoneListItem>> {
  const params: Record<string, string | number | boolean> = { page, pageSize };
  if (search) params.search = search;
  if (isActive !== undefined && isActive !== null) params.isActive = isActive;
  // Zone master listing only: inactive zones are hidden everywhere else.
  if (includeInactive) params.includeInactive = true;
  const response = await api.get("/api/zones", { params });
  return response.data;
}

export async function getZone(id: number): Promise<Zone> {
  const response = await api.get(`/api/zones/${id}`);
  return response.data;
}

export async function createZone(data: CreateZoneRequest): Promise<{ id: number }> {
  const response = await api.post("/api/zones", data);
  return response.data;
}

export async function updateZone(id: number, data: UpdateZoneRequest): Promise<void> {
  await api.put(`/api/zones/${id}`, data);
}

export async function deleteZone(id: number): Promise<void> {
  await api.delete(`/api/zones/${id}`);
}

// ── Tenants and editions (ROW Wave 1, build spec items 1 and 5). SuperAdmin only. ──
export interface Edition { code: string; name: string; moduleKeys: string[] }
export interface TenantSubscription {
  districtId?: number;
  districtNumber?: string | null;
  editionCode: string;
  memberBand: string | null;
  termStart: string | null;
  termEnd: string | null;
  state: "planning" | "live";
  region: "US" | "EU" | "APAC" | "IN" | null;
  bridgeStart: string | null;
  bridgeEnd: string | null;
  setupFeeWaived: boolean;
  platformFeePct: number | null;
  platformFeeFixed: number | null;
  feeWaiverUntil: string | null;
  /** Build spec 3.14: anonymise terminated members this many months after termination; null = off. */
  anonymiseAfterMonths?: number | null;
  /** Build spec 3.5: renews at term end (default on). */
  autoRenew?: boolean | null;
  // read only (renewal reminders)
  renewalNoticeFor?: string | null;
  dunningStage?: number;
  // read only (planning mode and trials, flag "planning_mode")
  trialEnds?: string | null;
  planningYearLabel?: string | null;
  cutoverAt?: string | null;
  cutoverDoneAt?: string | null;
}
export interface TenantDetail {
  subscription: TenantSubscription | null;
  clubs: { clubId: number; clubName: string | null; editionCode: string }[];
}

export async function getEditions(): Promise<Edition[]> {
  return (await api.get("/api/editions")).data;
}

export async function updateEdition(code: string, name: string, moduleKeys: string[]) {
  return (await api.put(`/api/editions/${encodeURIComponent(code)}`, { name, moduleKeys })).data;
}

export async function getTenant(districtId: number): Promise<TenantDetail> {
  return (await api.get(`/api/tenants/${districtId}`)).data;
}

export async function setTenant(districtId: number, subscription: TenantSubscription) {
  return (await api.put(`/api/tenants/${districtId}`, subscription)).data;
}

export async function applyTenantEdition(districtId: number): Promise<{ districtOn: number; districtOff: number; clubOn: number; clubOff: number }> {
  return (await api.post(`/api/tenants/${districtId}/apply-edition`)).data;
}

// ── Planning mode, elect access, cut-over and trials (api/Controllers/PlanningController.cs; flag "planning_mode") ──
import type { AcceptedInvite, PlanningOverview, PlanningRole, PlanningState } from "@/types/planning";
export async function startTenantTrial(districtId: number): Promise<{ trialEnds: string }> {
  return (await api.post(`/api/tenants/${districtId}/trial`)).data;
}
export async function convertTenantTrial(districtId: number) {
  return (await api.post(`/api/tenants/${districtId}/convert-trial`)).data;
}
export async function getPlanningState(scope: { districtId?: number; clubId?: number }): Promise<PlanningState> {
  return (await api.get("/api/planning/state", { params: scope })).data;
}
export async function getMyPlanningRoles(): Promise<PlanningRole[]> {
  return (await api.get("/api/planning/me")).data;
}
export async function getPlanningOverview(districtId: number): Promise<PlanningOverview> {
  return (await api.get(`/api/planning/districts/${districtId}`)).data;
}
export async function startPlanning(districtId: number, dgeMemberId: number | null) {
  return (await api.post(`/api/planning/districts/${districtId}/start`, { dgeMemberId })).data;
}
export async function appointPlanningRole(districtId: number, role: "DS" | "DT", memberId: number) {
  return (await api.post(`/api/planning/districts/${districtId}/appointments`, { role, memberId })).data;
}
export async function invitePlanningRole(districtId: number, clubId: number, role: "PE" | "SE", memberId: number) {
  return (await api.post(`/api/planning/districts/${districtId}/invites`, { clubId, role, memberId })).data;
}
export async function revokePlanningRole(districtId: number, roleId: number) {
  await api.delete(`/api/planning/districts/${districtId}/roles/${roleId}`);
}
export async function runCutover(districtId: number): Promise<{ rolesActivated: number; officersQueued: number; primaryVendorQueued: number }> {
  return (await api.post(`/api/planning/districts/${districtId}/cutover`)).data;
}
/** The accept link from the invitation email: no sign-in. */
export async function acceptPlanningInvite(token: string): Promise<AcceptedInvite> {
  return (await publicApi.post("/api/planning/invites/accept", { token })).data;
}

// ── String catalogue (ROW Wave 1, build spec item 3). Reading is public; writing is SuperAdmin only. ──
export async function getI18nOverrides(locale: string): Promise<Override[]> {
  return (await api.get(`/api/i18n/${encodeURIComponent(locale)}`)).data;
}

export async function saveI18nOverride(locale: string, namespace: string, key: string, text: string, reviewed: boolean): Promise<Override> {
  return (await api.put(`/api/i18n/${encodeURIComponent(locale)}/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, { text, reviewed })).data;
}

export interface TranslationMemoryRow { hash: string; source: string; text: string; provider: string | null; isOverride: boolean; updatedAt: string; }
export interface TranslationMemoryPage {
  rows: TranslationMemoryRow[];
  total: number;
  provider: string;
  configured: boolean;
  monthChars: number;
  monthlyLimit: number;
}

export async function getTranslationMemory(params: { locale: string; search?: string; correctionsOnly?: boolean; page: number; pageSize: number }): Promise<TranslationMemoryPage> {
  return (await api.get("/api/i18n/memory", { params })).data;
}

export async function saveTranslationCorrection(locale: string, source: string, text: string): Promise<void> {
  await api.put("/api/i18n/memory", { locale, source, text });
}

export async function deleteTranslationMemory(locale: string, hash: string): Promise<void> {
  await api.delete(`/api/i18n/memory/${encodeURIComponent(locale)}/${hash}`);
}

export async function deleteI18nOverride(locale: string, namespace: string, key: string) {
  await api.delete(`/api/i18n/${encodeURIComponent(locale)}/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`);
}

// Multilingual club and district websites (api WebsiteLanguagesController, flag website_languages).
export type WebsiteScope = "clubs" | "districts";
export interface WebsiteLanguageSettings { defaultLanguage: string; languages: string[] }
export type WebsiteTextType = "site" | "about" | "page" | "submenu";
export interface WebsiteTranslationItem {
  type: WebsiteTextType;
  id: number;
  sourceTitle: string | null;
  sourceBody: string | null; // sanitised HTML
  hasBody: boolean;
  sourceSeoTitle: string | null;
  sourceSeoDescription: string | null;
  title: string | null;
  body: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}
export type WebsiteTranslationFields = Pick<WebsiteTranslationItem, "title" | "body" | "seoTitle" | "seoDescription">;

const websiteLanguagesPath = (scope: WebsiteScope, ownerId: number) => `/api/${scope}/${ownerId}/website-languages`;

export async function getWebsiteLanguages(scope: WebsiteScope, ownerId: number): Promise<WebsiteLanguageSettings> {
  return (await api.get(websiteLanguagesPath(scope, ownerId))).data;
}

export async function saveWebsiteLanguages(scope: WebsiteScope, ownerId: number, settings: WebsiteLanguageSettings): Promise<WebsiteLanguageSettings> {
  return (await api.put(websiteLanguagesPath(scope, ownerId), settings)).data;
}

export async function getWebsiteTranslations(scope: WebsiteScope, ownerId: number, language: string): Promise<WebsiteTranslationItem[]> {
  return (await api.get(`${websiteLanguagesPath(scope, ownerId)}/${encodeURIComponent(language)}`)).data;
}

export async function saveWebsiteTranslation(scope: WebsiteScope, ownerId: number, language: string, type: WebsiteTextType, id: number, fields: WebsiteTranslationFields) {
  await api.put(`${websiteLanguagesPath(scope, ownerId)}/${encodeURIComponent(language)}/${type}/${id}`, fields);
}

export async function deleteWebsiteTranslation(scope: WebsiteScope, ownerId: number, language: string, type: WebsiteTextType, id: number) {
  await api.delete(`${websiteLanguagesPath(scope, ownerId)}/${encodeURIComponent(language)}/${type}/${id}`);
}

// Chat moderation queue (api ChatModerationController, flag chat). The chat itself is in the app.
export interface ChatReport {
  id: number;
  reason: string | null;
  reportedAt: string;
  reporterId: number;
  reporterName: string | null;
  messageId: number;
  messageBody: string; // plain text typed by a member: render as text, never as HTML
  messageAt: string;
  hidden: boolean;
  senderId: number;
  senderName: string | null;
  senderMuted: boolean;
  conversationId: number;
  conversationKind: "direct" | "group";
  conversationTitle: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolution: string | null;
}

const chatModerationPath = (scope: "clubs" | "districts", ownerId: number) => `/api/${scope}/${ownerId}/chat-moderation`;

export async function getChatReports(scope: "clubs" | "districts", ownerId: number, status: "open" | "resolved"): Promise<ChatReport[]> {
  return (await api.get(`${chatModerationPath(scope, ownerId)}/reports`, { params: { status } })).data;
}

export async function setChatMessageHidden(scope: "clubs" | "districts", ownerId: number, messageId: number, hidden: boolean) {
  await api.post(`${chatModerationPath(scope, ownerId)}/messages/${messageId}/${hidden ? "hide" : "unhide"}`);
}

export async function setChatMemberMuted(scope: "clubs" | "districts", ownerId: number, conversationId: number, memberId: number, muted: boolean) {
  await api.post(`${chatModerationPath(scope, ownerId)}/conversations/${conversationId}/${muted ? "mute" : "unmute"}/${memberId}`);
}

export async function resolveChatReport(scope: "clubs" | "districts", ownerId: number, reportId: number, note: string) {
  await api.post(`${chatModerationPath(scope, ownerId)}/reports/${reportId}/resolve`, { note });
}

// District APIs
export async function getDistricts(
  page: number = 1,
  pageSize: number = 12,
  search?: string,
  isActive?: number,
  zoneId?: number,
  hasClubs?: boolean,
  hasMembers?: boolean,
  hasSyncClubs?: boolean,
  includeInactive?: boolean
): Promise<PagedResult<DistrictListItem>> {
  const params: Record<string, string | number | boolean> = { page, pageSize };
  if (search) params.search = search;
  if (isActive !== undefined && isActive !== null) params.isActive = isActive;
  if (zoneId !== undefined && zoneId !== null) params.zoneId = zoneId;
  if (hasClubs !== undefined && hasClubs !== null) params.hasClubs = hasClubs;
  if (hasMembers !== undefined && hasMembers !== null) params.hasMembers = hasMembers;
  if (hasSyncClubs !== undefined && hasSyncClubs !== null) params.hasSyncClubs = hasSyncClubs;
  // District master listing only: inactive districts are hidden everywhere else.
  if (includeInactive) params.includeInactive = true;
  const response = await api.get("/api/districts", { params });
  return response.data;
}

export async function getDistrict(id: number): Promise<District> {
  const response = await api.get(`/api/districts/${id}`);
  return response.data;
}

export async function createDistrict(data: CreateDistrictRequest): Promise<{ id: number }> {
  const response = await api.post("/api/districts", data);
  return response.data;
}

export async function updateDistrict(id: number, data: UpdateDistrictRequest): Promise<void> {
  await api.put(`/api/districts/${id}`, data);
}

// Settings → Currency: lightweight per-district currency update (no need to resend the
// full district record just to change this one field).
export async function updateDistrictDefaultCurrency(id: number, defaultCurrency: string): Promise<void> {
  await api.put(`/api/districts/${id}/default-currency`, { defaultCurrency });
}

/** Gives every district still on the platform default its own country's currency. */
export async function setDistrictCurrenciesFromCountry(): Promise<{ changed: number }> {
  const { data } = await api.post("/api/districts/default-currency/from-country");
  return data;
}

export interface CurrencyRateInfo {
  base: string;
  asOf: string;
  isLive: boolean;
  /** Value of one unit of each currency in the base currency. */
  rates: Record<string, number>;
}

export async function getCurrencyRates(): Promise<CurrencyRateInfo> {
  const { data } = await api.get("/api/districts/currency-rates");
  return data;
}

export async function deleteDistrict(id: number): Promise<void> {
  await api.delete(`/api/districts/${id}`);
}

export async function getDistrictClubs(districtId: number, hasMembers?: boolean): Promise<ClubListItem[]> {
  const params: Record<string, boolean> = {};
  if (hasMembers !== undefined && hasMembers !== null) params.hasMembers = hasMembers;
  const response = await api.get(`/api/districts/${districtId}/clubs`, { params });
  return response.data;
}

export async function getDistrictMembers(
  districtId: number,
  page: number = 1,
  pageSize: number = 20,
  search?: string
): Promise<PagedResult<DistrictMember>> {
  const params: Record<string, string | number> = { page, pageSize };
  if (search) params.search = search;
  const response = await api.get(`/api/districts/${districtId}/members`, { params });
  return response.data;
}

export async function uploadDistrictLogo(file: File): Promise<{ path: string }> {

  file = await processImageBeforeUpload(file);  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post("/api/districts/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// Club APIs
export async function getClubs(
  page: number = 1,
  pageSize: number = 12,
  search?: string,
  districtId?: number,
  city?: string,
  meetingDay?: string,
  isActive?: number,
  zoneId?: number,
  includeInactive?: boolean
): Promise<PagedResult<ClubListItem>> {
  const params: Record<string, string | number | boolean> = { page, pageSize };
  if (search) params.search = search;
  if (districtId) params.districtId = districtId;
  if (city) params.city = city;
  if (meetingDay) params.meetingDay = meetingDay;
  if (isActive !== undefined && isActive !== null) params.isActive = isActive;
  if (zoneId) params.zoneId = zoneId;
  // Club master listing only: inactive clubs are hidden everywhere else.
  if (includeInactive) params.includeInactive = true;
  const response = await api.get("/api/clubs", { params });
  return response.data;
}

export async function getClub(id: number): Promise<Club> {
  const response = await api.get(`/api/clubs/${id}`);
  return response.data;
}

export async function createClub(data: CreateClubRequest): Promise<{ id: number }> {
  const response = await api.post("/api/clubs", data);
  return response.data;
}

export async function updateClub(id: number, data: UpdateClubRequest): Promise<void> {
  await api.put(`/api/clubs/${id}`, data);
}

export async function deleteClub(id: number): Promise<void> {
  await api.delete(`/api/clubs/${id}`);
}

export interface ClubMemberSearchOptions {
  year?: number;
  email?: string;
  rotaryId?: string;
  districtNumber?: string;
  designation?: string;
  classification?: string;
  familyMemberName?: string;
}

export async function getClubMembers(
  clubId: number,
  page: number = 1,
  pageSize: number = 20,
  search?: string,
  options?: ClubMemberSearchOptions
): Promise<PagedResult<ClubMemberItem>> {
  const params: Record<string, string | number> = { page, pageSize };
  if (search) params.search = search;
  if (options?.year) params.year = options.year;
  if (options?.email) params.email = options.email;
  if (options?.rotaryId) params.rotaryId = options.rotaryId;
  if (options?.districtNumber) params.districtNumber = options.districtNumber;
  if (options?.designation) params.designation = options.designation;
  if (options?.classification) params.classification = options.classification;
  if (options?.familyMemberName) params.familyMemberName = options.familyMemberName;
  const response = await api.get(`/api/clubs/${clubId}/members`, { params });
  return response.data;
}

export async function getClubMemberYears(clubId: number): Promise<number[]> {
  const response = await api.get(`/api/clubs/${clubId}/members/years`);
  return response.data;
}

// Current COG district + Rotary year for one member, read from that member's COG
// membership row. Open to any authenticated user (Club Admins see it read-only).
export async function getCogDesignation(
  clubId: number,
  memberId: number
): Promise<{ districtNumber: string | null; yearLabel: string | null }> {
  const response = await api.get(`/api/clubs/${clubId}/members/${memberId}/cog-designation`);
  return response.data;
}

// COG (club 31598) only, SuperAdmin only. Writes district number + Rotary year
// back into that member's COG club_members.Designation row. Members view the
// result in the mobile app; there is no mobile write path.
export async function updateCogDesignation(
  clubId: number,
  memberId: number,
  data: { districtNumber: string; yearLabel: string }
): Promise<{ districtNumber: string; yearLabel: string }> {
  const response = await api.put(`/api/clubs/${clubId}/members/${memberId}/cog-designation`, data);
  return response.data;
}

export async function addClubMember(clubId: number, data: AddClubMemberRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/members`, data);
  return response.data;
}

export async function removeClubMember(clubId: number, memberId: number, reason?: string, reasonCode?: string): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/members/${memberId}`, { params: reason || reasonCode ? { reason, reasonCode } : undefined });
}

export async function getMemberRemovalPreview(clubId: number, memberId: number): Promise<import("@/types/memberRemoval").MemberRemovalPreview> {
  const response = await api.get(`/api/clubs/${clubId}/members/${memberId}/removal-preview`);
  return response.data;
}

export async function getTerminatedMembers(
  clubId: number,
  page: number = 1,
  pageSize: number = 20,
  search?: string
): Promise<PagedResult<TerminatedMember>> {
  const response = await api.get(`/api/clubs/${clubId}/terminated-members`, { params: { page, pageSize, search } });
  return response.data;
}

export async function uploadClubLogo(file: File): Promise<{ path: string }> {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post("/api/clubs/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// Logos card on /clubs/[id]/website-data/logos — two per-club horizontal logos.
// Files land in DIFFERENT folders so the per-logo upload endpoints know where
// to write:
//   • Club Logo   → /Documents/group/<filename>                (shared, legacy)
//   • Rotary Logo → /Documents/WebsiteData/Group{clubId}/LOGO/<filename>
export interface ClubLogos {
  clubLogoUrl: string | null;
  rotaryLogoUrl: string | null;
}
export async function getClubLogos(clubId: number): Promise<ClubLogos> {
  const res = await api.get(`/api/clubs/${clubId}/logos`);
  return res.data;
}
export async function setClubLogos(clubId: number, payload: { clubLogoPath?: string; rotaryLogoPath?: string }) {
  const res = await api.put(`/api/clubs/${clubId}/logos`, payload);
  return res.data;
}
export async function uploadClubLogoFile(clubId: number, file: File): Promise<{ path: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post(`/api/clubs/${clubId}/upload-club-logo`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
export async function uploadRotaryLogoFile(clubId: number, file: File): Promise<{ path: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post(`/api/clubs/${clubId}/upload-rotary-logo`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

// Per-club honorary — open GET for any authenticated user, PATCH for SuperAdmin only.
export async function getClubMemberHonorary(
  clubId: number,
  memberId: number,
): Promise<{ clubId: number; memberId: number; isHonorary: boolean }> {
  const res = await api.get(`/api/clubs/${clubId}/members/${memberId}/honorary-status`);
  return res.data;
}

export async function setClubMemberHonorary(
  clubId: number,
  memberId: number,
  isHonorary: boolean,
): Promise<{ clubId: number; memberId: number; isHonorary: boolean; message: string }> {
  const res = await api.patch(
    `/api/clubs/${clubId}/members/${memberId}/honorary-status`,
    { isHonorary },
  );
  return res.data;
}

export function getPhotoUrl(path: string | null): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

// District Dues assets (logo/background/email header) are stored as a bare filename under
// Documents/ClubDues; build the servable URL. Passes through full URLs / rooted paths as-is.
export function clubDuesAssetUrl(v: string | null | undefined): string {
  if (!v) return "";
  if (v.startsWith("http")) return v;
  if (v.startsWith("/")) return `${API_BASE_URL}${v}`;
  return `${API_BASE_URL}/Documents/ClubDues/${v}`;
}

// ===== MODULE MANAGEMENT APIs =====

// Module Categories
export async function getModuleCategories(): Promise<ModuleCategory[]> {
  const response = await api.get("/api/module-categories");
  return response.data;
}

export async function createModuleCategory(data: CreateModuleCategoryRequest): Promise<{ id: number }> {
  const response = await api.post("/api/module-categories", data);
  return response.data;
}

export async function updateModuleCategory(id: number, data: UpdateModuleCategoryRequest): Promise<void> {
  await api.put(`/api/module-categories/${id}`, data);
}

export async function deleteModuleCategory(id: number): Promise<void> {
  await api.delete(`/api/module-categories/${id}`);
}

// Module Master
export async function getModules(): Promise<Module[]> {
  const response = await api.get("/api/modules");
  return response.data;
}

export async function getModule(id: number): Promise<Module> {
  const response = await api.get(`/api/modules/${id}`);
  return response.data;
}

export async function createModule(data: CreateModuleRequest): Promise<{ id: number }> {
  const response = await api.post("/api/modules", data);
  return response.data;
}

export async function updateModule(id: number, data: UpdateModuleRequest): Promise<void> {
  await api.put(`/api/modules/${id}`, data);
}

export async function uploadModuleIcon(file: File): Promise<{ path: string }> {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post("/api/modules/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function deleteModule(id: number): Promise<void> {
  await api.delete(`/api/modules/${id}`);
}

export async function getModuleUsageCount(id: number): Promise<ModuleUsageCount> {
  const response = await api.get(`/api/modules/${id}/usage`);
  return response.data;
}

// Coming Soon (per-module placeholder for non-SuperAdmin during phased migration)
export async function getModulesComingSoon(): Promise<ModuleComingSoonInfo[]> {
  const response = await api.get("/api/modules/coming-soon");
  return response.data;
}

export async function updateModuleComingSoon(id: number, payload: UpdateModuleComingSoonRequest): Promise<void> {
  await api.put(`/api/modules/${id}/coming-soon`, payload);
}

// District Modules
export async function getDistrictModules(districtId: number): Promise<AssignedModule[]> {
  const response = await api.get(`/api/districts/${districtId}/modules`);
  return response.data;
}

export async function getDistrictAvailableModules(districtId: number): Promise<AvailableModule[]> {
  const response = await api.get(`/api/districts/${districtId}/modules/available`);
  return response.data;
}

export async function assignDistrictModules(districtId: number, moduleIds: number[]): Promise<void> {
  await api.post(`/api/districts/${districtId}/modules/assign`, { moduleIds });
}

export async function unassignDistrictModules(districtId: number, moduleIds: number[]): Promise<void> {
  await api.post(`/api/districts/${districtId}/modules/unassign`, { moduleIds });
}

// Club Modules
export async function getClubModules(clubId: number): Promise<AssignedModule[]> {
  const response = await api.get(`/api/clubs/${clubId}/modules`);
  return response.data;
}

export async function getClubAvailableModules(clubId: number): Promise<AvailableModule[]> {
  const response = await api.get(`/api/clubs/${clubId}/modules/available`);
  return response.data;
}

export async function assignClubModules(clubId: number, moduleIds: number[]): Promise<void> {
  await api.post(`/api/clubs/${clubId}/modules/assign`, { moduleIds });
}

export async function unassignClubModules(clubId: number, moduleIds: number[]): Promise<void> {
  await api.post(`/api/clubs/${clubId}/modules/unassign`, { moduleIds });
}

// Dashboard
export async function getDistrictDashboard(districtId: number): Promise<DistrictDashboard> {
  const response = await api.get(`/api/districts/${districtId}/dashboard`);
  return response.data;
}

export async function getClubDashboard(clubId: number): Promise<ClubDashboard> {
  const response = await api.get(`/api/clubs/${clubId}/dashboard`);
  return response.data;
}

// ===== ROTARY YEAR APIs =====

export async function getRotaryYears(): Promise<RotaryYear[]> {
  const response = await api.get("/api/rotary-years");
  return response.data;
}

export async function addNextRotaryYear(): Promise<{ id: number; yearLabel: string; message: string }> {
  const response = await api.post("/api/rotary-years/add-next");
  return response.data;
}

export async function getCurrentRotaryYear(): Promise<RotaryYear> {
  const response = await api.get("/api/rotary-years/current");
  return response.data;
}

// ===== PAST PRESIDENT APIs =====

export async function getPastPresidents(clubId: number): Promise<PastPresident[]> {
  const response = await api.get(`/api/clubs/${clubId}/past-presidents`);
  return response.data;
}

export async function getPastPresident(clubId: number, id: number): Promise<PastPresident> {
  const response = await api.get(`/api/clubs/${clubId}/past-presidents/${id}`);
  return response.data;
}

// Multipart — `photo` (a File) is only honoured for NON-MEMBER entries; members ignore it.
export async function createPastPresident(clubId: number, data: CreatePastPresidentRequest, photo?: File | null): Promise<{ id: number }> {
  const fd = new FormData();
  if (data.memberId != null) fd.append("MemberId", String(data.memberId));
  if (data.nonMemberName) fd.append("NonMemberName", data.nonMemberName);
  fd.append("YearId", String(data.yearId));
  if (photo) fd.append("photo", photo);
  const response = await api.post(`/api/clubs/${clubId}/past-presidents`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// `photo` replaces the non-member photo; `removePhoto` clears it (ignored when a new photo is sent).
export async function updatePastPresident(
  clubId: number,
  id: number,
  data: UpdatePastPresidentRequest,
  photo?: File | null,
  removePhoto?: boolean,
): Promise<void> {
  const fd = new FormData();
  if (data.memberId != null) fd.append("MemberId", String(data.memberId));
  if (data.nonMemberName) fd.append("NonMemberName", data.nonMemberName);
  fd.append("YearId", String(data.yearId));
  if (photo) fd.append("photo", photo);
  if (removePhoto) fd.append("RemovePhoto", "true");
  await api.put(`/api/clubs/${clubId}/past-presidents/${id}`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}

export async function deletePastPresident(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/past-presidents/${id}`);
}

export async function searchClubMembers(clubId: number, search?: string): Promise<ClubMemberSearchResult[]> {
  const params: Record<string, string> = {};
  if (search) params.search = search;
  const response = await api.get(`/api/clubs/${clubId}/past-presidents/search-members`, { params });
  return response.data;
}

// ===== DESIGNATION APIs =====

export async function getDesignations(): Promise<Designation[]> {
  const response = await api.get("/api/designations");
  return response.data;
}

export async function createDesignation(data: CreateDesignationRequest): Promise<{ id: number }> {
  const response = await api.post("/api/designations", data);
  return response.data;
}

export async function updateDesignation(id: number, data: UpdateDesignationRequest): Promise<void> {
  await api.put(`/api/designations/${id}`, data);
}

export async function deleteDesignation(id: number): Promise<void> {
  await api.delete(`/api/designations/${id}`);
}

export async function reorderDesignations(id1: number, id2: number): Promise<void> {
  await api.put("/api/designations/reorder", { id1, id2 });
}

export async function reorderDesignationsAll(orderedIds: number[]): Promise<void> {
  await api.put("/api/designations/reorder-all", { orderedIds });
}

// ===== BOARD OF DIRECTORS APIs =====

export async function getBoardOfDirectors(clubId: number, yearId: number): Promise<BoardDirector[]> {
  const response = await api.get(`/api/clubs/${clubId}/board-of-directors`, { params: { yearId } });
  return response.data;
}

export async function getBoardYearsByClub(clubId: number): Promise<RotaryYear[]> {
  const response = await api.get(`/api/clubs/${clubId}/board-of-directors/years`);
  return response.data;
}

export async function getBoardDirector(clubId: number, id: number): Promise<BoardDirector> {
  const response = await api.get(`/api/clubs/${clubId}/board-of-directors/${id}`);
  return response.data;
}

/** OMS ROW-51: true when this club may add a non-member for the CURRENT year (test district only). */
export async function getBoardDirectorRules(clubId: number): Promise<{ nonMemberCurrentYear: boolean }> {
  const response = await api.get(`/api/clubs/${clubId}/board-of-directors/rules`);
  return response.data;
}

export async function createBoardDirector(clubId: number, data: CreateBoardDirectorRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/board-of-directors`, data);
  return response.data;
}

export async function updateBoardDirector(clubId: number, id: number, data: UpdateBoardDirectorRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/board-of-directors/${id}`, data);
}

export async function deleteBoardDirector(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/board-of-directors/${id}`);
}

export async function reorderBoardOfDirectors(clubId: number, yearId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/board-of-directors/reorder`, { yearId, orderedIds });
}

export async function searchBoardMembers(clubId: number, search?: string): Promise<ClubMemberSearchResult[]> {
  const params: Record<string, string> = {};
  if (search) params.search = search;
  const response = await api.get(`/api/clubs/${clubId}/board-of-directors/search-members`, { params });
  return response.data;
}

// ===== WEBSITE DATA MODULE APIs =====

export async function getWebsiteDataModules(): Promise<WebsiteDataModule[]> {
  const response = await api.get("/api/website-data-modules");
  return response.data;
}

export async function createWebsiteDataModule(data: CreateWebsiteDataModuleRequest): Promise<{ id: number }> {
  const response = await api.post("/api/website-data-modules", data);
  return response.data;
}

export async function updateWebsiteDataModule(id: number, data: UpdateWebsiteDataModuleRequest): Promise<void> {
  await api.put(`/api/website-data-modules/${id}`, data);
}

export async function deleteWebsiteDataModule(id: number): Promise<void> {
  await api.delete(`/api/website-data-modules/${id}`);
}

export async function reorderWebsiteDataModules(id1: number, id2: number): Promise<void> {
  await api.put("/api/website-data-modules/reorder", { id1, id2 });
}

// ===== THEME APIs =====

export async function getThemes(): Promise<Theme[]> {
  const response = await api.get("/api/themes");
  return response.data;
}

export async function createTheme(data: CreateThemeRequest): Promise<{ id: number }> {
  const response = await api.post("/api/themes", data);
  return response.data;
}

export async function updateTheme(id: number, data: UpdateThemeRequest): Promise<void> {
  await api.put(`/api/themes/${id}`, data);
}

export async function deleteTheme(id: number): Promise<void> {
  await api.delete(`/api/themes/${id}`);
}

export interface PhotoUploadResponse {
  path: string;
  url?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}
export async function uploadThemeImage(file: File, strict: boolean = false): Promise<PhotoUploadResponse> {
  file = await processImageBeforeUpload(file);
  const validation = await validateImagePhoto(file, strict);
  if (!validation.ok) throw new Error(validation.error || "Photo failed quality check.");
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/themes/upload${strict ? "?strict=true" : ""}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return { ...validation.info, ...response.data };
}

// ===== CLUB THEME (Website Data) APIs =====

export async function getClubTheme(clubId: number, yearId: number): Promise<ClubTheme | null> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/theme`, { params: { yearId } });
  // API returns empty object {} when no theme is set
  if (!response.data || !response.data.id) return null;
  return response.data;
}

export async function saveClubTheme(clubId: number, data: { yearId: number; themeId: number }): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/theme`, data);
}

// Phase 7: active theme on the club website itself (per-club, not per-year).
// This is what the public club-website Next.js app actually reads via the resolver.
export interface ActiveTheme {
  hasWebsite: boolean;
  themeId?: number | null;
  themeName?: string | null;
  themeImagePath?: string | null;
}
export async function getClubActiveTheme(clubId: number): Promise<ActiveTheme> {
  const response = await api.get(`/api/clubs/${clubId}/website/active-theme`);
  return response.data;
}
export async function setClubActiveTheme(clubId: number, themeId: number): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website/active-theme`, { themeId });
}

// ===== CLUB BANNER (Website Data) APIs =====

export async function getClubBanners(clubId: number, yearId: number): Promise<ClubBanner[]> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/banners`, { params: { yearId } });
  return response.data;
}

export async function getClubBanner(clubId: number, id: number): Promise<ClubBanner> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/banners/${id}`);
  return response.data;
}

export async function createClubBanner(clubId: number, data: CreateClubBannerRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/website-data/banners`, data);
  return response.data;
}

export async function updateClubBanner(clubId: number, id: number, data: UpdateClubBannerRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/banners/${id}`, data);
}

export async function deleteClubBanner(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/website-data/banners/${id}`);
}

export async function uploadBannerImage(clubId: number, file: File, strict: boolean = false): Promise<PhotoUploadResponse> {
  file = await processImageBeforeUpload(file);
  const validation = await validateImagePhoto(file, strict);
  if (!validation.ok) throw new Error(validation.error || "Photo failed quality check.");
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/website-data/banners/upload${strict ? "?strict=true" : ""}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return { ...validation.info, ...response.data };
}

export async function reorderBanners(clubId: number, id1: number, id2: number): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/banners/reorder`, { id1, id2 });
}

export async function reorderClubBannersAll(clubId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/banners/reorder-all`, { orderedIds });
}

export async function reorderDistrictBannersAll(districtId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/districts/${districtId}/website-data/banners/reorder-all`, { orderedIds });
}

// ===== CLUB ADVERTISEMENT (Website Data) APIs =====

export async function getClubAdvertisements(clubId: number, yearId: number): Promise<ClubAdvertisement[]> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/advertisements`, { params: { yearId } });
  return response.data;
}

export async function getClubAdvertisement(clubId: number, id: number): Promise<ClubAdvertisement> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/advertisements/${id}`);
  return response.data;
}

export async function createClubAdvertisement(clubId: number, data: CreateClubAdvertisementRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/website-data/advertisements`, data);
  return response.data;
}

export async function updateClubAdvertisement(clubId: number, id: number, data: UpdateClubAdvertisementRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/advertisements/${id}`, data);
}

export async function deleteClubAdvertisement(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/website-data/advertisements/${id}`);
}

export async function uploadAdvertisementImage(clubId: number, file: File): Promise<{ path: string; url?: string }> {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/website-data/advertisements/upload-image`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function uploadAdvertisementDocument(clubId: number, file: File): Promise<{ path: string }> {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/website-data/advertisements/upload-document`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function uploadBannerDocument(clubId: number, file: File): Promise<{ path: string }> {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/website-data/banners/upload-document`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function reorderAdvertisements(clubId: number, id1: number, id2: number): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/advertisements/reorder`, { id1, id2 });
}
export async function reorderClubAdvertisementsAll(clubId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/advertisements/reorder-all`, { orderedIds });
}
export async function reorderDistrictAdvertisementsAll(districtId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/districts/${districtId}/website-data/advertisements/reorder-all`, { orderedIds });
}

// ===== CLUB SOCIAL LINKS (Website Data) APIs =====

export async function getClubSocialLinks(clubId: number): Promise<ClubSocialLink[]> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/social_media_links`);
  return response.data;
}

export async function getClubSocialLink(clubId: number, id: number): Promise<ClubSocialLink> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/social_media_links/${id}`);
  return response.data;
}

export async function createClubSocialLink(clubId: number, data: CreateClubSocialLinkRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/website-data/social_media_links`, data);
  return response.data;
}

export async function updateClubSocialLink(clubId: number, id: number, data: UpdateClubSocialLinkRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/social_media_links/${id}`, data);
}

export async function reorderClubSocialLinksAll(clubId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/social_media_links/reorder-all`, { orderedIds });
}
export async function deleteClubSocialLink(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/website-data/social_media_links/${id}`);
}

// ===== CLUB MENU (Website Data) APIs =====

export async function getClubMenus(clubId: number): Promise<ClubMenu[]> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/menu_list`);
  return response.data;
}

export async function getClubMenu(clubId: number, id: number): Promise<ClubMenu> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/menu_list/${id}`);
  return response.data;
}

export async function createClubMenu(clubId: number, data: CreateClubMenuRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/website-data/menu_list`, data);
  return response.data;
}

export async function updateClubMenu(clubId: number, id: number, data: UpdateClubMenuRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/menu_list/${id}`, data);
}

// Active/Inactive only — also allowed on default menus, which updateClubMenu refuses.
export async function setClubMenuActive(clubId: number, id: number, isActive: boolean): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/menu_list/${id}/active`, { isActive });
}

export async function deleteClubMenu(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/website-data/menu_list/${id}`);
}

export async function reorderMenus(clubId: number, id1: number, id2: number): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/menu_list/reorder`, { id1, id2 });
}

// Drag-and-drop full-list reorder. orderedIds = new order top→bottom.
export async function reorderMenusBulk(clubId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/menu_list/reorder-bulk`, { orderedIds });
}

// Returns whether this club has an active club_websites row (created by SuperAdmin).
// Used to gate Website Data tiles + Menu List page.
export async function getClubHasWebsite(clubId: number): Promise<boolean> {
  const response = await api.get<{ hasWebsite: boolean }>(`/api/clubs/${clubId}/has-website`);
  return response.data.hasWebsite;
}

export async function uploadMenuDocument(clubId: number, file: File): Promise<{ path: string }> {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/website-data/menu_list/upload-document`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function getClubSubMenus(clubId: number, menuId: number): Promise<ClubSubMenu[]> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/menu_list/${menuId}/submenus`);
  return response.data;
}

export async function createClubSubMenu(clubId: number, menuId: number, data: CreateClubSubMenuRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/website-data/menu_list/${menuId}/submenus`, data);
  return response.data;
}

export async function updateClubSubMenu(clubId: number, menuId: number, id: number, data: UpdateClubSubMenuRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/menu_list/${menuId}/submenus/${id}`, data);
}

export async function deleteClubSubMenu(clubId: number, menuId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/website-data/menu_list/${menuId}/submenus/${id}`);
}

export async function reorderSubMenusBulk(clubId: number, menuId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/menu_list/${menuId}/submenus/reorder-bulk`, { orderedIds });
}

export async function reorderSubMenus(clubId: number, menuId: number, id1: number, id2: number): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/menu_list/${menuId}/submenus/reorder`, { id1, id2 });
}

// ===== CLUB CONTACT DETAILS (Website Data) APIs =====

export async function getClubContactDetails(clubId: number, yearId: number): Promise<ClubContactDetail[]> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/contact_details`, { params: { yearId } });
  return response.data;
}

export async function getClubContactDetail(clubId: number, id: number): Promise<ClubContactDetail> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/contact_details/${id}`);
  return response.data;
}

export async function createClubContactDetail(clubId: number, data: CreateClubContactDetailRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/website-data/contact_details`, data);
  return response.data;
}

export async function updateClubContactDetail(clubId: number, id: number, data: UpdateClubContactDetailRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/contact_details/${id}`, data);
}

export async function deleteClubContactDetail(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/website-data/contact_details/${id}`);
}

// ==================== Club About ====================

export async function getClubAboutByClub(clubId: number): Promise<ClubAbout[]> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/about`);
  return response.data;
}

export async function getClubAboutById(clubId: number, id: number): Promise<ClubAbout> {
  const response = await api.get(`/api/clubs/${clubId}/website-data/about/${id}`);
  return response.data;
}

export async function createClubAbout(clubId: number, data: CreateClubAboutRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/website-data/about`, data);
  return response.data;
}

export async function updateClubAbout(clubId: number, id: number, data: UpdateClubAboutRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/website-data/about/${id}`, data);
}

export async function deleteClubAbout(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/website-data/about/${id}`);
}

export async function uploadAboutImage(clubId: number, file: File): Promise<{ path: string }> {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/website-data/about/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// ==================== Potential Members ====================

export async function getPotentialMembers(
  clubId: number,
  page: number = 1,
  pageSize: number = 20,
  search?: string,
  stage?: string
): Promise<PagedResult<PotentialMember>> {
  const response = await api.get(`/api/clubs/${clubId}/potential-members`, { params: { page, pageSize, search, stage } });
  return response.data;
}

export async function getPotentialMember(clubId: number, id: number): Promise<PotentialMember> {
  const response = await api.get(`/api/clubs/${clubId}/potential-members/${id}`);
  return response.data;
}

export async function createPotentialMember(clubId: number, data: CreatePotentialMemberRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/potential-members`, data);
  return response.data;
}

export async function updatePotentialMember(clubId: number, id: number, data: UpdatePotentialMemberRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/potential-members/${id}`, data);
}

export async function deletePotentialMember(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/potential-members/${id}`);
}

// ══════════════════════════════════════════════════════
// AREA OF FOCUS
// ══════════════════════════════════════════════════════

export async function getAreasOfFocus(moduleId?: number): Promise<AreaOfFocus[]> {
  const response = await api.get("/api/area-of-focus", { params: moduleId ? { moduleId } : {} });
  return response.data;
}

export async function createAreaOfFocus(data: { moduleId: number; name: string; sortOrder: number; isActive: boolean }): Promise<{ id: number }> {
  const response = await api.post("/api/area-of-focus", data);
  return response.data;
}

export async function updateAreaOfFocus(id: number, data: { moduleId: number; name: string; sortOrder: number; isActive: boolean }): Promise<void> {
  await api.put(`/api/area-of-focus/${id}`, data);
}

export async function deleteAreaOfFocus(id: number): Promise<void> {
  await api.delete(`/api/area-of-focus/${id}`);
}

export async function reorderAreasOfFocus(moduleId: number, orderedIds: number[]): Promise<void> {
  await api.put("/api/area-of-focus/reorder", { moduleId, orderedIds });
}

// Smart search across a module's Areas of Focus: one term, each result carrying the area's id + name
// so the form can set it on one pick.
// module* fields are populated only by the AI suggest (cross-module); the smart search leaves them null.
export interface ClassificationSearchResult {
  type: "area";
  areaOfFocusId: number; areaOfFocusName: string;
  moduleId?: number | null; moduleKey?: string | null; moduleName?: string | null;
}
// AI suggestion result: best matches WITHIN the current module, plus an optional single "better fit"
// entry from a DIFFERENT module when the project reads like it belongs to another project type.
export interface ClassificationSuggestResponse {
  matches: ClassificationSearchResult[];
  betterModule: ClassificationSearchResult | null;
}
export async function searchProjectClassifications(q: string, moduleId: number): Promise<ClassificationSearchResult[]> {
  const { data } = await api.get(`/api/project-classification/search`, { params: { q, moduleId } });
  return data;
}
// AI suggestion: read a project's title/description → best Area(s) of Focus in this module +
// (optionally) a better-fitting Area of Focus from another module.
export async function suggestProjectClassification(title: string, description: string, moduleId: number): Promise<ClassificationSuggestResponse> {
  const { data } = await api.post(`/api/project-classification/suggest`, { title, description, moduleId });
  return data;
}

// ══════════════════════════════════════════════════════
// FUNDING
// ══════════════════════════════════════════════════════

export async function getFunding(): Promise<Funding[]> {
  const response = await api.get("/api/funding");
  return response.data;
}

export async function createFunding(data: { name: string; sortOrder: number; isActive: boolean }): Promise<{ id: number }> {
  const response = await api.post("/api/funding", data);
  return response.data;
}

export async function updateFunding(id: number, data: { name: string; sortOrder: number; isActive: boolean }): Promise<void> {
  await api.put(`/api/funding/${id}`, data);
}

export async function deleteFunding(id: number): Promise<void> {
  await api.delete(`/api/funding/${id}`);
}

// ══════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════

export async function getProjects(
  clubId: number, moduleId: number, yearId: number,
  page: number, pageSize: number, search?: string, projectType?: string
): Promise<PagedResult<ProjectListItem>> {
  const params = new URLSearchParams({
    moduleId: String(moduleId), yearId: String(yearId),
    page: String(page), pageSize: String(pageSize),
  });
  if (search) params.set("search", search);
  // projectType=ongoing_repeat | one_time. "all" / undefined → no filter on server side.
  if (projectType && projectType !== "all") params.set("projectType", projectType);
  const response = await api.get(`/api/clubs/${clubId}/projects?${params}`);
  return response.data;
}

// Year-wise tables: project PK alone is ambiguous (PK=5 exists in multiple year tables).
// Every targeted-project call now takes yearId so the backend knows which year-wise
// table to read/write. List endpoint already takes yearId — unchanged.
export async function getProject(clubId: number, yearId: number, id: number): Promise<ProjectDetail> {
  const response = await api.get(`/api/clubs/${clubId}/projects/${yearId}/${id}`);
  return response.data;
}

export async function createProject(clubId: number, data: CreateProjectRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/projects`, data);
  return response.data;
}

// When a project's edited date crosses into another rotary year, the backend returns
// 409 { requiresMove } instead of updating. updateProject surfaces that as a return value
// (null = updated normally; object = caller should confirm + call moveProject).
export interface ProjectMoveInfo {
  requiresMove: true;
  fromYearId: number;
  toYearId: number;
  fromYearLabel: string;
  toYearLabel: string;
  message: string;
}

export async function updateProject(clubId: number, yearId: number, id: number, data: UpdateProjectRequest): Promise<ProjectMoveInfo | null> {
  try {
    await api.put(`/api/clubs/${clubId}/projects/${yearId}/${id}`, data);
    return null;
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = (err as any)?.response;
    if (resp?.status === 409 && resp.data?.requiresMove) {
      return resp.data as ProjectMoveInfo;
    }
    throw err;
  }
}

// Confirms a cross-year move: relocates the project + photos to the year implied by data.projectDate.
// Returns the project's new location so the caller can redirect.
export async function moveProject(clubId: number, fromYearId: number, id: number, data: UpdateProjectRequest): Promise<{ newYearId: number; newId: number; newYearLabel: string }> {
  const response = await api.post(`/api/clubs/${clubId}/projects/${fromYearId}/${id}/move`, data);
  return response.data;
}

export async function deleteProject(clubId: number, yearId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/projects/${yearId}/${id}`);
}

export async function getProjectYears(clubId: number, moduleId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const response = await api.get(`/api/clubs/${clubId}/projects/years?moduleId=${moduleId}`);
  return response.data;
}

// RI Flow-Bot: per-club rotary.org login the extension uses to sign in to spc.rotary.org.
export interface ClubRotaryOrgCredentials {
  hasCredentials: boolean;
  username: string | null;
  password: string | null;
  modifiedDate: string | null;
}
export async function getClubRotaryOrgCredentials(clubId: number): Promise<ClubRotaryOrgCredentials> {
  const { data } = await api.get(`/api/clubs/${clubId}/rotary-org-credentials`);
  return data;
}
export async function saveClubRotaryOrgCredentials(clubId: number, username: string, password: string): Promise<void> {
  await api.put(`/api/clubs/${clubId}/rotary-org-credentials`, { username, password });
}
// Signed token handed to the RI Flow-Bot extension so it can confirm (after the user publishes on
// SPC) that THIS project was synced — the extension POSTs it back to the public confirm endpoint.
export async function getRotaryOrgSyncToken(projectId: number, clubId: number): Promise<{ token: string }> {
  const { data } = await api.get(`/api/rotary-org-sync/token`, { params: { projectId, clubId } });
  return data;
}

export async function getOngoingProjects(clubId: number, moduleId: number, search?: string, yearId?: number): Promise<OngoingProject[]> {
  const params = new URLSearchParams({ moduleId: String(moduleId) });
  if (search) params.set("search", search);
  // Scope to the active year so the Add page only sees parents from THIS year, not duplicates across all year tables.
  if (yearId) params.set("yearId", String(yearId));
  const response = await api.get(`/api/clubs/${clubId}/projects/ongoing?${params}`);
  return response.data;
}

export async function uploadProjectImage(clubId: number, file: File, projectId?: number, yearId?: number, strict: boolean = false): Promise<PhotoUploadResponse> {
  file = await processImageBeforeUpload(file);
  // Client-side quality gate. Throws on validation failure so the caller's existing
  // catch block surfaces a descriptive message instead of "Failed to upload photo."
  // strict=true: enforces 1200×800 minimum (used on Add pages).
  // strict=false: only format + max-size checks (used on Edit pages).
  const validation = await validateImagePhoto(file, strict);
  if (!validation.ok) throw new Error(validation.error || "Photo failed quality check.");

  const formData = new FormData();
  formData.append("file", file);
  const qs = new URLSearchParams();
  // Edit mode requires both projectId AND yearId so the backend writes into the right
  // year's Album folder. Add mode omits both — file lands in /tempdocument/ and the
  // CreateAsync flow moves it once it knows the year derived from project_date.
  if (projectId) qs.set("projectId", String(projectId));
  if (yearId) qs.set("yearId", String(yearId));
  if (strict) qs.set("strict", "true");
  const url = `/api/clubs/${clubId}/projects/upload${qs.toString() ? "?" + qs.toString() : ""}`;
  const response = await api.post(url, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  // Merge server response with locally-read dimensions so the caller always has both.
  return { ...validation.info, ...response.data };
}

export async function uploadProjectDocument(clubId: number, file: File): Promise<{ path: string }> {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/projects/upload-document`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// ══════════════════════════════════════════════════════
// UPCOMING EVENTS
// ══════════════════════════════════════════════════════

export async function getUpcomingEvents(
  clubId: number, page: number = 1, pageSize: number = 20,
  status?: string, search?: string
): Promise<PagedResult<UpcomingEventListItem>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const response = await api.get(`/api/clubs/${clubId}/upcoming-events?${params}`);
  return response.data;
}

export async function getUpcomingEvent(clubId: number, id: number): Promise<UpcomingEventDetail> {
  const response = await api.get(`/api/clubs/${clubId}/upcoming-events/${id}`);
  return response.data;
}

export async function createUpcomingEvent(clubId: number, data: CreateUpcomingEventRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/upcoming-events`, data);
  return response.data;
}

export async function updateUpcomingEvent(clubId: number, id: number, data: UpdateUpcomingEventRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/upcoming-events/${id}`, data);
}

export async function deleteUpcomingEvent(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/upcoming-events/${id}`);
}

export async function uploadUpcomingEventImage(clubId: number, file: File): Promise<{ path: string }> {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/upcoming-events/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function getUpcomingEventYears(clubId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const response = await api.get(`/api/clubs/${clubId}/upcoming-events/years`);
  return response.data;
}

// ══════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ══════════════════════════════════════════════════════

export async function getAnnouncements(
  clubId: number, page: number = 1, pageSize: number = 20,
  status?: string, search?: string
): Promise<PagedResult<AnnouncementListItem>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const response = await api.get(`/api/clubs/${clubId}/announcements?${params}`);
  return response.data;
}

export async function getAnnouncement(clubId: number, id: number): Promise<AnnouncementDetail> {
  const response = await api.get(`/api/clubs/${clubId}/announcements/${id}`);
  return response.data;
}

export async function createAnnouncement(clubId: number, data: CreateAnnouncementRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/announcements`, data);
  return response.data;
}

export async function updateAnnouncement(clubId: number, id: number, data: UpdateAnnouncementRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/announcements/${id}`, data);
}

export async function deleteAnnouncement(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/announcements/${id}`);
}

export async function uploadAnnouncementImage(clubId: number, file: File): Promise<{ path: string }> {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/announcements/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function getAnnouncementYears(clubId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const response = await api.get(`/api/clubs/${clubId}/announcements/years`);
  return response.data;
}

// ══════════════════════════════════════════════════════
// NEWSLETTERS
// ══════════════════════════════════════════════════════

export async function getNewsletters(
  clubId: number, yearId: number, page: number = 1, pageSize: number = 20,
  status?: string, search?: string
): Promise<PagedResult<NewsletterListItem>> {
  const params = new URLSearchParams({ yearId: String(yearId), page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const response = await api.get(`/api/clubs/${clubId}/newsletters?${params}`);
  return response.data;
}

export async function getNewsletter(clubId: number, id: number): Promise<NewsletterDetail> {
  const response = await api.get(`/api/clubs/${clubId}/newsletters/${id}`);
  return response.data;
}

export async function createNewsletter(clubId: number, data: CreateNewsletterRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/newsletters`, data);
  return response.data;
}

export async function updateNewsletter(clubId: number, id: number, data: UpdateNewsletterRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/newsletters/${id}`, data);
}

export async function deleteNewsletter(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/newsletters/${id}`);
}

export async function uploadNewsletterFile(clubId: number, file: File): Promise<{ path: string }> {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/newsletters/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function getNewsletterYears(clubId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const response = await api.get(`/api/clubs/${clubId}/newsletters/years`);
  return response.data;
}

// ══════════════════════════════════════════════════════
// DOCUMENTS
// ══════════════════════════════════════════════════════

export async function getDocuments(
  clubId: number, page: number = 1, pageSize: number = 20,
  status?: string, search?: string
): Promise<PagedResult<DocumentListItem>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const response = await api.get(`/api/clubs/${clubId}/documents?${params}`);
  return response.data;
}

export async function getDocument(clubId: number, id: number): Promise<DocumentDetail> {
  const response = await api.get(`/api/clubs/${clubId}/documents/${id}`);
  return response.data;
}

export async function createDocument(clubId: number, data: CreateDocumentRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/documents`, data);
  return response.data;
}

export async function updateDocument(clubId: number, id: number, data: UpdateDocumentRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/documents/${id}`, data);
}

export async function deleteDocument(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/documents/${id}`);
}

export async function uploadDocumentFile(clubId: number, file: File): Promise<{ path: string; originalName: string }> {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/clubs/${clubId}/documents/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function getDocumentYears(clubId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const response = await api.get(`/api/clubs/${clubId}/documents/years`);
  return response.data;
}

// ══════════════════════════════════════════════════════
// GREETINGS
// ══════════════════════════════════════════════════════

export async function getGreetingSettings(clubId: number): Promise<GreetingSettings> {
  const response = await api.get(`/api/clubs/${clubId}/greetings`);
  return response.data;
}

export async function updateGreetingSettings(clubId: number, data: UpdateGreetingSettingsRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/greetings`, data);
}

// ══════════════════════════════════════════════════════
// ATTENDANCE
// ══════════════════════════════════════════════════════

export async function getAttendanceList(clubId: number, yearId: number, page: number, pageSize: number, search?: string): Promise<{ items: AttendanceListItem[]; totalCount: number }> {
  const params = new URLSearchParams({ yearId: String(yearId), page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  const response = await api.get(`/api/clubs/${clubId}/attendance?${params}`);
  return response.data;
}

export async function getAttendanceYears(clubId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const response = await api.get(`/api/clubs/${clubId}/attendance/years`);
  return response.data;
}

export async function getAttendance(clubId: number, id: number): Promise<AttendanceDetail> {
  const response = await api.get(`/api/clubs/${clubId}/attendance/${id}`);
  return response.data;
}

export async function createAttendance(clubId: number, data: CreateAttendanceRequest): Promise<{ id: number }> {
  const response = await api.post(`/api/clubs/${clubId}/attendance`, data);
  return response.data;
}

export async function updateAttendance(clubId: number, id: number, data: UpdateAttendanceRequest): Promise<void> {
  await api.put(`/api/clubs/${clubId}/attendance/${id}`, data);
}

export async function deleteAttendance(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/attendance/${id}`);
}

export async function getClubMembersForAttendance(clubId: number): Promise<ClubMemberSimple[]> {
  const response = await api.get(`/api/clubs/${clubId}/attendance/members`);
  return response.data;
}

// ── Club Monthly Report ──

export async function getMonthlyReportYears(clubId: number): Promise<ReportYear[]> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/years`);
  return response.data;
}

// TRF and OCV pages pick a year from the club's monthly-report years; with that module switched off, from every rotary year.
export async function getTrfYears(clubId: number, monthlyReportOn: boolean): Promise<ReportYear[]> {
  return monthlyReportOn ? getMonthlyReportYears(clubId) : getRotaryYears();
}

export async function getMonthlyReportMonths(clubId: number, yearId: number): Promise<MonthlyReportListItem[]> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/months/${yearId}`);
  return response.data;
}

export async function getMonthlyReport(clubId: number, yearId: number, month: number): Promise<MonthlyReportDetail | null> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/detail/${yearId}/${month}`);
  return response.data;
}

export async function initMonthlyReport(clubId: number, yearId: number, month: number): Promise<{ reportId: number }> {
  const response = await api.post(`/api/clubs/${clubId}/monthly-reports/init/${yearId}/${month}`);
  return response.data;
}

export async function getMonthlyReportMeetings(clubId: number, yearId: number, month: number): Promise<ReportMeeting[]> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/meetings/${yearId}/${month}`);
  return response.data;
}

export async function getMonthlyReportProjects(clubId: number, yearId: number, month: number): Promise<Record<string, ReportProject[]>> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/projects/${yearId}/${month}`);
  return response.data;
}

export async function getMonthlyReportTrf(clubId: number, reportId: number): Promise<TrfEntry[]> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/trf/${reportId}`);
  return response.data;
}

export async function saveMonthlyReportTrf(clubId: number, reportId: number, entries: SaveTrfEntry[]): Promise<void> {
  await api.post(`/api/clubs/${clubId}/monthly-reports/trf/${reportId}`, entries);
}

export async function saveMonthlyReportMemberInfo(clubId: number, reportId: number, data: SaveMemberInfo): Promise<void> {
  await api.put(`/api/clubs/${clubId}/monthly-reports/member-info/${reportId}`, data);
}

// Live member stats for a CMR month, computed from club_members (last-month count /
// deleted / added). Used to pre-fill the Members Info step; values remain editable.
export interface ComputedMemberInfo {
  memberCountLastMonth: number;
  membersDeleted: number;
  membersAdded: number;
  currentMemberCount: number;
}
export async function getMonthlyReportMemberStats(clubId: number, yearId: number, month: number): Promise<ComputedMemberInfo> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/member-stats/${yearId}/${month}`);
  return response.data;
}

export async function getMonthlyReportPreview(clubId: number, yearId: number, month: number): Promise<MonthlyReportPreview> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/preview/${yearId}/${month}`);
  return response.data;
}

export async function uploadMonthlyReportToDistrict(clubId: number, reportId: number, pdfBase64?: string): Promise<void> {
  // pdfBase64 (new CMR): the Design B PDF the server emails instead of building its own. Old CMR sends none.
  await api.post(`/api/clubs/${clubId}/monthly-reports/upload-to-district/${reportId}`, pdfBase64 ? { pdfBase64 } : undefined);
}

// NEW CMR Word (user 2026-11-13): Design B layout. The Foundation + Membership tables are sent exactly as the
// CMR screen / PDF show them, so Word = screen = PDF. Triggers a browser download.
export async function downloadClubMonthlyReportWordV2(
  clubId: number, yearId: number, month: number, payload: unknown, fileName: string,
): Promise<void> {
  const response = await api.post(`/api/clubs/${clubId}/monthly-reports/word-v2/${yearId}/${month}`, payload, {
    responseType: "blob",
    timeout: 300000, // embedded photos - allow up to 5 minutes
  });
  const blob = new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

// Detailed CMR Word (.docx): summary + meetings + all service avenues with photos.
// Server-generated (photos embedded); triggers a browser download.
export async function downloadClubMonthlyReportWord(
  clubId: number,
  yearId: number,
  month: number,
  baseFileName: string,
): Promise<void> {
  const response = await api.get(`/api/clubs/${clubId}/monthly-reports/word/${yearId}/${month}`, {
    responseType: "blob",
    timeout: 300000, // Word report with embedded photos is slow — allow up to 5 minutes (default 30s trips).
  });
  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseFileName.replace(/\s+/g, "_")}.docx`;
  link.click();
  window.URL.revokeObjectURL(url);
}

export async function sendMonthlyReportEmail(clubId: number, data: {
  pdfBase64: string;
  yearId: number;
  month: number;
  monthName: string;
  clubName: string;
  yearLabel: string;
}): Promise<{ sentTo: string[]; warnings: string[] }> {
  const res = await api.post(`/api/clubs/${clubId}/monthly-reports/send-report-email`, data);
  return res.data;
}

// OCV/GOV
export async function getOcvCategories(clubId: number): Promise<OcvCategory[]> {
  const { data } = await api.get(`/api/clubs/${clubId}/ocv-gov/categories`);
  return data;
}

export async function getOcvDocumentTypes(clubId: number, categoryId: number): Promise<OcvDocumentType[]> {
  const { data } = await api.get(`/api/clubs/${clubId}/ocv-gov/document-types/${categoryId}`);
  return data;
}

export async function getOcvDocuments(clubId: number, categoryId: number, yearId: number): Promise<OcvDocumentListItem[]> {
  const { data } = await api.get(`/api/clubs/${clubId}/ocv-gov/documents/${categoryId}?yearId=${yearId}`);
  return data;
}

export async function uploadOcvDocument(clubId: number, formData: FormData): Promise<OcvDocumentListItem> {
  const { data } = await api.post(`/api/clubs/${clubId}/ocv-gov/documents`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function updateOcvDocument(clubId: number, documentId: number, formData: FormData): Promise<OcvDocumentListItem> {
  const { data } = await api.put(`/api/clubs/${clubId}/ocv-gov/documents/${documentId}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deleteOcvDocument(clubId: number, documentId: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/ocv-gov/documents/${documentId}`);
}

/**
 * Downloads an OCV document via the API endpoint that adds Content-Disposition: attachment.
 * Returns a Blob; caller is responsible for triggering the actual save dialog via createObjectURL.
 * Uses the auth-aware api instance, so cross-origin + auth + CORS all work.
 */
export async function downloadOcvDocumentBlob(clubId: number, documentId: number): Promise<Blob> {
  const res = await api.get(`/api/clubs/${clubId}/ocv-gov/documents/${documentId}/download`, { responseType: "blob" });
  return res.data as Blob;
}

export async function getOcvReport(clubId: number, yearId: number, status?: string): Promise<OcvReportItem[]> {
  const params = new URLSearchParams({ yearId: yearId.toString() });
  if (status) params.append("status", status);
  const { data } = await api.get(`/api/clubs/${clubId}/ocv-gov/report?${params}`);
  return data;
}

// OCV Word (.docx): uploaded documents grouped by category (images embedded, other files
// hyperlinked) + Live Documents module snapshots + newsletters. Server-generated.
export async function downloadOcvReportWord(
  clubId: number,
  yearId: number,
  baseFileName: string,
  onProgress?: (fraction: number) => void,   // 0..1 while the finished file comes down (user 2026-11-13)
): Promise<void> {
  const response = await api.get(`/api/clubs/${clubId}/ocv-gov/report/word`, {
    params: { yearId },
    responseType: "blob",
    onDownloadProgress: (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); },
    // The Word report rasterizes uploaded Office/PDF docs (LibreOffice/pdfium) — slow when a club has
    // several attachments, so the default 30s axios timeout trips. Allow up to 5 minutes.
    timeout: 300000,
  });
  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseFileName.replace(/\s+/g, "_")}.docx`;
  link.click();
  window.URL.revokeObjectURL(url);
}

// OCV Excel (.xlsx, real Excel file since 2026-11-13): server-generated, same layout as the legacy
// OCV list — header block + one row per document-type across all
// categories with "Download Here" hyperlinks + Live Documents + Newsletters sections.
export async function downloadOcvReportExcel(
  clubId: number,
  yearId: number,
  baseFileName: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const response = await api.get(`/api/clubs/${clubId}/ocv-gov/report/excel`, {
    params: { yearId },
    responseType: "blob",
    timeout: 300000,
    onDownloadProgress: (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); },
  });
  const blob = new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseFileName.replace(/\s+/g, "_")}.xlsx`;   // real .xlsx (user 2026-11-13)
  link.click();
  window.URL.revokeObjectURL(url);
}

// Blob-only variants (no auto-download) — used to bundle several clubs' OCV reports into one
// ZIP for the AG-wise district report.
export async function fetchOcvReportWordBlob(clubId: number, yearId: number): Promise<Blob> {
  const response = await api.get(`/api/clubs/${clubId}/ocv-gov/report/word`, { params: { yearId }, responseType: "blob", timeout: 300000 });
  return new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
export async function fetchOcvReportExcelBlob(clubId: number, yearId: number): Promise<Blob> {
  const response = await api.get(`/api/clubs/${clubId}/ocv-gov/report/excel`, { params: { yearId }, responseType: "blob" });
  return new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// The Live Documents module snapshots the Word report renders, as JSON — so the Excel
// export reproduces that section table-for-table instead of keeping its own module list.
export async function getOcvReportLiveTables(
  clubId: number,
  yearId: number,
): Promise<{ label: string; headers: string[]; rows: string[][] }[]> {
  const { data } = await api.get(`/api/clubs/${clubId}/ocv-gov/report/live-tables`, {
    params: { yearId },
  });
  return data;
}

// OCV Settings (SuperAdmin)
export async function createOcvDocumentType(clubId: number, dto: { categoryId: number; typeName: string; allowMultiple: boolean; sortOrder: number }): Promise<OcvDocumentType> {
  const { data } = await api.post(`/api/clubs/${clubId}/ocv-gov/settings/document-types`, dto);
  return data;
}

export async function updateOcvDocumentType(clubId: number, typeId: number, dto: { typeName: string; allowMultiple: boolean; sortOrder: number }): Promise<void> {
  await api.put(`/api/clubs/${clubId}/ocv-gov/settings/document-types/${typeId}`, dto);
}

export async function deleteOcvDocumentType(clubId: number, typeId: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/ocv-gov/settings/document-types/${typeId}`);
}

// TRF Contribution
export async function getTrfFunds(clubId: number): Promise<TrfFund[]> {
  const { data } = await api.get(`/api/clubs/${clubId}/trf/funds`);
  return data;
}

export async function createTrfFund(clubId: number, dto: { fundName: string; sortOrder: number }): Promise<TrfFund> {
  const { data } = await api.post(`/api/clubs/${clubId}/trf/settings/funds`, dto);
  return data;
}

export async function updateTrfFund(clubId: number, fundId: number, dto: { fundName: string; sortOrder: number; isActive: boolean }): Promise<void> {
  await api.put(`/api/clubs/${clubId}/trf/settings/funds/${fundId}`, dto);
}

export async function deleteTrfFund(clubId: number, fundId: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/trf/settings/funds/${fundId}`);
}

export async function getTrfContributions(clubId: number, yearId: number): Promise<TrfContribution[]> {
  const { data } = await api.get(`/api/clubs/${clubId}/trf?yearId=${yearId}`);
  return data;
}

export async function createTrfContribution(clubId: number, dto: { yearId: number; trfDate: string; donorName: string; amountUSD: number; fundId: number; otherFundName?: string | null }): Promise<TrfContribution> {
  const { data } = await api.post(`/api/clubs/${clubId}/trf`, dto);
  return data;
}

export async function updateTrfContribution(clubId: number, trfId: number, dto: { trfDate: string; donorName: string; amountUSD: number; fundId: number; otherFundName?: string | null }): Promise<TrfContribution> {
  const { data } = await api.put(`/api/clubs/${clubId}/trf/${trfId}`, dto);
  return data;
}

export async function deleteTrfContribution(clubId: number, trfId: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/trf/${trfId}`);
}

export async function getTrfContributionsByMonth(clubId: number, yearId: number, month: number): Promise<TrfContribution[]> {
  const { data } = await api.get(`/api/clubs/${clubId}/trf/by-month?yearId=${yearId}&month=${month}`);
  return data;
}

// Cashfree KYC
// Off on ROW (FeatureGate legacy_gateways): the create forms get no vendor accounts.
export async function getCashfreeKycList(): Promise<CashfreeKyc[]> {
  return [];
}
export async function sendCashfreeOtp(): Promise<{ message: string }> {
  const res = await api.post('/api/cashfree-kyc/send-otp');
  return res.data;
}
export async function verifyCashfreeOtpAndSave(data: {
  otp: string;
  kycId?: number | null;
  vendorId: string;
  email: string;
  phone: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  name: string;
  pan: string;
}): Promise<CashfreeKyc> {
  const res = await api.post('/api/cashfree-kyc/verify-and-save', data);
  return res.data;
}
export async function deleteCashfreeKyc(kycId: number): Promise<void> {
  await api.delete(`/api/cashfree-kyc/${kycId}`);
}
export async function toggleCashfreeKycActive(kycId: number): Promise<void> {
  await api.put(`/api/cashfree-kyc/${kycId}/toggle-active`);
}
export async function getCashfreeVendorDetail(kycId: number): Promise<CashfreeVendorDetail> {
  const res = await api.get(`/api/cashfree-kyc/${kycId}/detail`);
  return res.data;
}
export async function refreshAllCashfreeStatus(): Promise<{ message: string; updatedCount: number }> {
  const res = await api.post('/api/cashfree-kyc/refresh-all');
  return res.data;
}
export async function refreshCashfreeVendorStatus(kycId: number): Promise<{ status: string }> {
  const res = await api.post(`/api/cashfree-kyc/${kycId}/refresh`);
  return res.data;
}

// ── Weblinks ─────────────────────────────────────────────────────────
export async function getWeblinks(clubId: number, parentId?: number): Promise<Weblink[]> {
  const params = parentId ? `?parentId=${parentId}` : '';
  const res = await api.get(`/api/clubs/${clubId}/weblinks${params}`);
  return res.data;
}
export async function getWeblinkTree(clubId: number): Promise<WeblinkTree[]> {
  const res = await api.get(`/api/clubs/${clubId}/weblinks/tree`);
  return res.data;
}
export async function createWeblink(clubId: number, data: FormData): Promise<Weblink> {
  const res = await api.post(`/api/clubs/${clubId}/weblinks`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function updateWeblink(clubId: number, weblinkId: number, data: FormData): Promise<Weblink> {
  const res = await api.put(`/api/clubs/${clubId}/weblinks/${weblinkId}`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function deleteWeblink(clubId: number, weblinkId: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/weblinks/${weblinkId}`);
}
export async function toggleWeblinkActive(clubId: number, weblinkId: number): Promise<void> {
  await api.put(`/api/clubs/${clubId}/weblinks/${weblinkId}/toggle-active`);
}

// ── Sub Groups ──────────────────────────────────────────────────────
export async function getSubGroups(clubId: number, yearId: number): Promise<SubGroup[]> {
  const res = await api.get(`/api/clubs/${clubId}/sub-groups?yearId=${yearId}`);
  return res.data;
}
export async function getSubGroupDetail(clubId: number, subGroupId: number): Promise<SubGroupDetail> {
  const res = await api.get(`/api/clubs/${clubId}/sub-groups/${subGroupId}`);
  return res.data;
}
export async function createSubGroup(clubId: number, data: { yearId: number; groupName: string; memberIds: number[] }): Promise<SubGroup> {
  const res = await api.post(`/api/clubs/${clubId}/sub-groups`, data);
  return res.data;
}
export async function updateSubGroup(clubId: number, subGroupId: number, data: { yearId?: number; groupName: string; memberIds: number[] }): Promise<SubGroup> {
  const res = await api.put(`/api/clubs/${clubId}/sub-groups/${subGroupId}`, data);
  return res.data;
}
export async function deleteSubGroup(clubId: number, subGroupId: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/sub-groups/${subGroupId}`);
}
export async function getSubGroupClubMembers(clubId: number): Promise<SubGroupMember[]> {
  const res = await api.get(`/api/clubs/${clubId}/sub-groups/club-members`);
  return res.data;
}
export async function getSubGroupAvailableYears(clubId?: number, districtId?: number) {
  const res = await api.get("/api/event-payment-links/subgroup-years", { params: { clubId, districtId } });
  return res.data;
}
export async function getDistrictSubGroups(districtId: number, yearId: number): Promise<SubGroup[]> {
  const res = await api.get(`/api/districts/${districtId}/sub-groups?yearId=${yearId}`);
  return res.data;
}
export async function getClubSubGroupAvailableYears(clubId: number) {
  const res = await api.get(`/api/clubs/${clubId}/sub-groups/available-years`);
  return res.data;
}
export async function getDistrictSubGroupAvailableYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/sub-groups/available-years`);
  return res.data;
}

// ── Event Masters ──────────────────────────────────────────────────
export async function getEventTshirtSizes() {
  const res = await api.get("/api/event-masters/tshirt-sizes");
  return res.data;
}
export async function createEventTshirtSize(data: { sizeName: string; sortOrder: number }) {
  const res = await api.post("/api/event-masters/tshirt-sizes", data);
  return res.data;
}
export async function updateEventTshirtSize(id: number, data: { sizeName: string; sortOrder: number }) {
  const res = await api.put(`/api/event-masters/tshirt-sizes/${id}`, data);
  return res.data;
}
export async function deleteEventTshirtSize(id: number) {
  await api.delete(`/api/event-masters/tshirt-sizes/${id}`);
}
export async function getEventFoodPreferences() {
  const res = await api.get("/api/event-masters/food-preferences");
  return res.data;
}
export async function createEventFoodPreference(data: { foodType: string; sortOrder: number }) {
  const res = await api.post("/api/event-masters/food-preferences", data);
  return res.data;
}
export async function updateEventFoodPreference(id: number, data: { foodType: string; sortOrder: number }) {
  const res = await api.put(`/api/event-masters/food-preferences/${id}`, data);
  return res.data;
}
export async function deleteEventFoodPreference(id: number) {
  await api.delete(`/api/event-masters/food-preferences/${id}`);
}

// ── Event Payment Links (Admin) ─────────────────────────────────────
export async function getEventPaymentLinks(params?: { clubId?: number; districtId?: number; search?: string }) {
  const res = await api.get("/api/event-payment-links", { params });
  return res.data;
}
export async function getEventPaymentLinkDetail(linkId: number) {
  const res = await api.get(`/api/event-payment-links/${linkId}`);
  return res.data;
}
export async function createEventPaymentLink(formData: FormData) {
  const res = await api.post("/api/event-payment-links", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
export async function createFullEventPaymentLink(formData: FormData) {
  const res = await api.post("/api/event-payment-links/create-full", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
export async function updateEventPaymentLink(linkId: number, formData: FormData) {
  const res = await api.put(`/api/event-payment-links/${linkId}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
export async function updateFullEventPaymentLink(linkId: number, formData: FormData) {
  const res = await api.put(`/api/event-payment-links/${linkId}/update-full`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
export async function deleteEventPaymentLink(linkId: number) {
  await api.delete(`/api/event-payment-links/${linkId}`);
}
export async function toggleEventPaymentLinkActive(linkId: number) {
  const res = await api.patch(`/api/event-payment-links/${linkId}/toggle-active`);
  return res.data;
}

// Registration types
export async function getEventRegistrations(linkId: number) {
  const res = await api.get(`/api/event-payment-links/${linkId}/registrations`);
  return res.data;
}
export async function saveEventRegistration(linkId: number, data: { registrationName: string; amount: number }) {
  const res = await api.post(`/api/event-payment-links/${linkId}/registrations`, data);
  return res.data;
}
export async function updateEventRegistration(linkId: number, regId: number, data: { registrationName: string; amount: number }) {
  const res = await api.put(`/api/event-payment-links/${linkId}/registrations/${regId}`, data);
  return res.data;
}
export async function deleteEventRegistration(linkId: number, regId: number) {
  await api.delete(`/api/event-payment-links/${linkId}/registrations/${regId}`);
}

// Vendor splits
export async function getEventVendorSplits(linkId: number) {
  const res = await api.get(`/api/event-payment-links/${linkId}/vendor-splits`);
  return res.data;
}
export async function saveEventVendorSplits(linkId: number, data: { splits: Array<{ fkRegistrationId: number; fkKycId: number; splitAmount: number }> }) {
  const res = await api.post(`/api/event-payment-links/${linkId}/vendor-splits`, data);
  return res.data;
}

// Designations
export async function getEventDesignations(linkId: number) {
  const res = await api.get(`/api/event-payment-links/${linkId}/designations`);
  return res.data;
}
export async function saveEventDesignation(linkId: number, data: { designationName: string }) {
  const res = await api.post(`/api/event-payment-links/${linkId}/designations`, data);
  return res.data;
}
export async function deleteEventDesignation(linkId: number, desigId: number) {
  await api.delete(`/api/event-payment-links/${linkId}/designations/${desigId}`);
}

// Members
export async function getEventMembers(linkId: number, isPaid: boolean, search?: string) {
  const res = await api.get(`/api/event-payment-links/${linkId}/members`, { params: { isPaid, search } });
  return res.data;
}
export async function recordOfflinePayment(linkId: number, formData: FormData) {
  const res = await api.post(`/api/event-payment-links/${linkId}/members/offline-payment`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
export async function getMemberPaymentDetail(memberPaymentId: number) {
  const res = await api.get(`/api/event-payment-links/member-payment/${memberPaymentId}`);
  return res.data;
}
export async function updateOfflinePayment(memberPaymentId: number, formData: FormData) {
  const res = await api.put(`/api/event-payment-links/members/${memberPaymentId}/update-offline`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
export async function sendEventReceipt(memberPaymentId: number, remark?: string) {
  const res = await api.post(`/api/event-payment-links/members/${memberPaymentId}/send-receipt`, { remark });
  return res.data;
}
export async function sendEventReminderEmail(memberPaymentId: number, remark?: string) {
  const res = await api.post(`/api/event-payment-links/members/${memberPaymentId}/send-reminder-email`, { remark });
  return res.data;
}
export async function bulkReminderEmail(linkId: number, remark?: string) {
  const res = await api.post(`/api/event-payment-links/${linkId}/members/bulk-reminder-email`, { remark });
  return res.data;
}
export async function exportEventMembers(linkId: number, isPaid: boolean) {
  const res = await api.get(`/api/event-payment-links/${linkId}/members/export`, {
    params: { isPaid },
    responseType: "blob",
  });
  return res.data;
}

// ── Public Event Payment (no auth) ──────────────────────────────────
export async function getPublicEventLink(linkId: number) {
  const res = await publicApi.get(`/api/public/event-payment/${linkId}`);
  return res.data;
}
export async function getPublicEventClubs(linkId: number, districtId: number) {
  const res = await publicApi.get(`/api/public/event-payment/${linkId}/districts/${districtId}/clubs`);
  return res.data;
}
/** Path of an event pay link. The key (from the link list) is what lets the page search members. */
export function eventPayPath(item: { id: number; payKey?: string | null }) {
  return `/pay/${item.id}${item.payKey ? `?k=${encodeURIComponent(item.payKey)}` : ""}`;
}
export async function searchPublicEventMembers(linkId: number, params: { districtId?: number; clubId?: number; query?: string; k: string }) {
  const res = await publicApi.get(`/api/public/event-payment/${linkId}/search-members`, { params });
  return res.data;
}
export async function sendPublicEventOtp(linkId: number, data: { email?: string; mobile?: string; memberProfileId?: number }) {
  const res = await publicApi.post(`/api/public/event-payment/${linkId}/send-otp`, data);
  return res.data;
}
export async function verifyPublicEventOtp(linkId: number, data: { email?: string; mobile?: string; otpCode: string; memberProfileId?: number }) {
  const res = await publicApi.post(`/api/public/event-payment/${linkId}/verify-otp`, data);
  return res.data;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createPublicEventOrder(linkId: number, data: any, payerToken: string) {
  const res = await publicApi.post(`/api/public/event-payment/${linkId}/create-order`, data, { headers: { "X-Payer-Token": payerToken } });
  return res.data;
}
export async function verifyPublicEventPayment(linkId: number, orderId: string, memberPaymentId: number) {
  const res = await publicApi.get(`/api/public/event-payment/${linkId}/verify-payment`, {
    params: { orderId, memberPaymentId },
  });
  return res.data;
}

export async function getEventReport(linkId: number) {
  const res = await api.get(`/api/event-payment-links/${linkId}/report`);
  return res.data;
}

export async function createGoogleSheetForLink(linkId: number) {
  const res = await api.post(`/api/event-payment-links/${linkId}/create-google-sheet`);
  return res.data;
}

export async function deleteGoogleSheetForLink(linkId: number) {
  const res = await api.delete(`/api/event-payment-links/${linkId}/delete-google-sheet`);
  return res.data;
}

// ── Membership Dues ──────────────────────────────────────────
export async function getMembershipDuesList(params?: { clubId?: number; districtId?: number; search?: string; year?: string }) {
  const res = await api.get("/api/membership-dues", { params });
  return res.data;
}
export async function getMembershipDuesDetail(id: number) {
  const res = await api.get(`/api/membership-dues/${id}`);
  return res.data;
}
export async function createMembershipDues(data: FormData) {
  const res = await api.post("/api/membership-dues", data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function updateMembershipDues(id: number, data: FormData) {
  const res = await api.put(`/api/membership-dues/${id}`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function updateMembershipDuesBasic(id: number, data: FormData) {
  const res = await api.patch(`/api/membership-dues/${id}/basic`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function deleteMembershipDues(id: number) {
  const res = await api.delete(`/api/membership-dues/${id}`);
  return res.data;
}
export async function toggleMembershipDuesActive(id: number) {
  const res = await api.patch(`/api/membership-dues/${id}/toggle-active`);
  return res.data;
}
export async function getMembershipDuesMembers(id: number, params?: { search?: string; filter?: string }) {
  const res = await api.get(`/api/membership-dues/${id}/members`, { params });
  return res.data;
}
export async function allocateMembershipDuesFees(id: number) {
  const res = await api.post(`/api/membership-dues/${id}/allocate`);
  return res.data;
}
export async function updateMembershipDuesMemberFee(duesId: number, memberFeeId: number, data: any) {
  const res = await api.put(`/api/membership-dues/${duesId}/members/${memberFeeId}`, data);
  return res.data;
}
export async function recordMembershipDuesOffline(duesId: number, memberFeeId: number, data: FormData) {
  const res = await api.post(`/api/membership-dues/${duesId}/members/${memberFeeId}/offline-payment`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function approveMembershipDuesPayment(paymentId: number, data: any) {
  const res = await api.post(`/api/membership-dues/payments/${paymentId}/approve-reject`, data);
  return res.data;
}
export async function getMembershipDuesOfflineDetails(paymentId: number) {
  const res = await api.get(`/api/membership-dues/payments/${paymentId}/offline-details`);
  return res.data;
}
export async function updateMembershipDuesOffline(paymentId: number, formData: FormData) {
  // FormData includes sendReceiptOnUpdate as a stringified bool
  const res = await api.put(`/api/membership-dues/payments/${paymentId}/update-offline`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
// SuperAdmin-only — server rejects with 403 for any other role.
export async function deleteMembershipDuesPayment(paymentId: number) {
  const res = await api.delete(`/api/membership-dues/payments/${paymentId}`);
  return res.data;
}
// SuperAdmin-only payment-status correction — flips a member fee that is
// currently Paid back to Unpaid. NOT a refund: no money moves and no gateway
// call is made. The payment row is preserved server-side (soft-deleted and
// marked 'Reverted') so the audit trail survives. `reason` is mandatory;
// omit `feeType` to revert every currently-paid fee type on the row.
export async function revertMembershipDuesPayment(
  duesId: number,
  memberFeeId: number,
  data: { feeType?: number; reason: string },
) {
  const res = await api.post(`/api/membership-dues/${duesId}/members/${memberFeeId}/revert-payment`, data);
  return res.data;
}
// Callers pass a membership_dues_member_fees.pk_id (memberFeeId) — the
// "Send Receipt" button on the club-admin members list has that id, not a
// payment id. Backend resolves to the latest paid payment for that fee.
// The parameter was named `paymentId` before 2026-07-08 which caused a
// silent cross-member misroute when the fee id numerically collided with an
// unrelated payment.pk_id.
export async function sendMembershipDuesReceipt(memberFeeId: number) {
  const res = await api.post(`/api/membership-dues/member-fees/${memberFeeId}/send-receipt`);
  return res.data;
}
export async function sendMembershipDuesReminder(duesId: number, memberFeeId: number, data: { feeType: number; remark?: string }) {
  const res = await api.post(`/api/membership-dues/${duesId}/members/${memberFeeId}/reminder-email`, data);
  return res.data;
}
export async function bulkMembershipDuesReminderEmail(duesId: number, data?: { remark?: string }) {
  const res = await api.post(`/api/membership-dues/${duesId}/bulk-reminder-email`, data);
  return res.data;
}
export async function createMembershipDuesGoogleSheet(id: number) {
  const res = await api.post(`/api/membership-dues/${id}/create-google-sheet`);
  return res.data;
}
export async function deleteMembershipDuesGoogleSheet(id: number) {
  const res = await api.delete(`/api/membership-dues/${id}/delete-google-sheet`);
  return res.data;
}

// Public Membership Dues
export async function getPublicMembershipDues(id: number) {
  const res = await publicApi.get(`/api/public/membership-dues/${id}`);
  return res.data;
}
/** Path of a dues pay link. The key (from the dues list) is what lets the page search members. */
export function duesPayPath(item: { id: number; payKey?: string | null }) {
  return `/pay/dues/${item.id}${item.payKey ? `?k=${encodeURIComponent(item.payKey)}` : ""}`;
}
/** Always answers the same way, so it says nothing about who is a member. */
export async function requestFreshPayLink(kind: string, id: number, email: string) {
  const res = await publicApi.post(`/api/public/pay-link-request`, { kind, id, email });
  return res.data as { message: string };
}
export async function searchMembershipDuesMembers(id: number, query: string, k: string) {
  const res = await publicApi.get(`/api/public/membership-dues/${id}/search-members`, { params: { query, k } });
  return res.data;
}
export async function getMemberDuesStatus(id: number, memberProfileId: number, token: string) {
  const res = await publicApi.get(`/api/public/membership-dues/${id}/member/${memberProfileId}/status`, { params: { token } });
  return res.data;
}
export async function sendMembershipDuesOtp(id: number, data: any) {
  const res = await publicApi.post(`/api/public/membership-dues/${id}/send-otp`, data);
  return res.data;
}
export async function verifyMembershipDuesOtp(id: number, data: any) {
  const res = await publicApi.post(`/api/public/membership-dues/${id}/verify-otp`, data);
  return res.data;
}
/** A hosted checkout session as the public API reports it (no personal data). */
export interface CheckoutSessionView {
  status: "open" | "paid" | "failed" | "cancelled";
  amount: number;
  currency: string;
  description: string;
  gateway: string;
  merchantOrderId: string;
  returnUrl: string | null;
  cancelUrl: string | null;
  simulated: boolean;
  expired: boolean;
}

export async function getCheckoutSession(token: string): Promise<CheckoutSessionView> {
  const res = await publicApi.get(`/api/public/payments/checkout/${encodeURIComponent(token)}`);
  return res.data;
}

export async function simulateCheckout(token: string, outcome: "paid" | "failed" | "cancelled"): Promise<CheckoutSessionView> {
  const res = await publicApi.post(`/api/public/payments/checkout/${encodeURIComponent(token)}/simulate`, { outcome });
  return res.data;
}

export async function createMembershipDuesPaymentOrder(id: number, data: any, payerToken: string) {
  const res = await publicApi.post(`/api/public/membership-dues/${id}/pay`, data, { headers: { "X-Payer-Token": payerToken } });
  return res.data;
}
export async function verifyMembershipDuesPayment(id: number, orderId: string, paymentId: number) {
  const res = await publicApi.get(`/api/public/membership-dues/${id}/verify-payment`, { params: { orderId, paymentId } });
  return res.data;
}
export async function getMembershipDuesReport(id: number) {
  const res = await api.get(`/api/membership-dues/${id}/report`);
  return res.data;
}
export async function exportMembershipDuesReport(duesId: number) {
  const res = await api.get(`/api/membership-dues/${duesId}/export`, { responseType: "blob" });
  return res.data;
}

export async function refreshMembershipDuesSettlements(id: number) {
  const res = await api.post(`/api/membership-dues/${id}/settlement-refresh`);
  return res.data;
}

export async function getMembershipDuesSettlementReport(id: number) {
  const res = await api.get(`/api/membership-dues/${id}/settlement-report`);
  return res.data;
}

export async function refreshEventSettlements(linkId: number) {
  const res = await api.post(`/api/event-payment-links/${linkId}/settlement-refresh`);
  return res.data;
}

export async function getEventSettlementReport(linkId: number) {
  const res = await api.get(`/api/event-payment-links/${linkId}/settlement-report`);
  return res.data;
}

// ── Credit Management ──────────────────────────────────────────────
export async function getCreditList(params?: Record<string, any>) {
  const res = await api.get("/api/credit-management", { params });
  return res.data;
}
export async function addCredit(data: FormData) {
  const res = await api.post("/api/credit-management", data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function updateCredit(id: number, data: FormData) {
  const res = await api.put(`/api/credit-management/${id}`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function deleteCredit(id: number) {
  const res = await api.delete(`/api/credit-management/${id}`);
  return res.data;
}
// "RCC & District Goals" combined report (RCC + District Goals) for a district or a club (user 2026-11-16).
export async function downloadRccDistrictReport(districtId: number, yearId?: number | null): Promise<Blob> {
  const r = await api.get(`/api/rcc-goals/report/district/${districtId}`, { params: yearId ? { yearId } : {}, responseType: "blob", timeout: 300000 });
  return r.data;
}
export async function downloadRccClubReport(clubId: number, yearId?: number | null): Promise<Blob> {
  const r = await api.get(`/api/rcc-goals/report/club/${clubId}`, { params: yearId ? { yearId } : {}, responseType: "blob", timeout: 300000 });
  return r.data;
}
// Settings > Wallet: Super Admin deducts credits used outside ROW, with a reason (user 2026-11-16).
export async function deductCredit(id: number, count: number, reason: string): Promise<{ message: string; balanceBefore: number; balanceAfter: number }> {
  const res = await api.post(`/api/credit-management/${id}/deduct`, { count, reason });
  return res.data;
}
export interface CreditHistoryEntry {
  date: string; dateTo: string | null; kind: "Credit" | "Debit"; group: "Support" | "Online" | "ROW" | "Expired";
  source: string; count: number; detail: string | null; balanceAfter: number | null; lines: number;
}
export interface CreditHistory {
  districtNumber: string; clubName: string | null; creditType: string;
  activeCredited: number; activeUsed: number;
  creditedBySupport: number; boughtOnline: number; sentThroughRow: number; deductedBySupport: number; expired: number; balance: number;
  tally: CreditHistoryEntry[];    // grouped, oldest first
  entries: CreditHistoryEntry[];  // every single entry, oldest first
}
// Every credit and debit of the pack's club / district wallet for its type, newest first.
export async function getCreditHistory(id: number): Promise<CreditHistory> {
  const res = await api.get(`/api/credit-management/${id}/history`);
  return res.data;
}
export async function getClubCreditBalance(clubId: number) {
  const res = await api.get(`/api/credit-management/club/${clubId}/balance`);
  return res.data;
}
export async function getDistrictCreditBalance(districtId: number) {
  const res = await api.get(`/api/credit-management/district/${districtId}/balance`);
  return res.data;
}

// ── Wallet credit top-up (Razorpay) ──
export async function walletQuote(creditType: string, amount: number) {
  const res = await api.get(`/api/wallet/quote`, { params: { creditType, amount } });
  return res.data;
}
export async function createWalletTopupOrder(payload: {
  scope: "club" | "district"; clubId?: number; districtId?: number; creditType: string; amount: number; returnPath?: string;
}) {
  const res = await api.post(`/api/wallet/create-order`, payload);
  return res.data;
}
export async function verifyWalletTopup(payload: {
  topupOrderId: number; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string;
}) {
  const res = await api.post(`/api/wallet/verify`, payload);
  return res.data;
}

// ── Club website purchase / renewal (Razorpay) ──
export async function getWebsiteQuote(clubId: number) {
  const res = await api.get(`/api/website-billing/quote`, { params: { clubId } });
  return res.data;
}
export async function checkWebsiteSubdomain(input: string, clubId?: number) {
  const res = await api.get(`/api/website-billing/check-subdomain`, { params: { input, clubId } });
  return res.data;
}
export async function createWebsiteOrder(payload: {
  clubId: number; subdomainInput?: string; reminderDays: number; themeId?: number; returnPath?: string;
}) {
  const res = await api.post(`/api/website-billing/create-order`, payload);
  return res.data;
}
export async function verifyWebsiteOrder(payload: {
  websiteOrderId: number; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string;
}) {
  const res = await api.post(`/api/website-billing/verify`, payload);
  return res.data;
}
export async function getWebsiteOrderStatus(orderId: number) {
  const res = await api.get(`/api/website-billing/order-status/${orderId}`);
  return res.data;
}
export async function getLatestWebsiteOrder(clubId: number) {
  const res = await api.get(`/api/website-billing/latest-order`, { params: { clubId } });
  return res.data;
}

// ── Website training appointments (Calendly-style booking + Zoom) ──
export async function getTrainingAvailability(clubId: number) {
  const res = await api.get(`/api/training-appointments/availability`, { params: { clubId } });
  return res.data;
}
export async function bookTrainingAppointment(payload: { clubId: number; slotStart: string; notes?: string }) {
  const res = await api.post(`/api/training-appointments/book`, payload);
  return res.data;
}
export async function getClubTrainingAppointments(clubId: number) {
  const res = await api.get(`/api/training-appointments/mine`, { params: { clubId } });
  return res.data;
}
export async function rescheduleTrainingAppointment(id: number, payload: { slotStart: string }) {
  const res = await api.post(`/api/training-appointments/${id}/reschedule`, payload);
  return res.data;
}
export async function getAllTrainingAppointments() {
  const res = await api.get(`/api/admin/training-appointments`);
  return res.data;
}

// ── Training availability (SuperAdmin): the team's weekly hours + the dates they are blocked ──
export interface TrainingHourRange { id?: number; start: string; end: string }
export interface TrainingWeekday {
  dayOfWeek: number;          // 0 = Sunday
  dayName: string;
  isAvailable: boolean;
  ranges: TrainingHourRange[];
}
export interface TrainingDateOverride {
  id: number;
  date: string;               // yyyy-MM-dd
  dateLabel: string;
  isUnavailableAllDay: boolean;
  ranges: TrainingHourRange[];
  reason?: string | null;
  bookedCount: number;        // appointments already sitting on that date
}
export interface TrainingAvailabilitySettings {
  slotMinutes: number;
  maxPerDay: number;
  week: TrainingWeekday[];
  overrides: TrainingDateOverride[];
}
export async function getTrainingAvailabilitySettings(): Promise<TrainingAvailabilitySettings> {
  const res = await api.get(`/api/admin/training-availability`);
  return res.data;
}
export async function saveTrainingWeek(week: TrainingWeekday[]): Promise<TrainingAvailabilitySettings> {
  const res = await api.put(`/api/admin/training-availability/week`, { week });
  return res.data;
}
export async function saveTrainingDateOverride(payload: {
  // One date, or several picked off the calendar in one go — the same rule is applied to each.
  date?: string; dates?: string[]; isUnavailableAllDay: boolean; ranges: TrainingHourRange[]; reason?: string | null;
}): Promise<TrainingAvailabilitySettings> {
  const res = await api.post(`/api/admin/training-availability/overrides`, payload);
  return res.data;
}
export async function deleteTrainingDateOverride(id: number): Promise<TrainingAvailabilitySettings> {
  const res = await api.delete(`/api/admin/training-availability/overrides/${id}`);
  return res.data;
}

export interface WebsiteStatusInfo {
  configured: boolean;
  status: "active" | "trial" | "trial_expired" | "expired" | "not_configured";
  daysRemaining?: number;
  visitUrl?: string | null;
  isPaid?: boolean;
}
export async function getClubWebsiteStatus(clubId: number): Promise<WebsiteStatusInfo> {
  const res = await api.get(`/api/clubs/${clubId}/website-status`);
  return res.data;
}
export async function getDistrictWebsiteStatus(districtId: number): Promise<WebsiteStatusInfo> {
  const res = await api.get(`/api/districts/${districtId}/website-status`);
  return res.data;
}
export async function getCreditNotifications() {
  const res = await api.get("/api/credit-management/notifications");
  return res.data;
}
export interface ChannelRecipientInfo {
  emailRecipientCount: number;
  emailRemaining: number;
}
export async function getClubRecipientInfo(clubId: number): Promise<ChannelRecipientInfo> {
  const res = await api.get(`/api/recipient-info/club/${clubId}`);
  return res.data;
}
export async function getDistrictRecipientInfo(districtId: number): Promise<ChannelRecipientInfo> {
  const res = await api.get(`/api/recipient-info/district/${districtId}`);
  return res.data;
}
export async function getCreditUsageHistory(params?: Record<string, any>) {
  const res = await api.get("/api/credit-management/usage-history", { params });
  return res.data;
}

// ── Club Mass Emails ────────────────────────────────────────────────
export async function getMassEmailList(clubId: number, params?: Record<string, any>) {
  const res = await api.get(`/api/clubs/${clubId}/mass-emails`, { params });
  return res.data;
}
export async function getMassEmailDetail(clubId: number, id: number) {
  const res = await api.get(`/api/clubs/${clubId}/mass-emails/${id}`);
  return res.data;
}
export async function createMassEmail(clubId: number, data: any) {
  const res = await api.post(`/api/clubs/${clubId}/mass-emails`, data);
  return res.data;
}
export async function updateMassEmail(clubId: number, id: number, data: any) {
  const res = await api.put(`/api/clubs/${clubId}/mass-emails/${id}`, data);
  return res.data;
}
export async function deleteMassEmail(clubId: number, id: number) {
  const res = await api.delete(`/api/clubs/${clubId}/mass-emails/${id}`);
  return res.data;
}
export async function sendMassEmail(clubId: number, id: number) {
  const res = await api.post(`/api/clubs/${clubId}/mass-emails/${id}/send`);
  return res.data;
}
export async function getMassEmailRecipients(clubId: number, id: number) {
  const res = await api.get(`/api/clubs/${clubId}/mass-emails/${id}/recipients`);
  return res.data;
}
export async function getMassEmailRecipientCount(clubId: number, params?: Record<string, any>) {
  const res = await api.get(`/api/clubs/${clubId}/mass-emails/recipient-count`, { params });
  return res.data;
}

// ══════════════════════════════════════════════════════
// DISTRICT MODULE APIs
// ══════════════════════════════════════════════════════

// District Upcoming Events
export async function getDistrictUpcomingEvents(
  districtId: number, page: number = 1, pageSize: number = 20,
  status?: string, search?: string
) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const response = await api.get(`/api/districts/${districtId}/upcoming-events?${params}`);
  return response.data;
}
export async function getDistrictUpcomingEvent(districtId: number, id: number) {
  const response = await api.get(`/api/districts/${districtId}/upcoming-events/${id}`);
  return response.data;
}
export async function createDistrictUpcomingEvent(districtId: number, data: any) {
  const response = await api.post(`/api/districts/${districtId}/upcoming-events`, data);
  return response.data;
}
export async function updateDistrictUpcomingEvent(districtId: number, id: number, data: any) {
  await api.put(`/api/districts/${districtId}/upcoming-events/${id}`, data);
}
export async function deleteDistrictUpcomingEvent(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/upcoming-events/${id}`);
}
export async function uploadDistrictUpcomingEventImage(districtId: number, file: File) {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/districts/${districtId}/upcoming-events/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// District Announcements
export async function getDistrictAnnouncements(
  districtId: number, page: number = 1, pageSize: number = 20,
  status?: string, search?: string
) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const response = await api.get(`/api/districts/${districtId}/announcements?${params}`);
  return response.data;
}
export async function getDistrictAnnouncement(districtId: number, id: number) {
  const response = await api.get(`/api/districts/${districtId}/announcements/${id}`);
  return response.data;
}
export async function createDistrictAnnouncement(districtId: number, data: any) {
  const response = await api.post(`/api/districts/${districtId}/announcements`, data);
  return response.data;
}
export async function updateDistrictAnnouncement(districtId: number, id: number, data: any) {
  await api.put(`/api/districts/${districtId}/announcements/${id}`, data);
}
export async function deleteDistrictAnnouncement(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/announcements/${id}`);
}
export async function uploadDistrictAnnouncementImage(districtId: number, file: File) {
  file = await processImageBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/districts/${districtId}/announcements/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// District Newsletters
export async function getDistrictNewsletters(
  districtId: number, yearId: number, page: number = 1, pageSize: number = 20,
  status?: string, search?: string
) {
  const params = new URLSearchParams({ yearId: String(yearId), page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const response = await api.get(`/api/districts/${districtId}/newsletters?${params}`);
  return response.data;
}
export async function getDistrictNewsletter(districtId: number, id: number) {
  const response = await api.get(`/api/districts/${districtId}/newsletters/${id}`);
  return response.data;
}
export async function createDistrictNewsletter(districtId: number, data: any) {
  const response = await api.post(`/api/districts/${districtId}/newsletters`, data);
  return response.data;
}
export async function updateDistrictNewsletter(districtId: number, id: number, data: any) {
  await api.put(`/api/districts/${districtId}/newsletters/${id}`, data);
}
export async function deleteDistrictNewsletter(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/newsletters/${id}`);
}
export async function uploadDistrictNewsletterFile(districtId: number, file: File) {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/districts/${districtId}/newsletters/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}
export async function getDistrictNewsletterYears(districtId: number) {
  const response = await api.get(`/api/districts/${districtId}/newsletters/years`);
  return response.data;
}

// District Documents
export async function getDistrictDocuments(
  districtId: number, page: number = 1, pageSize: number = 20,
  status?: string, search?: string
) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const response = await api.get(`/api/districts/${districtId}/documents?${params}`);
  return response.data;
}
export async function getDistrictDocument(districtId: number, id: number) {
  const response = await api.get(`/api/districts/${districtId}/documents/${id}`);
  return response.data;
}
export async function createDistrictDocument(districtId: number, data: any) {
  const response = await api.post(`/api/districts/${districtId}/documents`, data);
  return response.data;
}
export async function updateDistrictDocument(districtId: number, id: number, data: any) {
  await api.put(`/api/districts/${districtId}/documents/${id}`, data);
}
export async function deleteDistrictDocument(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/documents/${id}`);
}
export async function uploadDistrictDocumentFile(districtId: number, file: File) {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/api/districts/${districtId}/documents/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// District Greetings
export async function getDistrictGreetingSettings(districtId: number) {
  const response = await api.get(`/api/districts/${districtId}/greetings`);
  return response.data;
}
export async function updateDistrictGreetingSettings(districtId: number, data: any) {
  await api.put(`/api/districts/${districtId}/greetings`, data);
}

// District Weblinks
export async function getDistrictWeblinks(districtId: number, parentId?: number) {
  const params = parentId ? `?parentId=${parentId}` : '';
  const res = await api.get(`/api/districts/${districtId}/weblinks${params}`);
  return res.data;
}
export async function getDistrictWeblinkTree(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/weblinks/tree`);
  return res.data;
}
export async function createDistrictWeblink(districtId: number, data: FormData) {
  const res = await api.post(`/api/districts/${districtId}/weblinks`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function updateDistrictWeblink(districtId: number, weblinkId: number, data: FormData) {
  const res = await api.put(`/api/districts/${districtId}/weblinks/${weblinkId}`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function deleteDistrictWeblink(districtId: number, weblinkId: number) {
  await api.delete(`/api/districts/${districtId}/weblinks/${weblinkId}`);
}
export async function toggleDistrictWeblinkActive(districtId: number, weblinkId: number) {
  await api.put(`/api/districts/${districtId}/weblinks/${weblinkId}/toggle-active`);
}

// District Sub Groups
export async function getDistrictSubGroupDetail(districtId: number, subGroupId: number) {
  const res = await api.get(`/api/districts/${districtId}/sub-groups/${subGroupId}`);
  return res.data;
}
export async function createDistrictSubGroup(districtId: number, data: { yearId: number; groupName: string; memberIds: number[] }) {
  const res = await api.post(`/api/districts/${districtId}/sub-groups`, data);
  return res.data;
}
export async function updateDistrictSubGroup(districtId: number, subGroupId: number, data: { yearId?: number; groupName: string; memberIds: number[] }) {
  const res = await api.put(`/api/districts/${districtId}/sub-groups/${subGroupId}`, data);
  return res.data;
}
export async function deleteDistrictSubGroup(districtId: number, subGroupId: number) {
  await api.delete(`/api/districts/${districtId}/sub-groups/${subGroupId}`);
}
export async function getDistrictSubGroupMembers(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/sub-groups/district-members`);
  return res.data;
}

// District Mass Emails
export async function getDistrictMassEmailList(districtId: number, params?: Record<string, any>) {
  const res = await api.get(`/api/districts/${districtId}/mass-emails`, { params });
  return res.data;
}
export async function getDistrictMassEmailDetail(districtId: number, id: number) {
  const res = await api.get(`/api/districts/${districtId}/mass-emails/${id}`);
  return res.data;
}
export async function createDistrictMassEmail(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/mass-emails`, data);
  return res.data;
}
export async function updateDistrictMassEmail(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/mass-emails/${id}`, data);
  return res.data;
}
export async function deleteDistrictMassEmail(districtId: number, id: number) {
  const res = await api.delete(`/api/districts/${districtId}/mass-emails/${id}`);
  return res.data;
}
export async function sendDistrictMassEmail(districtId: number, id: number) {
  const res = await api.post(`/api/districts/${districtId}/mass-emails/${id}/send`);
  return res.data;
}
export async function getDistrictMassEmailRecipients(districtId: number, id: number) {
  const res = await api.get(`/api/districts/${districtId}/mass-emails/${id}/recipients`);
  return res.data;
}
export async function getDistrictMassEmailRecipientCount(districtId: number, params?: Record<string, any>) {
  const res = await api.get(`/api/districts/${districtId}/mass-emails/recipient-count`, { params });
  return res.data;
}
// Returns { senderEmail } — the exact From-address Brevo will use for mass
// emails. Config-driven server side (Brevo:MassEmailSenderEmail). The compose
// UI reads this so what admins see == what recipients see.
export async function getMassEmailSenderInfo(): Promise<{ senderEmail: string }> {
  const res = await api.get(`/api/mass-emails/sender-info`);
  return res.data;
}

// ===== District Members (Directory) Admin =====
export async function assignDistrictAdmin(
  districtId: number, memberId: number, years?: { yearIds: number[]; allYears: boolean }
) {
  // Body is optional server-side: sending none means the current year only.
  const res = await api.post(`/api/districts/${districtId}/members/${memberId}/assign-admin`, years ?? {});
  return res.data;
}

// sendEmail=false removes the District Admin silently (no notification email).
export async function removeDistrictAdmin(districtId: number, memberId: number, sendEmail = true) {
  const res = await api.post(`/api/districts/${districtId}/members/${memberId}/remove-admin?sendEmail=${sendEmail}`);
  return res.data;
}

// SuperAdmin-only: toggle whether a District Admin can access all clubs of the district.
export async function setDistrictAdminClubAccess(districtId: number, memberId: number, enabled: boolean) {
  const res = await api.post(`/api/districts/${districtId}/members/${memberId}/club-access`, { enabled });
  return res.data;
}

// District Admin (or SuperAdmin): promote a member to District Admin for this district.
// Never grants club access — that stays SuperAdmin-only.
export async function assignDistrictAdminByDistrictAdmin(
  districtId: number, memberId: number, years?: { yearIds: number[]; allYears: boolean }
) {
  const res = await api.post(`/api/district-admin/districts/${districtId}/members/${memberId}/assign-admin`, years ?? {});
  return res.data;
}

// Clubs of a district for the District-Admin club switcher (requires all-clubs access).
export async function getDistrictAllClubsForAdmin(districtId: number): Promise<Array<{ clubId: number; clubName: string; clubRotaryId?: string }>> {
  const res = await api.get(`/api/district-admin/districts/${districtId}/all-clubs`);
  return res.data;
}

// ── District Projects ──────────────────────────────────────────────
export async function getDistrictProjects(districtId: number, params?: Record<string, any>) {
  const res = await api.get(`/api/districts/${districtId}/projects`, { params });
  return res.data;
}
export async function getDistrictProjectAvailableYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/projects/available-years`);
  return res.data;
}
export async function getDistrictEventAvailableYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/district-events/available-years`);
  return res.data;
}
// Year-wise tables: id alone is ambiguous across years — every targeted call takes yearId too.
export async function getDistrictProjectDetail(districtId: number, yearId: number, id: number) {
  const res = await api.get(`/api/districts/${districtId}/projects/${yearId}/${id}`);
  return res.data;
}
export async function createDistrictProject(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/projects`, data);
  return res.data;
}
// Returns null on normal update; ProjectMoveInfo if the date crossed rotary years.
export async function updateDistrictProject(districtId: number, yearId: number, id: number, data: any): Promise<ProjectMoveInfo | null> {
  try {
    await api.put(`/api/districts/${districtId}/projects/${yearId}/${id}`, data);
    return null;
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = (err as any)?.response;
    if (resp?.status === 409 && resp.data?.requiresMove) return resp.data as ProjectMoveInfo;
    throw err;
  }
}
export async function moveDistrictProject(districtId: number, fromYearId: number, id: number, data: any): Promise<{ newYearId: number; newId: number; newYearLabel: string }> {
  const res = await api.post(`/api/districts/${districtId}/projects/${fromYearId}/${id}/move`, data);
  return res.data;
}
export async function deleteDistrictProject(districtId: number, yearId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/projects/${yearId}/${id}`);
}
export async function uploadDistrictProjectPhoto(districtId: number, file: File, strict: boolean = false): Promise<PhotoUploadResponse> {
  file = await processImageBeforeUpload(file);
  const validation = await validateImagePhoto(file, strict);
  if (!validation.ok) throw new Error(validation.error || "Photo failed quality check.");
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/projects/upload${strict ? "?strict=true" : ""}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return { ...validation.info, ...res.data };
}

// ── District Events ────────────────────────────────────────────────
export async function getDistrictEventsList(districtId: number, params?: Record<string, any>) {
  const res = await api.get(`/api/districts/${districtId}/district-events`, { params });
  return res.data;
}
export async function getDistrictEventDetail(districtId: number, yearId: number, id: number) {
  const res = await api.get(`/api/districts/${districtId}/district-events/${yearId}/${id}`);
  return res.data;
}
export async function createDistrictEventItem(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/district-events`, data);
  return res.data;
}
// Returns null on normal update; ProjectMoveInfo if the date crossed rotary years.
export async function updateDistrictEventItem(districtId: number, yearId: number, id: number, data: any): Promise<ProjectMoveInfo | null> {
  try {
    await api.put(`/api/districts/${districtId}/district-events/${yearId}/${id}`, data);
    return null;
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = (err as any)?.response;
    if (resp?.status === 409 && resp.data?.requiresMove) return resp.data as ProjectMoveInfo;
    throw err;
  }
}
export async function moveDistrictEvent(districtId: number, fromYearId: number, id: number, data: any): Promise<{ newYearId: number; newId: number; newYearLabel: string }> {
  const res = await api.post(`/api/districts/${districtId}/district-events/${fromYearId}/${id}/move`, data);
  return res.data;
}
export async function deleteDistrictEventItem(districtId: number, yearId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/district-events/${yearId}/${id}`);
}
export async function uploadDistrictEventPhoto(districtId: number, file: File, strict: boolean = false): Promise<PhotoUploadResponse> {
  file = await processImageBeforeUpload(file);
  const validation = await validateImagePhoto(file, strict);
  if (!validation.ok) throw new Error(validation.error || "Photo failed quality check.");
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/district-events/upload${strict ? "?strict=true" : ""}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return { ...validation.info, ...res.data };
}

// ===== DISTRICT WEBSITE DATA: BANNERS =====
export async function getDistrictBanners(districtId: number, yearId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/banners`, { params: { yearId } });
  return res.data;
}
export async function createDistrictBanner(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/website-data/banners`, data);
  return res.data;
}
export async function updateDistrictBanner(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/website-data/banners/${id}`, data);
  return res.data;
}
export async function deleteDistrictBanner(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/website-data/banners/${id}`);
}
export async function uploadDistrictBannerImage(districtId: number, file: File, strict: boolean = false): Promise<PhotoUploadResponse> {
  file = await processImageBeforeUpload(file);
  const validation = await validateImagePhoto(file, strict);
  if (!validation.ok) throw new Error(validation.error || "Photo failed quality check.");
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/website-data/banners/upload${strict ? "?strict=true" : ""}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return { ...validation.info, ...res.data };
}
export async function uploadDistrictBannerDocument(districtId: number, file: File): Promise<{ path: string }> {
  file = await processDocumentBeforeUpload(file);
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/website-data/banners/upload-document`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}

// ===== DISTRICT WEBSITE DATA: ADVERTISEMENTS =====
export async function getDistrictAdvertisements(districtId: number, yearId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/advertisements`, { params: { yearId } });
  return res.data;
}
export async function createDistrictAdvertisement(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/website-data/advertisements`, data);
  return res.data;
}
export async function updateDistrictAdvertisement(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/website-data/advertisements/${id}`, data);
  return res.data;
}
export async function deleteDistrictAdvertisement(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/website-data/advertisements/${id}`);
}
export async function uploadDistrictAdvertisementImage(districtId: number, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/website-data/advertisements/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function uploadDistrictAdvertisementDocument(districtId: number, file: File): Promise<{ path: string }> {
  file = await processDocumentBeforeUpload(file);
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/website-data/advertisements/upload-document`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}

// ===== DISTRICT WEBSITE DATA: SOCIAL LINKS =====
export async function getDistrictSocialLinks(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/social-links`);
  return res.data;
}
export async function createDistrictSocialLink(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/website-data/social-links`, data);
  return res.data;
}
export async function updateDistrictSocialLink(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/website-data/social-links/${id}`, data);
  return res.data;
}
export async function deleteDistrictSocialLink(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/website-data/social-links/${id}`);
}
export async function reorderDistrictSocialLinksAll(districtId: number, orderedIds: number[]): Promise<void> {
  await api.put(`/api/districts/${districtId}/website-data/social-links/reorder-all`, { orderedIds });
}
export async function getDistrictBannerAvailableYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/banners/available-years`);
  return res.data;
}
export async function getDistrictAdAvailableYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/advertisements/available-years`);
  return res.data;
}
export async function getClubBannerAvailableYears(clubId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const res = await api.get(`/api/clubs/${clubId}/website-data/banners/available-years`);
  return res.data;
}
export async function getClubContactAvailableYears(clubId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const res = await api.get(`/api/clubs/${clubId}/website-data/contact_details/available-years`);
  return res.data;
}
export async function getClubAdvertisementAvailableYears(clubId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const res = await api.get(`/api/clubs/${clubId}/website-data/advertisements/available-years`);
  return res.data;
}

// ===== DISTRICT WEBSITE DATA: LOGO =====
export async function getDistrictLogo(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/logo`);
  return res.data;
}
export async function uploadDistrictWebsiteLogo(districtId: number, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/website-data/logo/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}

// ===== DISTRICT WEBSITE DATA: MENUS =====
export async function getDistrictMenus(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/menus`);
  return res.data;
}
export async function createDistrictMenu(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/website-data/menus`, data);
  return res.data;
}
export async function updateDistrictMenu(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/website-data/menus/${id}`, data);
  return res.data;
}
// Active/Inactive only — also allowed on default menus, which updateDistrictMenu refuses.
export async function setDistrictMenuActive(districtId: number, id: number, isActive: boolean) {
  await api.put(`/api/districts/${districtId}/website-data/menus/${id}/active`, { isActive });
}
export async function deleteDistrictMenu(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/website-data/menus/${id}`);
}
export async function uploadDistrictMenuDocument(districtId: number, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/website-data/menus/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function reorderDistrictMenus(districtId: number, id1: number, id2: number) {
  await api.post(`/api/districts/${districtId}/website-data/menus/reorder`, { id1, id2 });
}
// Drag-and-drop full-list reorder.
export async function reorderDistrictMenusBulk(districtId: number, orderedIds: number[]) {
  await api.put(`/api/districts/${districtId}/website-data/menus/reorder-bulk`, { orderedIds });
}

// ===== DISTRICT WEBSITE DATA: SUB-MENUS =====
export async function getDistrictSubMenus(districtId: number, menuId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/menus/${menuId}/submenus`);
  return res.data;
}
export async function createDistrictSubMenu(districtId: number, menuId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/website-data/menus/${menuId}/submenus`, data);
  return res.data;
}
export async function updateDistrictSubMenu(districtId: number, menuId: number, id: number, data: any) {
  await api.put(`/api/districts/${districtId}/website-data/menus/${menuId}/submenus/${id}`, data);
}
export async function deleteDistrictSubMenu(districtId: number, menuId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/website-data/menus/${menuId}/submenus/${id}`);
}
export async function reorderDistrictSubMenus(districtId: number, menuId: number, id1: number, id2: number) {
  await api.post(`/api/districts/${districtId}/website-data/menus/${menuId}/submenus/reorder`, { id1, id2 });
}
export async function reorderDistrictSubMenusBulk(districtId: number, menuId: number, orderedIds: number[]) {
  await api.put(`/api/districts/${districtId}/website-data/menus/${menuId}/submenus/reorder-bulk`, { orderedIds });
}

// ===== DISTRICT WEBSITE DATA: THEME =====
export interface DistrictWebsiteTheme { hasWebsite: boolean; themeKey: string; themes: string[] }
export async function getDistrictWebsiteTheme(districtId: number): Promise<DistrictWebsiteTheme> {
  const res = await api.get(`/api/districts/${districtId}/website-data/theme`);
  return res.data;
}
export async function updateDistrictWebsiteTheme(districtId: number, themeKey: string) {
  const res = await api.put(`/api/districts/${districtId}/website-data/theme`, { themeKey });
  return res.data;
}

// ===== DISTRICT WEBSITE DATA: ABOUT =====
export async function getDistrictAbout(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/about`);
  return res.data;
}
export async function createDistrictAbout(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/website-data/about`, data);
  return res.data;
}
export async function updateDistrictAbout(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/website-data/about/${id}`, data);
  return res.data;
}
export async function deleteDistrictAbout(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/website-data/about/${id}`);
}
export async function uploadDistrictAboutImage(districtId: number, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(`/api/districts/${districtId}/website-data/about/upload-image`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}

// ===== DISTRICT WEBSITE DATA: CONTACT DETAILS =====
export async function getDistrictContactDetails(districtId: number, yearId?: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/contact-details`, { params: yearId ? { yearId } : {} });
  return res.data;
}
export async function createDistrictContactDetail(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/website-data/contact-details`, data);
  return res.data;
}
export async function updateDistrictContactDetail(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/website-data/contact-details/${id}`, data);
  return res.data;
}
export async function deleteDistrictContactDetail(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/website-data/contact-details/${id}`);
}
export async function getDistrictContactDetailAvailableYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/website-data/contact-details/available-years`);
  return res.data;
}

// ── District Committee ────────────────────────────────────────────────
export async function searchDistrictCommitteeMembers(districtId: number, search: string) {
  const res = await api.get(`/api/districts/${districtId}/committee/search-members`, { params: { search } });
  return res.data;
}
export async function uploadCommitteePhoto(
  districtId: number,
  file: File,
  isMember?: boolean,
  clubId?: number | null,
) {
  const formData = new FormData();
  formData.append("file", file);
  const params: Record<string, any> = {};
  if (isMember !== undefined) params.isMember = isMember;
  if (clubId != null) params.clubId = clubId;
  const res = await api.post(`/api/districts/${districtId}/committee/upload-photo`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    params,
  });
  return res.data;
}
// Committee Members (Level 1) — paginated PagedResult shape.
// Backward-compat: callers passing only (districtId, yearId) still work via defaults.
export async function getCommitteeMembers(districtId: number, yearId?: number, page: number = 1, pageSize: number = 20, search?: string) {
  const res = await api.get(`/api/districts/${districtId}/committee/members`, { params: { yearId, page, pageSize, search } });
  return res.data;
}
export async function getCommitteeMemberAvailableYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/committee/members/available-years`);
  return res.data;
}
export async function createCommitteeMember(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/committee/members`, data);
  return res.data;
}
export async function updateCommitteeMember(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/committee/members/${id}`, data);
  return res.data;
}
export async function deleteCommitteeMember(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/committee/members/${id}`);
}
// Non-sync cascade (Phase 4): members soft-deleted because their club went non-sync.
export async function getNonSyncRemovedCommitteeMembers(districtId: number, yearId?: number) {
  const res = await api.get(`/api/districts/${districtId}/committee/members/non-sync-removed`, { params: { yearId } });
  return res.data;
}
export async function addCommitteeMemberAsNonMember(districtId: number, id: number) {
  const res = await api.post(`/api/districts/${districtId}/committee/members/${id}/add-as-non-member`, {});
  return res.data;
}
// Committee Groups (Level 2) — paginated PagedResult shape.
export async function getCommitteeGroups(districtId: number, yearId?: number, page: number = 1, pageSize: number = 20, search?: string) {
  const res = await api.get(`/api/districts/${districtId}/committee/groups`, { params: { yearId, page, pageSize, search } });
  return res.data;
}
// Single-group lookup — fast indexed read; use this instead of paginating 200 groups for a name.
export async function getCommitteeGroupById(districtId: number, groupId: number) {
  const { data } = await api.get(`/api/districts/${districtId}/committee/groups/${groupId}`);
  return data;
}
export async function getCommitteeGroupAvailableYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/committee/groups/available-years`);
  return res.data;
}
export async function createCommitteeGroup(districtId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/committee/groups`, data);
  return res.data;
}
export async function updateCommitteeGroup(districtId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/committee/groups/${id}`, data);
  return res.data;
}
export async function deleteCommitteeGroup(districtId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/committee/groups/${id}`);
}
// Group Members — paginated PagedResult shape.
export async function getGroupMembers(districtId: number, groupId: number, page: number = 1, pageSize: number = 20, search?: string) {
  const res = await api.get(`/api/districts/${districtId}/committee/groups/${groupId}/members`, { params: { page, pageSize, search } });
  return res.data;
}
export async function createGroupMember(districtId: number, groupId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/committee/groups/${groupId}/members`, data);
  return res.data;
}
export async function updateGroupMember(districtId: number, groupId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/committee/groups/${groupId}/members/${id}`, data);
  return res.data;
}
export async function deleteGroupMember(districtId: number, groupId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/committee/groups/${groupId}/members/${id}`);
}
// Non-sync cascade (Phase 4): group members soft-deleted because their club went non-sync.
export async function getNonSyncRemovedGroupMembers(districtId: number, groupId: number) {
  const res = await api.get(`/api/districts/${districtId}/committee/groups/${groupId}/members/non-sync-removed`);
  return res.data;
}
export async function addGroupMemberAsNonMember(districtId: number, groupId: number, id: number) {
  const res = await api.post(`/api/districts/${districtId}/committee/groups/${groupId}/members/${id}/add-as-non-member`, {});
  return res.data;
}
// Sub Groups (Level 3)
export async function getCommitteeSubGroups(districtId: number, groupId: number) {
  const res = await api.get(`/api/districts/${districtId}/committee/groups/${groupId}/sub-groups`);
  return res.data;
}
export async function createCommitteeSubGroup(districtId: number, groupId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/committee/groups/${groupId}/sub-groups`, data);
  return res.data;
}
export async function updateCommitteeSubGroup(districtId: number, groupId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/committee/groups/${groupId}/sub-groups/${id}`, data);
  return res.data;
}
export async function deleteCommitteeSubGroup(districtId: number, groupId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/committee/groups/${groupId}/sub-groups/${id}`);
}
// Sub Group Members
export async function getSubGroupCommitteeMembers(districtId: number, subGroupId: number) {
  const res = await api.get(`/api/districts/${districtId}/committee/sub-groups/${subGroupId}/members`);
  return res.data;
}
export async function createSubGroupCommitteeMember(districtId: number, subGroupId: number, data: any) {
  const res = await api.post(`/api/districts/${districtId}/committee/sub-groups/${subGroupId}/members`, data);
  return res.data;
}
export async function updateSubGroupCommitteeMember(districtId: number, subGroupId: number, id: number, data: any) {
  const res = await api.put(`/api/districts/${districtId}/committee/sub-groups/${subGroupId}/members/${id}`, data);
  return res.data;
}
export async function deleteSubGroupCommitteeMember(districtId: number, subGroupId: number, id: number) {
  await api.delete(`/api/districts/${districtId}/committee/sub-groups/${subGroupId}/members/${id}`);
}
// Non-sync cascade (Phase 4): sub-group members soft-deleted because their club went non-sync.
export async function getNonSyncRemovedSubGroupMembers(districtId: number, subGroupId: number) {
  const res = await api.get(`/api/districts/${districtId}/committee/sub-groups/${subGroupId}/members/non-sync-removed`);
  return res.data;
}
export async function addSubGroupMemberAsNonMember(districtId: number, subGroupId: number, id: number) {
  const res = await api.post(`/api/districts/${districtId}/committee/sub-groups/${subGroupId}/members/${id}/add-as-non-member`, {});
  return res.data;
}

// Reorder (drag & drop)
export async function reorderCommitteeMembers(districtId: number, orderedIds: number[]) {
  await api.put(`/api/districts/${districtId}/committee/members/reorder`, { orderedIds });
}
export async function reorderCommitteeGroups(districtId: number, orderedIds: number[]) {
  await api.put(`/api/districts/${districtId}/committee/groups/reorder`, { orderedIds });
}
export async function reorderGroupMembers(districtId: number, groupId: number, orderedIds: number[]) {
  await api.put(`/api/districts/${districtId}/committee/groups/${groupId}/members/reorder`, { orderedIds });
}
export async function reorderSubGroups(districtId: number, groupId: number, orderedIds: number[]) {
  await api.put(`/api/districts/${districtId}/committee/groups/${groupId}/sub-groups/reorder`, { orderedIds });
}
export async function reorderSubGroupMembers(districtId: number, subGroupId: number, orderedIds: number[]) {
  await api.put(`/api/districts/${districtId}/committee/sub-groups/${subGroupId}/members/reorder`, { orderedIds });
}

// ── Membership fields (build spec 3.12, flag membership_fields): Foundation designations, committee documents ──
export type DesignationType = "PHF" | "MAJOR_DONOR" | "BEQUEST_SOCIETY";
export interface MemberDesignation {
  id: number;
  type: DesignationType;
  level: number | null;
  label: string;
  awardedDate: string;
  notes: string | null;
  source: string;
}
export interface DesignationReportRow {
  memberId: number;
  memberName: string;
  clubName: string;
  level: number | null;
  label: string;
  awardedDate: string;
}
export interface CommitteeDocument {
  id: number;
  title: string;
  originalFileName: string | null;
  url: string;
  createdDate: string;
}
/** A committee (groupId) or one of its sub-committees (subGroupId). */
export type CommitteeRef = { groupId: number } | { subGroupId: number };

export async function getMemberDesignations(memberId: number): Promise<MemberDesignation[]> {
  return (await api.get(`/api/members/${memberId}/foundation-designations`)).data;
}
export async function addMemberDesignation(
  memberId: number,
  body: { type: DesignationType; level: number | null; awardedDate: string; notes: string | null },
): Promise<{ id: number }> {
  return (await api.post(`/api/members/${memberId}/foundation-designations`, body)).data;
}
export async function removeMemberDesignation(memberId: number, id: number): Promise<void> {
  await api.delete(`/api/members/${memberId}/foundation-designations/${id}`);
}
export async function getDesignationReport(
  scope: "clubs" | "districts", scopeId: number, type: DesignationType, minLevel: number,
): Promise<DesignationReportRow[]> {
  return (await api.get(`/api/${scope}/${scopeId}/foundation-designations`, { params: { type, minLevel } })).data;
}
export async function getCommitteeDocuments(districtId: number, committee: CommitteeRef): Promise<CommitteeDocument[]> {
  return (await api.get(`/api/districts/${districtId}/committee/documents`, { params: committee })).data;
}
export async function uploadCommitteeDocument(districtId: number, committee: CommitteeRef, title: string, file: File): Promise<{ id: number }> {
  file = await processDocumentBeforeUpload(file);
  const formData = new FormData();
  for (const [k, v] of Object.entries(committee)) formData.append(k, String(v));
  formData.append("title", title);
  formData.append("file", file);
  const response = await api.post(`/api/districts/${districtId}/committee/documents`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}
export async function removeCommitteeDocument(districtId: number, id: number): Promise<void> {
  await api.delete(`/api/districts/${districtId}/committee/documents/${id}`);
}

// ── Engagement (build list #26-#28, flag engagement): milestones, PHF highlights, spotlight cards ──
export type SpotlightStatus = "pending" | "approved" | "rejected";
export interface SpotlightCard {
  id: number;
  /** TARGET: the club reached a target (target celebration); the club stands in for the member. */
  type: "MILESTONE" | "PHF" | "TARGET";
  label: string;
  text: string;
  memberId: number | null;
  memberName: string;
  clubId: number;
  clubName: string | null;
  photoUrl: string | null;
  occurredOn: string;
  createdDate: string;
  cardStatus: SpotlightStatus;
  cardDecidedDate: string | null;
}
export interface EngagementSettings {
  milestoneYears: number[];
  governorMessage: string | null;
  /** This Rotary year's District Governor, who signs the Governor message; null when none is set. */
  governorName?: string | null;
}

export async function getSpotlightCards(
  scope: "clubs" | "districts", scopeId: number, status: SpotlightStatus | "",
): Promise<SpotlightCard[]> {
  return (await api.get(`/api/${scope}/${scopeId}/engagement/cards`, { params: status ? { status } : {} })).data;
}
/** The card as a PNG. download=true is refused until the card is approved. */
export async function getSpotlightCardImage(id: number, download = false): Promise<Blob> {
  return (await api.get(`/api/engagement/spotlight-cards/${id}/image`, { params: { download }, responseType: "blob" })).data;
}
export async function decideSpotlightCard(id: number, decision: "approve" | "reject"): Promise<{ id: number; cardStatus: SpotlightStatus }> {
  return (await api.post(`/api/engagement/spotlight-cards/${id}/${decision}`)).data;
}
export async function getEngagementSettings(districtId: number): Promise<EngagementSettings> {
  return (await api.get(`/api/districts/${districtId}/engagement/settings`)).data;
}
export async function saveEngagementSettings(
  districtId: number, body: { milestoneYears: number[]; governorMessage: string | null },
): Promise<EngagementSettings> {
  return (await api.put(`/api/districts/${districtId}/engagement/settings`, body)).data;
}

// ── Escalation alerts (B.1 #32, flag escalation): the district's rules and its alert log ──
export type EscalationRule = "target" | "meetings";
export type EscalationEmailStatus = "sent" | "no_email" | "no_recipient" | "opted_out";
export interface EscalationRules {
  /** red, or amber (amber or red); null: the target rule is off */
  targetStatus: "red" | "amber" | null;
  /** fire when a finished month has at least this many meetings fewer than required; null: off */
  meetingShortfall: number | null;
  agDelayDays: number;
  dgDelayDays: number;
}
export interface EscalationSettings extends EscalationRules {
  /** false: the rule waits for the Live target dashboard / Meetings module to be switched on */
  targetRuleActive: boolean;
  meetingRuleActive: boolean;
}
export interface EscalationAlert {
  id: number;
  clubId: number;
  clubName: string | null;
  rule: EscalationRule;
  /** YYYY-MM */
  period: string;
  level: number;
  role: string;
  memberId: number | null;
  recipientName: string | null;
  reason: string;
  emailStatus: EscalationEmailStatus;
  createdDate: string;
}

export async function getEscalationSettings(districtId: number): Promise<EscalationSettings> {
  return (await api.get(`/api/districts/${districtId}/escalation/settings`)).data;
}
export async function saveEscalationSettings(districtId: number, rules: EscalationRules): Promise<EscalationSettings> {
  return (await api.put(`/api/districts/${districtId}/escalation/settings`, rules)).data;
}
export async function getEscalationAlerts(districtId: number, rule: EscalationRule | ""): Promise<EscalationAlert[]> {
  return (await api.get(`/api/districts/${districtId}/escalation/alerts`, { params: rule ? { rule } : {} })).data;
}

// ── District Clubs View ───────────────────────────────────────────────
export async function getClubInfoForDistrict(districtId: number, clubId: number) {
  const res = await api.get(`/api/districts/${districtId}/clubs/${clubId}/info`);
  return res.data;
}
export async function getClubMemberDetail(districtId: number, clubId: number, memberId: number) {
  const res = await api.get(`/api/districts/${districtId}/clubs/${clubId}/member-detail/${memberId}`);
  return res.data;
}
export async function getClubProjectsView(districtId: number, clubId: number, yearId?: number, moduleKey?: string) {
  const res = await api.get(`/api/districts/${districtId}/clubs/${clubId}/projects-view`, { params: { yearId, moduleKey } });
  return res.data;
}
export async function getClubProjectsAvailableYears(districtId: number, clubId: number) {
  const res = await api.get(`/api/districts/${districtId}/clubs/${clubId}/projects-view/available-years`);
  return res.data;
}

// ── District Club Monthly Report ──────────────────────────────────────
export async function getDistrictReportYears(districtId: number) {
  const res = await api.get(`/api/districts/${districtId}/club-monthly-report/years`);
  return res.data;
}
export async function getDistrictReportMonths(districtId: number, yearId: number) {
  const res = await api.get(`/api/districts/${districtId}/club-monthly-report/months/${yearId}`);
  return res.data;
}
export async function getDistrictReportMonthDetail(districtId: number, yearId: number, month: number) {
  const res = await api.get(`/api/districts/${districtId}/club-monthly-report/month-detail/${yearId}/${month}`);
  return res.data;
}
export async function sendReportReminder(districtId: number, yearId: number, month: number, data: { sendEmail: boolean; agMemberId?: number | null }) {
  const res = await api.post(`/api/districts/${districtId}/club-monthly-report/send-reminder/${yearId}/${month}`, data);
  return res.data;
}

// ── AG (Assistant Governor) ───────────────────────────────────────────
// AG is now year-scoped: every list / save / delete passes yearId so the same
// member can be AG of different clubs across rotary years independently.
export async function getAGs(districtId: number, yearId?: number) {
  const res = await api.get(`/api/districts/${districtId}/ag`, { params: { yearId } });
  return res.data;
}
// Returns only years that have at least one AG record for this district —
// used to populate the year selector with no empty options.
export async function getAGYearsWithData(districtId: number): Promise<{ id: number; yearLabel: string; isCurrent: boolean }[]> {
  const res = await api.get(`/api/districts/${districtId}/ag/years-with-data`);
  return res.data;
}
export async function getAvailableClubsForAG(districtId: number, excludeMemberId?: number, yearId?: number) {
  const res = await api.get(`/api/districts/${districtId}/ag/available-clubs`, { params: { excludeMemberId, yearId } });
  return res.data;
}
export async function searchMembersForAG(districtId: number, search: string, yearId?: number) {
  const res = await api.get(`/api/districts/${districtId}/ag/search-members`, { params: { search, yearId } });
  return res.data;
}
export async function saveAG(districtId: number, data: { memberId: number; clubIds: number[]; oldMemberId?: number; yearId: number }) {
  const res = await api.post(`/api/districts/${districtId}/ag`, data);
  return res.data;
}
export async function deleteAGByMember(districtId: number, memberId: number, yearId?: number) {
  await api.delete(`/api/districts/${districtId}/ag/member/${memberId}`, { params: { yearId } });
}

// District Citation
export async function getCitationActivities() {
  const { data } = await api.get("/api/district-modules/citation/activities");
  return data;
}

export async function getCitationMeetingTypes() {
  const { data } = await api.get("/api/district-modules/citation/meeting-types");
  return data;
}

export async function getCitationAreaOfFocus(moduleKey?: string) {
  const { data } = await api.get("/api/district-modules/citation/area-of-focus", { params: { moduleKey } });
  return data;
}

export async function getCitationCategoriesByDistrict(districtId: number, yearId?: number) {
  const { data } = await api.get(`/api/district-modules/${districtId}/citation/categories`, { params: { yearId } });
  return data;
}

export async function createCitationCategory(districtId: number, dto: any) {
  const { data } = await api.post(`/api/district-modules/${districtId}/citation/categories`, dto);
  return data;
}

export async function updateCitationCategory(districtId: number, id: number, dto: any) {
  const { data } = await api.put(`/api/district-modules/${districtId}/citation/categories/${id}`, dto);
  return data;
}

export async function deleteCitationCategory(districtId: number, id: number) {
  await api.delete(`/api/district-modules/${districtId}/citation/categories/${id}`);
}

export async function getCitationDescription(districtId: number, yearId: number) {
  const { data } = await api.get(`/api/district-modules/${districtId}/citation/description`, { params: { yearId } });
  return data;
}

export async function saveCitationDescription(districtId: number, dto: any) {
  const { data } = await api.post(`/api/district-modules/${districtId}/citation/description`, dto);
  return data;
}

export async function getCitationAutoQuestions(districtId: number, yearId?: number) {
  const { data } = await api.get(`/api/district-modules/${districtId}/citation/auto-questions`, { params: { yearId } });
  return data;
}

export async function createCitationAutoQuestion(districtId: number, dto: any) {
  const { data } = await api.post(`/api/district-modules/${districtId}/citation/auto-questions`, dto);
  return data;
}

export async function updateCitationAutoQuestion(districtId: number, id: number, dto: any) {
  const { data } = await api.put(`/api/district-modules/${districtId}/citation/auto-questions/${id}`, dto);
  return data;
}

export async function deleteCitationAutoQuestion(districtId: number, id: number) {
  await api.delete(`/api/district-modules/${districtId}/citation/auto-questions/${id}`);
}

export async function getCitationManualCriteria(districtId: number, yearId?: number) {
  const { data } = await api.get(`/api/district-modules/${districtId}/citation/manual-criteria`, { params: { yearId } });
  return data;
}

export async function createCitationManualCriteria(districtId: number, dto: any) {
  const { data } = await api.post(`/api/district-modules/${districtId}/citation/manual-criteria`, dto);
  return data;
}

export async function updateCitationManualCriteria(districtId: number, id: number, dto: any) {
  const { data } = await api.put(`/api/district-modules/${districtId}/citation/manual-criteria/${id}`, dto);
  return data;
}

export async function deleteCitationManualCriteria(districtId: number, id: number) {
  await api.delete(`/api/district-modules/${districtId}/citation/manual-criteria/${id}`);
}

export async function getCitationClubPoints(districtId: number, yearId: number) {
  const { data } = await api.get(`/api/district-modules/${districtId}/citation/club-points`, { params: { yearId } });
  return data;
}

export async function downloadCitationSingleClubReport(districtId: number, clubId: number, yearId: number) {
  const { data } = await api.get(`/api/district-modules/${districtId}/citation/club-report/${clubId}`, {
    params: { yearId },
    responseType: "blob",
  });
  return data;
}

export async function downloadCitationClubReport(districtId: number, yearId: number) {
  const { data } = await api.get(`/api/district-modules/${districtId}/citation/club-report`, {
    params: { yearId },
    responseType: "blob",
  });
  return data;
}

export async function getCitationAvailableYears(districtId: number) {
  const { data } = await api.get(`/api/district-modules/${districtId}/citation/available-years`);
  return data;
}

// Club Citation
export async function getClubCitation(clubId: number, districtId: number, yearId?: number | null) {
  // yearId is optional — when omitted the backend defaults to the current
  // rotary year. The dashboard V2 page passes the global topbar yearId so
  // the citation total matches the Overview "Citation Score" card.
  const params: Record<string, number> = { districtId };
  if (yearId) params.yearId = yearId;
  const { data } = await api.get(`/api/clubs/${clubId}/citation`, { params });
  return data;
}

export async function saveClubManualEntries(clubId: number, entries: any[]) {
  const { data } = await api.post(`/api/clubs/${clubId}/citation/save-manual`, entries);
  return data;
}

export async function refreshClubAutoPoints(clubId: number, districtId: number) {
  const { data } = await api.post(`/api/clubs/${clubId}/citation/refresh-auto`, null, { params: { districtId } });
  return data;
}

// Mass-email rich-text body image host. Returns { url } — an ABSOLUTE public URL
// (e.g. https://portal.example.org/API/uploads/mass-email/<file>) that email clients
// can load. Used by RichTextEditor's image button instead of inline base64.
export async function uploadMassEmailImage(file: File | Blob, filename = "image.png"): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append("file", file, (file as File).name || filename);
  const { data } = await api.post(`/api/mass-email/image`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// ── Club Report — Word .docx downloads (Avenue of Service Raw Data + Annual Club Service Raw Data)
export async function downloadClubReportWord(
  clubId: number,
  yearId: number,
  slug: "avenue-of-service-raw-data" | "annual-club-service-raw-data" | "annual-report",
  baseFileName: string,
) {
  const response = await api.get(`/api/clubs/${clubId}/club-report/${slug}`, {
    params: { yearId },
    responseType: "blob",
    timeout: 300000, // Word report with embedded photos is slow — allow up to 5 minutes (default 30s trips).
  });
  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseFileName}_${fileTimestamp()}.docx`;
  link.click();
  window.URL.revokeObjectURL(url);
}

// ── Login Announcements ──
export async function getLoginAnnouncements() {
  const { data } = await api.get("/api/login-announcements");
  return data;
}
export async function getLoginAnnouncement(id: number) {
  const { data } = await api.get(`/api/login-announcements/${id}`);
  return data;
}
export interface LoginAnnouncementPayload {
  content: string;
  isActive: boolean;
  targetRoles: string[];
  targetFilters: Record<string, string>;
  targetLocations: { zoneIds: number[]; districtIds: number[]; clubIds: number[] };
}
export async function createLoginAnnouncement(payload: LoginAnnouncementPayload) {
  const { data } = await api.post("/api/login-announcements", payload);
  return data;
}
export async function updateLoginAnnouncement(id: number, payload: LoginAnnouncementPayload) {
  const { data } = await api.put(`/api/login-announcements/${id}`, payload);
  return data;
}
export async function toggleLoginAnnouncement(id: number) {
  const { data } = await api.put(`/api/login-announcements/${id}/toggle`);
  return data;
}
export async function deleteLoginAnnouncement(id: number) {
  const { data } = await api.delete(`/api/login-announcements/${id}`);
  return data;
}
// Every active, un-acknowledged announcement for the user's roles; currentRole's ones come first.
export async function getActiveLoginAnnouncement(currentRole?: string) {
  const { data } = await api.get("/api/login-announcements/active", { params: currentRole ? { currentRole } : undefined });
  return data;
}
export async function acknowledgeLoginAnnouncements(ids: number[]) {
  const { data } = await api.post("/api/login-announcements/acknowledge", { ids });
  return data;
}
export async function acknowledgeLoginAnnouncement(id: number) {
  const { data } = await api.post(`/api/login-announcements/${id}/acknowledge`);
  return data;
}

// ── District Governors ──
export async function getDistrictGovernors(districtId?: number, yearId?: number) {
  const { data } = await api.get("/api/district-governors", { params: { districtId, yearId } });
  return data;
}
export async function getDistrictGovernor(id: number) {
  const { data } = await api.get(`/api/district-governors/${id}`);
  return data;
}
export async function createDistrictGovernor(payload: any) {
  const { data } = await api.post("/api/district-governors", payload);
  return data;
}
export async function updateDistrictGovernor(id: number, payload: any) {
  const { data } = await api.put(`/api/district-governors/${id}`, payload);
  return data;
}
export async function deleteDistrictGovernor(id: number) {
  const { data } = await api.delete(`/api/district-governors/${id}`);
  return data;
}

// District Awards activation flag (per district + year). Read by anyone; only SuperAdmin can set.
export async function getDistrictAwardsConfig(districtId: number, yearId: number): Promise<{ isEnabled: boolean }> {
  const { data } = await api.get(`/api/districts/${districtId}/awards-config`, { params: { yearId } });
  return data;
}
export async function setDistrictAwardsConfig(districtId: number, yearId: number, isEnabled: boolean): Promise<void> {
  await api.put(`/api/districts/${districtId}/awards-config`, { yearId, isEnabled });
}
// ── District Awards: SuperAdmin-only "Clear all clubs points" (+ Restore) for one district+year ──
export interface AwardsClearStatus {
  isSuperAdmin: boolean; liveEntryCount: number; liveClubCount: number; canClear: boolean; canRestore: boolean;
  lastClearedDate: string | null; lastClearedCount: number;
}
export async function getAwardsClearStatus(districtId: number, yearId: number): Promise<AwardsClearStatus> {
  const { data } = await api.get(`/api/districts/${districtId}/awards-clear-status`, { params: { yearId } });
  return data;
}
export async function clearAwardsPoints(districtId: number, yearId: number): Promise<{ message: string; clearedCount: number; emailedTo: string[] }> {
  const { data } = await api.post(`/api/districts/${districtId}/awards-clear`, null, { params: { yearId } });
  return data;
}
export async function restoreAwardsPoints(districtId: number, yearId: number): Promise<{ message: string; restoredCount: number }> {
  const { data } = await api.post(`/api/districts/${districtId}/awards-restore`, null, { params: { yearId } });
  return data;
}
// Photo for a District Governor who is not a member of any club (a member's photo comes from
// their own profile). Returns the stored filename; build the URL with districtGovernorPhotoUrl.
export async function uploadDistrictGovernorPhoto(file: File): Promise<{ path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post("/api/district-governors/upload-photo", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
export const DISTRICT_GOVERNOR_PHOTO_PREFIX = "/Documents/WebsiteData/District_Governor/";
// The value is either a bare filename (just uploaded) or a rooted path (loaded from a record,
// which for a member is /Documents/directory/...). Both must render.
export function districtGovernorPhotoUrl(v: string | null | undefined): string {
  if (!v) return "";
  if (v.startsWith("http") || v.startsWith("/")) return getPhotoUrl(v);
  return `${API_BASE_URL}${DISTRICT_GOVERNOR_PHOTO_PREFIX}${v}`;
}
export async function searchDistrictGovernorMembers(search: string) {
  const { data } = await api.get("/api/district-governors/search-members", { params: { search } });
  return data;
}
// ── Club Report ──
export async function getClubReport(clubId: number, yearId: number) {
  const { data } = await api.get(`/api/clubs/${clubId}/club-report`, { params: { yearId } });
  return data;
}
export async function getClubReportAvailableYears(clubId: number) {
  const { data } = await api.get(`/api/clubs/${clubId}/club-report/available-years`);
  return data;
}

// Attendance (Member Wise) MATRIX — rows = members, columns = events, cell = present/absent.
export interface AttendanceMatrixEvent { id: number; name: string; dateTime: string | null; }
export interface AttendanceMatrixMember { memberName: string; present: boolean[]; }
export interface AttendanceMatrixPayload {
  clubName: string;
  yearLabel: string;
  events: AttendanceMatrixEvent[];
  members: AttendanceMatrixMember[];
}
export async function getClubAttendanceMatrix(clubId: number, yearId: number): Promise<AttendanceMatrixPayload> {
  const { data } = await api.get(`/api/clubs/${clubId}/club-report/attendance-matrix`, { params: { yearId } });
  return data;
}

// ── Club Websites ──
export async function getClubWebsites(params?: { status?: string; districtId?: number; search?: string }) {
  const { data } = await api.get(`/api/admin/club-websites`, { params });
  return data;
}
export async function getClubWebsiteLogs(id: number) {
  const { data } = await api.get(`/api/admin/club-websites/${id}/logs`);
  return data;
}
export async function getClubWebsiteHistory(clubId: number) {
  const { data } = await api.get(`/api/admin/club-websites/club-history`, { params: { clubId } });
  return data;
}
export async function getAvailableClubsForWebsite(districtId: number) {
  const { data } = await api.get(`/api/admin/club-websites/available-clubs`, { params: { districtId } });
  return data;
}
export async function getClubWebsiteSettings() {
  const { data } = await api.get(`/api/admin/club-websites/settings`);
  return data;
}
export async function updateClubWebsiteSettings(payload: { defaultReminderDays: number; parentDomain?: string }) {
  const { data } = await api.put(`/api/admin/club-websites/settings`, payload);
  return data;
}
export async function createClubWebsite(payload: any) {
  const { data } = await api.post(`/api/admin/club-websites`, payload);
  return data;
}
export async function updateClubWebsite(id: number, payload: any) {
  const { data } = await api.put(`/api/admin/club-websites/${id}`, payload);
  return data;
}
export async function deleteClubWebsite(id: number, skipPlesk: boolean = false) {
  const { data } = await api.delete(`/api/admin/club-websites/${id}`, { params: { skipPlesk } });
  return data;
}
export async function activateClubWebsite(id: number, skipPlesk: boolean = false) {
  const { data } = await api.post(`/api/admin/club-websites/${id}/activate`, null, { params: { skipPlesk } });
  return data;
}
export async function retryClubWebsiteActivation(id: number) {
  const { data } = await api.post(`/api/admin/club-websites/${id}/retry-activation`);
  return data;
}
export async function retryClubWebsiteSsl(id: number) {
  const { data } = await api.post(`/api/admin/club-websites/${id}/retry-ssl`);
  return data;
}
// Third-party (custom) domain: does it currently resolve (A record) to our server IP?
export async function checkClubWebsiteDomainPointing(domain: string): Promise<{ pointsToServer: boolean; resolvedIps: string[]; expectedIp: string }> {
  const { data } = await api.post(`/api/admin/club-websites/check-domain-pointing`, { domain });
  return data;
}
// Is the domain already added as an application (site-alias) on our Plesk server?
export async function getClubWebsiteDomainPleskStatus(domain: string): Promise<{ existsInPlesk: boolean; pleskConfigured: boolean; error?: string }> {
  const { data } = await api.get(`/api/admin/club-websites/domain-plesk-status`, { params: { domain } });
  return data;
}
export async function pleskDiagnosticSubdomain(label: string) {
  const { data } = await api.get(`/api/admin/club-websites/plesk/diagnostic-subdomain`, { params: { label }, responseType: "text" });
  return data as string;
}
export interface BulkStartTrialResponse {
  success: boolean;
  updated: number;
  skippedPurchased: number;
  skippedPurchasedNames: string[];
  notFound: number;
  emailsSent: number;
  emailsTotal: number;
}
export async function bulkStartClubWebsiteTrial(ids: number[], days: number): Promise<BulkStartTrialResponse> {
  const { data } = await api.post(`/api/admin/club-websites/bulk-start-trial`, { ids, days });
  return data;
}

// ── Club Website pricing & bulk pay-link reminders (SuperAdmin, per Rotary year) ──
export interface ClubWebsitePricingRow {
  clubId: number; clubName: string; clubRotaryId: string | null;
  districtId: number | null; districtNumber: string | null;
  subdomain: string | null; websiteStatus: string | null;
  endDate: string | null; daysLeft: number | null; orderType: string;
  isCustom: boolean; baseAmount: number; renewalAmount: number; gstPercent: number; totalAmount: number; renewalTotalAmount: number;
  gatewayType: string; routeAccountId: number | null; routeAccountName: string | null;
  payLink: string;                                    // club-website pay link
  emailPayLink: string;                               // Wallet email-credit top-up link
  presidentName: string | null; presidentMobile: string | null; presidentEmail: string | null;
  secretaryName: string | null; secretaryMobile: string | null; secretaryEmail: string | null;
}
export interface WalletCommonLinks { website: string; email: string }
export interface ClubWebsitePricingResponse {
  items: ClubWebsitePricingRow[]; total: number; page: number; pageSize: number; yearId: number;
  commonLinks: WalletCommonLinks;
}
export interface PricingUpsertPayload {
  yearId: number; baseAmount: number; renewalAmount: number; gstPercent: number;
  gatewayType: string; routeAccountId?: number | null;
}
export async function getClubWebsitePricingYears(): Promise<{ id: number; label: string; isCurrent: number }[]> {
  const { data } = await api.get(`/api/admin/club-websites/pricing/years`);
  return data;
}
export async function getClubWebsitePricing(params: { yearId?: number; districtId?: number; search?: string; expiringInDays?: number; expiryFrom?: string; expiryTo?: string; page?: number; pageSize?: number }): Promise<ClubWebsitePricingResponse> {
  const { data } = await api.get(`/api/admin/club-websites/pricing`, { params });
  return data;
}
export async function upsertClubWebsitePricing(clubId: number, payload: PricingUpsertPayload) {
  const { data } = await api.put(`/api/admin/club-websites/pricing/${clubId}`, payload);
  return data;
}
export async function batchClubWebsitePricing(payload: PricingUpsertPayload & { districtId?: number | null; clubIds?: number[] }) {
  const { data } = await api.put(`/api/admin/club-websites/pricing/batch`, payload);
  return data;
}
// System-wide DEFAULT club-website pricing (New / Renewal / GST) — the fallback for clubs with no override.
export interface WebsiteDefaultPricing {
  newAmount: number; renewalAmount: number; gstPercent: number;
  newTotal: number; renewalTotal: number; isCustom: boolean;
}
export async function getWebsiteDefaultPricing(): Promise<WebsiteDefaultPricing> {
  const { data } = await api.get(`/api/admin/club-websites/default-pricing`);
  return data;
}
export interface WebsiteDefaultPricingOtpResult {
  message: string; debugOtp?: string; sentEmail: boolean;
  maskedEmail: string; expiryMinutes: number;
}
export async function sendWebsiteDefaultPricingOtp(payload: { newAmount: number; renewalAmount: number; gstPercent: number }): Promise<WebsiteDefaultPricingOtpResult> {
  const { data } = await api.post(`/api/admin/club-websites/default-pricing/send-otp`, payload);
  return data;
}
export async function saveWebsiteDefaultPricing(payload: { newAmount: number; renewalAmount: number; gstPercent: number; otp: string }) {
  const { data } = await api.post(`/api/admin/club-websites/default-pricing`, payload);
  return data;
}

export interface SendRemindersResult {
  clubsProcessed: number; emailsSent: number; failed: number;
  skipped: { clubId: number; clubName: string; reason: string }[];
}
export async function sendClubWebsiteReminders(clubIds: number[], yearId?: number): Promise<SendRemindersResult> {
  const { data } = await api.post(`/api/admin/club-websites/pricing/send-reminders`, { clubIds, yearId });
  return data;
}
// The single global Route account all club-website Route payments settle to.
export interface ClubWebsiteRouteAccount { id: number; name: string; accountId: string; isActive: boolean | number; status: string | null }
export async function getClubWebsiteRouteAccount(): Promise<{ routeAccountId: number | null; account: ClubWebsiteRouteAccount | null; routeAll: boolean }> {
  const { data } = await api.get(`/api/admin/club-websites/pricing/route-account`);
  return data;
}
export async function setClubWebsiteRouteAccount(routeAccountId: number | null, routeAll: boolean) {
  const { data } = await api.put(`/api/admin/club-websites/pricing/route-account`, { routeAccountId, routeAll });
  return data;
}

// ── District Wallet (SuperAdmin): per-district credit balances + copy links + reminders ──
export interface WalletDistrictRow {
  districtId: number; districtNumber: string | null;
  emailBalance: number;
  emailPayLink: string;
}
export interface WalletDistrictsResponse {
  items: WalletDistrictRow[];
  commonLinks: { email: string };
}
export async function getWalletDistricts(search?: string): Promise<WalletDistrictsResponse> {
  const { data } = await api.get(`/api/admin/wallet/districts`, { params: search ? { search } : {} });
  return data;
}
// Clubs with a live email credit balance > 0 (+ President/Secretary contacts) — Check balance popup.
export interface WalletClubBalanceRow {
  clubId: number; clubName: string | null; districtNumber: string | null;
  emailBalance: number;
  presidentName: string | null; presidentMobile: string | null; presidentEmail: string | null;
  secretaryName: string | null; secretaryMobile: string | null; secretaryEmail: string | null;
}
export async function getWalletClubBalances(): Promise<WalletClubBalanceRow[]> {
  const { data } = await api.get(`/api/admin/wallet/club-balances`);
  return data;
}

// ── Wallet › Reports tab: Club Website / Email purchase history ──
export interface WalletReportRow {
  districtNumber: string | null;
  clubName: string; purchaseDate: string; purchaseAmount: number;
  creditsPurchased: number | null;
  settlementAmount: number | null; settlementDate: string | null;
  razorpayTransactionId: string | null;
  presidentName: string | null; presidentMobile: string | null; presidentEmail: string | null;
  secretaryName: string | null; secretaryMobile: string | null; secretaryEmail: string | null;
  settlesInAccount: string;
  startDate: string | null; endDate: string | null;
}
export interface WalletReportFilters {
  dateFrom?: string; dateTo?: string; districtId?: number; search?: string;
}
export async function getWalletClubWebsiteReport(f: WalletReportFilters): Promise<WalletReportRow[]> {
  const { data } = await api.get(`/api/admin/wallet/reports/club-website`, { params: f });
  return data;
}
export async function getWalletEmailReport(f: WalletReportFilters): Promise<WalletReportRow[]> {
  const { data } = await api.get(`/api/admin/wallet/reports/email`, { params: f });
  return data;
}
export async function getWalletDistrictEmailReport(f: WalletReportFilters): Promise<WalletReportRow[]> {
  const { data } = await api.get(`/api/admin/wallet/reports/district-email`, { params: f });
  return data;
}

// Wallet page combined list: every email credit given Offline (Super Admin) or bought Online.
export interface WalletCreditEntryRow {
  source: "Offline" | "Online";
  entryType: string;              // Added | Edited | Purchased | Earlier entry
  entryDate: string;
  districtId: number;
  districtNumber: string | null;
  clubId: number;                 // 0 = district level
  clubName: string | null;
  creditType: string;
  credits: number | null;         // null = earlier offline count not recorded
  countBefore: number | null;
  countAfter: number | null;
  amount: number | null;
  transactionId: string | null;
  paymentDate: string | null;
  proofDocumentPath: string | null;
  expiryDate: string | null;
  byName: string | null;
  packStatus: string | null;      // Active | Expired | Deleted
  note: string | null;
}
export interface WalletCreditEntryFilters {
  districtId?: number;
  clubId?: number;
  creditType?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}
export async function getWalletCreditEntries(f: WalletCreditEntryFilters): Promise<WalletCreditEntryRow[]> {
  const { data } = await api.get(`/api/admin/wallet/credit-entries`, { params: f });
  return data;
}

// ── Razorpay Route Accounts (SuperAdmin) ──
export interface RazorpayRouteAccount {
  id: number; accountId: string; name: string; isActive: boolean | number;
  notes: string | null; status: string | null; stakeholderId: string | null;
  productConfigId: string | null; statusRefreshedDate: string | null;
  bankAccountLast4: string | null; bankIfsc: string | null;
  createdDate: string; modifiedDate: string | null;
  accountNumber?: string | null; beneficiaryName?: string | null; ifsc?: string | null;
}
// Off on ROW (FeatureGate legacy_gateways).
export async function getRazorpayRouteAccounts(_activeOnly = false): Promise<RazorpayRouteAccount[]> {
  return [];
}
// Sends a 6-digit OTP to the logged-in SuperAdmin's own email; required before create.
export async function sendRazorpayRouteOtp(): Promise<{ success: boolean; email: string }> {
  const { data } = await api.post(`/api/admin/razorpay-route-accounts/send-otp`);
  return data;
}
// Pull live activation status from Razorpay for one account / all pending accounts.
export async function refreshRazorpayRouteAccount(id: number): Promise<{ success: boolean; status: string | null }> {
  const { data } = await api.post(`/api/admin/razorpay-route-accounts/${id}/refresh`);
  return data;
}
export async function refreshAllRazorpayRouteAccounts(): Promise<{ success: boolean; refreshed: number }> {
  const { data } = await api.post(`/api/admin/razorpay-route-accounts/refresh-all`);
  return data;
}
// Minimal Razorpay Route onboarding — the backend creates the linked account (+ Route product +
// settlement bank) ON Razorpay with generic defaults for everything not supplied here, and stores
// the returned acc_… id. Only name, email, account number + IFSC are needed; the rest is optional.
export interface RouteAccountOnboardingPayload {
  name?: string; isActive: boolean; notes?: string | null;
  email: string; legalBusinessName: string; customerFacingBusinessName?: string;
  businessType?: string;                                   // explicitly chosen (no longer PAN-derived)
  pan?: string; gst?: string;                              // KYC: business PAN + GST (name-on-doc = legalBusinessName)
  bankAccountNumber: string; bankIfsc: string; bankBeneficiaryName?: string;
  otp: string;
}
export interface RouteAccountOnboardingResult {
  success: boolean; id: number; accountId: string; status: string | null; warnings: string[];
}
export async function createRazorpayRouteAccount(payload: RouteAccountOnboardingPayload): Promise<RouteAccountOnboardingResult> {
  const { data } = await api.post(`/api/admin/razorpay-route-accounts`, payload);
  return data;
}
export async function updateRazorpayRouteAccount(id: number, payload: {
  accountId: string; name: string; isActive: boolean; notes?: string | null;
  // Settlement bank details — Razorpay's Route API doesn't reliably echo these back, so this is
  // the SuperAdmin re-entering/backfilling what they already typed in at onboarding. Optional:
  // omit to leave the currently-stored value unchanged.
  bankAccountNumber?: string; bankIfsc?: string;
}) {
  const { data } = await api.put(`/api/admin/razorpay-route-accounts/${id}`, payload);
  return data;
}
export async function deleteRazorpayRouteAccount(id: number) {
  const { data } = await api.delete(`/api/admin/razorpay-route-accounts/${id}`);
  return data;
}

// ── Public (open) club-website pay page — reached from the encrypted reminder link ──
export async function getPublicClubWebsite(token: string) {
  const { data } = await publicApi.get(`/api/public/club-website/${token}`);
  return data;
}
export async function checkPublicClubWebsiteSubdomain(token: string, input: string) {
  const { data } = await publicApi.get(`/api/public/club-website/${token}/check-subdomain`, { params: { input } });
  return data;
}
export async function createPublicClubWebsiteOrder(token: string, payload: { subdomainInput?: string; returnPath?: string }) {
  const { data } = await publicApi.post(`/api/public/club-website/${token}/create-order`, payload);
  return data;
}
export async function verifyPublicClubWebsiteOrder(token: string, payload: { websiteOrderId: number; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
  const { data } = await publicApi.post(`/api/public/club-website/${token}/verify`, payload);
  return data;
}

// ── Public (open) Wallet pay page — email credit top-ups + common pick-a-club/district links ──
export interface PublicWalletStatus {
  emailRemaining: number;
  websiteOrderType: string | null; websiteSubdomain: string | null;
  websiteCurrentEndDate: string | null; websiteNewEndDate: string | null;
  websiteCanPurchase: boolean; websitePurchaseBlockedReason: string | null;
}
export interface PublicWalletInfo {
  scope: "club" | "district"; purpose: "website" | "email";
  entityId: number; requiresPick: boolean;
  entityName: string | null; districtNumber: string | null;
  status: PublicWalletStatus | null;
}
export interface PublicWalletSearchResult { id: number; name: string; districtNumber: string | null }
export interface PublicWalletQuote {
  creditType: string; creditCount: number; baseAmount: number;
  gstAmount: number; totalAmount: number; minAmount: number; error: string | null;
}
export async function getPublicWallet(token: string): Promise<PublicWalletInfo> {
  const { data } = await publicApi.get(`/api/public/wallet/${token}`);
  return data;
}
export async function searchPublicWallet(token: string, q: string): Promise<PublicWalletSearchResult[]> {
  const { data } = await publicApi.get(`/api/public/wallet/${token}/search`, { params: { q } });
  return data;
}
export async function getPublicWalletEntity(token: string, entityId: number): Promise<PublicWalletInfo> {
  const { data } = await publicApi.get(`/api/public/wallet/${token}/entity/${entityId}`);
  return data;
}
export async function getPublicWalletQuote(token: string, amount: number): Promise<PublicWalletQuote> {
  const { data } = await publicApi.get(`/api/public/wallet/${token}/quote`, { params: { amount } });
  return data;
}
export async function resolvePublicWalletWebsiteToken(token: string, entityId: number): Promise<{ websiteToken: string }> {
  const { data } = await publicApi.post(`/api/public/wallet/${token}/website-token`, { entityId });
  return data;
}
export async function createPublicWalletOrder(token: string, payload: { entityId: number; amount: number; returnPath?: string }) {
  const { data } = await publicApi.post(`/api/public/wallet/${token}/create-order`, payload);
  return data;
}
export async function verifyPublicWalletOrder(token: string, payload: { topupOrderId: number; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
  const { data } = await publicApi.post(`/api/public/wallet/${token}/verify`, payload);
  return data;
}

export interface RecycleAllPoolsResponse {
  totalPools: number;
  recycled: number;
  failed: number;
  recycledPools: string[];
  failedPools: string[];
  durationMs: number;
  error: string | null;
  permissionDenied: boolean;
}
// Recycles every IIS app pool whose name contains the parent domain. Used after
// a code deploy so all 2000+ club website pools pick up the new code in one click.
export async function recycleAllClubWebsitePools(): Promise<RecycleAllPoolsResponse> {
  const { data } = await api.post(`/api/admin/club-websites/recycle-all-pools`);
  return data;
}

// ===================== District Websites =====================
export async function getDistrictWebsites(params?: { status?: string; districtId?: number; search?: string }) {
  const { data } = await api.get(`/api/admin/district-websites`, { params });
  return data;
}
export async function getDistrictWebsiteLogs(id: number) {
  const { data } = await api.get(`/api/admin/district-websites/${id}/logs`);
  return data;
}
export async function getAvailableDistrictsForWebsite() {
  const { data } = await api.get(`/api/admin/district-websites/available-districts`);
  return data;
}
export async function createDistrictWebsite(payload: { districtId: number; subdomain: string; clientDomain?: string | null; notes?: string | null }) {
  const { data } = await api.post(`/api/admin/district-websites`, payload);
  return data;
}
export async function updateDistrictWebsite(id: number, payload: { subdomain: string; clientDomain?: string | null; notes?: string | null }) {
  const { data } = await api.put(`/api/admin/district-websites/${id}`, payload);
  return data;
}
export async function deleteDistrictWebsite(id: number, skipPlesk: boolean = false) {
  const { data } = await api.delete(`/api/admin/district-websites/${id}`, { params: { skipPlesk } });
  return data;
}
export async function activateDistrictWebsite(id: number, skipPlesk: boolean = false) {
  const { data } = await api.post(`/api/admin/district-websites/${id}/activate`, null, { params: { skipPlesk } });
  return data;
}
export async function deactivateDistrictWebsite(id: number) {
  const { data } = await api.post(`/api/admin/district-websites/${id}/deactivate`);
  return data;
}
export async function retryDistrictWebsiteActivation(id: number) {
  const { data } = await api.post(`/api/admin/district-websites/${id}/retry-activation`);
  return data;
}
export async function retryDistrictWebsiteSsl(id: number) {
  const { data } = await api.post(`/api/admin/district-websites/${id}/retry-ssl`);
  return data;
}
export async function testDistrictPleskConnection() {
  const { data } = await api.get(`/api/admin/district-websites/plesk/test-connection`);
  return data;
}
export async function listDistrictPleskSubdomains() {
  const { data } = await api.get(`/api/admin/district-websites/plesk/list-subdomains`);
  return data;
}
export async function forceDeleteDistrictPleskSubdomain(label: string) {
  const { data } = await api.post(`/api/admin/district-websites/plesk/force-delete-subdomain`, { label });
  return data;
}
export async function testPleskConnection() {
  const { data } = await api.get(`/api/admin/club-websites/plesk/test-connection`);
  return data;
}
export async function forceDeletePleskSubdomain(label: string) {
  const { data } = await api.post(`/api/admin/club-websites/plesk/force-delete-subdomain`, { label });
  return data;
}
export async function listPleskSubdomains() {
  const { data } = await api.get(`/api/admin/club-websites/plesk/list-subdomains`);
  return data;
}
export async function pleskDiagnostic(type: string) {
  const { data } = await api.get(`/api/admin/club-websites/plesk/diagnostic`, { params: { type } });
  return data;
}
export async function deactivateClubWebsite(id: number) {
  const { data } = await api.post(`/api/admin/club-websites/${id}/deactivate`);
  return data;
}
export async function sendClubWebsiteReminder(id: number) {
  const { data } = await api.post(`/api/admin/club-websites/${id}/send-reminder`);
  return data;
}

// ── Club Leadership (SuperAdmin bulk setup of Pres/Sec) ──
export async function getClubLeadership(districtId: number, yearId: number) {
  const { data } = await api.get(`/api/admin/club-leadership`, { params: { districtId, yearId } });
  return data;
}
export async function getClubLeadershipMembers(clubId: number) {
  const { data } = await api.get(`/api/admin/club-leadership/club-members`, { params: { clubId } });
  return data;
}
export async function upsertClubLeadership(payload: { clubId: number; yearId: number; memberId: number; role: "President" | "Secretary" }) {
  const { data } = await api.post(`/api/admin/club-leadership`, payload);
  return data;
}
export async function makeClubLeadershipAdmin(payload: { clubId: number; yearId: number; districtId: number; memberId: number; role: "President" | "Secretary" }) {
  const { data } = await api.post(`/api/admin/club-leadership/make-admin`, payload);
  return data;
}
export async function scheduleClubLeadershipEmail(payload: { districtId: number; yearId: number; scheduleDateTime: string }) {
  const { data } = await api.post(`/api/admin/club-leadership/schedule-email`, payload);
  return data;
}
export async function getClubLeadershipEmailStatus(districtId: number, yearId: number) {
  const { data } = await api.get(`/api/admin/club-leadership/email-status`, { params: { districtId, yearId } });
  return data;
}
export async function getClubLeadershipAllSchedules() {
  const { data } = await api.get(`/api/admin/club-leadership/all-schedules`);
  return data;
}
export async function deleteClubLeadershipSchedule(scheduleId: number) {
  const { data } = await api.delete(`/api/admin/club-leadership/schedule/${scheduleId}`);
  return data;
}
export async function getClubLeadershipScheduleLog(scheduleId: number) {
  const { data } = await api.get(`/api/admin/club-leadership/schedule-log`, { params: { scheduleId } });
  return data;
}

// ── District Report ──
// agMemberId (optional): scopes the whole report to that AG's clubs. Omitted by the
// District Admin report, so its payload is unchanged.
export async function getDistrictReport(districtId: number, yearId: number, agMemberId?: number) {
  const params: any = { yearId };
  if (agMemberId && agMemberId > 0) params.agMemberId = agMemberId;
  const { data } = await api.get(`/api/districts/${districtId}/district-report`, { params });
  return data;
}

// Club Officers (From RI) — live from Rotary.org for the selected year; one row per club.
export async function getDistrictClubOfficersRi(districtId: number, yearId: number, clubId?: number, agMemberId?: number) {
  const params: any = { yearId };
  if (clubId && clubId > 0) params.clubId = clubId;
  if (agMemberId && agMemberId > 0) params.agMemberId = agMemberId;
  const { data } = await api.get(`/api/districts/${districtId}/district-report/club-officers-ri`, { params });
  return (data || []) as any[];
}
// Governor's Official Visit (OCV/GOV) report — pass clubId (Club Wise) or
// agMemberId (AG Wise). Returns all OCV categories × types per club with the
// uploaded file URL (or null → N/A).
export async function getDistrictOcvGovReport(
  districtId: number,
  yearId: number,
  opts: { clubId?: number; agMemberId?: number },
) {
  const params: any = { yearId };
  if (opts.clubId && opts.clubId > 0) params.clubId = opts.clubId;
  if (opts.agMemberId && opts.agMemberId > 0) params.agMemberId = opts.agMemberId;
  const { data } = await api.get(`/api/districts/${districtId}/district-report/ocv-gov`, { params });
  return (data || { districtNumber: "", yearId: 0, clubs: [] }) as {
    districtNumber: string;
    yearId: number;
    clubs: Array<{
      clubId: number; clubName: string; clubRotaryId?: string | null; presidentName?: string | null; agName?: string | null;
      rows: Array<{ moduleName: string; documentType: string; uploaded: boolean; downloadUrl?: string | null }>;
    }>;
  };
}
// Avenue Of Service — flat per-project list across every club in the district.
// Fetched lazily by the Excel-export button on the Reports tab so the main
// district-report payload stays small.
export async function getDistrictAvenueOfServiceAllClubs(districtId: number, yearId: number) {
  const { data } = await api.get(
    `/api/districts/${districtId}/district-report/avenue-of-service-all-clubs`,
    { params: { yearId } },
  );
  return data as Array<{
    clubName: string; districtNumber: string;
    typeOfProject: string; moduleKey: string;
    clubRole: string | null; coHostName: string | null;
    areaOfFocus: string | null;
    projectDate: string | null; title: string; description: string | null;
    location: string | null; projectCost: number | null; funding: string | null;
    globalGrantNumber: string | null; csrCompanyName: string | null;
    amountSanctioned: number | null; amountReceived: number | null; amountSpent: number | null;
    hostClubsDistricts: string | null; globalPartners: string | null;
    beneficiaries: number | null; manHours: number | null; rotariansInvolved: number | null;
    publicPhotoUrl: string;
  }>;
}
// Avenue Of Service — per-club count of avenue-of-service projects (excludes
// club_service per spec). Returns one row per club in the district.
export async function getDistrictAvenueOfServiceClubCount(districtId: number, yearId: number) {
  const { data } = await api.get(
    `/api/districts/${districtId}/district-report/avenue-of-service-club-count`,
    { params: { yearId } },
  );
  return data as Array<{ clubId: number; districtNumber: string; clubName: string; projectCount: number }>;
}
export async function getDuesApprovalSnapshot(token: string) {
  const { data } = await api.get(`/api/public/dues-approval/${encodeURIComponent(token)}`);
  return data;
}
export async function applyDuesApproval(token: string, body: { action: "approve" | "reject"; approvalRemark?: string; rejectionReason?: string }) {
  const { data } = await api.post(`/api/public/dues-approval/${encodeURIComponent(token)}`, body);
  return data;
}
export async function getClubPendingOfflineApprovals(clubId: number) {
  const { data } = await api.get(`/api/clubs/${clubId}/membership-dues/pending-offline-approvals`);
  return data as Array<{ duesId: number; purpose: string; pendingCount: number }>;
}
export async function getCitationMatrix(districtId: number, yearId?: number, clubId?: number) {
  const params: Record<string, any> = { districtId };
  if (yearId && yearId > 0) params.yearId = yearId;
  if (clubId && clubId > 0) params.clubId = clubId;
  const { data } = await api.get(`/api/citation-matrix`, { params });
  return data;
}
export async function getDistrictReportAvailableYears(districtId: number) {
  const { data } = await api.get(`/api/districts/${districtId}/district-report/available-years`);
  return data;
}

// ── Live Documents Export ──
export async function getLiveDocumentsExport(clubId: number, yearId: number, module: string) {
  const { data } = await api.get(`/api/clubs/${clubId}/live-documents/export`, { params: { yearId, module } });
  return data;
}

// ── Global Member Search ──
export async function globalMemberSearch(search: string) {
  const { data } = await api.get("/api/admin/global-member-search", { params: { search } });
  return data;
}

// One member's contact card by id: name, photo, contacts and the clubs (with district + zone) they
// belong to. Feeds the member popup opened by clicking a name. SuperAdmin only.
export interface MemberCardClub {
  clubId: number; clubName: string; clubRotaryId: string | null;
  city: string | null; state: string | null;
  districtId: number | null; districtNumber: string | null; zoneName: string | null;
  isActive: boolean | number;
}
export interface MemberCard {
  member: {
    memberId: number; memberName: string; rotaryId: string | null;
    email: string | null; mobile: string | null; mobileCode: string | null;
    secondaryMobile: string | null; profilePhoto: string | null;
  };
  clubs: MemberCardClub[];
}
export async function getGlobalMemberCard(memberId: number): Promise<MemberCard> {
  const { data } = await api.get(`/api/admin/global-member-search/${memberId}/card`);
  return data;
}

// Soft-delete a member profile + free its primary mobile (moves primary→secondary, nulls primary).
export async function globalMemberSoftDelete(id: number) {
  const { data } = await api.post(`/api/admin/global-member-search/${id}/soft-delete`);
  return data;
}

// Edit only the mobile numbers + email of a member.
export async function globalMemberUpdateContact(
  id: number,
  payload: { primaryMobileNumber?: string | null; secondaryMobileNumber?: string | null; emailId?: string | null }
) {
  const { data } = await api.put(`/api/admin/global-member-search/${id}/contact`, payload);
  return data;
}

// ── SuperAdmin Reports ──
export async function fetchReport(endpoint: string, params?: Record<string, any>) {
  const { data } = await api.get(`/api/admin/reports/${endpoint}`, { params });
  return data;
}

// ── AG Reports ──
export async function fetchAgReport(endpoint: string, params?: Record<string, any>) {
  const { data } = await api.get(`/api/ag/reports/${endpoint}`, { params });
  return data;
}
export async function getAgMyClubs(yearId?: number): Promise<{ clubId: number; clubName: string; clubRotaryId: string; districtNumber: string }[]> {
  const { data } = await api.get(`/api/ag/reports/my-clubs`, { params: yearId ? { yearId } : undefined });
  return data;
}
export async function getAgMyYears(): Promise<{ id: number; yearLabel: string; isCurrent: boolean; startDate: string; endDate: string }[]> {
  const { data } = await api.get(`/api/ag/reports/my-years`);
  return data;
}

// ── Super Admin Role Config ──
export interface SuperAdminRow {
  memberId: number;
  memberName: string;
  mobile: string | null;
  email: string | null;
  promotedOn: string | null;
  promotedByName: string | null;
}
export interface SuperAdminSearchRow {
  memberId: number;
  memberName: string;
  mobile: string | null;
  email: string | null;
  rotaryId: string | null;
  clubName: string | null;
  districtNumber: string | null;
  zoneName: string | null;
  currentRoles: string | null;
}
export async function listSuperAdmins(): Promise<SuperAdminRow[]> {
  const { data } = await api.get("/api/admin/super-admins");
  return data;
}
export async function searchSuperAdminCandidates(q: string): Promise<SuperAdminSearchRow[]> {
  const { data } = await api.get("/api/admin/super-admins/search-members", { params: { q } });
  return data;
}
export async function sendSuperAdminOtp(memberId: number, action: "PROMOTE" | "REMOVE") {
  const { data } = await api.post("/api/admin/super-admins/send-otp", { memberId, action });
  // No debugOtp — the SuperAdmin promote/remove OTP goes only to the approver's email.
  return data as { message: string; sentEmail: boolean; expiryMinutes: number };
}
export async function verifySuperAdminOtp(memberId: number, action: "PROMOTE" | "REMOVE", otp: string) {
  const { data } = await api.post("/api/admin/super-admins/verify-otp", { memberId, action, otp });
  return data as { message: string; credentialsSent?: boolean };
}

// ── International President ──
export async function getAllInternationalPresidents() {
  const { data } = await api.get("/api/admin/international-president/all");
  return data;
}
export async function getInternationalPresidentByYear(yearId: number) {
  const { data } = await api.get("/api/admin/international-president", { params: { yearId } });
  return data;
}
export async function saveInternationalPresident(payload: {
  yearId: number;
  name: string;
  designation?: string | null;
  profilePhotoPath?: string | null;
  description?: string | null;
}) {
  const { data } = await api.put("/api/admin/international-president", payload);
  return data;
}
export async function deleteInternationalPresident(id: number) {
  const { data } = await api.delete(`/api/admin/international-president/${id}`);
  return data;
}
export async function uploadInternationalPresidentPhoto(file: File): Promise<{ path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post("/api/admin/international-president/upload-photo", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

// ═══════════════════════════════════════════════════════════════════
// SuperAdmin → Settings → Rotary.org → Manual Sync
// ═══════════════════════════════════════════════════════════════════

export async function compareClubs(districtId: number) {
  const { data } = await api.get("/api/admin/rotary-org-manual-sync/clubs/compare", { params: { districtId } });
  return data;
}

export async function addClubFromOrg(rotaryClubId: number, districtId: number) {
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/clubs", { rotaryClubId, districtId });
  return data;
}

export async function updateClubManual(clubId: number, payload: any) {
  const { data } = await api.put(`/api/admin/rotary-org-manual-sync/clubs/${clubId}`, payload);
  return data;
}

export async function deleteClubManualSync(clubId: number) {
  const { data } = await api.delete(`/api/admin/rotary-org-manual-sync/clubs/${clubId}`);
  return data;
}

export async function getClubOrgDetail(rotaryClubId: number) {
  const { data } = await api.get(`/api/admin/rotary-org-manual-sync/clubs/org-detail/${rotaryClubId}`);
  return data;
}

export async function getClubIndiaDetail(clubId: number) {
  const { data } = await api.get(`/api/admin/rotary-org-manual-sync/clubs/india-detail/${clubId}`);
  return data;
}

export async function compareMembers(clubId: number) {
  const { data } = await api.get("/api/admin/rotary-org-manual-sync/members/compare", { params: { clubId } });
  return data;
}

export async function addMemberFromOrg(rotaryMemberId: number, clubId: number) {
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/members", { rotaryMemberId, clubId });
  return data;
}

export async function updateMemberManual(memberId: number, payload: any) {
  const { data } = await api.put(`/api/admin/rotary-org-manual-sync/members/${memberId}`, payload);
  return data;
}

export async function deleteMemberFromClubManual(memberId: number, clubId: number) {
  const { data } = await api.delete(`/api/admin/rotary-org-manual-sync/members/${memberId}/from-club/${clubId}`);
  return data;
}

export async function getMemberOrgDetail(rotaryMemberId: number) {
  const { data } = await api.get(`/api/admin/rotary-org-manual-sync/members/org-detail/${rotaryMemberId}`);
  return data;
}

export async function getMemberIndiaDetail(memberId: number) {
  const { data } = await api.get(`/api/admin/rotary-org-manual-sync/members/india-detail/${memberId}`);
  return data;
}

export async function refreshClubsCache() {
  // Pulls every club from Rotary.org — well past the default 30s. Allow up to 5 minutes.
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/clubs/refresh-cache", null, { timeout: 300000 });
  return data;
}

// Landing-card counts for /settings/rotary-org (Club Sync + Member Sync).
export async function getRotaryOrgSyncSummary(): Promise<{ syncClubs: number; nonSyncClubs: number; totalMembers: number }> {
  const { data } = await api.get("/api/admin/rotary-org-manual-sync/summary");
  return data;
}

// Download the 3-sheet club-sync Excel report (Summary / Sync Clubs / Non-Sync Clubs).
export async function getClubSyncDistricts(): Promise<{ id: number; districtNumber: string; zoneName: string | null }[]> {
  const { data } = await api.get("/api/admin/rotary-org-manual-sync/clubs/sync-districts");
  return data;
}

export async function downloadClubSyncReport(districtId?: number, districtLabel?: string): Promise<void> {
  const response = await api.get("/api/admin/rotary-org-manual-sync/clubs/sync-report", {
    responseType: "blob",
    params: districtId ? { districtId } : undefined,
  });
  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const scope = districtLabel ? `_D${districtLabel}` : "_AllDistricts";
  link.download = `RotaryOrg_ClubSync_Report${scope}_${fileTimestamp()}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
}

export async function refreshMembersCache(clubId: number) {
  // One Rotary.org profile call per member (6 at a time) — a big club passes the default 30s and the
  // page showed "Network problem / Refresh failed". Allow up to 5 minutes (500 members ≈ 1 minute).
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/members/refresh-cache", null, { params: { clubId }, timeout: 300000 });
  return data;
}

// ── Member Match (district → sync clubs → ROW vs Rotary.org counts) ──
export async function getDistrictSyncClubsForMatch(districtId: number) {
  const { data } = await api.get("/api/admin/rotary-org-manual-sync/members/district-clubs", { params: { districtId } });
  return data; // { items: [{ clubId, clubRotaryId, clubName, clubType, localCount }] }
}
export async function getClubOrgMemberCount(clubId: number) {
  const { data } = await api.get("/api/admin/rotary-org-manual-sync/members/club-org-count", { params: { clubId } });
  return data; // { orgActive, orgHonorary, orgTotal, error? }
}
export async function sweepMembersForClub(clubId: number) {
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/members/sweep-club", { clubId });
  return data; // { started, clubRotaryIds, pid, message }
}
export async function sweepMembersForDistrict(districtId: number) {
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/members/sweep-district", { districtId });
  return data;
}
// Reconcile ONLY the mismatched sync clubs in a district (--member-count-reconcile --districts <num>).
export async function reconcileDistrictMembers(districtId: number) {
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/members/reconcile-district", { districtId });
  return data; // { started, pid, message }
}
// Per-member diff for a club: { clubName, localCount, orgCount, toAdd[], toRemove[], noRotaryId[], error? }
export async function getClubMemberDiff(clubId: number) {
  const { data } = await api.get("/api/admin/rotary-org-manual-sync/members/club-diff", { params: { clubId } });
  return data;
}
// Soft-delete no-Rotary-ID members from a club (server re-validates non-honorary/non-COG).
export async function softDeleteClubMemberLinks(clubId: number, memberIds: number[]) {
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/members/soft-delete-club-links", { clubId, memberIds });
  return data; // { softDeleted, message }
}
// Clubs page: mark a ROW club synced (flag=1) + full member sweep — for clubs that are
// sync on Rotary.org but show non-sync in ROW.
export async function markClubSynced(clubId: number) {
  const { data } = await api.post("/api/admin/rotary-org-manual-sync/clubs/mark-synced", { clubId });
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// SuperAdmin → Settings → Rotary.org → Duplicate Mobile / Email
// ═══════════════════════════════════════════════════════════════════

export interface DupPair {
  memberAId: number; memberBId: number;
  ridA: string | null; ridB: string | null;
  nameA: string | null; nameB: string | null;
  clubA: string | null; clubB: string | null;
  sharedMobile: string | null; sharedEmail: string | null;
  matchTypes: string; // "Mobile" | "Email" | "Email+Mobile"
  remark: string | null;
}

export async function getDuplicateCount(): Promise<{ total: number; mobile: number; email: number; both: number }> {
  const { data } = await api.get("/api/admin/member-duplicates/count");
  return data;
}

export async function getDuplicateList(page: number, pageSize: number, type?: string, search?: string, dismissed?: boolean): Promise<{ total: number; page: number; pageSize: number; items: DupPair[] }> {
  const { data } = await api.get("/api/admin/member-duplicates/list", { params: { page, pageSize, type, search: search || undefined, dismissed: dismissed || undefined } });
  return data;
}

// Fetch EVERY duplicate row for the current filter/search (loops the paged endpoint, which caps
// pageSize at 200) — used by the "Export to Excel" button to dump the full listing as-is.
export async function getAllDuplicates(type?: string, search?: string, dismissed?: boolean): Promise<DupPair[]> {
  const size = 200;
  const first = await getDuplicateList(1, size, type, search, dismissed);
  const all = [...first.items];
  const pages = Math.ceil((first.total || 0) / size);
  for (let p = 2; p <= pages; p++) {
    const res = await getDuplicateList(p, size, type, search, dismissed);
    all.push(...res.items);
  }
  return all;
}

// Add / edit / clear the free-text remark for a duplicate pair. Empty remark clears it.
export async function saveDuplicateRemark(memberAId: number, memberBId: number, remark: string) {
  const { data } = await api.post("/api/admin/member-duplicates/remark", { memberAId, memberBId, remark });
  return data as { success: boolean; remark: string | null };
}

// Re-open a "Kept Both" (dismissed) pair so it shows in the active duplicates list again.
export async function undismissDuplicate(memberAId: number, memberBId: number) {
  const { data } = await api.post("/api/admin/member-duplicates/undismiss", { memberAId, memberBId });
  return data;
}

export interface MergeHistoryRow {
  id: number; keptId: number; deletedId: number; mergedOn: string;
  keptName: string | null; keptRid: string | null;
  deletedName: string | null; deletedRid: string | null; deletedMobile: string | null;
  deletedStillGone: number; // 1 = still merged/deleted, 0 = already restored
}
// Recent merges that can be undone (most recent first).
export async function getMergeHistory(limit = 50): Promise<MergeHistoryRow[]> {
  const { data } = await api.get("/api/admin/member-duplicates/merge-history", { params: { limit } });
  return data;
}
// Undo a merge — restores the deleted member (profile, clubs, family) from the saved snapshot.
export async function revertMerge(keptId: number, deletedId: number): Promise<{ success: boolean; restoredMemberId: number; rolesNote: string | null }> {
  const { data } = await api.post("/api/admin/member-duplicates/revert", { keptId, deletedId });
  return data;
}

export interface DupRole { source: string; label: string | null; context: string | null; year: string | null; }
export interface DupClub { clubMemberId: number; fkClubId: number; clubName: string | null; districtNumber: string | null; designation: string | null; isHonorary: number; joinedDate: string | null; }
export interface DupFamily { familyId: number; name: string | null; relation: string | null; phoneNumber: string | null; emailId: string | null; birthDate: string | null; anniversaryDate: string | null; bloodGroup: string | null; }
export interface DupProfile {
  id: number; memberName: string | null; rotaryId: string | null;
  emailId: string | null; secondaryEmailId: string | null;
  primaryMobileNumber: string | null; secondaryMobileNumber: string | null;
  fkPrimaryCountryId: number | null; fkSecondaryCountryId: number | null;
  birthDate: string | null; anniversaryDate: string | null; bloodGroup: string | null;
  gender: string | null; primaryLanguage: string | null; isYouth: number | null;
  memberIntroduction: string | null; donorRecognition: string | null;
  facebook: string | null; instagram: string | null; linkedIn: string | null;
  twitter: string | null; youtube: string | null; website: string | null;
  profilePhotoPath: string | null; createdDate: string | null;
}

export async function getDuplicatePair(aId: number, bId: number): Promise<{
  memberA: DupProfile; memberB: DupProfile;
  clubsA: DupClub[]; clubsB: DupClub[]; rolesA: DupRole[]; rolesB: DupRole[];
  familyA: DupFamily[]; familyB: DupFamily[];
}> {
  const { data } = await api.get("/api/admin/member-duplicates/pair", { params: { aId, bId } });
  return data;
}

export async function resolveDuplicate(body: {
  keepId: number; deleteId: number;
  survivor: Record<string, unknown>;
  clubs: { fkClubId: number; isHonorary: boolean; joinedDate: string | null }[];
}): Promise<{ success: boolean; keptId: number; deletedId: number }> {
  const { data } = await api.post("/api/admin/member-duplicates/resolve", body);
  return data;
}

export async function dismissDuplicate(
  memberAId: number,
  memberBId: number,
  reason?: string,
  note?: string,
  // "Keep both" with edits — each member's own changed fields, saved to its own row (never merged).
  editsA?: Record<string, unknown>,
  editsB?: Record<string, unknown>,
) {
  const { data } = await api.post("/api/admin/member-duplicates/dismiss", { memberAId, memberBId, reason, note, editsA, editsB });
  return data;
}

export async function getDuplicateDistricts(): Promise<{ id: number; districtNumber: string }[]> {
  const { data } = await api.get("/api/admin/member-duplicates/districts");
  return data;
}

export async function getDuplicateClubs(districtId: number): Promise<{ id: number; clubName: string }[]> {
  const { data } = await api.get("/api/admin/member-duplicates/clubs", { params: { districtId } });
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// SuperAdmin → Settings → Push Notification Logs
// ═══════════════════════════════════════════════════════════════════

export async function getRecentPushLogs(params?: { type?: string; from?: string; to?: string }) {
  const { data } = await api.get("/api/admin/push-logs/recent", { params });
  return data;
}

export async function getPushRecipients(type: string, entityId: number, isReminder: boolean = false, reminderId?: number) {
  const { data } = await api.get("/api/admin/push-logs/recipients", {
    params: { type, entityId, isReminder, reminderId }
  });
  return data;
}

export async function getStuckPushes() {
  const { data } = await api.get("/api/admin/push-logs/stuck");
  return data;
}

export async function sendPushNow(type: string, entityId: number) {
  const { data } = await api.post("/api/admin/push-logs/send-now", { type, entityId });
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// SuperAdmin → Settings → Mobile App Version Management
// ═══════════════════════════════════════════════════════════════════

export async function getMobileVersions() {
  const { data } = await api.get("/api/admin/mobile-versions");
  return data;
}

export async function createMobileVersion(payload: any) {
  const { data } = await api.post("/api/admin/mobile-versions", payload);
  return data;
}

export async function updateMobileVersion(id: number, payload: any) {
  const { data } = await api.put(`/api/admin/mobile-versions/${id}`, payload);
  return data;
}

export async function activateMobileVersion(id: number) {
  const { data } = await api.post(`/api/admin/mobile-versions/${id}/activate`);
  return data;
}

export async function deactivateMobileVersion(id: number) {
  const { data } = await api.post(`/api/admin/mobile-versions/${id}/deactivate`);
  return data;
}

export async function deleteMobileVersion(id: number) {
  const { data } = await api.delete(`/api/admin/mobile-versions/${id}`);
  return data;
}

// ---------------------------------------------------------------------------
// App Route Maintenance (SuperAdmin switchboard for the mobile app's
// per-route blocklist). The mobile Flutter app reads the active rows;
// the web admin reads + upserts.
// ---------------------------------------------------------------------------
export interface AppRouteMaintenanceRow {
  id: number;
  routeKey: string;
  label: string | null;
  isUnderMaintenance: boolean;
  message: string | null;
  maintenanceUntil: string | null;
  modifiedDate: string | null;
}

export interface AppRouteMaintenanceUpsertPayload {
  routeKey: string;
  isUnderMaintenance: boolean;
  message?: string | null;
  maintenanceUntil?: string | null;
}

export async function getAppRouteMaintenanceAll(): Promise<AppRouteMaintenanceRow[]> {
  const { data } = await api.get("/api/app/route-maintenance/all");
  return data as AppRouteMaintenanceRow[];
}

export async function getAppRouteMaintenanceActive(): Promise<Pick<AppRouteMaintenanceRow, "routeKey" | "isUnderMaintenance" | "message" | "maintenanceUntil">[]> {
  const { data } = await api.get("/api/app/route-maintenance");
  return data;
}

export async function upsertAppRouteMaintenance(payload: AppRouteMaintenanceUpsertPayload) {
  const { data } = await api.put("/api/app/route-maintenance", payload);
  return data as { message: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// App Sign-in Check (SuperAdmin diagnostic): would this email get into the app, and with which clubs?
// No writes, no email.
// ─────────────────────────────────────────────────────────────────────────────
export interface MobileLoginCheckClub {
  clubId: number;
  clubName: string;
  clubCode: string | null;
  districtId: number;
  districtNumber: string | null;
  zoneId: number;
  zoneName: string | null;
}

export interface MobileLoginCheckResult {
  allowed: boolean;
  reason: string | null;
  email: string;
  member: {
    id: number;
    name: string;
    email: string | null;
  } | null;
  clubs: MobileLoginCheckClub[];
}

export async function checkMobileLogin(email: string): Promise<MobileLoginCheckResult> {
  const { data } = await api.get("/api/admin/mobile-login-check", { params: { email } });
  return data as MobileLoginCheckResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// SuperAdmin global search (Zones + Districts + Clubs) — Settings page only.
// Returns mixed results across the three masters. Frontend uses `type` to pick
// the right navigation target on click.
// ─────────────────────────────────────────────────────────────────────────────
export interface GlobalSearchRow {
  id: number;
  label: string;
  subLabel: string | null;
  districtId: number | null;   // set only for type=club
  // Club-only extras (zone/district rows leave these null)
  isSyncedFromRotaryOrg?: number | null;   // 1 = yes, 0 = no
  clubWebsiteSubdomain?: string | null;    // subdomain prefix; full URL = `${subdomain}.portal.example.org`
  clubWebsiteStatus?: string | null;       // 'active' | 'expired' | 'none' — drives the Website pill
  clubType?: string | null;                // 'Rotary Club' | 'Rotaract Club'
  memberCount?: number | null;            // clubs: club members; zones + districts: total active members
  clubRotaryId?: string | null;            // club rows only; districts/zones leave this null
  // Zone AND district rollups (clubs leave these null)
  districtCount?: number | null;           // zones only
  clubCount?: number | null;               // active clubs
  // District rollups (user 2026-10-01): the active clubs split by Rotary.org sync, and the
  // district's own website (same shape as the club one).
  syncedClubCount?: number | null;
  nonSyncedClubCount?: number | null;
  districtWebsiteSubdomain?: string | null;
  districtWebsiteClientDomain?: string | null;
  districtWebsiteStatus?: string | null;   // 'active' | 'expired' | 'none'
}

export interface GlobalSearchResult {
  zones: GlobalSearchRow[];
  districts: GlobalSearchRow[];
  clubs: GlobalSearchRow[];
}

export async function globalSearchAll(q: string): Promise<GlobalSearchResult> {
  const { data } = await api.get(`/api/admin/global-search?q=${encodeURIComponent(q)}`);
  return data as GlobalSearchResult;
}

// ─────────────────────────────────────────────────────────────
//  Club Dues (District Dues) — separate from Membership Dues
// ─────────────────────────────────────────────────────────────
export async function getClubDuesList(params?: { districtId?: number; search?: string; year?: string }) {
  const res = await api.get("/api/club-dues", { params });
  return res.data;
}
export async function getClubDuesDetail(id: number) {
  const res = await api.get(`/api/club-dues/${id}`);
  return res.data;
}
export async function createClubDues(data: FormData) {
  const res = await api.post("/api/club-dues", data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function updateClubDues(id: number, data: FormData) {
  const res = await api.put(`/api/club-dues/${id}`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function deleteClubDues(id: number) {
  const res = await api.delete(`/api/club-dues/${id}`);
  return res.data;
}
export async function toggleClubDuesActive(id: number) {
  const res = await api.patch(`/api/club-dues/${id}/toggle-active`);
  return res.data;
}
export async function syncClubDues(id: number) {
  const res = await api.post(`/api/club-dues/${id}/sync`);
  return res.data;
}
export async function getClubDuesClubs(id: number, params?: { search?: string; includeNonSynced?: boolean }) {
  const res = await api.get(`/api/club-dues/${id}/clubs`, { params });
  return res.data;
}
export async function getClubDuesClubMembers(id: number, clubId: number) {
  const res = await api.get(`/api/club-dues/${id}/clubs/${clubId}/members`);
  return res.data;
}
export async function updateClubDuesRate(id: number, clubDuesClubId: number, perMemberRate: number, onlinePerMemberRate?: number, offlinePerMemberRate?: number) {
  const res = await api.put(`/api/club-dues/${id}/clubs/${clubDuesClubId}/rate`, { perMemberRate, onlinePerMemberRate, offlinePerMemberRate });
  return res.data;
}
export async function recordClubDuesOffline(id: number, data: FormData) {
  const res = await api.post(`/api/club-dues/${id}/offline-payment`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function approveClubDuesPayment(paymentId: number, data: { isApproved: boolean; rejectionReason?: string; approvalRemark?: string }) {
  const res = await api.post(`/api/club-dues/payments/${paymentId}/approve-reject`, data);
  return res.data;
}
export async function sendClubDuesReceipt(paymentId: number) {
  const res = await api.post(`/api/club-dues/payments/${paymentId}/receipt`);
  return res.data;
}
export async function getClubDuesOfflineDetails(paymentId: number) {
  const res = await api.get(`/api/club-dues/payments/${paymentId}/offline-details`);
  return res.data;
}
export async function updateClubDuesOffline(paymentId: number, data: FormData) {
  const res = await api.put(`/api/club-dues/payments/${paymentId}/update-offline`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function getClubDuesClubVendors(id: number, clubId: number) {
  const res = await api.get(`/api/club-dues/${id}/clubs/${clubId}/vendors`);
  return res.data;
}
// Effective bank-account options for the offline-payment picker (admin side) — same accounts
// used for online Razorpay Route splits, per-club override if set else the campaign default.
export interface ClubDuesOfflineAccountOption {
  fkRouteAccountId: number;
  accountId: string;
  accountLabel: string | null;
  amount: number; // this account's share of the club's currently-owed total
}
export async function getClubDuesOfflineAccounts(id: number, clubId: number): Promise<ClubDuesOfflineAccountOption[]> {
  const res = await api.get(`/api/club-dues/${id}/clubs/${clubId}/offline-accounts`);
  return res.data;
}
export async function getClubDuesAllClubVendors(id: number) {
  const res = await api.get(`/api/club-dues/${id}/all-club-vendors`);
  return res.data;
}
export async function saveClubDuesClubVendors(id: number, clubId: number, vendorsJson: string, isOnline: boolean = true) {
  const res = await api.put(`/api/club-dues/${id}/clubs/${clubId}/vendors`, { vendorsJson, isOnline });
  return res.data;
}
export async function sendClubDuesReminder(id: number, clubId: number, remark?: string) {
  const res = await api.post(`/api/club-dues/${id}/clubs/${clubId}/reminder`, { remark });
  return res.data;
}
export async function bulkClubDuesReminder(id: number, remark?: string) {
  const res = await api.post(`/api/club-dues/${id}/reminder`, { remark });
  return res.data;
}
export function getClubDuesExportUrl(id: number) {
  return `${API_BASE_URL}/api/club-dues/${id}/export`;
}
export async function createClubDuesGoogleSheet(id: number) {
  const res = await api.post(`/api/club-dues/${id}/create-google-sheet`);
  return res.data;
}
export async function deleteClubDuesGoogleSheet(id: number) {
  const res = await api.delete(`/api/club-dues/${id}/delete-google-sheet`);
  return res.data;
}
export async function getClubDuesPayLink(id: number, clubId: number): Promise<{ url: string; expiresAtUtc: string }> {
  const res = await api.get(`/api/club-dues/${id}/clubs/${clubId}/pay-link`);
  return res.data;
}

// Public (token-gated) — officer pay page
export async function getPublicClubDues(id: number, clubId: number, token: string) {
  const res = await publicApi.get(`/api/public/club-dues/${id}`, { params: { clubId, token } });
  return res.data;
}
export async function payPublicClubDues(id: number, token: string, body: { fkClubId: number; paidByMemberId?: number }) {
  const res = await publicApi.post(`/api/public/club-dues/${id}/pay?token=${encodeURIComponent(token)}`, body);
  return res.data;
}
export async function offlinePublicClubDues(id: number, token: string, data: FormData) {
  const res = await publicApi.post(`/api/public/club-dues/${id}/offline-payment?token=${encodeURIComponent(token)}`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function getPublicClubDuesOfflineAccounts(id: number, clubId: number, token: string): Promise<ClubDuesOfflineAccountOption[]> {
  const res = await publicApi.get(`/api/public/club-dues/${id}/offline-accounts`, { params: { clubId, token } });
  return res.data;
}
export async function verifyPublicClubDuesPayment(id: number, body: { paymentId: number; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
  const res = await publicApi.post(`/api/public/club-dues/${id}/verify-payment`, body);
  return res.data;
}
export async function getClubDuesReport(id: number) {
  const res = await api.get(`/api/club-dues/${id}/report`);
  return res.data;
}

// Approval (token) — District Treasurer
export async function getClubDuesApproval(token: string) {
  const res = await publicApi.get(`/api/public/club-dues-approval/${token}`);
  return res.data;
}
export async function decideClubDuesApproval(token: string, body: { isApproved: boolean; rejectionReason?: string; approvalRemark?: string }) {
  const res = await publicApi.post(`/api/public/club-dues-approval/${token}`, body);
  return res.data;
}

// ── Officer surface (Club President / Secretary / Treasurer) — authenticated web ──
export async function getClubDuesOfficerClubs(): Promise<{ duesId: number; purpose?: string; rotaryYear?: string; clubId: number; clubName?: string; districtNumber?: string }[]> {
  const res = await api.get("/api/club-dues/officer/my-clubs");
  return res.data;
}
export async function getClubDuesOfficerSnapshot(duesId: number, clubId: number) {
  const res = await api.get(`/api/club-dues/officer/${duesId}`, { params: { clubId } });
  return res.data;
}
export async function payClubDuesOfficer(duesId: number, clubId: number) {
  const res = await api.post(`/api/club-dues/officer/${duesId}/pay`, null, { params: { clubId } });
  return res.data;
}
export async function verifyClubDuesOfficer(duesId: number, clubId: number, body: { paymentId: number; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
  const res = await api.post(`/api/club-dues/officer/${duesId}/verify`, body, { params: { clubId } });
  return res.data;
}
export async function getClubDuesOfficerPayLink(duesId: number, clubId: number): Promise<{ url: string; expiresAtUtc: string }> {
  const res = await api.get(`/api/club-dues/officer/${duesId}/pay-link`, { params: { clubId } });
  return res.data;
}
export async function recordClubDuesOfficerOffline(duesId: number, clubId: number, data: FormData) {
  const res = await api.post(`/api/club-dues/officer/${duesId}/offline-payment`, data, { params: { clubId }, headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function getClubDuesOfficerOfflineAccounts(duesId: number, clubId: number): Promise<ClubDuesOfflineAccountOption[]> {
  const res = await api.get(`/api/club-dues/officer/${duesId}/offline-accounts`, { params: { clubId } });
  return res.data;
}

// ── District-admin content surface — branding + email copy only ──
export async function getClubDuesMyDistrict(districtId?: number): Promise<{ id: number; districtNumber?: string; rotaryYear?: string; purpose?: string; isActive: boolean }[]> {
  const res = await api.get("/api/club-dues/my-district", { params: districtId ? { districtId } : undefined });
  return res.data;
}
export async function sendClubDuesTestEmail(body: {
  email: string; type: "reminder" | "receipt"; districtId: number; duesId?: number;
  subject?: string; body?: string; buttonText?: string; showBank?: boolean; bankName?: string; accountNumber?: string; ifsc?: string;
  emailLogo?: File | null;  // optional just-picked (unsaved) header logo — embedded inline in the test
}): Promise<{ message: string }> {
  const fd = new FormData();
  fd.append("Email", body.email);
  fd.append("Type", body.type);
  fd.append("DistrictId", String(body.districtId));
  fd.append("DuesId", String(body.duesId ?? 0));
  fd.append("Subject", body.subject ?? "");
  fd.append("Body", body.body ?? "");
  fd.append("ButtonText", body.buttonText ?? "");
  fd.append("ShowBank", body.showBank ? "true" : "false");
  fd.append("BankName", body.bankName ?? "");
  fd.append("AccountNumber", body.accountNumber ?? "");
  fd.append("Ifsc", body.ifsc ?? "");
  if (body.emailLogo) fd.append("emailLogo", body.emailLogo);
  const res = await api.post("/api/club-dues/test-email", fd, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}
export async function getClubDuesContent(id: number) {
  const res = await api.get(`/api/club-dues/${id}/content`);
  return res.data;
}
export async function updateClubDuesContent(id: number, data: FormData) {
  const res = await api.patch(`/api/club-dues/${id}/content`, data, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}

// ─── Connected payment accounts (ROW: payments.connect) ──────────────────────
export async function getPaymentAccounts(ownerType: AccountOwnerType, ownerId: number): Promise<PaymentAccount[]> {
  const res = await api.get("/api/payments/accounts", { params: { ownerType, ownerId } });
  return res.data;
}
export async function getGatewayCoverage(ownerType: AccountOwnerType, ownerId: number): Promise<GatewayCoverage> {
  const res = await api.get("/api/payments/coverage", { params: { ownerType, ownerId } });
  return res.data;
}
// The API verifies the keys with a harmless call (Stripe: retrieve account; PayPal: token) before storing.
export async function connectPaymentAccount(body: ConnectAccountRequest): Promise<PaymentAccount> {
  const res = await api.post("/api/payments/accounts", body);
  return res.data;
}
export async function reverifyPaymentAccount(id: number): Promise<PaymentAccount> {
  const res = await api.post(`/api/payments/accounts/${id}/verify`);
  return res.data;
}
export async function setPaymentAccountActive(id: number, isActive: boolean): Promise<PaymentAccount> {
  const res = await api.put(`/api/payments/accounts/${id}/active`, { isActive });
  return res.data;
}

// ─── Privacy: member export, erasure, consent (ROW: privacy.enabled) ─────────
export async function getPrivacyRequests(districtId: number): Promise<PrivacyRequest[]> {
  const res = await api.get("/api/privacy/requests", { params: { districtId } });
  return res.data;
}
export async function requestMemberExport(memberId: number): Promise<PrivacyRequest> {
  const res = await api.post(`/api/privacy/members/${memberId}/export`);
  return res.data;
}
/** `confirm` is the member's name as the admin typed it; the server refuses the erasure unless it matches. */
export async function requestMemberErasure(memberId: number, reason: string, confirm: string): Promise<PrivacyRequest> {
  const res = await api.post(`/api/privacy/members/${memberId}/erase`, { reason, confirm });
  return res.data;
}
// Erasure by a District Admin needs a second District Admin's approval.
export async function approvePrivacyRequest(requestId: number): Promise<PrivacyRequest> {
  const res = await api.post(`/api/privacy/requests/${requestId}/approve`);
  return res.data;
}
export async function rejectPrivacyRequest(requestId: number): Promise<PrivacyRequest> {
  const res = await api.post(`/api/privacy/requests/${requestId}/reject`);
  return res.data;
}
export async function getConsentStatus(): Promise<ConsentStatus> {
  const res = await api.get("/api/privacy/consent");
  return res.data;
}
export async function acceptConsent(policyVersion: string, language: string): Promise<void> {
  await api.post("/api/privacy/consent", { policyVersion, language });
}

// Platform module switches (api/Services/FeatureGate.cs): skipped modules stay off, flagged ones a SuperAdmin turns on.
export interface PlatformFeature {
  key: string;
  label: string;
  kind: "skipped" | "flagged";
  enabled: boolean;
  adminPaths: string[];
}

export async function getFeatures(): Promise<PlatformFeature[]> {
  return (await api.get("/api/features")).data;
}

export async function setFeature(key: string, enabled: boolean) {
  await api.put(`/api/features/${encodeURIComponent(key)}`, { enabled });
}

// ─── Grants (api/Controllers/GrantsController.cs; flagged module "grants") ───
import type {
  GrantApplication, GrantApplicationListItem, GrantActionBody, GrantAttachment, GrantCashFlow, GrantClubOverview,
  GrantCycle, GrantLightProject, RecordGrantPayment, SaveGrantApplication, SaveGrantCycle,
} from "@/types/grants";

export type GrantSide = "club" | "district";
const grantsBase = (side: GrantSide, scopeId: number) =>
  side === "club" ? `/api/clubs/${scopeId}/grants` : `/api/districts/${scopeId}/grants`;

function saveBlob(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

export async function getGrantCycles(districtId: number): Promise<GrantCycle[]> {
  return (await api.get(`${grantsBase("district", districtId)}/cycles`)).data;
}
export async function saveGrantCycle(districtId: number, body: SaveGrantCycle, cycleId?: number): Promise<GrantCycle> {
  const url = `${grantsBase("district", districtId)}/cycles`;
  return (await (cycleId ? api.put(`${url}/${cycleId}`, body) : api.post(url, body))).data;
}
export async function getGrantCashFlow(districtId: number, cycleId: number): Promise<GrantCashFlow> {
  return (await api.get(`${grantsBase("district", districtId)}/cycles/${cycleId}/cashflow`)).data;
}
export async function downloadGrantsCsv(districtId: number, cycleId: number, yearLabel: string) {
  const r = await api.get(`${grantsBase("district", districtId)}/cycles/${cycleId}/export`, { responseType: "blob" });
  saveBlob(new Blob([r.data], { type: "text/csv" }), `grants_${yearLabel}_${fileTimestamp()}.csv`);
}
export async function getDistrictGrantApplications(
  districtId: number,
  params: { cycleId?: number; status?: string; archived?: boolean },
): Promise<GrantApplicationListItem[]> {
  return (await api.get(`${grantsBase("district", districtId)}/applications`, { params })).data;
}
export async function recordGrantPayment(districtId: number, id: number, body: RecordGrantPayment): Promise<GrantApplication> {
  return (await api.post(`${grantsBase("district", districtId)}/applications/${id}/payments`, body)).data;
}

export async function getGrantApplication(side: GrantSide, scopeId: number, id: number): Promise<GrantApplication> {
  return (await api.get(`${grantsBase(side, scopeId)}/applications/${id}`)).data;
}
export async function grantAction(side: GrantSide, scopeId: number, id: number, action: string, body: GrantActionBody): Promise<GrantApplication> {
  return (await api.post(`${grantsBase(side, scopeId)}/applications/${id}/actions/${action}`, body)).data;
}
export async function grantComment(side: GrantSide, scopeId: number, id: number, comment: string): Promise<GrantApplication> {
  return (await api.post(`${grantsBase(side, scopeId)}/applications/${id}/comments`, { comment })).data;
}
export async function downloadGrantAttachment(side: GrantSide, scopeId: number, id: number, attachment: GrantAttachment) {
  const r = await api.get(`${grantsBase(side, scopeId)}/applications/${id}/attachments/${attachment.id}`, { responseType: "blob" });
  saveBlob(r.data, attachment.originalName);
}

export async function getClubGrants(clubId: number): Promise<GrantClubOverview> {
  return (await api.get(grantsBase("club", clubId))).data;
}
export async function createGrantApplication(clubId: number, body: SaveGrantApplication): Promise<{ id: number }> {
  return (await api.post(`${grantsBase("club", clubId)}/applications`, body)).data;
}
export async function updateGrantApplication(clubId: number, id: number, body: SaveGrantApplication): Promise<GrantApplication> {
  return (await api.put(`${grantsBase("club", clubId)}/applications/${id}`, body)).data;
}
export async function uploadGrantAttachment(clubId: number, id: number, file: File): Promise<GrantAttachment> {
  const checked = file.type.startsWith("image/") ? await processImageBeforeUpload(file) : await processDocumentBeforeUpload(file);
  const form = new FormData();
  form.append("file", checked);
  return (await api.post(`${grantsBase("club", clubId)}/applications/${id}/attachments`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  })).data;
}
export async function deleteGrantAttachment(clubId: number, id: number, attachmentId: number): Promise<void> {
  await api.delete(`${grantsBase("club", clubId)}/applications/${id}/attachments/${attachmentId}`);
}
export async function getGrantLightProjects(clubId: number, yearId: number): Promise<GrantLightProject[]> {
  return (await api.get(`${grantsBase("club", clubId)}/light`, { params: { yearId } })).data;
}
export async function saveGrantLight(clubId: number, yearId: number, projectId: number, body: { grantAmount: number | null; reportDate: string | null }) {
  await api.put(`${grantsBase("club", clubId)}/light/${yearId}/${projectId}`, body);
}

// ─── Volunteers and speakers (api/Controllers/VolunteersController.cs, SpeakersController.cs; flagged module "volunteers") ───
import type {
  MeetingDuty, PublicVolunteerSheet, SaveMeetingDuty, SaveSpeaker, SaveVolunteerSheet, Speaker, VolunteerSheet,
  VolunteerSheetListItem, VolunteerTargets,
} from "@/types/volunteers";
import { ensureErrorMessage } from "@/lib/apiError";
import { stripBase, withBase } from "@/lib/basePath";

const sheetsBase = (clubId: number) => `/api/clubs/${clubId}/volunteer-sheets`;

export async function getVolunteerSheets(clubId: number): Promise<VolunteerSheetListItem[]> {
  return (await api.get(sheetsBase(clubId))).data;
}
export async function getVolunteerTargets(clubId: number, yearId: number | null): Promise<VolunteerTargets> {
  return (await api.get(`${sheetsBase(clubId)}/targets`, { params: yearId ? { yearId } : {} })).data;
}
export async function getVolunteerSheet(clubId: number, id: number): Promise<VolunteerSheet> {
  return (await api.get(`${sheetsBase(clubId)}/${id}`)).data;
}
export async function createVolunteerSheet(clubId: number, body: SaveVolunteerSheet): Promise<{ id: number }> {
  return (await api.post(sheetsBase(clubId), body)).data;
}
export async function updateVolunteerSheet(clubId: number, id: number, body: SaveVolunteerSheet): Promise<VolunteerSheet> {
  return (await api.put(`${sheetsBase(clubId)}/${id}`, body)).data;
}
export async function deleteVolunteerSheet(clubId: number, id: number): Promise<void> {
  await api.delete(`${sheetsBase(clubId)}/${id}`);
}
export async function saveVolunteerHours(clubId: number, id: number, entries: { signupId: number; hours: number | null }[]): Promise<VolunteerSheet> {
  return (await api.put(`${sheetsBase(clubId)}/${id}/hours`, { entries })).data;
}
export async function removeVolunteerSignup(clubId: number, id: number, signupId: number): Promise<VolunteerSheet> {
  return (await api.delete(`${sheetsBase(clubId)}/${id}/signups/${signupId}`)).data;
}
// The public sign-up page: no session, so the public instance (no admin token).
export async function getPublicVolunteerSheet(token: string): Promise<PublicVolunteerSheet> {
  return (await publicApi.get(`/api/public/volunteers/${encodeURIComponent(token)}`)).data;
}
export async function publicVolunteerSignup(
  token: string,
  body: { slotId: number; name: string; email: string; consent: boolean; formToken: string; website: string },
): Promise<{ message: string }> {
  return (await publicApi.post(`/api/public/volunteers/${encodeURIComponent(token)}/signup`, body)).data;
}

const speakersBase = (clubId: number) => `/api/clubs/${clubId}/speakers`;

export async function getSpeakers(clubId: number, params: { from?: string; to?: string } = {}): Promise<Speaker[]> {
  return (await api.get(speakersBase(clubId), { params })).data;
}
export async function saveSpeaker(clubId: number, body: SaveSpeaker, id?: number): Promise<Speaker> {
  return (await (id ? api.put(`${speakersBase(clubId)}/${id}`, body) : api.post(speakersBase(clubId), body))).data;
}
export async function deleteSpeaker(clubId: number, id: number): Promise<void> {
  await api.delete(`${speakersBase(clubId)}/${id}`);
}
export async function uploadSpeakerPhoto(clubId: number, id: number, file: File): Promise<Speaker> {
  const form = new FormData();
  form.append("file", await processImageBeforeUpload(file));
  return (await api.post(`${speakersBase(clubId)}/${id}/photo`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
}
export async function getMeetingDuties(clubId: number, params: { from?: string; to?: string } = {}): Promise<MeetingDuty[]> {
  return (await api.get(`/api/clubs/${clubId}/meeting-duties`, { params })).data;
}
export async function addMeetingDuty(clubId: number, body: SaveMeetingDuty): Promise<MeetingDuty> {
  return (await api.post(`/api/clubs/${clubId}/meeting-duties`, body)).data;
}
export async function deleteMeetingDuty(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/meeting-duties/${id}`);
}

// ── Contacts, prospect pipeline, growth and guest invites (N3, feature contacts_growth) ─────────────────
// scope "clubs" | "districts": the same endpoints serve a club and a district.
export type ContactScope = "clubs" | "districts";

export interface Contact {
  id: number;
  name: string;
  email: string | null;
  mobile: string | null;
  contactType: string;
  organisation: string | null;
  notes: string | null;
  source: string;
  createdDate: string;
  groupIds: number[];
  /** Club tags (member flexibility); empty for district contacts. */
  tagIds?: number[];
}
export interface SaveContact {
  name: string;
  email?: string | null;
  mobile?: string | null;
  contactType?: string;
  organisation?: string | null;
  notes?: string | null;
  groupIds?: number[];
}
export interface ContactGroup { id: number; name: string; contactCount: number }
export interface ContactImportPreviewRow {
  row: number;
  name: string;
  email: string | null;
  mobile: string | null;
  contactType: string;
  status: "new" | "duplicate" | "invalid";
  reason: string | null;
  matchId: number | null;
}
export interface ContactImportResult { created: number; updated: number; skipped: number; invalid: number }
export interface StageCount { stage: string; count: number }
export interface ClubGrowth {
  clubId: number;
  yearId: number;
  yearLabel: string;
  target: number | null;
  joined: number;
  terminated: number;
  netGrowth: number;
  currentMembers: number;
  progressPercent: number | null;
  prospectsByStage: StageCount[];
}
export interface DistrictGrowthClub {
  clubId: number;
  clubName: string;
  target: number | null;
  joined: number;
  terminated: number;
  netGrowth: number;
  progressPercent: number | null;
  openProspects: number;
  prospectsByStage: StageCount[];
}
export interface DistrictGrowth {
  districtId: number;
  yearId: number;
  yearLabel: string;
  targetTotal: number;
  clubsWithTarget: number;
  clubsReached: number;
  joined: number;
  terminated: number;
  netGrowth: number;
  prospectsByStage: StageCount[];
  clubs: DistrictGrowthClub[];
}
export interface InvitePrompt {
  id: number;
  meetingDate: string;
  sendOn: string;
  note: string | null;
  status: "scheduled" | "sending" | "sent" | "cancelled";
  sentCount: number;
  sentDate: string | null;
}
export interface PublicInvite {
  clubName: string;
  inviterName: string;
  meetingDate: string | null;
  meetingDay: string | null;
  meetingFromTime: string | null;
  meetingToTime: string | null;
  meetingAddress: string | null;
}

export async function getContacts(scope: ContactScope, ownerId: number,
  params: { search?: string; type?: string; groupId?: number; tagId?: number; page?: number; pageSize?: number }): Promise<PagedResult<Contact>> {
  return (await api.get(`/api/${scope}/${ownerId}/contacts`, { params })).data;
}
export async function createContact(scope: ContactScope, ownerId: number, data: SaveContact): Promise<{ id: number }> {
  return (await api.post(`/api/${scope}/${ownerId}/contacts`, data)).data;
}
export async function updateContact(scope: ContactScope, ownerId: number, id: number, data: SaveContact): Promise<void> {
  await api.put(`/api/${scope}/${ownerId}/contacts/${id}`, data);
}
export async function deleteContact(scope: ContactScope, ownerId: number, id: number): Promise<void> {
  await api.delete(`/api/${scope}/${ownerId}/contacts/${id}`);
}
export async function getContactGroups(scope: ContactScope, ownerId: number): Promise<ContactGroup[]> {
  return (await api.get(`/api/${scope}/${ownerId}/contact-groups`)).data;
}
export async function createContactGroup(scope: ContactScope, ownerId: number, name: string): Promise<{ id: number }> {
  return (await api.post(`/api/${scope}/${ownerId}/contact-groups`, { name })).data;
}
export async function renameContactGroup(scope: ContactScope, ownerId: number, id: number, name: string): Promise<void> {
  await api.put(`/api/${scope}/${ownerId}/contact-groups/${id}`, { name });
}
export async function deleteContactGroup(scope: ContactScope, ownerId: number, id: number): Promise<void> {
  await api.delete(`/api/${scope}/${ownerId}/contact-groups/${id}`);
}
export async function previewContactImport(scope: ContactScope, ownerId: number, rows: object[]): Promise<ContactImportPreviewRow[]> {
  return (await api.post(`/api/${scope}/${ownerId}/contacts/import/preview`, { rows })).data;
}
export async function importContacts(scope: ContactScope, ownerId: number, rows: object[], groupId: number | null,
  updateExisting: boolean): Promise<ContactImportResult> {
  return (await api.post(`/api/${scope}/${ownerId}/contacts/import`, { rows, groupId, updateExisting })).data;
}
export async function inviteContactsToEvent(scope: ContactScope, ownerId: number, eventId: number,
  contactGroupIds: number[]): Promise<{ massEmailId: number }> {
  return (await api.post(`/api/${scope}/${ownerId}/contacts/invite-event`, { eventId, contactGroupIds })).data;
}
export async function convertPotentialMember(clubId: number, id: number): Promise<{ memberId: number; message: string }> {
  return (await api.post(`/api/clubs/${clubId}/potential-members/${id}/convert`)).data;
}
export async function getClubGrowth(clubId: number, yearId?: number | null): Promise<ClubGrowth> {
  return (await api.get(`/api/clubs/${clubId}/growth`, { params: yearId ? { yearId } : undefined })).data;
}
export async function setClubGrowthTarget(clubId: number, yearId: number, target: number): Promise<void> {
  await api.put(`/api/clubs/${clubId}/growth/target`, { yearId, target });
}
export async function getDistrictGrowth(districtId: number, yearId?: number | null): Promise<DistrictGrowth> {
  return (await api.get(`/api/districts/${districtId}/growth`, { params: yearId ? { yearId } : undefined })).data;
}
export async function getInvitePrompts(clubId: number): Promise<InvitePrompt[]> {
  return (await api.get(`/api/clubs/${clubId}/invite-prompts`)).data;
}
export async function createInvitePrompt(clubId: number, data: { meetingDate: string; daysBefore: number; note?: string | null }): Promise<{ id: number }> {
  return (await api.post(`/api/clubs/${clubId}/invite-prompts`, data)).data;
}
export async function sendInvitePromptNow(clubId: number, id: number): Promise<void> {
  await api.post(`/api/clubs/${clubId}/invite-prompts/${id}/send`);
}
export async function cancelInvitePrompt(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/invite-prompts/${id}`);
}
export async function getPublicInvite(token: string): Promise<PublicInvite> {
  return (await publicApi.get(`/api/public/invite/${encodeURIComponent(token)}`)).data;
}
export async function sendInviteRsvp(token: string, body: {
  name: string; email: string; phone: string; attending: boolean; interestedInJoining: boolean;
  consent: boolean; website: string; elapsedMs: number;
}): Promise<{ message: string; kind: "prospect" | "contact" }> {
  return (await publicApi.post(`/api/public/invite/${encodeURIComponent(token)}/rsvp`, body)).data;
}

// ─── N10 live target dashboard (feature target_dashboard) ───────────────────────────────────────────────────────────
export type TargetStatus = "green" | "amber" | "red" | "none";
export type TargetMetricKey = "members" | "growth" | "newMembers" | "dues" | "attendance" | "meetings" | "projects" | "foundation";
export interface TargetMetric {
  actual: number;
  target: number | null;
  percent: number | null;
  status: TargetStatus;
}
export interface TargetClubRow {
  clubId: number;
  clubName: string;
  agMemberId: number | null;
  agName: string | null;
  status: TargetStatus;
  metrics: Record<TargetMetricKey, TargetMetric>;
}
export interface TargetDashboardData {
  districtId: number;
  yearId: number;
  yearLabel: string;
  yearElapsedPercent: number;
  wholeDistrict: boolean;
  totals: Record<TargetMetricKey, TargetMetric>;
  agGroups: { memberId: number; name: string; clubs: number }[];
  clubs: TargetClubRow[];
}
/** Clubs this viewer may see: the whole district for its managers, an AG's group, a club admin's club. */
export async function getDistrictTargets(districtId: number, yearId?: number | null): Promise<TargetDashboardData> {
  return (await api.get(`/api/districts/${districtId}/targets`, { params: yearId ? { yearId } : undefined })).data;
}
/** One club (clubs[0]), for its admins, its AG and the district. */
export async function getClubTargets(clubId: number, yearId?: number | null): Promise<TargetDashboardData> {
  return (await api.get(`/api/clubs/${clubId}/targets`, { params: yearId ? { yearId } : undefined })).data;
}

// N8 Meetings (api/Controllers/MeetingsController.cs, flagged feature "meetings"): calendar feed URLs and
// meeting compliance (meetings held per club against the meetings-per-month rule).
export interface MeetingComplianceClub {
  clubId: number;
  clubName: string;
  required: number;
  isOverride: boolean;
  held: number;
  status: "met" | "due" | "missed";
}

export interface MeetingCompliance {
  month: string; // YYYY-MM
  districtDefault: number;
  districtDefaultIsSet: boolean;
  clubs: MeetingComplianceClub[];
}

export async function getDistrictMeetingCompliance(districtId: number, month?: string): Promise<MeetingCompliance> {
  return (await api.get(`/api/districts/${districtId}/meeting-compliance`, { params: { month } })).data;
}

/** No clubId: the district default. A clubId: that club's override, where null clears it. */
export async function setMeetingRule(districtId: number, meetingsPerMonth: number | null, clubId?: number) {
  await api.put(`/api/districts/${districtId}/meeting-compliance/rule`, { clubId: clubId ?? null, meetingsPerMonth });
}

export async function getClubCalendarFeed(clubId: number): Promise<string | null> {
  return (await api.get(`/api/clubs/${clubId}/calendar-feed`)).data.url ?? null;
}

/** Issues the club's calendar feed URL; an earlier URL stops working. */
export async function resetClubCalendarFeed(clubId: number): Promise<string> {
  return (await api.post(`/api/clubs/${clubId}/calendar-feed`)).data.url;
}

// N5 Communication (api/Controllers/CommsController.cs, flagged feature "communication"): per-language templates,
// sender profile and domains, monthly allowance, campaign tracking, suppressions and opt-outs. scope: club or district.
export type CommsScope = "clubs" | "districts";

export interface CommSettings {
  defaultLanguage: string | null;
  effectiveLanguage: string;
  governorNoteEnabled: boolean;
  governorName: string | null;
  governorPhotoUrl: string | null;
  governorMessage: string | null;
  senderFromName: string | null;
  senderFromEmail: string | null;
  senderReplyTo: string | null;
  /** District only: the Foundation giving link that {{foundation_link}} fills in greetings and milestone texts. */
  foundationGivingUrl: string | null;
}

export interface CommTemplate {
  id: number;
  templateKey: string;
  language: string;
  subject: string;
  bodyHtml: string;
  /** false: a machine translation nobody reviewed yet (beta) */
  reviewed: boolean;
  modifiedDate: string | null;
}

export interface DnsRecord { type: string; host: string; value: string; purpose: string; }

export interface SenderDomain {
  id: number;
  domain: string;
  dkimSelector: string;
  verifyToken: string;
  ownershipOk: boolean;
  spfOk: boolean;
  dkimOk: boolean;
  dmarcOk: boolean;
  verified: boolean;
  checkedAt: string | null;
  records: DnsRecord[];
}

export interface CampaignCounts {
  id: number;
  subject: string;
  sentDate: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complaints: number;
  skipped: number;
}

export interface CommUsage {
  month: string;
  edition: string;
  perMember: number | null;
  members: number;
  allowance: number | null;
  used: number;
  remaining: number | null;
  campaigns: CampaignCounts[];
}

export interface CampaignRecipientTracking {
  memberName: string | null;
  email: string | null;
  language: string | null;
  status: string;
  deliveryStatus: string | null;
  sentDate: string | null;
  openedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  clickCount: number;
  errorMessage: string | null;
}

export interface CampaignTracking extends CampaignCounts {
  status: string;
  templateKey: string | null;
  recipients: number;
  failed: number;
  recipientRows: CampaignRecipientTracking[];
}

export interface CommSuppression { id: number; email: string; reason: string; createdDate: string; }
export interface CommOptOut { memberId: number; memberName: string | null; channel: string; changedAtUtc: string; source: string; }

const commsBase = (scope: CommsScope, id: number) => `/api/${scope}/${id}/comms`;

export async function getCommSettings(scope: CommsScope, id: number): Promise<CommSettings> {
  return (await api.get(`${commsBase(scope, id)}/settings`)).data;
}
export async function saveCommSettings(scope: CommsScope, id: number, settings: Partial<CommSettings>): Promise<CommSettings> {
  return (await api.put(`${commsBase(scope, id)}/settings`, settings)).data;
}
export async function getCommTemplates(scope: CommsScope, id: number): Promise<CommTemplate[]> {
  return (await api.get(`${commsBase(scope, id)}/templates`)).data;
}
export async function saveCommTemplate(scope: CommsScope, id: number,
  t: { templateKey: string; language: string; subject: string; bodyHtml: string; reviewed: boolean }): Promise<CommTemplate> {
  return (await api.put(`${commsBase(scope, id)}/templates`, t)).data;
}
export async function deleteCommTemplate(scope: CommsScope, id: number, templateId: number) {
  await api.delete(`${commsBase(scope, id)}/templates/${templateId}`);
}
export async function getSenderDomains(scope: CommsScope, id: number): Promise<SenderDomain[]> {
  return (await api.get(`${commsBase(scope, id)}/domains`)).data;
}
export async function addSenderDomain(scope: CommsScope, id: number, domain: string, dkimSelector?: string): Promise<SenderDomain> {
  return (await api.post(`${commsBase(scope, id)}/domains`, { domain, dkimSelector: dkimSelector || null })).data;
}
export async function verifySenderDomain(scope: CommsScope, id: number, domainId: number): Promise<SenderDomain> {
  return (await api.post(`${commsBase(scope, id)}/domains/${domainId}/verify`)).data;
}
export async function deleteSenderDomain(scope: CommsScope, id: number, domainId: number) {
  await api.delete(`${commsBase(scope, id)}/domains/${domainId}`);
}
export async function getCommUsage(scope: CommsScope, id: number, month?: string): Promise<CommUsage> {
  return (await api.get(`${commsBase(scope, id)}/usage`, { params: { month } })).data;
}
export async function getCampaignTracking(scope: CommsScope, id: number, massEmailId: number): Promise<CampaignTracking> {
  return (await api.get(`${commsBase(scope, id)}/campaigns/${massEmailId}`)).data;
}
export async function getCommSuppressions(scope: CommsScope, id: number): Promise<CommSuppression[]> {
  return (await api.get(`${commsBase(scope, id)}/suppressions`)).data;
}
export async function deleteCommSuppression(scope: CommsScope, id: number, suppressionId: number) {
  await api.delete(`${commsBase(scope, id)}/suppressions/${suppressionId}`);
}
export async function getCommOptOuts(scope: CommsScope, id: number): Promise<CommOptOut[]> {
  return (await api.get(`${commsBase(scope, id)}/opt-outs`)).data;
}

/** Machine translation through the API's localization service; untranslatable text comes back as is. */
export async function machineTranslate(target: string, texts: string[]): Promise<string[]> {
  const res = await postTranslate({ target, source: "en", q: texts });
  if (!res.ok) throw new Error("Translation failed");
  return (await res.json()).translations;
}

// Public unsubscribe page (signed token in the link, no login).
export interface UnsubscribeInfo { maskedEmail: string; subscribed: boolean; }

export async function getUnsubscribe(token: string): Promise<UnsubscribeInfo> {
  return (await publicApi.get(`/api/public/comms/unsubscribe/${encodeURIComponent(token)}`)).data;
}
export async function setUnsubscribe(token: string, subscribe: boolean): Promise<UnsubscribeInfo> {
  return (await publicApi.post(`/api/public/comms/unsubscribe/${encodeURIComponent(token)}`, { subscribe })).data;
}

/** The IANA zone a club's or district's events are in (build spec 3.3). */
export async function getEventTimeZone(scope: { clubId: number } | { districtId: number }): Promise<string> {
  const res = await api.get<{ timeZone: string }>("/api/time-zone", { params: scope });
  return res.data.timeZone;
}

// ── RI fields (build spec 3.12) ──────────────────────────────────────────────
export type RiCodeKind = "member_type" | "join_reason" | "termination_reason";
export interface RiCode { id: number; kind: RiCodeKind; code: string; label: string; sortOrder: number }
export interface MembershipRiFields { riMemberType: string | null; joinReasonCode: string | null; terminationReasonCode?: string | null }

export async function getRiCodes(): Promise<RiCode[]> {
  return (await api.get<RiCode[]>("/api/ri-codes")).data;
}
export async function saveRiCode(data: Omit<RiCode, "id">, id?: number): Promise<void> {
  if (id) await api.put(`/api/ri-codes/${id}`, data);
  else await api.post("/api/ri-codes", data);
}
export async function deleteRiCode(id: number): Promise<void> {
  await api.delete(`/api/ri-codes/${id}`);
}
export async function getMembershipRiFields(clubId: number, memberId: number): Promise<MembershipRiFields> {
  return (await api.get<MembershipRiFields>(`/api/clubs/${clubId}/members/${memberId}/ri-fields`)).data;
}
export async function setMembershipRiFields(clubId: number, memberId: number, data: MembershipRiFields): Promise<void> {
  await api.put(`/api/clubs/${clubId}/members/${memberId}/ri-fields`, data);
}

// ── District target setting (build spec B.29) ────────────────────────────────
export type ProposalMetric = "membership_growth" | "meetings" | "dues_collection" | "service_projects" | "foundation_giving";
export interface TargetProposal {
  id: number; clubId: number; clubName: string; yearId: number; metric: ProposalMetric; proposedValue: number;
  status: "proposed" | "accepted" | "countered"; counterValue: number | null; clubNote: string | null;
  proposedAt: string; respondedAt: string | null;
}
export async function getDistrictTargetProposals(districtId: number, yearId: number | null): Promise<TargetProposal[]> {
  return (await api.get<TargetProposal[]>(`/api/districts/${districtId}/targets/proposals`, { params: yearId ? { yearId } : undefined })).data;
}
export async function proposeClubTarget(districtId: number, data: { clubId: number; yearId: number | null; metric: ProposalMetric; value: number }): Promise<TargetProposal> {
  return (await api.put<TargetProposal>(`/api/districts/${districtId}/targets/proposals`, data)).data;
}
export async function getClubTargetProposals(clubId: number, yearId: number | null): Promise<TargetProposal[]> {
  return (await api.get<TargetProposal[]>(`/api/clubs/${clubId}/targets/proposals`, { params: yearId ? { yearId } : undefined })).data;
}
export async function answerTargetProposal(clubId: number, id: number, answer: { accept: true } | { value: number; note?: string }): Promise<TargetProposal> {
  const path = `/api/clubs/${clubId}/targets/proposals/${id}`;
  return "accept" in answer ? (await api.post<TargetProposal>(`${path}/accept`)).data : (await api.post<TargetProposal>(`${path}/counter`, answer)).data;
}

// ── Booth sign-ups and onboarding kits (build spec 3.1, 3.2) ─────────────────
export interface BoothSignup {
  id: number; districtId: number; districtNumber: string | null; editionCode: string; memberBand: string | null;
  contactName: string; contactEmail: string; status: "awaiting_payment" | "provisioned" | "rejected";
  paymentNote: string | null; resultNote: string | null; createdAt: string;
}
export async function getBoothSignups(): Promise<BoothSignup[]> {
  return (await api.get<BoothSignup[]>("/api/booth/signups")).data;
}
export async function provisionBoothSignup(id: number, paymentNote: string): Promise<{ result: string }> {
  return (await api.post<{ result: string }>(`/api/booth/signups/${id}/provision`, { paymentNote })).data;
}
export async function rejectBoothSignup(id: number): Promise<void> {
  await api.post(`/api/booth/signups/${id}/reject`);
}
export async function getOnboardingKitHtml(districtId: number, clubId: number): Promise<string> {
  return (await api.get<string>(`/api/districts/${districtId}/onboarding-kit/clubs/${clubId}`, { responseType: "text" })).data;
}
export async function sendOnboardingNudge(districtId: number, clubId: number): Promise<{ sent: number }> {
  return (await api.post<{ sent: number }>(`/api/districts/${districtId}/onboarding-kit/clubs/${clubId}/nudge`)).data;
}

// ── Year-wise Admin Rights (upstream pull 2026-11-06) ──
export interface YearRuleScopeOverride {
  districtId: number;
  districtNumber: string | null;
  clubId: number;
  clubName: string | null;
  isEnabled: boolean;
  notes: string | null;
  modifiedDate: string | null;
  modifiedByName: string | null;
}

export interface YearRuleSettings {
  globalEnabled: boolean;
  globalModifiedDate: string | null;
  globalModifiedByName: string | null;
  districts: YearRuleScopeOverride[];
  clubs: YearRuleScopeOverride[];
}

export interface YearRulePreflightAdmin {
  memberId: number;
  memberName: string;
  sources: string[];
  years: string[];
  allYears: boolean;
  /** No years at all — every edit button goes away the moment the rule applies. */
  wouldLoseAccess: boolean;
}

export interface YearRulePreflight {
  scopeLabel: string;
  allYearsCount: number;
  someYearsCount: number;
  noYearsCount: number;
  admins: YearRulePreflightAdmin[];
  /** District flips only: clubs underneath that will newly start enforcing. */
  cascadeClubCount: number;
  cascadeAdminsWithNoYears: number;
}

export async function getYearRuleSettings(): Promise<YearRuleSettings> {
  const { data } = await api.get("/api/settings/year-rule");
  return data;
}

export async function setYearRuleGlobal(isEnabled: boolean): Promise<{ message: string; isEnabled: boolean }> {
  const { data } = await api.put("/api/settings/year-rule/global", { isEnabled });
  return data;
}

export async function setYearRuleDistrict(districtId: number, isEnabled: boolean, notes?: string) {
  const { data } = await api.put(`/api/settings/year-rule/district/${districtId}`, { isEnabled, notes });
  return data as { message: string; isEnabled: boolean };
}

export async function clearYearRuleDistrict(districtId: number) {
  const { data } = await api.delete(`/api/settings/year-rule/district/${districtId}`);
  return data as { message: string };
}

export async function setYearRuleClub(clubId: number, isEnabled: boolean, notes?: string) {
  const { data } = await api.put(`/api/settings/year-rule/club/${clubId}`, { isEnabled, notes });
  return data as { message: string; isEnabled: boolean };
}

export async function clearYearRuleClub(clubId: number) {
  const { data } = await api.delete(`/api/settings/year-rule/club/${clubId}`);
  return data as { message: string };
}

// Who loses what if this scope is switched ON. Pass exactly one of the two ids.
export async function getYearRulePreflight(params: { clubId?: number; districtId?: number }): Promise<YearRulePreflight> {
  const { data } = await api.get("/api/settings/year-rule/preflight", { params });
  return data;
}

export interface YearRuleMessageSetting {
  /** current_year_only | wrong_year_with_years | wrong_year_no_years | default_actions */
  key: string;
  /** What readers see today — the stored text, or the default. */
  template: string;
  default: string;
  /** False when nobody has edited it, so "Reset" can be hidden. */
  isCustom: boolean;
  modifiedDate: string | null;
  modifiedByName: string | null;
}

export interface YearRuleToken {
  token: string;
  describes: string;
  /** What a screen that cannot fill this token shows instead. */
  fallback: string;
}

export interface YearRuleMessagesSettings {
  messages: YearRuleMessageSetting[];
  tokens: YearRuleToken[];
}

export async function getYearRuleMessageSettings(): Promise<YearRuleMessagesSettings> {
  const { data } = await api.get("/api/settings/year-rule/messages");
  return data;
}

/** A blank or omitted `template` resets that message to its default. */
export async function setYearRuleMessage(key: string, template?: string) {
  const { data } = await api.put("/api/settings/year-rule/messages", { key, template });
  return data as { message: string; key: string; isCustom: boolean; template: string };
}

// ─── Goal Setting: DG "Sync from Rotary.org" (2026-11-06) ─────────────────────────────────────
export interface RotaryOrgSyncStatus {
  canSync: boolean; asOn: string | null; configured?: boolean; estimateMinutes?: number;
  current?: { id: number; status: "QUEUED" | "RUNNING"; stage: string | null; clubsDone: number; clubsTotal: number; queuePosition: number; etaSeconds: number; startedAt: string | null; requestedAt: string } | null;
  savedLogin?: { email: string; allowNightly: boolean; status: "NEW" | "OK" | "EXPIRED" | "MFA" | "DISABLED"; statusMessage: string | null; lastOkAt: string | null } | null;
  last?: { status: "DONE" | "FAILED" | "LOGIN_FAILED"; finishedAt: string | null; error: string | null; rows: number; clubs: number } | null;
  districtAuto?: boolean;   // club only: the district's DG weekly auto-sync is on (it covers this club)
}
// clubId > 0 = that club's own sync (user 2026-11-10: Club Admin / President / Secretary, own Rotary.org login).
export async function getRotaryOrgSyncStatus(districtId: number, clubId?: number): Promise<RotaryOrgSyncStatus> {
  return (await api.get("/api/goal-setting-rotary/sync/status", { params: { districtId, clubId: clubId || 0 } })).data;
}
export async function getRotaryOrgSyncAsOn(districtId: number, clubId?: number): Promise<{ asOn: string | null }> {
  return (await api.get("/api/goal-setting-rotary/sync/as-on", { params: { districtId, clubId: clubId || 0 } })).data;
}
export async function startRotaryOrgSync(body: { districtId: number; clubId?: number; email?: string; password?: string; savePassword?: boolean; allowNightly?: boolean }): Promise<{ requestId: number; alreadyRunning: boolean }> {
  return (await api.post("/api/goal-setting-rotary/sync/start", body)).data;
}
export async function setRotaryOrgSyncNightly(districtId: number, allowNightly: boolean, clubId?: number) {
  return (await api.post("/api/goal-setting-rotary/sync/nightly", { districtId, clubId: clubId || 0, allowNightly })).data;
}
export async function removeRotaryOrgSyncLogin(districtId: number, clubId?: number) {
  return (await api.post("/api/goal-setting-rotary/sync/remove-login", { districtId, clubId: clubId || 0 })).data;
}


// ─── Rotary.org goals page (ROW, 2026-11-09): years, figures, Excel reports ──────────────────
export interface GoalRotaryYear { id: number; yearLabel: string; isCurrent: boolean | number }
export interface GoalRotaryOrgValue { itemName: string; kind: string; value: number | null; source: string | null; updatedAt: string }
export async function getGoalRotaryYears(): Promise<GoalRotaryYear[]> {
  return (await api.get("/api/goal-setting-rotary/years")).data;
}
// One district, or one club (clubId; the new CMR goal panels, RIZones 2026-11-13).
export interface GoalRotaryOrgValues { isCurrentYear: boolean; updatedAt: string | null; values: GoalRotaryOrgValue[] }
export async function getGoalRotaryOrgValues(yearId: number, districtId: number | null, clubId?: number | null): Promise<GoalRotaryOrgValues> {
  return (await api.get("/api/goal-setting-rotary/rotary-org-values", { params: { yearId, districtId: districtId || undefined, clubId: clubId || undefined } })).data;
}
// The 5 Rotary.org club-size (RAG) bands of a district.
export interface GoalRagBands { red: number; yellow: number; orange: number; blue: number; purple: number }
export async function getGoalRotaryRagBands(districtId: number): Promise<GoalRagBands> {
  return (await api.get("/api/goal-setting-rotary/rag-bands", { params: { districtId } })).data;
}
// Dates for the "where this figure comes from" note on goal cards (ROW, used by the new CMR panels).
export interface GoalSourceDates { rotaryOrgSync: string | null; memberSync?: string | null; clubSync?: string | null; dgSync?: string | null; imports: Record<string, string>; lastSaved: Record<number, string>; savedByField?: Record<number, string> }
export async function getGoalSourceDates(yearId: number, districtId: number | null, clubId: number | null): Promise<GoalSourceDates> {
  return (await api.get("/api/goal-setting-rotary/source-dates", { params: { yearId, districtId: districtId || undefined, clubId: clubId || undefined } })).data;
}
export async function downloadGoalRotaryDistrictReport(districtId: number, yearId: number): Promise<Blob> {
  return (await api.get("/api/goal-setting-rotary/report/districts", { params: { districtIds: String(districtId), yearId }, responseType: "blob" })).data;
}
export async function downloadGoalRotaryClubsReport(districtId: number, yearId: number): Promise<Blob> {
  return (await api.get("/api/goal-setting-rotary/report/clubs-all", { params: { districtId, yearId }, responseType: "blob" })).data;
}

// ── District and Club subscriptions (KIS/ROW/SUB/01) ─────────────────────────
export type SubscriptionStateName = "None" | "Active" | "Grace" | "Expired";
export interface SubscriptionTerm { state: SubscriptionStateName; termEnd: string | null }
export interface ClubSubscriptionStatus {
  clubId: number; districtId: number; clubName: string | null; canBuy: boolean;
  level: "None" | "Reporting" | "Full";
  clubSubscription: SubscriptionTerm; districtSubscription: SubscriptionTerm;
  enforced: boolean; graceDays: number;
}
export interface DistrictSubscriptionStatus extends SubscriptionTerm {
  districtId: number; districtNumber: string; canBuy: boolean; enforced: boolean; graceDays: number;
  flaggedClubs: { clubId: number; clubName: string; reason: string; syncedAt: string | null }[] | null;
}
export interface SubscriptionPrice { kind: "district" | "club"; amount: number; currency: string }

export async function getClubSubscription(clubId: number): Promise<ClubSubscriptionStatus> {
  return (await api.get(`/api/subscriptions/club/${clubId}`)).data;
}
export async function getDistrictSubscription(districtId: number): Promise<DistrictSubscriptionStatus> {
  return (await api.get(`/api/subscriptions/district/${districtId}`)).data;
}
export async function getSubscriptionPrices(): Promise<SubscriptionPrice[]> {
  return (await api.get("/api/subscriptions/prices")).data;
}
/** Buy or renew. The amount is set by the server; the response carries the hosted checkout to send the buyer to. */
export async function buySubscription(kind: "district" | "club", districtId: number, clubId: number, returnPath: string): Promise<unknown> {
  return (await api.post("/api/subscriptions/orders", { kind, districtId, clubId, returnPath })).data;
}
export async function setSubscriptionPrice(kind: "district" | "club", amount: number, currency: string): Promise<void> {
  await api.put(`/api/subscriptions/prices/${kind}`, { amount, currency });
}
export async function activateSubscriptionOffline(body: { kind: "district" | "club"; districtId: number; clubId: number; amount: number; currency: string }): Promise<{ orderId: number }> {
  return (await api.post("/api/subscriptions/activate-offline", body)).data;
}

// ===== Attendance rules: makeups, leave, exemptions, standing (gap agent) =====
export type MakeupStatus = "pending" | "approved" | "rejected";
export interface AttendanceMemberStanding {
  memberId: number; memberName: string; counted: number; present: number; madeUp: number; excused: number;
  exempt: boolean; percent: number | null; rule85: boolean; memberType: string; inClubTotal: boolean;
}
export interface AttendanceStanding {
  from: string; to: string; windowDays: number; meetings: number; counted: number; credited: number;
  clubPercent: number | null; members: AttendanceMemberStanding[];
}
export interface AttendanceMakeup {
  id: number; memberId: number; memberName: string; makeupDate: string; makeupType: string; note: string | null;
  missedAttendanceId: number | null; missedEventName: string | null; status: MakeupStatus; reviewNote: string | null; selfLogged: number | boolean;
}
export interface AttendanceLeave { id: number; memberId: number; memberName: string; fromDate: string; toDate: string; reason: string | null }
export interface AttendanceExemption { id: number; memberId: number; memberName: string; reason: string; endDate: string | null }

function attendanceQuery(yearId: number, month?: number | null): string {
  return `yearId=${yearId}${month ? `&month=${month}` : ""}`;
}
export async function getAttendanceStanding(clubId: number, yearId: number, month?: number | null): Promise<AttendanceStanding> {
  return (await api.get(`/api/clubs/${clubId}/attendance/standing?${attendanceQuery(yearId, month)}`)).data;
}
export async function getAttendanceMakeups(clubId: number, yearId: number, status?: MakeupStatus): Promise<AttendanceMakeup[]> {
  return (await api.get(`/api/clubs/${clubId}/attendance/makeups?${attendanceQuery(yearId)}${status ? `&status=${status}` : ""}`)).data;
}
export async function addAttendanceMakeup(clubId: number, body: { memberId: number; makeupDate: string; makeupType: string; note?: string; missedAttendanceId?: number | null }): Promise<{ id: number }> {
  return (await api.post(`/api/clubs/${clubId}/attendance/makeups`, body)).data;
}
export async function reviewAttendanceMakeup(clubId: number, id: number, approve: boolean, note?: string): Promise<void> {
  await api.post(`/api/clubs/${clubId}/attendance/makeups/${id}/review`, { approve, note });
}
export async function deleteAttendanceMakeup(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/attendance/makeups/${id}`);
}
export async function getAttendanceLeaves(clubId: number, yearId: number): Promise<AttendanceLeave[]> {
  return (await api.get(`/api/clubs/${clubId}/attendance/leaves?yearId=${yearId}`)).data;
}
export async function addAttendanceLeave(clubId: number, body: { memberId: number; fromDate: string; toDate: string; reason?: string }): Promise<{ id: number }> {
  return (await api.post(`/api/clubs/${clubId}/attendance/leaves`, body)).data;
}
export async function deleteAttendanceLeave(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/attendance/leaves/${id}`);
}
export async function getAttendanceExemptions(clubId: number): Promise<AttendanceExemption[]> {
  return (await api.get(`/api/clubs/${clubId}/attendance/exemptions`)).data;
}
export async function saveAttendanceExemption(clubId: number, body: { memberId: number; reason: string; endDate?: string | null }): Promise<void> {
  await api.put(`/api/clubs/${clubId}/attendance/exemptions`, body);
}
export async function deleteAttendanceExemption(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/attendance/exemptions/${id}`);
}
export async function getAttendanceSettings(clubId: number): Promise<{ makeupWindowDays: number }> {
  return (await api.get(`/api/clubs/${clubId}/attendance/settings`)).data;
}
export async function saveAttendanceSettings(clubId: number, makeupWindowDays: number): Promise<void> {
  await api.put(`/api/clubs/${clubId}/attendance/settings`, { makeupWindowDays });
}
export type AttendanceCountRule = "counted" | "own_only" | "excluded";
export interface AttendanceMeeting {
  id: number; eventName: string; meetingDate: string; presentCount: number; closed: number | boolean;
  closedDate: string | null; closedByName: string | null;
}
export interface AttendanceMemberTypeRule { memberType: string; label: string; rule: AttendanceCountRule; isDefault: boolean }
export interface AttendanceRule85Row { memberId: number; memberName: string; age: number; years: number; exempt: boolean }
export async function getAttendanceMeetings(clubId: number, yearId: number): Promise<AttendanceMeeting[]> {
  return (await api.get(`/api/clubs/${clubId}/attendance/meetings?yearId=${yearId}`)).data;
}
export async function setAttendanceMeetingClosed(clubId: number, id: number, close: boolean): Promise<void> {
  await api.post(`/api/clubs/${clubId}/attendance/${id}/${close ? "close" : "reopen"}`);
}
export async function downloadAttendanceSignInSheet(clubId: number, id: number): Promise<Blob> {
  return (await api.get(`/api/clubs/${clubId}/attendance/${id}/sign-in-sheet`, { responseType: "blob" })).data;
}
export async function getAttendanceRule85(clubId: number): Promise<AttendanceRule85Row[]> {
  return (await api.get(`/api/clubs/${clubId}/attendance/rule85`)).data;
}
export async function downloadAttendanceRule85(clubId: number, format: "csv" | "pdf"): Promise<Blob> {
  return (await api.get(`/api/clubs/${clubId}/attendance/rule85?format=${format}`, { responseType: "blob" })).data;
}
export async function getAttendanceMemberTypeRules(clubId: number): Promise<AttendanceMemberTypeRule[]> {
  return (await api.get(`/api/clubs/${clubId}/attendance/member-type-rules`)).data;
}
export async function saveAttendanceMemberTypeRule(clubId: number, memberType: string, rule: AttendanceCountRule): Promise<AttendanceMemberTypeRule[]> {
  return (await api.put(`/api/clubs/${clubId}/attendance/member-type-rules`, { memberType, rule })).data;
}

// ===== GDPR erase (gap agent) =====
/** What erasing a member would change, table by table. Writes nothing. */
export async function getErasePreview(memberId: number): Promise<import("@/types/privacy").ErasePreview> {
  return (await api.get(`/api/privacy/members/${memberId}/erase-preview`)).data;
}
/** People who were in the club and have no active membership anywhere: whom the club's admins may erase. */
export async function getClubFormerMembers(clubId: number, q?: string): Promise<import("@/types/privacy").FormerMember[]> {
  return (await api.get(`/api/privacy/clubs/${clubId}/former-members`, { params: q ? { q } : {} })).data;
}

// ===== Club admin limit (gap agent) =====
export interface ClubAdminLimitSetting { max: number; defaultMax: number; isDefault: boolean }
export interface ClubOverAdminLimit {
  clubId: number; clubName: string; districtNumber: string | null; adminCount: number;
  admins: { memberId: number; name: string }[];
}
export async function getClubAdminLimit(): Promise<ClubAdminLimitSetting> {
  return (await api.get("/api/admin/club-admin-limit")).data;
}
export async function setClubAdminLimit(max: number): Promise<ClubAdminLimitSetting> {
  return (await api.put("/api/admin/club-admin-limit", { max })).data;
}
/** Clubs holding more active Club Admins than the limit (SuperAdmins not counted). Nothing is changed for them. */
export async function getClubAdminLimitReport(): Promise<{ max: number; clubs: ClubOverAdminLimit[] }> {
  return (await api.get("/api/admin/club-admin-limit/report")).data;
}

// ===== Account security (gap agent) =====
// MFA (TOTP) and email magic-link sign-in. The login-time calls live under /api/auth/, so a wrong code (401)
// does not trigger the global sign-out redirect.
export type MfaLoginResponse = LoginResponse & {
  mfaRequired?: boolean; mfaToken?: string | null; mfaSetupRequired?: boolean; recoveryCodes?: string[] | null;
};
export interface MfaSetupInfo { secret: string; otpAuthUri: string; qrSvg: string }
export interface MfaStatus { enabled: boolean; required: boolean; enabledAt: string | null; recoveryCodesLeft: number }
export interface ClubSecurityPolicy {
  clubId: number; clubName: string; requireMfa: boolean; updatedAt: string | null; activeMembers: number; membersWithMfa: number;
}
export async function mfaLoginSetup(mfaToken: string): Promise<MfaSetupInfo> {
  return (await api.post("/api/auth/mfa/setup", { mfaToken })).data;
}
export async function mfaLoginVerify(mfaToken: string, code: string): Promise<MfaLoginResponse> {
  return (await api.post("/api/auth/mfa/verify", { mfaToken, code })).data;
}
export async function requestMagicLink(email: string): Promise<{ message: string }> {
  return (await api.post("/api/auth/magic-link", { email })).data;
}
export async function consumeMagicLink(token: string): Promise<MfaLoginResponse> {
  return (await api.post("/api/auth/magic-link/consume", { token })).data;
}
export async function getMfaStatus(): Promise<MfaStatus> {
  return (await api.get("/api/account-security/mfa")).data;
}
export async function startMfaEnrol(): Promise<MfaSetupInfo> {
  return (await api.post("/api/account-security/mfa/enrol")).data;
}
export async function confirmMfaEnrol(code: string): Promise<{ recoveryCodes: string[] }> {
  return (await api.post("/api/account-security/mfa/confirm", { code })).data;
}
export async function disableMfa(code: string): Promise<{ message: string }> {
  return (await api.post("/api/account-security/mfa/disable", { code })).data;
}
export async function regenerateMfaRecoveryCodes(code: string): Promise<{ recoveryCodes: string[] }> {
  return (await api.post("/api/account-security/mfa/recovery-codes", { code })).data;
}
export async function getClubSecurityPolicy(clubId: number): Promise<ClubSecurityPolicy> {
  return (await api.get(`/api/account-security/club-policy/${clubId}`)).data;
}
export async function setClubSecurityPolicy(clubId: number, requireMfa: boolean): Promise<ClubSecurityPolicy> {
  return (await api.put(`/api/account-security/club-policy/${clubId}`, { requireMfa })).data;
}

// ===== Cross-district access (gap agent) =====
export type DistrictAccessStatus = "active" | "scheduled" | "expiring" | "expired" | "revoked";
export interface DistrictAccessGrant {
  id: number; memberId: number; memberName: string | null; districtId: number; districtNumber: string | null;
  canWrite: boolean; purpose: string; note: string | null; startsAtUtc: string; expiresAtUtc: string;
  grantedBy: number; grantedByName: string | null; grantedAtUtc: string;
  revokedAtUtc: string | null; revokedByName: string | null; revokeReason: string | null; status: DistrictAccessStatus;
}
export interface DistrictAccessList { items: DistrictAccessGrant[]; counts: Partial<Record<DistrictAccessStatus, number>>; expiringSoonDays: number }
export interface DistrictAccessMember { id: number; name: string; clubName: string | null; districtNumber: string | null }
export async function getDistrictAccessGrants(status?: string): Promise<DistrictAccessList> {
  return (await api.get("/api/district-access-grants", { params: status ? { status } : undefined })).data;
}
export async function getDistrictAccessDistricts(): Promise<{ id: number; districtNumber: string }[]> {
  return (await api.get("/api/district-access-grants/districts")).data;
}
export async function searchDistrictAccessMembers(q: string): Promise<DistrictAccessMember[]> {
  return (await api.get("/api/district-access-grants/members", { params: { q } })).data;
}
export async function createDistrictAccessGrant(body: {
  memberId: number; districtId: number; canWrite: boolean; purpose: string; note?: string; startsAtUtc: string; expiresAtUtc: string;
}): Promise<{ id: number }> {
  return (await api.post("/api/district-access-grants", body)).data;
}
export async function revokeDistrictAccessGrant(id: number, reason?: string): Promise<void> {
  await api.post(`/api/district-access-grants/${id}/revoke`, { reason });
}

// ===== Invoices and statements (gap agent) =====
export type InvoiceStatus = "open" | "part_paid" | "paid" | "void";
export interface ClubInvoice {
  id: number; invoiceNo: string; memberId: number; memberName: string; duesId: number | null; memberFeeId: number | null;
  feeType: number | null; kind: "dues" | "items"; issueDate: string; dueDate: string; amount: number; paidAmount: number;
  balance: number; status: InvoiceStatus; description: string | null; notes: string | null; voidReason: string | null;
  emailCount: number; emailedAt: string | null;
}
export interface InvoiceLineItem { productId: number | null; description: string; quantity: number; unitAmount: number; amount: number }
export interface InvoiceAppliedPayment { date: string; reference: string; method: string; amount: number }
export interface InvoiceDetail { invoice: ClubInvoice; lines: InvoiceLineItem[]; payments: InvoiceAppliedPayment[] }
export interface InvoiceProduct { id: number; name: string; description: string | null; unitAmount: number; isActive: boolean }
export interface MemberBalance {
  memberId: number; memberName: string; openInvoices: number; invoiced: number; paid: number; outstanding: number; credit: number; oldestDue: string | null;
}
export interface InvoiceReceipt {
  id: number; memberId: number; memberName: string; receiptDate: string; method: string; reference: string | null; amount: number; applied: number; notes: string | null;
}
export interface MemberStatement {
  from: string; to: string; opening: number; charges: number; payments: number; closing: number;
  rows: { date: string; isCharge: boolean; reference: string; description: string; amount: number; balance: number }[];
}
export interface InvoiceRunResult { created: number; skipped: number; invoiceNos: string[] }
export interface InvoiceEmailResult { sent: number; skipped: number; problems: string[] }

const inv = (clubId: number) => `/api/clubs/${clubId}/invoices`;
export async function getClubInvoices(clubId: number, params?: { status?: InvoiceStatus; memberId?: number; duesId?: number }): Promise<ClubInvoice[]> {
  return (await api.get(inv(clubId), { params })).data;
}
export async function getClubInvoice(clubId: number, id: number): Promise<InvoiceDetail> {
  return (await api.get(`${inv(clubId)}/${id}`)).data;
}
export async function generateDuesInvoices(clubId: number, body: { duesId: number; feeType: number; issueDate: string; dueDate: string }): Promise<InvoiceRunResult> {
  return (await api.post(`${inv(clubId)}/generate-dues`, body)).data;
}
export async function createClubInvoices(clubId: number, body: {
  memberIds: number[]; issueDate: string; dueDate: string; notes?: string;
  lines: { productId: number | null; description: string; quantity: number; unitAmount: number }[];
}): Promise<InvoiceRunResult> {
  return (await api.post(inv(clubId), body)).data;
}
export async function voidClubInvoice(clubId: number, id: number, reason: string): Promise<void> {
  await api.post(`${inv(clubId)}/${id}/void`, { reason });
}
export async function emailClubInvoices(clubId: number, invoiceIds: number[]): Promise<InvoiceEmailResult> {
  return (await api.post(`${inv(clubId)}/email`, { invoiceIds }, { timeout: 300000 })).data;
}
export async function getMemberBalances(clubId: number): Promise<MemberBalance[]> {
  return (await api.get(`${inv(clubId)}/balances`)).data;
}
export async function getMemberStatement(clubId: number, memberId: number, from: string, to: string): Promise<MemberStatement> {
  return (await api.get(`${inv(clubId)}/members/${memberId}/statement`, { params: { from, to } })).data;
}
export async function getInvoiceProducts(clubId: number, activeOnly = false): Promise<InvoiceProduct[]> {
  return (await api.get(`${inv(clubId)}/products`, { params: { activeOnly } })).data;
}
export async function saveInvoiceProduct(clubId: number, p: { id?: number; name: string; description?: string; unitAmount: number; isActive: boolean }): Promise<void> {
  if (p.id) await api.put(`${inv(clubId)}/products/${p.id}`, p);
  else await api.post(`${inv(clubId)}/products`, p);
}
export async function getInvoiceReceipts(clubId: number, memberId?: number): Promise<InvoiceReceipt[]> {
  return (await api.get(`${inv(clubId)}/receipts`, { params: { memberId } })).data;
}
export async function recordInvoicePayment(clubId: number, body: {
  memberId: number; receiptDate: string; method: "cash" | "cheque" | "bank"; reference?: string; amount: number; notes?: string;
  splits?: { invoiceId: number; amount: number }[];
}): Promise<{ id: number }> {
  return (await api.post(`${inv(clubId)}/receipts`, body)).data;
}
/** PDFs and QuickBooks files come back as a Blob; the caller saves it. */
export async function downloadInvoiceFile(clubId: number, path: string, params?: Record<string, string>): Promise<Blob> {
  return (await api.get(`${inv(clubId)}/${path}`, { params, responseType: "blob", timeout: 300000 })).data;
}
export interface MealMeetingRow { attendanceId: number; eventName: string; eventDate: string; meetingPrice: number | null; diners: number; billed: number }
export interface MealCharge {
  id: number; attendanceId: number; eventName: string; mealDate: string; memberId: number; memberName: string; guestName: string;
  amount: number; invoiceId: number | null; invoiceNo: string | null; billed: boolean;
}
export interface MealMeetingDetail {
  meeting: { attendanceId: number; eventName: string; eventDate: string; meetingPrice: number | null };
  defaultPrice: number | null;
  members: { memberId: number; memberName: string; attended: boolean }[];
  charges: MealCharge[];
}
export interface MealBillResult { invoicesCreated: number; invoicesUpdated: number; chargesBilled: number; invoiceNos: string[] }
export async function getMealSettings(clubId: number): Promise<{ defaultPrice: number | null }> {
  return (await api.get(`${inv(clubId)}/meals/settings`)).data;
}
export async function saveMealSettings(clubId: number, defaultPrice: number): Promise<void> {
  await api.put(`${inv(clubId)}/meals/settings`, { defaultPrice });
}
export async function getMealMeetings(clubId: number, from: string, to: string): Promise<MealMeetingRow[]> {
  return (await api.get(`${inv(clubId)}/meals/meetings`, { params: { from, to } })).data;
}
export async function getMealMeeting(clubId: number, attendanceId: number): Promise<MealMeetingDetail> {
  return (await api.get(`${inv(clubId)}/meals/meetings/${attendanceId}`)).data;
}
export async function saveMealDiners(clubId: number, attendanceId: number, body: {
  price?: number; diners: { memberId: number; ate: boolean; guests: string[] }[];
}): Promise<{ meals: number }> {
  return (await api.put(`${inv(clubId)}/meals/meetings/${attendanceId}`, body)).data;
}
export async function billMeals(clubId: number, body: { month: string; mode: "monthly" | "open"; issueDate: string; dueDate: string }): Promise<MealBillResult> {
  return (await api.post(`${inv(clubId)}/meals/bill`, body)).data;
}
// ===== end Invoices and statements (gap agent) =====

// ===== Club accounts (gap agent) =====
// Chart of accounts, double-entry journal (posted entries are only reversed), P&L, balance sheet, budget vs actual.
export type ClubAccountType = "asset" | "liability" | "equity" | "income" | "expense";
export interface ClubAccount { id: number; code: string; name: string; type: ClubAccountType; systemKey: string | null; isBank: boolean; bankName: string | null; accountLast4: string | null; isActive: boolean; balance: number; used: boolean }
export interface SaveClubAccount { code: string; name: string; type: ClubAccountType; isBank: boolean; bankName: string | null; accountLast4: string | null; isActive: boolean }
export interface JournalLine { accountId: number; code: string; name: string; debit: number; credit: number; description: string | null }
export interface JournalEntry { id: number; entryDate: string; memo: string; sourceType: string | null; sourceId: string | null; reversesEntryId: number | null; reversedByEntryId: number | null; createdAt: string; createdByName: string | null; total: number; lines: JournalLine[]; vendorId: number | null; vendorName: string | null; reference: string | null }
export interface ClubAccountsSummary { yearLabel: string | null; yearStart: string | null; yearEnd: string | null; banks: ClubAccount[]; yearIncome: number; yearExpenses: number; yearNet: number; recent: JournalEntry[] }
export interface LedgerReportLine { accountId: number; code: string; name: string; amount: number }
export interface ProfitAndLoss { income: LedgerReportLine[]; expenses: LedgerReportLine[]; totalIncome: number; totalExpenses: number; net: number }
export interface BalanceSheet { assets: LedgerReportLine[]; liabilities: LedgerReportLine[]; equity: LedgerReportLine[]; totalAssets: number; totalLiabilities: number; currentEarnings: number; totalEquity: number; balanced: boolean }
export interface BudgetLine { accountId: number; code: string; name: string; type: string; budget: number; actual: number; variance: number; percentUsed: number | null }
export interface BudgetReport { year: { id: number; yearLabel: string; startDate: string; endDate: string }; report: { lines: BudgetLine[]; budgetIncome: number; actualIncome: number; budgetExpenses: number; actualExpenses: number } }
export type AccountsReport = "profit-loss" | "balance-sheet" | "budget" | "journal" | "aged";
export interface NewJournalLine { accountId: number; debit: number; credit: number; description: string | null }
const acctBase = (clubId: number) => `/api/clubs/${clubId}/accounts`;
export async function getClubAccountsSummary(clubId: number): Promise<ClubAccountsSummary> {
  return (await api.get(`${acctBase(clubId)}/summary`)).data;
}
export async function getClubAccounts(clubId: number): Promise<ClubAccount[]> {
  return (await api.get(acctBase(clubId))).data;
}
export async function saveClubAccount(clubId: number, accountId: number | null, body: SaveClubAccount): Promise<ClubAccount> {
  return (accountId ? await api.put(`${acctBase(clubId)}/chart/${accountId}`, body) : await api.post(`${acctBase(clubId)}/chart`, body)).data;
}
export async function getJournal(clubId: number, params: { from?: string; to?: string; accountId?: number }): Promise<JournalEntry[]> {
  return (await api.get(`${acctBase(clubId)}/journal`, { params })).data;
}
export async function createJournalEntry(clubId: number, body: { entryDate: string; memo: string; lines: NewJournalLine[]; vendorId?: number | null; reference?: string | null }): Promise<JournalEntry> {
  return (await api.post(`${acctBase(clubId)}/journal`, body)).data;
}
export async function createQuickEntry(clubId: number, body: { kind: "in" | "out"; entryDate: string; categoryAccountId: number; bankAccountId: number; amount: number; memo: string; vendorId?: number | null; reference?: string | null }): Promise<JournalEntry> {
  return (await api.post(`${acctBase(clubId)}/journal/quick`, body)).data;
}
export async function reverseJournalEntry(clubId: number, entryId: number, body: { entryDate?: string; memo?: string }): Promise<JournalEntry> {
  return (await api.post(`${acctBase(clubId)}/journal/${entryId}/reverse`, body)).data;
}
export async function getProfitAndLoss(clubId: number, from: string, to: string): Promise<ProfitAndLoss> {
  return (await api.get(`${acctBase(clubId)}/reports/profit-loss`, { params: { from, to } })).data;
}
export async function getBalanceSheet(clubId: number, asOf: string): Promise<BalanceSheet> {
  return (await api.get(`${acctBase(clubId)}/reports/balance-sheet`, { params: { asOf } })).data;
}
export async function getBudgetReport(clubId: number, yearId: number): Promise<BudgetReport> {
  return (await api.get(`${acctBase(clubId)}/reports/budget`, { params: { yearId } })).data;
}
export async function saveBudget(clubId: number, yearId: number, lines: { accountId: number; amount: number }[]): Promise<void> {
  await api.put(`${acctBase(clubId)}/budget/${yearId}`, { lines });
}
export async function downloadAccountsReport(clubId: number, report: AccountsReport, format: "csv" | "xlsx" | "pdf", params: Record<string, string | number>): Promise<Blob> {
  return (await api.get(`${acctBase(clubId)}/export/${report}`, { params: { ...params, format }, responseType: "blob" })).data;
}

// Club accounts, second package: payees, bank reconciliation, payment voucher, aged balances.
export interface ClubVendor { id: number; name: string; email: string | null; phone: string | null; address: string | null; notes: string | null; isActive: boolean; paidThisYear: number }
export interface SaveClubVendor { name: string; email: string | null; phone: string | null; address: string | null; notes: string | null; isActive: boolean }
export interface StatementLine { id: number; lineDate: string; description: string; amount: number; journalLineId: number | null; journalEntryId: number | null; journalMemo: string | null; reconciledAt: string | null }
export interface BookLine { journalLineId: number; entryId: number; entryDate: string; memo: string; amount: number; reference: string | null }
export interface Reconciliation { accountId: number; accountName: string; bookBalance: number; reconciledBalance: number; statementTotal: number; unreconciledBook: number; statement: StatementLine[]; unmatchedBook: BookLine[] }
export interface AgedRow { memberId: number; memberName: string; notDue: number; days0To30: number; days31To60: number; days61To90: number; over90: number; total: number; items: { item: string; amount: number; dueDate: string }[] }
export interface AgedReport { asOf: string; rows: AgedRow[]; totals: AgedRow }
export async function getClubVendors(clubId: number): Promise<ClubVendor[]> {
  return (await api.get(`${acctBase(clubId)}/vendors`)).data;
}
export async function saveClubVendor(clubId: number, vendorId: number | null, body: SaveClubVendor): Promise<ClubVendor> {
  return (vendorId ? await api.put(`${acctBase(clubId)}/vendors/${vendorId}`, body) : await api.post(`${acctBase(clubId)}/vendors`, body)).data;
}
export async function getReconciliation(clubId: number, accountId: number): Promise<Reconciliation> {
  return (await api.get(`${acctBase(clubId)}/reconciliation/${accountId}`)).data;
}
export async function addStatementLines(clubId: number, accountId: number, lines: { lineDate: string; description: string; amount: number }[]): Promise<{ added: number; problems: string[] }> {
  return (await api.post(`${acctBase(clubId)}/reconciliation/${accountId}/lines`, { lines })).data;
}
export async function importStatementCsv(clubId: number, accountId: number, file: File): Promise<{ added: number; problems: string[] }> {
  const form = new FormData();
  form.append("file", file);
  return (await api.post(`${acctBase(clubId)}/reconciliation/${accountId}/import`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
}
export async function autoMatchStatement(clubId: number, accountId: number): Promise<{ matched: number }> {
  return (await api.post(`${acctBase(clubId)}/reconciliation/${accountId}/auto-match`)).data;
}
export async function matchStatementLine(clubId: number, lineId: number, journalLineId: number): Promise<void> {
  await api.post(`${acctBase(clubId)}/statement-lines/${lineId}/match`, { journalLineId });
}
export async function unmatchStatementLine(clubId: number, lineId: number): Promise<void> {
  await api.post(`${acctBase(clubId)}/statement-lines/${lineId}/unmatch`);
}
export async function deleteStatementLine(clubId: number, lineId: number): Promise<void> {
  await api.delete(`${acctBase(clubId)}/statement-lines/${lineId}`);
}
export async function downloadVoucher(clubId: number, entryId: number): Promise<Blob> {
  return (await api.get(`${acctBase(clubId)}/journal/${entryId}/voucher`, { responseType: "blob" })).data;
}
export async function getAgedBalances(clubId: number, asOf: string): Promise<AgedReport> {
  return (await api.get(`${acctBase(clubId)}/reports/aged`, { params: { asOf } })).data;
}

// ===== Grants lifecycle (gap agent) =====
// Interim reports, file kinds for the document archive, report reminders and the per-year summary (GrantsController).
export async function submitGrantInterimReport(clubId: number, id: number, body: { progress: string; amountSpent: number | null }): Promise<GrantApplication> {
  return (await api.post(`${grantsBase("club", clubId)}/applications/${id}/interim-reports`, body)).data;
}
export async function uploadGrantFileOfKind(clubId: number, id: number, file: File, kind: string): Promise<GrantAttachment> {
  const checked = file.type.startsWith("image/") ? await processImageBeforeUpload(file) : await processDocumentBeforeUpload(file);
  const form = new FormData();
  form.append("file", checked);
  return (await api.post(`${grantsBase("club", clubId)}/applications/${id}/attachments`, form, {
    params: { kind },
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  })).data;
}
export async function sendGrantReportReminders(districtId: number): Promise<{ sent: number }> {
  return (await api.post(`${grantsBase("district", districtId)}/reminders`)).data;
}
export async function getGrantYearSummary(districtId: number): Promise<import("@/types/grants").GrantYearSummary[]> {
  return (await api.get(`${grantsBase("district", districtId)}/summary`)).data;
}
// Grants extras: qualified clubs, monthly cash flow with receipts (Excel), notification email templates.
export async function getGrantQualifications(districtId: number, yearId: number): Promise<import("@/types/grants").GrantClubQualification[]> {
  return (await api.get(`${grantsBase("district", districtId)}/qualifications`, { params: { yearId } })).data;
}
export async function saveGrantQualification(districtId: number, clubId: number, yearId: number, body: import("@/types/grants").SaveGrantQualification): Promise<import("@/types/grants").GrantClubQualification> {
  return (await api.put(`${grantsBase("district", districtId)}/qualifications/${clubId}/${yearId}`, body)).data;
}
export async function getGrantMonthlyCashFlow(districtId: number, cycleId: number): Promise<import("@/types/grants").GrantMonthlyCashFlow> {
  return (await api.get(`${grantsBase("district", districtId)}/cycles/${cycleId}/monthly`)).data;
}
export async function addGrantReceipt(districtId: number, cycleId: number, body: { amount: number; receivedOn: string; source: string; reference: string | null }): Promise<import("@/types/grants").GrantMonthlyCashFlow> {
  return (await api.post(`${grantsBase("district", districtId)}/cycles/${cycleId}/receipts`, body)).data;
}
export async function deleteGrantReceipt(districtId: number, cycleId: number, receiptId: number): Promise<void> {
  await api.delete(`${grantsBase("district", districtId)}/cycles/${cycleId}/receipts/${receiptId}`);
}
export async function downloadGrantMonthlyCashFlow(districtId: number, cycleId: number, yearLabel: string) {
  const r = await api.get(`${grantsBase("district", districtId)}/cycles/${cycleId}/monthly/export`, { responseType: "blob" });
  saveBlob(new Blob([r.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `grants_cash_flow_${yearLabel}_${fileTimestamp()}.xlsx`);
}
export async function getGrantEmailTemplates(districtId: number): Promise<{ templates: import("@/types/grants").GrantEmailTemplate[]; placeholders: string[] }> {
  return (await api.get(`${grantsBase("district", districtId)}/email-templates`)).data;
}
export async function saveGrantEmailTemplate(districtId: number, kind: string, body: { subject: string; body: string }): Promise<import("@/types/grants").GrantEmailTemplate> {
  return (await api.put(`${grantsBase("district", districtId)}/email-templates/${kind}`, body)).data;
}
export async function resetGrantEmailTemplate(districtId: number, kind: string): Promise<import("@/types/grants").GrantEmailTemplate> {
  return (await api.delete(`${grantsBase("district", districtId)}/email-templates/${kind}`)).data;
}
export async function previewGrantEmailTemplate(districtId: number, kind: string, body: { subject: string; body: string }): Promise<{ subject: string; html: string }> {
  return (await api.post(`${grantsBase("district", districtId)}/email-templates/${kind}/preview`, body)).data;
}
export async function getGrantSettings(districtId: number): Promise<{ requireQualification: boolean }> {
  return (await api.get(`${grantsBase("district", districtId)}/settings`)).data;
}
export async function saveGrantSettings(districtId: number, body: { requireQualification: boolean }): Promise<{ requireQualification: boolean }> {
  return (await api.put(`${grantsBase("district", districtId)}/settings`, body)).data;
}

// ===== Email bulletins (gap agent) =====
export interface BulletinDraft {
  title: string; intro: string | null; presidentMessage: string | null; layout: "classic" | "compact" | "spotlight";
  announcementIds: number[]; eventIds: number[]; storyIds: number[]; includeBirthdays: boolean; includeSpeakers: boolean;
}
export interface BulletinListItem {
  id: number; title: string; layout: string; status: string; sentDate: string | null; createdDate: string;
  massEmailId: number | null; totalRecipients: number | null; subscriberCount: number;
}
export interface BulletinDetail extends BulletinDraft {
  id: number; clubId: number; status: string; massEmailId: number | null; sentDate: string | null; createdDate: string; html: string | null;
}
export interface BulletinOption { id: number; title: string; date: string | null }
export async function getBulletins(clubId: number): Promise<BulletinListItem[]> {
  return (await api.get(`/api/clubs/${clubId}/bulletins`)).data;
}
export async function getBulletin(clubId: number, id: number): Promise<BulletinDetail> {
  return (await api.get(`/api/clubs/${clubId}/bulletins/${id}`)).data;
}
export interface BulletinOptions {
  announcements: BulletinOption[]; events: BulletinOption[]; stories: BulletinOption[]; confirmedSubscribers: number;
}
export async function getBulletinOptions(clubId: number): Promise<BulletinOptions> {
  return (await api.get(`/api/clubs/${clubId}/bulletins/options`)).data;
}
export async function previewBulletin(clubId: number, draft: BulletinDraft): Promise<{ html: string }> {
  return (await api.post(`/api/clubs/${clubId}/bulletins/preview`, draft)).data;
}
export async function createBulletin(clubId: number, draft: BulletinDraft): Promise<{ id: number }> {
  return (await api.post(`/api/clubs/${clubId}/bulletins`, draft)).data;
}
export async function updateBulletin(clubId: number, id: number, draft: BulletinDraft): Promise<{ id: number }> {
  return (await api.put(`/api/clubs/${clubId}/bulletins/${id}`, draft)).data;
}
export async function deleteBulletin(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/bulletins/${id}`);
}
/** recipientType 1 = all members, 2 = the given sub groups. Confirmed subscribers get it either way. */
export async function sendBulletin(clubId: number, id: number, recipientType: 1 | 2 = 1, subgroupIds: number[] = []):
  Promise<{ massEmailId: number; subscribers: number; message: string }> {
  return (await api.post(`/api/clubs/${clubId}/bulletins/${id}/send`, { recipientType, subgroupIds })).data;
}
export async function getMassEmailNonOpeners(clubId: number, id: number): Promise<{ count: number }> {
  return (await api.get(`/api/clubs/${clubId}/mass-emails/${id}/non-openers`)).data;
}
export async function resendMassEmailToNonOpeners(clubId: number, id: number, subject: string | null): Promise<{ id: number; message: string }> {
  return (await api.post(`/api/clubs/${clubId}/mass-emails/${id}/resend-non-openers`, { subject })).data;
}
export interface ClubStory {
  id: number; title: string; body: string; status: "Pending" | "Approved" | "Rejected" | "ChangesRequested";
  authorId: number; authorName: string | null; submittedDate: string; reviewerName: string | null; reviewNote: string | null; reviewedDate: string | null;
}
export async function getClubStories(clubId: number, status?: string): Promise<{ canReview: boolean; items: ClubStory[] }> {
  return (await api.get(`/api/club-stories/${clubId}`, { params: status ? { status } : undefined })).data;
}
export async function reviewClubStory(clubId: number, id: number, decision: "approve" | "reject" | "changes", note: string | null): Promise<void> {
  await api.post(`/api/club-stories/${clubId}/${id}/review`, { decision, note });
}
export interface BulletinSubscriber {
  id: number; email: string; name: string | null; status: "Pending" | "Confirmed" | "Unsubscribed";
  signupDate: string; confirmedDate: string | null; unsubscribedDate: string | null;
}
export async function getBulletinSubscribers(clubId: number): Promise<BulletinSubscriber[]> {
  return (await api.get(`/api/clubs/${clubId}/bulletin-subscribers`)).data;
}
export async function removeBulletinSubscriber(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/bulletin-subscribers/${id}`);
}

// ===== Mass email compose (gap agent) =====
// Template library, merge fields, attachments and the sender's signature. scope: "clubs" | "districts".
export interface MassEmailTemplate { id: number; key: string | null; name: string; subject: string; bodyHtml: string; isStarter: boolean; modifiedDate: string | null }
export interface MassEmailMergeField { token: string; label: string }
export interface MassEmailTemplateLibrary { starters: MassEmailTemplate[]; saved: MassEmailTemplate[]; mergeFields: MassEmailMergeField[] }
export interface MassEmailAttachment { id: number; fileName: string; contentType: string; sizeBytes: number; createdDate: string }
export async function getMassEmailTemplates(scope: CommsScope, ownerId: number): Promise<MassEmailTemplateLibrary> {
  return (await api.get(`/api/${scope}/${ownerId}/mass-email-templates`)).data;
}
export async function createMassEmailTemplate(scope: CommsScope, ownerId: number, body: { name: string; subject: string; bodyHtml: string }): Promise<{ id: number }> {
  return (await api.post(`/api/${scope}/${ownerId}/mass-email-templates`, body)).data;
}
export async function updateMassEmailTemplate(scope: CommsScope, ownerId: number, id: number, body: { name: string; subject: string; bodyHtml: string }) {
  return (await api.put(`/api/${scope}/${ownerId}/mass-email-templates/${id}`, body)).data;
}
export async function deleteMassEmailTemplate(scope: CommsScope, ownerId: number, id: number) {
  return (await api.delete(`/api/${scope}/${ownerId}/mass-email-templates/${id}`)).data;
}
export async function getMassEmailAttachments(scope: CommsScope, ownerId: number, emailId: number): Promise<MassEmailAttachment[]> {
  return (await api.get(`/api/${scope}/${ownerId}/mass-emails/${emailId}/attachments`)).data;
}
export async function uploadMassEmailAttachment(scope: CommsScope, ownerId: number, emailId: number, file: File): Promise<MassEmailAttachment> {
  const form = new FormData();
  form.append("file", file);
  return (await api.post(`/api/${scope}/${ownerId}/mass-emails/${emailId}/attachments`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
}
export async function deleteMassEmailAttachment(scope: CommsScope, ownerId: number, emailId: number, attachmentId: number) {
  return (await api.delete(`/api/${scope}/${ownerId}/mass-emails/${emailId}/attachments/${attachmentId}`)).data;
}
export async function downloadMassEmailAttachment(scope: CommsScope, ownerId: number, emailId: number, attachmentId: number): Promise<Blob> {
  return (await api.get(`/api/${scope}/${ownerId}/mass-emails/${emailId}/attachments/${attachmentId}/download`, { responseType: "blob" })).data;
}
export async function getMassEmailSignature(): Promise<{ html: string }> {
  return (await api.get("/api/mass-email/signature")).data;
}
export async function saveMassEmailSignature(html: string): Promise<{ html: string }> {
  return (await api.put("/api/mass-email/signature", { html })).data;
}

// ===== Surveys (gap agent) =====
// api/Controllers/SurveysController.cs: a club's or a district's surveys and polls.
import type { SaveSurvey, Survey, SurveyResults, SurveyScope, SurveySubGroup } from "@/types/surveys";

const surveysBase = (scope: SurveyScope, id: number) => `/api/${scope}/${id}/surveys`;

export async function getSurveys(scope: SurveyScope, id: number): Promise<Survey[]> {
  return (await api.get(surveysBase(scope, id))).data;
}
export async function getSurvey(scope: SurveyScope, id: number, surveyId: number): Promise<Survey> {
  return (await api.get(`${surveysBase(scope, id)}/${surveyId}`)).data;
}
export async function getSurveySubGroups(clubId: number): Promise<SurveySubGroup[]> {
  return (await api.get(`${surveysBase("clubs", clubId)}/sub-groups`)).data;
}
export async function createSurvey(scope: SurveyScope, id: number, body: SaveSurvey): Promise<{ id: number }> {
  return (await api.post(surveysBase(scope, id), body)).data;
}
export async function updateSurvey(scope: SurveyScope, id: number, surveyId: number, body: SaveSurvey): Promise<Survey> {
  return (await api.put(`${surveysBase(scope, id)}/${surveyId}`, body)).data;
}
export async function deleteSurvey(scope: SurveyScope, id: number, surveyId: number): Promise<void> {
  await api.delete(`${surveysBase(scope, id)}/${surveyId}`);
}
export async function publishSurvey(scope: SurveyScope, id: number, surveyId: number): Promise<Survey> {
  return (await api.post(`${surveysBase(scope, id)}/${surveyId}/publish`)).data;
}
export async function closeSurvey(scope: SurveyScope, id: number, surveyId: number): Promise<Survey> {
  return (await api.post(`${surveysBase(scope, id)}/${surveyId}/close`)).data;
}
export async function getSurveyResults(scope: SurveyScope, id: number, surveyId: number): Promise<SurveyResults> {
  return (await api.get(`${surveysBase(scope, id)}/${surveyId}/results`)).data;
}
export async function downloadSurveyCsv(scope: SurveyScope, id: number, surveyId: number): Promise<Blob> {
  return (await api.get(`${surveysBase(scope, id)}/${surveyId}/export`, { responseType: "blob" })).data;
}

// ===== Donation campaigns (gap agent) =====
// api/Controllers/DonationsController.cs. Club and district share every route: /api/{clubs|districts}/{id}/...
import type {
  DonationCampaign, DonationOrder, DonationReceiptTemplate, DonationReport, DonationScope, PublicDonationCampaign,
  SaveDonationCampaign,
} from "@/types/donations";

const donationBase = (scope: DonationScope, scopeId: number) => `/api/${scope}/${scopeId}/donation-campaigns`;

/** Absolute URL of an uploaded campaign image (/Documents/donations/...). */
export const donationImageUrl = (path: string | null) => (path ? API_BASE_URL + path : null);

export async function getDonationCampaigns(scope: DonationScope, scopeId: number): Promise<{ currency: string; campaigns: DonationCampaign[] }> {
  return (await api.get(donationBase(scope, scopeId))).data;
}
export async function saveDonationCampaign(scope: DonationScope, scopeId: number, body: SaveDonationCampaign, id?: number): Promise<void> {
  if (id) await api.put(`${donationBase(scope, scopeId)}/${id}`, body);
  else await api.post(donationBase(scope, scopeId), body);
}
export async function deleteDonationCampaign(scope: DonationScope, scopeId: number, id: number): Promise<void> {
  await api.delete(`${donationBase(scope, scopeId)}/${id}`);
}
export async function getDonationReport(scope: DonationScope, scopeId: number, id: number): Promise<DonationReport> {
  return (await api.get(`${donationBase(scope, scopeId)}/${id}`)).data;
}
export async function uploadDonationImage(scope: DonationScope, scopeId: number, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  return (await api.post(`${donationBase(scope, scopeId)}/image`, form, {
    headers: { "Content-Type": "multipart/form-data" }, timeout: 120000,
  })).data.path;
}
export async function downloadDonorList(scope: DonationScope, scopeId: number, id: number): Promise<void> {
  const r = await api.get(`${donationBase(scope, scopeId)}/${id}/export`, { responseType: "blob" });
  saveBlob(r.data, `donors-campaign-${id}.xlsx`);
}
/** The QR code PNG as an object URL for an <img>; the caller revokes it. */
export async function getDonationQrUrl(scope: DonationScope, scopeId: number, id: number): Promise<string> {
  const r = await api.get(`${donationBase(scope, scopeId)}/${id}/qr`, { responseType: "blob" });
  return window.URL.createObjectURL(r.data);
}
export async function downloadDonationReceipt(scope: DonationScope, scopeId: number, id: number, donationId: number, orderId: string): Promise<void> {
  const r = await api.get(`${donationBase(scope, scopeId)}/${id}/donations/${donationId}/receipt`, { responseType: "blob" });
  saveBlob(r.data, `donation-receipt-${orderId}.pdf`);
}
export async function getDonationReceiptTemplate(scope: DonationScope, scopeId: number): Promise<{
  template: DonationReceiptTemplate; defaultBody: string; placeholders: string[];
}> {
  return (await api.get(`/api/${scope}/${scopeId}/donation-receipt-template`)).data;
}
export async function saveDonationReceiptTemplate(scope: DonationScope, scopeId: number, body: DonationReceiptTemplate): Promise<void> {
  await api.put(`/api/${scope}/${scopeId}/donation-receipt-template`, body);
}
export async function previewDonationReceiptTemplate(scope: DonationScope, scopeId: number, body: DonationReceiptTemplate): Promise<void> {
  const r = await api.post(`/api/${scope}/${scopeId}/donation-receipt-template/preview`, body, { responseType: "blob" });
  saveBlob(r.data, "donation-receipt-sample.pdf");
}
// The public giving page: no session, so the public instance.
export async function getPublicDonationCampaign(id: number): Promise<PublicDonationCampaign> {
  return (await publicApi.get(`/api/public/donations/${id}`)).data;
}
export async function startDonation(id: number, body: {
  name: string; email: string; message: string | null; anonymous: boolean; hideAmount: boolean; amount: number; website: string;
}): Promise<{ redirectUrl: string }> {
  return (await publicApi.post(`/api/public/donations/${id}/donate`, body)).data;
}
export async function getDonationOrder(id: number, orderId: string, token: string): Promise<DonationOrder> {
  return (await publicApi.get(`/api/public/donations/${id}/order/${encodeURIComponent(orderId)}`, { params: { token } })).data;
}
export async function downloadDonorReceipt(id: number, orderId: string, token: string): Promise<void> {
  const r = await publicApi.get(`/api/public/donations/${id}/order/${encodeURIComponent(orderId)}/receipt`, { params: { token }, responseType: "blob" });
  saveBlob(r.data, `donation-receipt-${orderId}.pdf`);
}

// ===== Speaker bureau (gap agent) =====
// District speaker bureau (api/Controllers/SpeakerBureauController.cs; flagged module "volunteers").
import type {
  BureauBooking, BureauEntry, BureauProfile, BureauRating, BureauSearch, BureauStatus, SaveBureauEntry,
} from "@/types/speakerBureau";

const bureauDistrict = (districtId: number) => `/api/districts/${districtId}/speaker-bureau`;
const bureauClub = (clubId: number) => `/api/clubs/${clubId}/speaker-bureau`;
const bureauParams = (s: BureauSearch) =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => v !== "" && v !== undefined && v !== null));

export async function getDistrictBureau(districtId: number, search: BureauSearch = {}): Promise<BureauEntry[]> {
  return (await api.get(bureauDistrict(districtId), { params: bureauParams(search) })).data;
}
export async function getDistrictBureauProfile(districtId: number, id: number): Promise<BureauProfile> {
  return (await api.get(`${bureauDistrict(districtId)}/${id}`)).data;
}
export async function saveDistrictBureauEntry(districtId: number, body: SaveBureauEntry, id?: number): Promise<BureauEntry> {
  return (await (id ? api.put(`${bureauDistrict(districtId)}/${id}`, body) : api.post(bureauDistrict(districtId), body))).data;
}
export async function setBureauEntryStatus(districtId: number, id: number, status: BureauStatus): Promise<BureauEntry> {
  return (await api.post(`${bureauDistrict(districtId)}/${id}/status`, { status })).data;
}
export async function deleteBureauEntry(districtId: number, id: number): Promise<void> {
  await api.delete(`${bureauDistrict(districtId)}/${id}`);
}
export async function uploadBureauPhoto(districtId: number, id: number, file: File): Promise<BureauEntry> {
  const form = new FormData();
  form.append("file", file);
  return (await api.post(`${bureauDistrict(districtId)}/${id}/photo`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
}
export async function hideBureauComment(districtId: number, ratingId: number, hidden: boolean): Promise<void> {
  await api.post(`${bureauDistrict(districtId)}/ratings/${ratingId}/hide`, { hidden });
}
export async function findBureauSpeakers(clubId: number, search: BureauSearch = {}): Promise<BureauEntry[]> {
  return (await api.get(bureauClub(clubId), { params: bureauParams(search) })).data;
}
export async function getClubBureauProfile(clubId: number, id: number): Promise<BureauProfile> {
  return (await api.get(`${bureauClub(clubId)}/${id}`)).data;
}
export async function proposeBureauSpeaker(clubId: number, body: SaveBureauEntry): Promise<BureauEntry> {
  return (await api.post(bureauClub(clubId), body)).data;
}
export async function shareSpeakerToBureau(clubId: number, speakerId: number): Promise<BureauEntry> {
  return (await api.post(`/api/clubs/${clubId}/speakers/${speakerId}/share-to-bureau`)).data;
}
export async function getBureauBookings(clubId: number): Promise<BureauBooking[]> {
  return (await api.get(`${bureauClub(clubId)}/bookings`)).data;
}
export async function bookBureauSpeaker(clubId: number, id: number, talkDate: string): Promise<BureauBooking> {
  return (await api.post(`${bureauClub(clubId)}/${id}/bookings`, { talkDate })).data;
}
export async function cancelBureauBooking(clubId: number, bookingId: number): Promise<void> {
  await api.delete(`${bureauClub(clubId)}/bookings/${bookingId}`);
}
export async function rateBureauSpeaker(clubId: number, id: number, body: { talkDate: string; rating: number; comment: string | null }): Promise<BureauRating> {
  return (await api.post(`${bureauClub(clubId)}/${id}/ratings`, body)).data;
}

// ===== Youth programs (gap agent) =====
export type YouthProgram = "ryla" | "rli";
export type YouthStatus = "applied" | "approved" | "declined" | "attended" | "completed" | "withdrawn";
export type ClearanceState = "incomplete" | "expired" | "expiring" | "cleared";
export type YouthScope = { kind: "clubs" | "districts"; id: number };
export interface YouthOfficer { memberId: number; memberName: string; clubName: string | null }
export interface YouthMemberPick { id: number; name: string; clubName: string | null }
export interface YouthYear { id: number; label: string; isCurrent: boolean }
export interface YouthParticipant {
  id: number; program: YouthProgram; yearId: number; yearLabel: string; sponsorClubId: number; sponsorClubName: string;
  fullName: string; contactEmail: string | null; status: YouthStatus; createdDate: string;
}
export interface YouthClearance {
  memberId: number; memberName: string; clubName: string | null;
  trainingDate: string | null; checkDate: string | null; expiryDate: string | null; state: ClearanceState;
}
const youthBase = (s: YouthScope) => `/api/youth/${s.kind}/${s.id}`;
export async function getYouthYears(): Promise<YouthYear[]> {
  return (await api.get("/api/youth/years")).data;
}
export async function getYouthOfficers(s: YouthScope): Promise<YouthOfficer[]> {
  return (await api.get(`${youthBase(s)}/officers`)).data;
}
export async function addYouthOfficer(s: YouthScope, memberId: number): Promise<void> {
  await api.post(`${youthBase(s)}/officers`, { memberId });
}
export async function removeYouthOfficer(s: YouthScope, memberId: number): Promise<void> {
  await api.delete(`${youthBase(s)}/officers/${memberId}`);
}
export async function searchYouthMembers(s: YouthScope, q: string): Promise<YouthMemberPick[]> {
  return (await api.get(`${youthBase(s)}/members`, { params: { q } })).data;
}
export async function getYouthParticipants(s: YouthScope, yearId: number, program?: YouthProgram | ""): Promise<YouthParticipant[]> {
  return (await api.get(`${youthBase(s)}/participants`, { params: { yearId, program: program || undefined } })).data;
}
export async function addYouthParticipant(clubId: number, body: { program: YouthProgram; yearId: number; fullName: string; contactEmail: string | null }): Promise<YouthParticipant> {
  return (await api.post(`/api/youth/clubs/${clubId}/participants`, body)).data;
}
export async function setYouthParticipantStatus(s: YouthScope, id: number, status: YouthStatus): Promise<YouthParticipant> {
  return (await api.put(`${youthBase(s)}/participants/${id}/status`, { status })).data;
}
export async function getYouthClearances(s: YouthScope): Promise<YouthClearance[]> {
  return (await api.get(`${youthBase(s)}/clearances`)).data;
}
export async function saveYouthClearance(s: YouthScope, memberId: number, body: { trainingDate: string | null; checkDate: string | null; expiryDate: string | null }): Promise<YouthClearance> {
  return (await api.put(`${youthBase(s)}/clearances/${memberId}`, body)).data;
}

// ===== Profile update requests + anniversaries report (gap agent) =====
export type ProfileUpdateField = "photo" | "email" | "mobile" | "birthDate" | "classification";
export type ProfileRequestStatus = "pending" | "updated" | "expired";
export interface ProfileUpdateMember {
  memberId: number;
  memberName: string;
  hasEmail: boolean;
  missing: ProfileUpdateField[];
  lastRequestedAt: string | null;
  lastStatus: ProfileRequestStatus | null;
}
export interface ProfileUpdateRequest {
  id: number;
  memberId: number;
  memberName: string;
  requestedByName: string | null;
  requestedAt: string;
  expiresAt: string;
  emailStatus: "emailed" | "no_email";
  completedAt: string | null;
  completedVia: "link" | "confirm" | "profile" | null;
  status: ProfileRequestStatus;
}
export interface ProfileUpdateSendResult { requested: number; emailed: number; noEmail: number; skipped: number }
export async function getProfileUpdateMembers(clubId: number): Promise<ProfileUpdateMember[]> {
  return (await api.get(`/api/clubs/${clubId}/profile-updates/members`)).data;
}
export async function getProfileUpdateRequests(clubId: number): Promise<ProfileUpdateRequest[]> {
  return (await api.get(`/api/clubs/${clubId}/profile-updates/requests`)).data;
}
export async function sendProfileUpdateRequests(
  clubId: number, body: { memberIds?: number[]; incompleteOnly?: boolean; message?: string },
): Promise<ProfileUpdateSendResult> {
  return (await api.post(`/api/clubs/${clubId}/profile-updates/requests`, body)).data;
}
export interface PublicProfileUpdate {
  clubName: string;
  memberName: string;
  email: string | null;
  mobile: string | null;
  secondaryEmailId: string | null;
  secondaryMobileNumber: string | null;
  birthDate: string | null;
  anniversaryDate: string | null;
  memberIntroduction: string | null;
  linkedIn: string | null;
  website: string | null;
  classificationProfession: string | null;
  alreadyUpdated: boolean;
}
export type PublicProfileUpdateBody =
  Partial<Omit<PublicProfileUpdate, "clubName" | "memberName" | "email" | "mobile" | "alreadyUpdated">> & { confirmOnly?: boolean };
export async function getPublicProfileUpdate(token: string): Promise<PublicProfileUpdate> {
  return (await publicApi.get(`/api/public/profile-update/${encodeURIComponent(token)}`)).data;
}
export async function savePublicProfileUpdate(token: string, body: PublicProfileUpdateBody): Promise<{ message: string }> {
  return (await publicApi.post(`/api/public/profile-update/${encodeURIComponent(token)}`, body)).data;
}
export interface AnniversaryRow {
  memberId: number;
  memberName: string;
  joinedDate: string | null;
  yearsOfService: number | null;
  joinAnniversaryDay: number | null;
  anniversaryYears: number | null;
  milestone: boolean;
  birthdayDay: number | null;
  weddingAnniversaryDay: number | null;
}
export interface AnniversaryReport {
  clubId: number;
  clubName: string;
  year: number;
  month: number;
  today: string;
  counts: { members: number; milestones: number; joiningAnniversaries: number; birthdays: number; weddingAnniversaries: number };
  members: AnniversaryRow[];
}
export async function getAnniversaryReport(clubId: number, year?: number, month?: number): Promise<AnniversaryReport> {
  return (await api.get(`/api/clubs/${clubId}/anniversaries`, { params: year && month ? { year, month } : {} })).data;
}
export async function downloadAnniversaryCsv(clubId: number, year: number, month: number): Promise<Blob> {
  return (await api.get(`/api/clubs/${clubId}/anniversaries`, { params: { year, month, format: "csv" }, responseType: "blob" })).data;
}

// ===== Prospect follow-up (gap agent) =====
// Follow-up tasks on prospects and who hears about a new prospect (feature contacts_growth).
export interface ProspectTask {
  id: number; clubId: number; clubName?: string | null; prospectId: number; prospectName: string;
  prospectEmail?: string | null; prospectMobile?: string | null; prospectStage?: string | null;
  title: string; notes?: string | null; assigneeMemberId: number; assigneeName?: string | null;
  dueDate: string; remindDaysBefore: number | null; status: "open" | "done";
  reminderSentAt?: string | null; completedAt?: string | null; completionNote?: string | null; createdDate: string;
}
export interface SaveProspectTask {
  prospectId: number; title: string; notes?: string; assigneeMemberId: number; dueDate: string;
  remindDaysBefore: number | null; status?: "open" | "done";
}
export interface ProspectNotifySettings {
  toPresident: boolean; toMembershipChair: boolean; memberIds: number[]; inApp: boolean; email: boolean;
  presidents: string[]; membershipChairs: string[];
}
export async function getProspectTasks(clubId: number, opts: { status?: string; prospectId?: number } = {}): Promise<ProspectTask[]> {
  return (await api.get(`/api/clubs/${clubId}/prospect-tasks`, { params: opts })).data;
}
export async function createProspectTask(clubId: number, body: SaveProspectTask): Promise<{ id: number }> {
  return (await api.post(`/api/clubs/${clubId}/prospect-tasks`, body)).data;
}
export async function updateProspectTask(clubId: number, id: number, body: SaveProspectTask): Promise<void> {
  await api.put(`/api/clubs/${clubId}/prospect-tasks/${id}`, body);
}
export async function deleteProspectTask(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/prospect-tasks/${id}`);
}
export async function getProspectNotifySettings(clubId: number): Promise<ProspectNotifySettings> {
  return (await api.get(`/api/clubs/${clubId}/prospect-notify-settings`)).data;
}
export async function saveProspectNotifySettings(
  clubId: number, body: Omit<ProspectNotifySettings, "presidents" | "membershipChairs">,
): Promise<ProspectNotifySettings> {
  return (await api.put(`/api/clubs/${clubId}/prospect-notify-settings`, body)).data;
}

// ===== Contacts export, merge, Friends of the club (gap agent) =====
// "friends" marks the group the API keeps equal to the Friends of the club (merges into ContactGroup above).
export interface ContactGroup { systemKey?: string | null }
export interface ContactDuplicateGroup { contacts: Contact[]; reasons: string[] }
export type ContactMergeField = "name" | "email" | "mobile" | "contactType" | "organisation" | "notes";
export interface ContactMergeHistory { id: number; mergedContactId: number; merged: Contact; mergedBy: string | null; mergedDateUtc: string }
export async function exportContacts(scope: ContactScope, ownerId: number, format: "xlsx" | "csv",
  params: { search?: string; type?: string; groupId?: number }): Promise<void> {
  const r = await api.get(`/api/${scope}/${ownerId}/contacts/export`, { params: { format, ...params }, responseType: "blob" });
  const stamp = new Date().toISOString().slice(0, 10);
  saveBlob(r.data, `${params.type === "friend" ? "friends" : "contacts"}-${stamp}.${format}`);
}
export async function getContactDuplicates(scope: ContactScope, ownerId: number): Promise<ContactDuplicateGroup[]> {
  return (await api.get(`/api/${scope}/${ownerId}/contacts/duplicates`)).data;
}
export async function mergeContacts(scope: ContactScope, ownerId: number, survivorId: number, mergeIds: number[],
  fieldSources: Partial<Record<ContactMergeField, number>>): Promise<Contact> {
  return (await api.post(`/api/${scope}/${ownerId}/contacts/merge`, { survivorId, mergeIds, fieldSources })).data;
}
export async function getContactMergeHistory(scope: ContactScope, ownerId: number, id: number): Promise<ContactMergeHistory[]> {
  return (await api.get(`/api/${scope}/${ownerId}/contacts/${id}/merge-history`)).data;
}

// ===== Member flexibility (gap agent) =====
// Club tags on members and contacts, custom profile fields, smart lists (saved member filters).
export interface ClubTag { id: number; name: string; color: string; memberCount: number; contactCount: number }
export type ProfileFieldType = "text" | "number" | "date" | "choice" | "yesno";
export interface ProfileField { id: number; label: string; fieldType: ProfileFieldType; options: string[]; visibility: "admins" | "members"; sortOrder: number }
export interface ProfileFieldValue extends ProfileField { value: string | null }
export type SaveProfileField = Omit<ProfileField, "id">;
export interface FieldCondition { fieldId: number; op: string; value?: string }
export interface SmartListFilter {
  search?: string; tagIds?: number[]; tagMode?: "any" | "all"; memberType?: "" | "active" | "honorary";
  joinedFrom?: string; joinedTo?: string; subGroupIds?: number[]; fields?: FieldCondition[];
}
export interface SmartList { id: number; name: string; filter: SmartListFilter; createdDate: string; modifiedDate: string | null }
export interface SmartListMember { memberId: number; name: string; email: string | null; mobile: string | null; joinedDate: string | null; isHonorary: boolean; tagIds: number[] }

export async function getClubTags(clubId: number): Promise<ClubTag[]> {
  return (await api.get(`/api/clubs/${clubId}/tags`)).data;
}
export async function createClubTag(clubId: number, data: { name: string; color: string }): Promise<{ id: number }> {
  return (await api.post(`/api/clubs/${clubId}/tags`, data)).data;
}
export async function updateClubTag(clubId: number, id: number, data: { name: string; color: string }): Promise<void> {
  await api.put(`/api/clubs/${clubId}/tags/${id}`, data);
}
export async function deleteClubTag(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/tags/${id}`);
}
export async function setMemberTags(clubId: number, memberId: number, tagIds: number[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/members/${memberId}/tags`, { tagIds });
}
export async function setContactTags(clubId: number, contactId: number, tagIds: number[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/contacts/${contactId}/tags`, { tagIds });
}
export async function getProfileFields(clubId: number): Promise<ProfileField[]> {
  return (await api.get(`/api/clubs/${clubId}/profile-fields`)).data;
}
export async function createProfileField(clubId: number, data: SaveProfileField): Promise<{ id: number }> {
  return (await api.post(`/api/clubs/${clubId}/profile-fields`, data)).data;
}
export async function updateProfileField(clubId: number, id: number, data: SaveProfileField): Promise<void> {
  await api.put(`/api/clubs/${clubId}/profile-fields/${id}`, data);
}
export async function deleteProfileField(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/profile-fields/${id}`);
}
export async function getMemberProfileFields(clubId: number, memberId: number): Promise<ProfileFieldValue[]> {
  return (await api.get(`/api/clubs/${clubId}/members/${memberId}/profile-fields`)).data;
}
export async function saveMemberProfileFields(clubId: number, memberId: number, values: { fieldId: number; value: string | null }[]): Promise<void> {
  await api.put(`/api/clubs/${clubId}/members/${memberId}/profile-fields`, { values });
}
export async function getClubCommittees(clubId: number): Promise<{ id: number; name: string }[]> {
  return (await api.get(`/api/clubs/${clubId}/committees`)).data;
}
export async function getSmartLists(clubId: number): Promise<SmartList[]> {
  return (await api.get(`/api/clubs/${clubId}/smart-lists`)).data;
}
export async function previewSmartList(clubId: number, filter: SmartListFilter, page = 1, pageSize = 25): Promise<PagedResult<SmartListMember>> {
  return (await api.post(`/api/clubs/${clubId}/smart-lists/preview`, { filter, page, pageSize })).data;
}
export async function createSmartList(clubId: number, data: { name: string; filter: SmartListFilter }): Promise<{ id: number }> {
  return (await api.post(`/api/clubs/${clubId}/smart-lists`, data)).data;
}
export async function updateSmartList(clubId: number, id: number, data: { name: string; filter: SmartListFilter }): Promise<void> {
  await api.put(`/api/clubs/${clubId}/smart-lists/${id}`, data);
}
export async function deleteSmartList(clubId: number, id: number): Promise<void> {
  await api.delete(`/api/clubs/${clubId}/smart-lists/${id}`);
}
export async function exportSmartList(clubId: number, id: number): Promise<Blob> {
  return (await api.get(`/api/clubs/${clubId}/smart-lists/${id}/export`, { responseType: "blob" })).data;
}
export async function smartListMassEmail(clubId: number, id: number, data: { subject?: string; fromName?: string }): Promise<{ massEmailId: number }> {
  return (await api.post(`/api/clubs/${clubId}/smart-lists/${id}/mass-email`, data)).data;
}

// ===== Custom reports (gap agent) =====
// api/Controllers/CustomReportsController.cs: report builder for club and district admins.
import type {
  CustomReport, CustomReportDefinition, CustomReportFormat, CustomReportResult, CustomReportScope, CustomReportSource,
  SaveCustomReport,
} from "@/types/customReports";
const customReportsBase = (scope: CustomReportScope, scopeId: number) =>
  scope === "club" ? `/api/clubs/${scopeId}/custom-reports` : `/api/districts/${scopeId}/custom-reports`;
export async function getCustomReportCatalog(scope: CustomReportScope, scopeId: number): Promise<CustomReportSource[]> {
  return (await api.get(`${customReportsBase(scope, scopeId)}/catalog`)).data;
}
export async function getCustomReports(scope: CustomReportScope, scopeId: number): Promise<CustomReport[]> {
  return (await api.get(customReportsBase(scope, scopeId))).data;
}
export async function saveCustomReport(scope: CustomReportScope, scopeId: number, id: number | null, body: SaveCustomReport): Promise<{ id: number }> {
  const base = customReportsBase(scope, scopeId);
  return (id == null ? await api.post(base, body) : await api.put(`${base}/${id}`, body)).data;
}
export async function deleteCustomReport(scope: CustomReportScope, scopeId: number, id: number): Promise<void> {
  await api.delete(`${customReportsBase(scope, scopeId)}/${id}`);
}
export async function runCustomReport(scope: CustomReportScope, scopeId: number, definition: CustomReportDefinition): Promise<CustomReportResult> {
  return (await api.post(`${customReportsBase(scope, scopeId)}/run`, definition, { timeout: 120000 })).data;
}
export async function exportCustomReport(scope: CustomReportScope, scopeId: number, definition: CustomReportDefinition,
  format: CustomReportFormat, title: string): Promise<Blob> {
  return (await api.post(`${customReportsBase(scope, scopeId)}/export`, definition,
    { params: { format, title }, responseType: "blob", timeout: 120000 })).data;
}
export async function sendCustomReport(scope: CustomReportScope, scopeId: number, id: number): Promise<{ sent: number }> {
  return (await api.post(`${customReportsBase(scope, scopeId)}/${id}/send`)).data;
}

// ===== Officer progression (gap agent) =====
export type ProgressionScope = "club" | "district";
export interface ProgressionStep {
  stepId: number; role: string; title: string; yearLabel: string; yearId: number | null;
  status: "pending" | "confirmed" | "dismissed" | "applying"; appliesTo: "record" | "board" | "governor";
  currentHolderName: string | null; currentHolderIsNominee: boolean; decidedDate: string | null;
}
export interface Progression {
  progressionId: number; scope: ProgressionScope; scopeId: number; memberId: number; memberName: string;
  nomineeYearLabel: string; createdDate: string; steps: ProgressionStep[];
}
export interface ProgressionCandidate { memberId: number; memberName: string; clubName: string | null }
export async function getOfficerProgressions(scope: ProgressionScope, scopeId: number): Promise<Progression[]> {
  return (await api.get("/api/officer-progression", { params: { scope, scopeId } })).data;
}
export async function getOfficerProgressionCandidates(scope: ProgressionScope, scopeId: number, search: string): Promise<ProgressionCandidate[]> {
  return (await api.get("/api/officer-progression/candidates", { params: { scope, scopeId, search } })).data;
}
export async function createOfficerProgression(scope: ProgressionScope, scopeId: number, memberId: number, nomineeStartYear: number): Promise<{ id: number }> {
  return (await api.post("/api/officer-progression", { scope, scopeId, memberId, nomineeStartYear })).data;
}
export async function deleteOfficerProgression(progressionId: number): Promise<{ message: string }> {
  return (await api.delete(`/api/officer-progression/${progressionId}`)).data;
}
export async function confirmOfficerProgressionStep(stepId: number): Promise<{ message: string }> {
  return (await api.post(`/api/officer-progression/steps/${stepId}/confirm`)).data;
}
export async function dismissOfficerProgressionStep(stepId: number): Promise<{ message: string }> {
  return (await api.post(`/api/officer-progression/steps/${stepId}/dismiss`)).data;
}

// ===== Year-end rollover (gap agent) =====
export type RolloverScope = "club" | "district";
export type RolloverAction = "add" | "exists" | "left";
export interface RolloverMember { key: string; rowId: number; memberId: number | null; name: string; action: RolloverAction }
export interface RolloverCommittee { sourceId: number; name: string; targetId: number | null; action: RolloverAction; subGroups: string[]; members: RolloverMember[] }
export interface RolloverOfficer { sourceId: number; memberId: number | null; name: string; designationId: number; designation: string; action: RolloverAction }
export interface RolloverRun {
  runId: number; fromYearId: number; toYearId: number; status: "applied" | "undone";
  summary: string | null; createdUtc: string; undoneUtc: string | null; createdByName: string | null;
}
export interface RolloverPreview {
  scope: RolloverScope; scopeId: number;
  fromYear: { id: number; label: string }; toYear: { id: number; label: string };
  committees: RolloverCommittee[]; officers: RolloverOfficer[]; ipp: RolloverOfficer | null;
  incoming: { name: string; designation: string }[];
  pendingProgression: { connected: boolean; steps: { role: string; memberId: number; memberName: string; status: string }[] };
  runs: RolloverRun[];
}
export interface RolloverApplyBody {
  fromYearId: number; includeIpp: boolean; officerIds: number[];
  committees: { sourceId: number; memberKeys: string[] }[];
}
export async function getRolloverPreview(scope: RolloverScope, scopeId: number, fromYearId?: number): Promise<RolloverPreview> {
  return (await api.get(`/api/rollover/${scope}/${scopeId}`, { params: fromYearId ? { fromYearId } : {} })).data;
}
export async function applyRollover(scope: RolloverScope, scopeId: number, body: RolloverApplyBody): Promise<{ runId: number | null; changed: number; counts: Record<string, number> }> {
  return (await api.post(`/api/rollover/${scope}/${scopeId}/apply`, body)).data;
}
/** Refused with 409 { message, blockers[] } when rows added or edited after the run hang off it. */
export async function undoRollover(runId: number): Promise<{ runId: number; removed: number }> {
  return (await api.post(`/api/rollover/runs/${runId}/undo`)).data;
}

// ===== Member map + business directory (gap agent) =====
export interface MapMember { name: string; clubName: string; city: string | null; area: string | null; latitude: number; longitude: number }
export interface MeetingPlace {
  clubId: number; clubName: string; meetingAddress: string | null; meetingDay: string | null;
  meetingFromTime: string | null; meetingToTime: string | null; latitude: number; longitude: number;
}
export interface MemberMap { members: MapMember[]; meetingPlaces: MeetingPlace[] }
export type ListingStatus = "pending" | "approved" | "rejected";
export interface BusinessListing {
  id: number; clubId: number; clubName: string; memberName: string; businessName: string; classification: string | null;
  description: string | null; website: string | null; phone: string | null; status: ListingStatus; reviewNote: string | null; modifiedUtc: string;
}
export type MapScope = "club" | "district";
export async function getMemberMap(scope: MapScope, id: number): Promise<MemberMap> {
  return (await api.get(`/api/${scope === "club" ? "clubs" : "districts"}/${id}/member-map`)).data;
}
export async function getBusinessListingsForReview(scope: MapScope, id: number, status?: ListingStatus): Promise<BusinessListing[]> {
  return (await api.get(`/api/${scope === "club" ? "clubs" : "districts"}/${id}/business-directory/review`, { params: status ? { status } : {} })).data;
}
export async function reviewBusinessListing(id: number, approve: boolean, note?: string): Promise<BusinessListing> {
  return (await api.post(`/api/business-directory/${id}/review`, { approve, note: note || null })).data;
}
/** Approved listings of a district (district pages) or of a club's district (club pages read the website's own feed). */
export async function searchBusinessDirectory(scope: MapScope, id: number, q: string): Promise<BusinessListing[]> {
  const path = scope === "club" ? `/api/public/club/${id}/business-directory` : `/api/districts/${id}/business-directory`;
  return (await api.get(path, { params: q.trim() ? { q: q.trim() } : {} })).data;
}

// ===== Website builder (gap agent) =====
// Custom pages + home layout (slug "home") with draft/publish, and the site media library, for club and district sites.
// WebsiteScope ("clubs" | "districts") is the one declared for the multilingual websites above.
export type WebsiteSectionType =
  | "richtext" | "image" | "embed" | "file" | "events" | "officers" | "news" | "projects" | "gallery" | "sponsors" | "contact";
export interface WebsiteSection {
  id: string;
  type: WebsiteSectionType;
  title?: string | null;
  html?: string | null;
  url?: string | null;
  caption?: string | null;
  linkUrl?: string | null;
  limit?: number | null;
}
export interface WebsitePageSummary {
  id: number;
  slug: string;
  title: string;
  isPublished: boolean;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  publishedAt: string | null;
  /** Only signed-in members of the club see it; applies on save. */
  membersOnly: boolean;
}
export interface WebsitePageDetail extends WebsitePageSummary { sections: WebsiteSection[] }
export interface WebsitePageInput { slug: string; title: string; sections: WebsiteSection[]; membersOnly: boolean }
/** Members-only items come back with url "media:<id>"; sections reference them that way. */
export interface WebsiteMedia { id: number; url: string; fileName: string; createdAt: string; membersOnly: boolean; contentType: string | null }

export async function getWebsitePages(scope: WebsiteScope, ownerId: number): Promise<WebsitePageSummary[]> {
  return (await api.get(`/api/${scope}/${ownerId}/website-pages`)).data;
}
export async function getWebsitePage(scope: WebsiteScope, ownerId: number, id: number): Promise<WebsitePageDetail> {
  return (await api.get(`/api/${scope}/${ownerId}/website-pages/${id}`)).data;
}
export async function createWebsitePage(scope: WebsiteScope, ownerId: number, body: WebsitePageInput): Promise<{ id: number }> {
  return (await api.post(`/api/${scope}/${ownerId}/website-pages`, body)).data;
}
export async function saveWebsitePage(scope: WebsiteScope, ownerId: number, id: number, body: WebsitePageInput): Promise<void> {
  await api.put(`/api/${scope}/${ownerId}/website-pages/${id}`, body);
}
export async function publishWebsitePage(scope: WebsiteScope, ownerId: number, id: number, publish: boolean): Promise<void> {
  await api.post(`/api/${scope}/${ownerId}/website-pages/${id}/${publish ? "publish" : "unpublish"}`);
}
export async function deleteWebsitePage(scope: WebsiteScope, ownerId: number, id: number): Promise<void> {
  await api.delete(`/api/${scope}/${ownerId}/website-pages/${id}`);
}
export async function getWebsiteMedia(scope: WebsiteScope, ownerId: number): Promise<WebsiteMedia[]> {
  return (await api.get(`/api/${scope}/${ownerId}/website-media`)).data;
}
export async function getWebsiteMediaLink(scope: WebsiteScope, ownerId: number, id: number): Promise<{ url: string }> {
  return (await api.get(`/api/${scope}/${ownerId}/website-media/${id}/link`)).data;
}
export async function uploadWebsiteMedia(scope: WebsiteScope, ownerId: number, file: File, membersOnly = false): Promise<WebsiteMedia> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("membersOnly", membersOnly ? "true" : "false");
  return (await api.post(`/api/${scope}/${ownerId}/website-media`, fd, { headers: { "Content-Type": "multipart/form-data" } })).data;
}
export async function deleteWebsiteMedia(scope: WebsiteScope, ownerId: number, id: number): Promise<void> {
  await api.delete(`/api/${scope}/${ownerId}/website-media/${id}`);
}

// ===== Website extras (gap agent) =====
// Social feed embeds, Google Analytics ID and page QR codes of a club or district website (api WebsiteExtrasController).
export interface WebsiteExtrasSettings {
  facebookPageUrl: string | null;
  instagramUsername: string | null;
  xUsername: string | null;
  gaMeasurementId: string | null;
}
export interface WebsiteExtrasView {
  settings: WebsiteExtrasSettings;
  siteUrl: string | null;
  pages: { title: string; path: string }[];
}
const websiteExtrasPath = (scope: WebsiteScope, ownerId: number) => `/api/${scope}/${ownerId}/website-extras`;
export async function getWebsiteExtras(scope: WebsiteScope, ownerId: number): Promise<WebsiteExtrasView> {
  return (await api.get(websiteExtrasPath(scope, ownerId))).data;
}
export async function saveWebsiteExtras(scope: WebsiteScope, ownerId: number, settings: WebsiteExtrasSettings): Promise<WebsiteExtrasView> {
  return (await api.put(websiteExtrasPath(scope, ownerId), settings)).data;
}
export async function downloadWebsiteQr(scope: WebsiteScope, ownerId: number, path: string, format: "png" | "svg"): Promise<Blob> {
  return (await api.get(`${websiteExtrasPath(scope, ownerId)}/qr`, { params: { path, format }, responseType: "blob" })).data;
}

// ===== WordPress connector (gap agent) =====
export type WebsiteApiScope = "clubs" | "districts";
export interface WebsiteApiKey {
  id: number; label: string; keyPrefix: string; createdUtc: string; lastUsedUtc: string | null; revokedUtc: string | null;
}
export interface WebsiteApiDocument {
  id: number; title: string; publishDateTime: string; expiryDateTime: string; isPublicOnWebsite: boolean;
}
/** The API address the WordPress plugin settings need. */
export const ROW_API_BASE_URL = API_BASE_URL;
export async function getWebsiteApiKeys(scope: WebsiteApiScope, id: number): Promise<WebsiteApiKey[]> {
  return (await api.get(`/api/${scope}/${id}/website-api/keys`)).data;
}
/** The plain key comes back only here, once. */
export async function createWebsiteApiKey(scope: WebsiteApiScope, id: number, label: string): Promise<{ key: string; item: WebsiteApiKey }> {
  return (await api.post(`/api/${scope}/${id}/website-api/keys`, { label })).data;
}
export async function revokeWebsiteApiKey(scope: WebsiteApiScope, id: number, keyId: number): Promise<void> {
  await api.delete(`/api/${scope}/${id}/website-api/keys/${keyId}`);
}
export async function getWebsiteApiDocuments(scope: WebsiteApiScope, id: number): Promise<WebsiteApiDocument[]> {
  return (await api.get(`/api/${scope}/${id}/website-api/documents`)).data;
}
export async function setWebsiteApiDocumentPublic(scope: WebsiteApiScope, id: number, documentId: number, isPublic: boolean): Promise<void> {
  await api.put(`/api/${scope}/${id}/website-api/documents/${documentId}`, { isPublic });
}

// ===== Service hours (gap agent) =====
// api/Controllers/ServiceHoursController.cs; flagged module "service_hours".
import type {
  Contribution, SaveContribution, ServiceHoursEntry, ServiceHoursStatus, ServiceProjectOption, ServiceReport,
} from "@/types/serviceHours";

const serviceHoursBase = (clubId: number) => `/api/clubs/${clubId}/service-hours`;

export async function getServiceHours(clubId: number, yearId: number | null, status: ServiceHoursStatus | ""): Promise<ServiceHoursEntry[]> {
  return (await api.get(serviceHoursBase(clubId), { params: { ...(yearId ? { yearId } : {}), ...(status ? { status } : {}) } })).data;
}
export async function reviewServiceHours(clubId: number, id: number, approve: boolean, note: string | null): Promise<ServiceHoursEntry> {
  return (await api.post(`${serviceHoursBase(clubId)}/${id}/review`, { approve, note })).data;
}
export async function getServiceProjects(clubId: number, yearId: number): Promise<ServiceProjectOption[]> {
  return (await api.get(`${serviceHoursBase(clubId)}/projects`, { params: { yearId } })).data;
}
export async function getServiceContributions(clubId: number, yearId: number): Promise<Contribution[]> {
  return (await api.get(`${serviceHoursBase(clubId)}/contributions`, { params: { yearId } })).data;
}
export async function addServiceContribution(clubId: number, body: SaveContribution): Promise<Contribution> {
  return (await api.post(`${serviceHoursBase(clubId)}/contributions`, body)).data;
}
export async function deleteServiceContribution(clubId: number, id: number): Promise<void> {
  await api.delete(`${serviceHoursBase(clubId)}/contributions/${id}`);
}
export async function getClubServiceReport(clubId: number, yearId: number | null): Promise<ServiceReport> {
  return (await api.get(`${serviceHoursBase(clubId)}/report`, { params: yearId ? { yearId } : {} })).data;
}
export async function getDistrictServiceReport(districtId: number, yearId: number | null): Promise<ServiceReport> {
  return (await api.get(`/api/districts/${districtId}/service-hours/report`, { params: yearId ? { yearId } : {} })).data;
}
/** The report as an Excel file (club: by project, by member, contributions; district: by club). */
export async function exportServiceReport(scope: "clubs" | "districts", id: number, yearId: number): Promise<Blob> {
  return (await api.get(`/api/${scope}/${id}/service-hours/report/export`, { params: { yearId }, responseType: "blob", timeout: 120000 })).data;
}

// ===== Volunteer sheet extras (gap agent) =====
// api/Controllers/VolunteerExtrasController.cs: confirmation text, follow-ups, coordinators, archive, copy.
export async function getVolunteerSheetExtras(clubId: number, id: number): Promise<import("@/types/volunteers").VolunteerSheetExtras> {
  return (await api.get(`${sheetsBase(clubId)}/${id}/extras`)).data;
}
export async function saveVolunteerSheetExtras(
  clubId: number, id: number, body: import("@/types/volunteers").SaveVolunteerSheetExtras,
): Promise<import("@/types/volunteers").VolunteerSheetExtras> {
  return (await api.put(`${sheetsBase(clubId)}/${id}/extras`, body)).data;
}
export async function archiveVolunteerSheet(clubId: number, id: number, archived: boolean): Promise<void> {
  await api.put(`${sheetsBase(clubId)}/${id}/archive`, { archived });
}
export async function copyVolunteerSheet(clubId: number, id: number, shiftDays: number): Promise<{ id: number }> {
  return (await api.post(`${sheetsBase(clubId)}/${id}/copy`, { shiftDays })).data;
}
export async function emailVolunteerCoordinators(clubId: number, id: number): Promise<{ sent: number }> {
  return (await api.post(`${sheetsBase(clubId)}/${id}/email-coordinators`)).data;
}

// ===== Enhanced committees (gap agent) =====
// Club committees (sub groups) and district committees: subcommittee tree, private documents, committee email.
// Every route checks the caller against the committee itself; platform switch "committees".
export type CommitteeKind = "club" | "district";
export interface CommitteeNode { id: number; name: string; parentId: number | null; memberCount: number; documentCount: number; messageCount: number }
export interface CommitteeCrumb { id: number; name: string }
export interface CommitteeDetail {
  kind: CommitteeKind; id: number; name: string; scopeId: number; yearId: number; parentId: number | null;
  path: CommitteeCrumb[]; children: CommitteeCrumb[];
  members: { memberId: number | null; name: string; designation: string | null }[];
  isMember: boolean; canManage: boolean;
}
export interface CommitteeDocumentRow {
  id: number; title: string; originalName: string; sizeBytes: number; uploadedBy: number;
  uploadedByName: string | null; createdDate: string; canDelete: boolean;
}
export interface CommitteeMessageRow {
  id: number; subject: string; body: string; sentBy: number; sentByName: string | null; createdDate: string;
  status: string | null; totalRecipients: number; sentCount: number; failedCount: number;
}

export async function getCommitteeTree(kind: CommitteeKind, scopeId: number, yearId: number): Promise<CommitteeNode[]> {
  return (await api.get("/api/committees/tree", { params: { kind, scopeId, yearId } })).data;
}
export async function getCommitteeDetail(kind: CommitteeKind, id: number): Promise<CommitteeDetail> {
  return (await api.get(`/api/committees/${kind}/${id}`)).data;
}
export async function setCommitteeParent(kind: CommitteeKind, id: number, parentId: number | null): Promise<void> {
  await api.put(`/api/committees/${kind}/${id}/parent`, { parentId });
}
export async function getCommitteePrivateDocuments(kind: CommitteeKind, id: number): Promise<CommitteeDocumentRow[]> {
  return (await api.get(`/api/committees/${kind}/${id}/documents`)).data;
}
export async function uploadCommitteePrivateDocument(kind: CommitteeKind, id: number, title: string, file: File): Promise<{ id: number }> {
  const form = new FormData();
  form.append("title", title);
  form.append("file", file.type.startsWith("image/") ? file : await processDocumentBeforeUpload(file));
  return (await api.post(`/api/committees/${kind}/${id}/documents`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  })).data;
}
export async function downloadCommitteePrivateDocument(kind: CommitteeKind, id: number, doc: CommitteeDocumentRow): Promise<void> {
  const r = await api.get(`/api/committees/${kind}/${id}/documents/${doc.id}/file`, { responseType: "blob" });
  saveBlob(r.data, doc.originalName);
}
export async function deleteCommitteePrivateDocument(kind: CommitteeKind, id: number, documentId: number): Promise<void> {
  await api.delete(`/api/committees/${kind}/${id}/documents/${documentId}`);
}
export async function getCommitteeMessages(kind: CommitteeKind, id: number): Promise<CommitteeMessageRow[]> {
  return (await api.get(`/api/committees/${kind}/${id}/messages`)).data;
}
export async function sendCommitteeMessage(kind: CommitteeKind, id: number, subject: string, body: string): Promise<{ id: number }> {
  return (await api.post(`/api/committees/${kind}/${id}/messages`, { subject, body })).data;
}

// ===== Mobile extras (gap agent) =====
// A club leader emails a member of their club the standard password-reset link (to the member's own address).
export interface ClubPasswordResetRow {
  id: number; memberId: number; memberName: string | null; sentById: number; sentByName: string | null; sentAtUtc: string;
}
export async function sendClubMemberPasswordReset(clubId: number, memberId: number): Promise<{ message: string; sentTo: string }> {
  return (await api.post(`/api/clubs/${clubId}/members/${memberId}/password-reset`)).data;
}
export async function getClubPasswordResets(clubId: number): Promise<ClubPasswordResetRow[]> {
  return (await api.get(`/api/clubs/${clubId}/password-resets`)).data;
}

// ===== RI data tools (gap agent) =====
// Officer compare and transfer-in wizard. They read only RI data the server sync stored, never Rotary.org itself.
export type RiOfficerStatus = "match" | "different" | "missing_in_row" | "missing_in_ri" | "empty" | "not_synced";
export interface RiHolder { name: string; rotaryId: string | null; memberId: number | null }
export interface RiOfficerRow { title: string; row: RiHolder[]; ri: RiHolder[]; status: RiOfficerStatus }
export interface RiYear { id: number; label: string; start: string; end: string; isCurrent: boolean }
export interface RiOfficerCompare {
  clubId: number; clubName: string; riClubId: string | null; year: RiYear; years: RiYear[];
  sync: { status: string; syncedAtUtc: string | null; message: string | null }; rows: RiOfficerRow[];
}
export interface RiCandidate { memberId: number; name: string; email: string | null; rotaryId: string | null; reason: "same_ri_id" | "email" | "name" }
export interface RiOnlyMember {
  rotaryMemberId: number; name: string; email: string | null; memberType: string | null; admissionDate: string | null;
  sameRiId: RiCandidate | null; matches: RiCandidate[];
}
export interface RiTransferIn { clubId: number; clubName: string; riClubId: string | null; cacheFetchedUtc: string | null; riCount: number; missing: RiOnlyMember[] }
export type RiTransferMode = "link" | "add" | "create";
export async function getRiOfficerCompare(clubId: number, yearId?: number): Promise<RiOfficerCompare> {
  return (await api.get(`/api/clubs/${clubId}/ri-tools/officers`, { params: yearId ? { yearId } : {} })).data;
}
export async function getRiTransferIn(clubId: number): Promise<RiTransferIn> {
  return (await api.get(`/api/clubs/${clubId}/ri-tools/transfer-in`)).data;
}
export async function riTransferInOne(clubId: number, body: { rotaryMemberId: number; mode: RiTransferMode; memberId?: number }): Promise<{ message: string; memberId: number | null }> {
  return (await api.post(`/api/clubs/${clubId}/ri-tools/transfer-in`, body)).data;
}

// ===== Job board (gap agent) =====
// Job postings and B2B offers (flag job_board): the district admin's review queue. Members post and browse in the app.
export type JobPostFilter = "pending" | "reported" | "live" | "closed";
export interface JobPostReport { id: number; postId: number; reporterName: string | null; reason: string | null; reportedAt: string }
export interface JobPost {
  id: number; kind: "job" | "offer"; title: string; description: string; company: string | null; location: string | null;
  contact: string; expiresOn: string; status: "pending" | "approved" | "rejected" | "removed" | "withdrawn" | "expired";
  reviewNote: string | null; clubId: number; clubName: string | null; memberId: number; postedBy: string | null;
  openReports: number; createdAt: string; reports: JobPostReport[] | null;
}
export async function getDistrictJobPosts(districtId: number, filter: JobPostFilter): Promise<JobPost[]> {
  return (await api.get(`/api/districts/${districtId}/job-board`, { params: { filter } })).data;
}
export async function reviewJobPost(districtId: number, postId: number, action: "approve" | "reject" | "remove", note: string): Promise<void> {
  await api.put(`/api/districts/${districtId}/job-board/${postId}/review`, { action, note });
}

// ===== Help centre (gap agent) =====
export interface HelpCategory { id: number; slug: string; name: string; description: string | null; sortOrder: number; articles: number }
export interface HelpArticleRow {
  id: number; slug: string; title: string; summary: string | null; categoryId: number; categorySlug: string; categoryName: string;
  status: "draft" | "published"; sortOrder: number; contextPath: string | null; helpfulYes: number; helpfulNo: number; updatedAt: string;
}
export interface HelpArticle extends HelpArticleRow { body: string; keywords: string | null; publishedAt: string | null }
export interface HelpArticleInput {
  categoryId: number; title: string; slug: string; summary: string; body: string; keywords: string; contextPath: string;
  status: "draft" | "published"; sortOrder: number;
}
export interface HelpCategoryInput { name: string; slug: string; description: string; sortOrder: number }

export async function getHelpCategories(): Promise<HelpCategory[]> {
  return (await api.get("/api/help/admin/categories")).data;
}
export async function saveHelpCategory(id: number | null, body: HelpCategoryInput): Promise<{ id: number }> {
  return (await (id ? api.put(`/api/help/admin/categories/${id}`, body) : api.post("/api/help/admin/categories", body))).data;
}
export async function deleteHelpCategory(id: number): Promise<void> {
  await api.delete(`/api/help/admin/categories/${id}`);
}
export async function getHelpArticles(q?: string, status?: string): Promise<HelpArticleRow[]> {
  return (await api.get("/api/help/admin/articles", { params: { q: q || undefined, status: status || undefined } })).data;
}
export async function getHelpArticle(id: number): Promise<HelpArticle> {
  return (await api.get(`/api/help/admin/articles/${id}`)).data;
}
export async function saveHelpArticle(id: number | null, body: HelpArticleInput): Promise<{ id: number; slug: string }> {
  return (await (id ? api.put(`/api/help/admin/articles/${id}`, body) : api.post("/api/help/admin/articles", body))).data;
}
export async function deleteHelpArticle(id: number): Promise<void> {
  await api.delete(`/api/help/admin/articles/${id}`);
}
/** The published help article for an admin page (public endpoint), or null. */
export async function getHelpForPage(path: string, lang?: string): Promise<{ slug: string; title: string } | null> {
  return (await api.get("/api/public/help/context", { params: { path, lang } })).data?.article ?? null;
}

// ── Goal messages + RAG clubs (RIZones goal module, ported 2026-11-20) ──
// One-to-one chats (2026-10-16): private to the two people. Scope = zoneId, or districtId for a
// District Admin / DG login. ROW has no "view as" (goal oversight roles are not in ROW).
export type GoalDirectScope = { zoneId?: number; districtId?: number };

export async function getGoalDirectContacts(yearId: number, scope: GoalDirectScope): Promise<GoalDirectContactDto[]> {
  const r = await api.get(`/api/goal-setting/direct/contacts`, { params: { yearId, ...scope } });
  return r.data;
}

export async function getGoalDirectConversation(otherMemberId: number, yearId: number, scope: GoalDirectScope): Promise<GoalDirectConversationDto> {
  const r = await api.get(`/api/goal-setting/direct/${otherMemberId}`, { params: { yearId, ...scope } });
  return r.data;
}

export async function getGoalDirectHasUnread(yearId: number, scope: GoalDirectScope): Promise<boolean> {
  const r = await api.get(`/api/goal-setting/direct/has-unread`, { params: { yearId, ...scope } });
  return !!r.data?.hasUnread;
}

export async function postGoalDirectMessage(otherMemberId: number, yearId: number, scope: GoalDirectScope,
  body: { commentText: string; categoryId: number; districtId: number }): Promise<GoalCommentDto> {
  const r = await api.post(`/api/goal-setting/direct/${otherMemberId}`, body, { params: { yearId, ...scope } });
  return r.data;
}

// Group messages (user 2026-10-19). The key ("D:12:3", "T:3:E/MGA", "B:3") travels in the query.
export async function getGoalGroups(yearId: number, scope: GoalDirectScope): Promise<GoalGroupDto[]> {
  const r = await api.get(`/api/goal-setting/groups`, { params: { yearId, ...scope } });
  return r.data;
}

export async function getGoalGroupConversation(key: string, yearId: number, scope: GoalDirectScope): Promise<GoalGroupConversationDto> {
  const r = await api.get(`/api/goal-setting/groups/conversation`, { params: { key, yearId, ...scope } });
  return r.data;
}

export async function postGoalGroupMessage(key: string, yearId: number, scope: GoalDirectScope, commentText: string): Promise<GoalCommentDto> {
  const r = await api.post(`/api/goal-setting/groups/conversation`, { commentText }, { params: { key, yearId, ...scope } });
  return r.data;
}

// RAG Analysis popup: the district's clubs with their Rotary.org member count.
export interface GoalRagClub { clubId: number; clubName: string; members: number }
export async function getGoalRagClubs(yearId: number, districtId: number): Promise<GoalRagClub[]> {
  const r = await api.get(`/api/goal-setting-rotary/rag-clubs`, { params: { yearId, districtId } });
  return r.data;
}

// --- Settings > QR Attendance (SuperAdmin, 2026-11-27). Marker: QR-ATTENDANCE ---
// Roll-out switch for the mobile QR attendance feature: test clubs first, then all.
// modifiedDate fields are UTC ISO strings.
export interface AttendanceQrClub {
  clubId: number;
  clubName: string | null;
  districtNumber: string | null;
  isEnabled: boolean;
  modifiedDate: string | null;
  modifiedByName: string | null;
}

export interface AttendanceQrSettings {
  allClubs: boolean;
  allClubsModifiedDate: string | null;
  allClubsModifiedByName: string | null;
  clubs: AttendanceQrClub[];
}

export async function getAttendanceQrSettings(): Promise<AttendanceQrSettings> {
  const { data } = await api.get("/api/settings/attendance-qr");
  return data;
}

export async function setAttendanceQrAll(isEnabled: boolean): Promise<{ message: string; isEnabled: boolean }> {
  const { data } = await api.put("/api/settings/attendance-qr/all", { isEnabled });
  return data;
}

export async function setAttendanceQrClub(clubId: number, isEnabled: boolean): Promise<{ message: string; isEnabled: boolean }> {
  const { data } = await api.put(`/api/settings/attendance-qr/club/${clubId}`, { isEnabled });
  return data;
}

export async function removeAttendanceQrClub(clubId: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/api/settings/attendance-qr/club/${clubId}`);
  return data;
}
