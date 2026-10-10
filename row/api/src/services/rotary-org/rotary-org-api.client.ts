import { Injectable, Logger } from "@nestjs/common";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { HttpRequestException, InvalidOperationException } from "../../common/exceptions";

export interface RotaryOrgClubOfficer { role: string | null; name: string | null; email: string | null; phone: string | null; rotaryId: string | null }

const TOKEN_TTL_MS = 55 * 60 * 1000;
const truncate = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max) + "…");

/**
 * Port of RotaryOrgApiClient.cs: the Rotary.org Data Integration API with a
 * process-wide token cache (55 min) and one re-auth + retry on 401. ROW needs its
 * own Rotary.org access (RotaryOrgApi:BaseUrl / Username / Password).
 * Response DTOs are read case-insensitively, as System.Text.Json did; dates come back as
 * "yyyy-MM-ddTHH:mm:ssZ" (UTC, the C# FlexibleDateTimeConverter's write format) or null.
 */
@Injectable()
export class RotaryOrgApiClient {
  private readonly log = new Logger("RotaryOrgApiClient");
  private cached: { token: string; expiresAt: number } | null = null;
  private authenticating: Promise<string> | null = null;

  constructor(private readonly config: AppConfig) {}

  private get baseUrl() {
    return (this.config.get("RotaryOrgApi:BaseUrl") ?? "https://api.rotary.org:8443/v1.1").replace(/\/+$/, "") + "/";
  }

  private headers(extra: Record<string, string> = {}) {
    // some Rotary.org endpoints reject requests without a User-Agent
    return { Accept: "application/json", "User-Agent": `${Brand.Current.shortName}-Sync/1.0`, ...extra };
  }

  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) return this.cached.token;
    this.authenticating ??= this.authenticate().finally(() => (this.authenticating = null));
    return this.authenticating;
  }

  async reauthenticate(): Promise<string> {
    this.cached = null;
    return this.getToken();
  }

  private async authenticate(): Promise<string> {
    const username = this.config.get("RotaryOrgApi:Username") ?? "";
    const password = this.config.get("RotaryOrgApi:Password") ?? "";
    if (!username.trim() || !password.trim()) throw new InvalidOperationException("RotaryOrgApi:Username / Password not configured in appsettings.");
    this.log.log(`🔑 [RI.org] POST /authentication — user=${username}`);
    const started = Date.now();
    const resp = await fetch(this.baseUrl + "authentication", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ Username: username, Password: password }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await resp.text();
    if (!resp.ok) {
      this.log.warn(`🔑 [RI.org] auth FAILED status=${resp.status} body=${truncate(body, 300)}`);
      throw new HttpRequestException(`Rotary.org authentication failed: ${resp.status} ${resp.statusText}. Body: ${truncate(body, 200)}`);
    }
    const token = RotaryOrgApiClient.extractToken(body);
    if (!token || !token.trim()) throw new InvalidOperationException(`Rotary.org auth response could not be parsed. Body: ${truncate(body, 200)}`);
    this.cached = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
    this.log.log(`🔑 [RI.org] auth OK in ${Date.now() - started}ms — token len=${token.length}`);
    return token;
  }

  /** The token comes back as a bare JSON string, an object with a token key, or plain text. */
  static extractToken(body: string): string | null {
    const b = (body ?? "").trim();
    if (!b) return null;
    if (b.startsWith('"') && b.endsWith('"')) return b.slice(1, -1);
    try {
      const doc = JSON.parse(b);
      for (const key of ["auth_token", "authToken", "AuthToken", "token", "Token", "access_token", "AccessToken"])
        if (typeof doc?.[key] === "string") return doc[key];
    } catch {
      /* not JSON */
    }
    return !b.startsWith("{") && !b.startsWith("[") ? b : null;
  }

  /** GET with the custom auth_token header; one re-auth and retry on 401. */
  private async getAuthenticated(path: string): Promise<Response> {
    let token = await this.getToken();
    this.log.log(`🔑 [RI.org] GET ${path} — token len=${token.length}`);
    const send = (t: string) => fetch(this.baseUrl + path, { headers: this.headers({ auth_token: t }), signal: AbortSignal.timeout(90_000) });
    const resp = await send(token);
    if (resp.status !== 401) return resp;
    this.log.log(`🔑 [RI.org] 401 on ${path} — re-authenticating and retrying`);
    token = await this.reauthenticate();
    return send(token);
  }

  async getClubs(): Promise<RotaryOrgClubList[]> {
    const started = Date.now();
    const resp = await this.getAuthenticated("clubs");
    const body = await resp.text();
    if (!resp.ok) {
      this.log.warn(`🔑 [RI.org] GET /clubs FAILED status=${resp.status} body=${truncate(body, 300)}`);
      throw new HttpRequestException(`Rotary.org GET /clubs failed: ${resp.status}. Body: ${truncate(body, 200)}`);
    }
    const list = arrayOf(parseJson(body)).map(toClubList);
    this.log.log(`🔑 [RI.org] GET /clubs OK in ${Date.now() - started}ms — ${list.length} clubs`);
    return list;
  }

  /** Full club detail with addresses; null when Rotary.org has no such club (404). */
  async getClubDetail(clubType: string, clubId: number): Promise<RotaryOrgClubDetail | null> {
    const type = clubType && clubType.trim() ? clubType : "Rotary Club";
    const resp = await this.getAuthenticated(`clubs/${encodeURIComponent(type)}/${clubId}?summary=false`);
    const body = await resp.text();
    if (resp.status === 404) return null;
    if (!resp.ok) {
      this.log.warn(`🔑 [RI.org] GET /clubs/${type}/${clubId} FAILED status=${resp.status}`);
      throw new HttpRequestException(`Rotary.org GET club detail failed: ${resp.status}. Body: ${truncate(body, 200)}`);
    }
    const j = parseJson(body);
    return j && typeof j === "object" ? toClubDetail(j) : null;
  }

  /** Country-scoped Rotary clubs (with the district number as a string). */
  async searchClubsByCountry(country: string): Promise<RotaryOrgClubSearch[]> {
    const path = `Clubs/search?searchterm=${encodeURIComponent(`(type=country:value=${country})`)}&searchterm=${encodeURIComponent("(type=ClubType:value=Rotary Club)")}`;
    const resp = await this.getAuthenticated(path);
    const body = await resp.text();
    if (!resp.ok) throw new HttpRequestException(`Rotary.org GET /Clubs/search failed: ${resp.status}. Body: ${truncate(body, 200)}`);
    return arrayOf(parseJson(body)).map(toClubSearch);
  }

  /** Active members (honorary excluded by Rotary.org); 401 / 403 / 404 read as none. */
  async getClubMembers(clubType: string, clubId: number): Promise<RotaryOrgClubMember[]> {
    const type = clubType && clubType.trim() ? clubType : "Rotary Club";
    const resp = await this.getAuthenticated(`clubs/${encodeURIComponent(type)}/${clubId}/members/0/1500/Active`);
    const body = await resp.text();
    if (resp.status === 404 || resp.status === 401 || resp.status === 403) return [];
    if (!resp.ok) throw new HttpRequestException(`Rotary.org GET /clubs/${type}/${clubId}/members failed: ${resp.status}. Body: ${truncate(body, 200)}`);
    return arrayOf(pick(parseJson(body), "ClubMembers")).map(toMember);
  }

  /** Honorary members; any failure reads as none (many clubs answer 404). */
  async getClubHonoraryMembers(clubType: string, clubId: number): Promise<RotaryOrgClubMember[]> {
    const type = clubType && clubType.trim() ? clubType : "Rotary Club";
    const resp = await this.getAuthenticated(`clubs/${encodeURIComponent(type)}/${clubId}/members/0/1500/Honorary`);
    const body = await resp.text();
    if (!resp.ok) return [];
    return arrayOf(pick(parseJson(body), "ClubMembers")).map(toMember);
  }

  /**
   * Terminated (former) members, display only. Paged with a 1-based cursor; a short page is the only
   * end-of-data signal. Rotary.org answers 400 "do not exist" for a club with none.
   */
  async getClubTerminatedMembers(clubType: string, clubId: number): Promise<RotaryOrgClubMember[]> {
    const type = clubType && clubType.trim() ? clubType : "Rotary Club";
    const pageSize = 100, maxPages = 50;
    const all: RotaryOrgClubMember[] = [];
    let current = 1;
    for (let page = 0; page < maxPages; page++) {
      const resp = await this.getAuthenticated(`clubs/${encodeURIComponent(type)}/${clubId}/members/${current}/${pageSize}/Terminated`);
      const body = await resp.text();
      if (resp.status === 404 || resp.status === 401 || resp.status === 403) break;
      if (resp.status === 400 && /do not exist/i.test(body)) break;
      if (!resp.ok) throw new InvalidOperationException("Rotary.org didn't return a result for this club (unexpected response). Try again shortly, or refresh just this club again later.");
      const items = parseMembersResponse(body);
      if (!items.length) break;
      all.push(...items);
      if (items.length < pageSize) break;
      current += items.length;
    }
    return all;
  }

  /** Full member profile with Address[] / Phone[] / Email[]; null on 401 / 403 / 404. */
  async getIndividualProfile(memberId: number): Promise<RotaryOrgIndividualProfile | null> {
    const resp = await this.getAuthenticated(`individuals/${memberId}/profile`);
    if (resp.status === 404 || resp.status === 401 || resp.status === 403) return null;
    const body = await resp.text();
    if (!resp.ok) throw new HttpRequestException(`Rotary.org GET /individuals/${memberId}/profile failed: ${resp.status}. Body: ${truncate(body, 200)}`);
    const j = parseJson(body);
    return j && typeof j === "object" ? toProfile(j) : null;
  }

  /** A club's officers for a date range ("MM/dd/yyyy"); any failure or unknown shape -> []. */
  async getClubOfficers(clubType: string, clubId: number, startDate: string, endDate: string): Promise<RotaryOrgClubOfficer[]> {
    const type = clubType && clubType.trim() ? clubType : "Rotary Club";
    const resp = await this.getAuthenticated(`clubs/${encodeURIComponent(type)}/${clubId}/officers?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
    const body = await resp.text();
    if (!resp.ok) return [];
    try {
      return parseOfficers(JSON.parse(body));
    } catch {
      return [];
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const prop = (el: unknown, ...names: string[]) => {
  if (isObj(el)) for (const n of names) if (n in el) return { found: true, value: el[n] };
  return { found: false, value: undefined };
};
const firstStr = (el: unknown, ...names: string[]): string | null => {
  if (!isObj(el)) return null;
  for (const n of names) {
    if (!(n in el)) continue;
    const v = el[n];
    if (typeof v === "string") { if (v.trim()) return v.trim(); }
    else if (typeof v === "number") return String(v);
  }
  return null;
};
const joinName = (first: string | null, last: string | null) => [first, last].filter((x) => x && x.trim()).join(" ") || null;

/** The response is a bare array or a wrapper { Officers | officers | ClubOfficers | clubOfficers: [...] }. */
export function parseOfficers(root: unknown): RotaryOrgClubOfficer[] {
  let arr: unknown;
  if (Array.isArray(root)) arr = root;
  else {
    const p = prop(root, "Officers", "officers", "ClubOfficers", "clubOfficers");
    if (!p.found || !Array.isArray(p.value)) return [];
    arr = p.value;
  }
  return (arr as unknown[]).map((o) => {
    const indiv = prop(o, "Individual", "individual", "Member", "member");
    const person = indiv.found && isObj(indiv.value) ? indiv.value : o;
    return {
      role: firstStr(o, "Role", "RoleName", "role", "Title", "OfficerRole", "PositionName"),
      name: firstStr(person, "Name", "FullName", "MemberName", "IndividualName", "PreferredName", "name") ?? joinName(firstStr(person, "FirstName", "firstName"), firstStr(person, "LastName", "lastName")),
      email: firstStr(person, "Email", "EmailAddress", "EmailId", "Email1", "email"),
      phone: firstStr(person, "Phone", "Mobile", "PhoneNumber", "Phone1", "MobileNumber", "phone"),
      rotaryId:
        firstStr(person, "Id", "id", "MemberId", "memberId", "IndividualId", "individualId", "RiIndividualId", "riIndividualId") ??
        firstStr(o, "Id", "id", "MemberId", "memberId", "IndividualId", "individualId"),
    };
  });
}

// ---- DTOs (case-insensitive JSON, as System.Text.Json with PropertyNameCaseInsensitive) ----

export interface RotaryOrgClubList { clubId: number; clubType: string | null; clubSubType: string | null; clubName: string | null; clubCountry: string | null; districtId: number | null; memberCount: number | null; honoraryMemberCount: number | null }
export interface RotaryOrgAddress {
  addressType: string | null; addressLine1: string | null; addressLine2: string | null; addressLine3: string | null; country: string | null; state: string | null; city: string | null;
  postalCode: string | null; meetingName: string | null; meetingDay: string | null; meetingTime: string | null; meetingComment: string | null; meetingType: string | null;
  onlineLocation: string | null; meetinglocationVariesFlag: string | null; meetingLocationName: string | null; isPrimary: boolean | null;
}
export interface RotaryOrgClubDetail {
  clubId: number; clubType: string | null; clubSubType: string | null; clubName: string | null; charterDate: string | null; startDate: string | null; endDate: string | null;
  districtId: number | null; zoneName: string | null; zoneSectionName: string | null; language: string | null; addresses: RotaryOrgAddress[] | null;
  websites: { websiteUrl: string | null; websiteType: string | null }[] | null; key: string | null; lastUpdated: string | null;
}
export interface RotaryOrgClubSearch {
  clubId: number; clubName: string | null; clubType: string | null; clubSubType: string | null; charterDate: string | null; numberOfActiveMembers: number | null;
  location: { latitude: number | null; longitude: number | null } | null; clubLanguage: string | null; district: string | null; website: string | null; email: string | null;
  address: { addressLine1: string | null; addressLine2: string | null; addressLine3: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null } | null;
}
export interface RotaryOrgClubMember {
  memberId: number; badgeName: string | null; localizedName: string | null; prefix: string | null; firstName: string | null; middleName: string | null; lastName: string | null;
  suffix: string | null; admissionDate: string | null; terminationDate: string | null; terminationReason: string | null; birthYear: string | null; memberType: string | null;
}
export interface RotaryOrgIndividualProfile {
  individual: {
    memberId: number; prefix: string | null; firstName: string | null; middleName: string | null; lastName: string | null; suffix: string | null; localizedName: string | null;
    gender: string | null; genderDescription: string | null; dateOfBirth: string | null; primaryLanguage: string | null; classification: string | null; youthFlag: boolean | null;
  } | null;
  address: { addressType: string | null; addressLine1: string | null; addressLine2: string | null; addressLine3: string | null; country: string | null; state: string | null; city: string | null; postalCode: string | null; isPrimary: boolean | null }[] | null;
  phone: { phoneType: string | null; phoneNumber: string | null; countryCode: string | null; isPrimary: boolean | null }[] | null;
  email: { emailAddress: string | null; emailType: string | null; isPrimary: boolean | null }[] | null;
}

const parseJson = (body: string): unknown => { try { return JSON.parse(body); } catch { return null; } };
/** Property by name, ignoring case. */
export function pick(o: unknown, name: string): unknown {
  if (!isObj(o)) return undefined;
  if (name in o) return o[name];
  const k = Object.keys(o).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : o[k];
}
const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (o: unknown, n: string): string | null => { const v = pick(o, n); return v === null || v === undefined ? null : String(v); };
const i = (o: unknown, n: string): number | null => { const v = pick(o, n); if (v === null || v === undefined || v === "") return null; const x = Number(v); return Number.isFinite(x) ? Math.trunc(x) : null; };
const f = (o: unknown, n: string): number | null => { const v = pick(o, n); if (v === null || v === undefined || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const b = (o: unknown, n: string): boolean | null => { const v = pick(o, n); return typeof v === "boolean" ? v : v === null || v === undefined ? null : String(v).toLowerCase() === "true"; };

/** FlexibleDateTimeConverter: a date string (taken as UTC unless it says otherwise) or epoch ms → "yyyy-MM-ddTHH:mm:ssZ". */
export function flexibleDate(v: unknown): string | null {
  let d: Date | null = null;
  if (typeof v === "number") d = new Date(v);
  else if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
    if (m) d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)));
    else {
      const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t) || !/\d{2}:\d{2}/.test(t) ? t : `${t.replace(" ", "T")}Z`;
      const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
      d = Number.isNaN(ms) ? null : new Date(ms);
    }
  }
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 19) + "Z" : null;
}
const dt = (o: unknown, n: string) => flexibleDate(pick(o, n));

const toClubList = (o: unknown): RotaryOrgClubList => ({ clubId: i(o, "ClubId") ?? 0, clubType: s(o, "ClubType"), clubSubType: s(o, "ClubSubType"), clubName: s(o, "ClubName"),
  clubCountry: s(o, "ClubCountry"), districtId: i(o, "DistrictId"), memberCount: i(o, "MemberCount"), honoraryMemberCount: i(o, "HonoraryMemberCount") });
const toAddress = (o: unknown): RotaryOrgAddress => ({
  addressType: s(o, "AddressType"), addressLine1: s(o, "AddressLine1"), addressLine2: s(o, "AddressLine2"), addressLine3: s(o, "AddressLine3"), country: s(o, "Country"), state: s(o, "State"),
  city: s(o, "City"), postalCode: s(o, "PostalCode"), meetingName: s(o, "MeetingName"), meetingDay: s(o, "MeetingDay"), meetingTime: s(o, "MeetingTime"), meetingComment: s(o, "MeetingComment"),
  meetingType: s(o, "MeetingType"), onlineLocation: s(o, "OnlineLocation"), meetinglocationVariesFlag: s(o, "MeetinglocationVariesFlag"), meetingLocationName: s(o, "MeetingLocationName"),
  isPrimary: b(o, "IsPrimary"),
});
const toClubDetail = (o: unknown): RotaryOrgClubDetail => ({
  clubId: i(o, "ClubId") ?? 0, clubType: s(o, "ClubType"), clubSubType: s(o, "ClubSubType"), clubName: s(o, "ClubName"), charterDate: dt(o, "CharterDate"), startDate: dt(o, "StartDate"),
  endDate: dt(o, "EndDate"), districtId: i(o, "DistrictId"), zoneName: s(o, "ZoneName"), zoneSectionName: s(o, "ZoneSectionName"), language: s(o, "Language"),
  addresses: Array.isArray(pick(o, "Addresses")) ? arrayOf(pick(o, "Addresses")).map(toAddress) : null,
  websites: Array.isArray(pick(o, "Websites")) ? arrayOf(pick(o, "Websites")).map((w) => ({ websiteUrl: s(w, "WebsiteUrl"), websiteType: s(w, "WebsiteType") })) : null,
  key: s(o, "Key"), lastUpdated: dt(o, "LastUpdated"),
});
const toClubSearch = (o: unknown): RotaryOrgClubSearch => {
  const loc = pick(o, "Location"), addr = pick(o, "Address");
  return {
    clubId: i(o, "ClubId") ?? 0, clubName: s(o, "ClubName"), clubType: s(o, "ClubType"), clubSubType: s(o, "ClubSubType"), charterDate: dt(o, "CharterDate"),
    numberOfActiveMembers: i(o, "NumberOfActiveMembers"), location: isObj(loc) ? { latitude: f(loc, "Latitude"), longitude: f(loc, "Longitude") } : null, clubLanguage: s(o, "ClubLanguage"),
    district: s(o, "District"), website: s(o, "Website"), email: s(o, "Email"),
    address: isObj(addr) ? { addressLine1: s(addr, "AddressLine1"), addressLine2: s(addr, "AddressLine2"), addressLine3: s(addr, "AddressLine3"), city: s(addr, "City"), state: s(addr, "State"),
      postalCode: s(addr, "PostalCode"), country: s(addr, "Country") } : null,
  };
};
const toMember = (o: unknown): RotaryOrgClubMember => ({
  memberId: i(o, "MemberId") ?? 0, badgeName: s(o, "BadgeName"), localizedName: s(o, "LocalizedName"), prefix: s(o, "Prefix"), firstName: s(o, "FirstName"), middleName: s(o, "MiddleName"),
  lastName: s(o, "LastName"), suffix: s(o, "Suffix"), admissionDate: dt(o, "AdmissionDate"), terminationDate: dt(o, "TerminationDate"), terminationReason: s(o, "TerminationReason"),
  birthYear: s(o, "BirthYear"), memberType: s(o, "MemberType"),
});
const toProfile = (o: unknown): RotaryOrgIndividualProfile => {
  const ind = pick(o, "Individual");
  const list = (n: string) => (Array.isArray(pick(o, n)) ? arrayOf(pick(o, n)) : null);
  return {
    individual: isObj(ind) ? {
      memberId: i(ind, "MemberId") ?? 0, prefix: s(ind, "Prefix"), firstName: s(ind, "FirstName"), middleName: s(ind, "MiddleName"), lastName: s(ind, "LastName"), suffix: s(ind, "Suffix"),
      localizedName: s(ind, "LocalizedName"), gender: s(ind, "Gender"), genderDescription: s(ind, "GenderDescription"), dateOfBirth: s(ind, "DateOfBirth"),
      primaryLanguage: s(ind, "PrimaryLanguage"), classification: s(ind, "Classification"), youthFlag: b(ind, "YouthFlag"),
    } : null,
    address: list("Address")?.map((a) => ({ addressType: s(a, "AddressType"), addressLine1: s(a, "AddressLine1"), addressLine2: s(a, "AddressLine2"), addressLine3: s(a, "AddressLine3"),
      country: s(a, "Country"), state: s(a, "State"), city: s(a, "City"), postalCode: s(a, "PostalCode"), isPrimary: b(a, "IsPrimary") })) ?? null,
    phone: list("Phone")?.map((p) => ({ phoneType: s(p, "PhoneType"), phoneNumber: s(p, "PhoneNumber"), countryCode: s(p, "CountryCode"), isPrimary: b(p, "IsPrimary") })) ?? null,
    email: list("Email")?.map((e) => ({ emailAddress: s(e, "EmailAddress"), emailType: s(e, "EmailType"), isPrimary: b(e, "IsPrimary") })) ?? null,
  };
};

/** Every /members shape seen: a bare array, or a wrapper under one of several keys. */
export function parseMembersResponse(body: string): RotaryOrgClubMember[] {
  const j = parseJson(body);
  if (Array.isArray(j)) return j.map(toMember);
  for (const key of ["ClubMembers", "TerminatedClubMembers", "TerminatedMembers", "Members"]) {
    const v = pick(j, key);
    if (Array.isArray(v)) return v.map(toMember);
  }
  return [];
}

/** The best email / phone / address of a profile: primary, else (phone) mobile, else the first. */
export function profileContacts(p: RotaryOrgIndividualProfile | null) {
  const email = p?.email?.find((e) => e.isPrimary === true)?.emailAddress ?? p?.email?.[0]?.emailAddress ?? null;
  const phone = p?.phone?.find((x) => x.isPrimary === true)?.phoneNumber ?? p?.phone?.find((x) => (x.phoneType ?? "").toLowerCase() === "mobile")?.phoneNumber ?? p?.phone?.[0]?.phoneNumber ?? null;
  const address = p?.address?.find((a) => a.isPrimary === true) ?? p?.address?.[0] ?? null;
  return { email, phone, address };
}
