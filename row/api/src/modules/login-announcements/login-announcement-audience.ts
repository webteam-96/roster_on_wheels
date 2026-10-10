import type { DbCommands } from "../../database/db.service";
import { RI_DIRECTOR } from "../goal-setting/goal-core";

/**
 * Port of LoginAnnouncementAudience.cs. target_roles: comma list (NULL = ALL). target_filters: JSON of purchase
 * filters. target_locations: JSON {ZoneIds, DistrictIds, ClubIds} (the C# PascalCase shape, kept for stored rows).
 * A member sees an announcement when they hold ANY targeted role AND match EVERY filter and the location.
 */
export const ALL = "ALL";
export const ROLE_KEYS = [
  "SuperAdmin", "RIDirector", "ZonalCoordinator", "ClubAdmin", "DistrictAdmin", "AG", "ClubModerator",
  "Member", "ClubPresident", "ClubSecretary", "RMC", "ARC", "RPIC", "ARPIC", "RRFC", "ARRFC",
];
export const FILTER_DEFS: [string, string[]][] = [
  ["clubWebsite", ["purchased", "not_purchased", "expired"]], ["clubDues", ["purchased", "not_purchased"]], ["districtDues", ["purchased", "not_purchased"]],
  ["districtWebsite", ["purchased", "not_purchased"]], ["whatsappCredits", ["purchased", "not_purchased"]], ["emailCredits", ["purchased", "not_purchased"]],
];
const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Returns [stored, error]; stored null = ALL. */
export function normalizeRoles(input: unknown[] | null): [string | null, string | null] {
  const seen: string[] = [];
  for (const s of (input ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)) if (!seen.some((y) => ci(y, s))) seen.push(s);
  if (seen.length === 0) return [null, "Select at least one role (or ALL)."];
  if (seen.some((s) => ci(s, ALL))) return [null, null];
  const unknown = seen.filter((s) => !ROLE_KEYS.some((k) => ci(k, s)));
  if (unknown.length > 0) return [null, `Unknown role(s): ${unknown.join(", ")}.`];
  return [ROLE_KEYS.filter((k) => seen.some((s) => ci(s, k))).join(","), null];
}
export const parseRoles = (stored: string | null | undefined) => (!stored || !stored.trim() ? [ALL] : stored.split(",").map((s) => s.trim()).filter(Boolean));

/** "any"/blank dropped; [storedJson, error]; null = no filter. */
export function normalizeFilters(input: Record<string, unknown> | null): [string | null, string | null] {
  if (!input) return [null, null];
  const chosen = new Map<string, string>();
  for (const [key, raw] of Object.entries(input)) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value || value === "any") continue;
    const def = FILTER_DEFS.find(([k]) => ci(k, key));
    if (!def) return [null, `Unknown filter: ${key}.`];
    if (!def[1].includes(value)) return [null, `Invalid value '${raw}' for filter ${def[0]}.`];
    chosen.set(def[0], value);
  }
  if (chosen.size === 0) return [null, null];
  return [JSON.stringify(Object.fromEntries(FILTER_DEFS.filter(([k]) => chosen.has(k)).map(([k]) => [k, chosen.get(k)!]))), null];
}
export function parseFilters(stored: string | null | undefined): Record<string, string> {
  if (!stored || !stored.trim()) return {};
  try {
    const v = JSON.parse(stored);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export interface TargetLocations { zoneIds: number[]; districtIds: number[]; clubIds: number[] }
const isEmpty = (l: TargetLocations) => l.zoneIds.length === 0 && l.districtIds.length === 0 && l.clubIds.length === 0;
const pick = (o: Record<string, unknown>, k: string) => { const e = Object.entries(o).find(([x]) => ci(x, k)); return e ? e[1] : undefined; };
const idList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);

/** Ids must exist; [storedJson, error]; null = none. */
export async function normalizeLocations(conn: DbCommands, input: unknown): Promise<[string | null, string | null]> {
  if (input === null || input === undefined || typeof input !== "object") return [null, null];
  const o = input as Record<string, unknown>;
  const clean: TargetLocations = { zoneIds: idList(pick(o, "zoneIds")), districtIds: idList(pick(o, "districtIds")), clubIds: idList(pick(o, "clubIds")) };
  if (isEmpty(clean)) return [null, null];
  if (clean.clubIds.length > 3000) return [null, "Select at most 3000 clubs."];
  const allExist = async (table: string, pk: string, ids: number[]) => ids.length === 0 || Number(await conn.executeScalar(`SELECT COUNT(*) FROM ${table} WHERE ${pk} IN @Ids AND isdeleted = 0`, { Ids: ids })) === ids.length;
  if (!(await allExist("zone_master", "pk_zone_id", clean.zoneIds))) return [null, "One or more selected zones no longer exist."];
  if (!(await allExist("district_master", "pk_district_id", clean.districtIds))) return [null, "One or more selected districts no longer exist."];
  if (!(await allExist("club_master", "pk_club_id", clean.clubIds))) return [null, "One or more selected clubs no longer exist."];
  return [JSON.stringify({ ZoneIds: clean.zoneIds, DistrictIds: clean.districtIds, ClubIds: clean.clubIds }), null];
}
export function parseLocations(stored: string | null | undefined): TargetLocations {
  const empty = { zoneIds: [], districtIds: [], clubIds: [] };
  if (!stored || !stored.trim()) return empty;
  try {
    const o = JSON.parse(stored);
    return o && typeof o === "object" ? { zoneIds: idList(pick(o, "zoneIds")), districtIds: idList(pick(o, "districtIds")), clubIds: idList(pick(o, "clubIds")) } : empty;
  } catch {
    return empty;
  }
}

export async function describeLocations(conn: DbCommands, loc: TargetLocations) {
  const zones = loc.zoneIds.length ? await conn.query("SELECT pk_zone_id AS id, ZoneName AS name FROM zone_master WHERE pk_zone_id IN @Ids ORDER BY ZoneName", { Ids: loc.zoneIds }) : [];
  const districts = loc.districtIds.length ? await conn.query("SELECT pk_district_id AS id, DistrictNumber AS name, fk_zone_id AS zoneId FROM district_master WHERE pk_district_id IN @Ids ORDER BY DistrictNumber", { Ids: loc.districtIds }) : [];
  const clubs = loc.clubIds.length
    ? await conn.query(`SELECT c.pk_club_id AS id, c.ClubName AS name, c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber
                        FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id IN @Ids ORDER BY c.ClubName`, { Ids: loc.clubIds })
    : [];
  return { zoneIds: loc.zoneIds, districtIds: loc.districtIds, clubIds: loc.clubIds, zones, districts, clubs };
}

const GOAL_ABBREV = /\(([A-Z]+)\)\s*$/;

/** Every role key the member holds (mobile excludes SuperAdmin). */
export async function resolveMemberRoleKeys(conn: DbCommands, memberId: number, includeSuperAdmin: boolean): Promise<Set<string>> {
  const keys = new Set<string>();
  if (memberId <= 0) return keys;
  for (const r of await conn.query(
    `SELECT r.RoleName AS roleName, mr.fk_club_id AS clubId, mr.fk_district_id AS districtId FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
     WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0`, { Id: memberId })) {
    const name = String(r.roleName ?? "");
    const clubId = Number(r.clubId ?? 0), districtId = Number(r.districtId ?? 0);
    if (name === "Admin") { if (clubId > 0) keys.add("ClubAdmin"); else if (districtId > 0) keys.add("DistrictAdmin"); }
    else if (name === "SuperAdmin") { if (includeSuperAdmin) keys.add("SuperAdmin"); }
    else if (["RIDirector", "ZonalCoordinator", "AG", "ClubModerator", "Member"].includes(name)) keys.add(name);
  }
  const memberships = Number(await conn.executeScalar(
    `SELECT COUNT(*) FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
     WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0`, { Id: memberId }));
  if (memberships > 0) keys.add("Member");
  for (const d of await conn.query(
    `SELECT DISTINCT dm.designation_name AS n FROM board_of_directors b
     JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
     JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id AND y.IsCurrent = 1
     WHERE b.fk_member_master_profile_id = @Id AND b.isdeleted = 0 AND dm.designation_name IN ('Club President', 'Club Secretary')`, { Id: memberId })) {
    if (d.n === "Club President") keys.add("ClubPresident");
    else if (d.n === "Club Secretary") keys.add("ClubSecretary");
  }
  // Goal roles: the title ends with the abbreviation, e.g. "... Co-Ordinator (RMC)".
  for (const g of await conn.query(
    "SELECT DISTINCT RoleTitle AS roleTitle, RoleType AS roleType FROM goal_role_assignments WHERE fk_member_id = @Id AND fk_member_id > 0 AND IsActive = 1 AND isdeleted = 0", { Id: memberId })) {
    const title = String(g.roleTitle ?? "").trim();
    const m = GOAL_ABBREV.exec(title);
    if (m && ROLE_KEYS.some((k) => ci(k, m[1]))) keys.add(m[1]);
    else if (ci(title, "RI Director") || g.roleType === RI_DIRECTOR) keys.add("RIDirector");
  }
  return keys;
}

/** Purchase and location filters for one member; units and lookups loaded lazily and cached. */
class PurchaseFilterContext {
  private clubs: number[] | null = null;
  private adminDistricts: number[] = [];
  private allDistricts: number[] = [];
  private yearLabel: string | null = null;
  private cache = new Map<string, [string[], Set<string>, Set<string>]>();
  private locDistricts: number[] | null = null;
  private locZones: number[] = [];

  constructor(private readonly conn: DbCommands, private readonly memberId: number) {}

  async matchesAll(filters: Record<string, string>) {
    for (const [k, v] of Object.entries(filters)) if (!(await this.matches(k, v))) return false;
    return true;
  }

  /** The most specific selected level applies: clubs, else districts, else zones. */
  async matchesLocations(loc: TargetLocations) {
    if (isEmpty(loc)) return true;
    await this.loadUnits();
    if (loc.clubIds.length) return this.clubs!.some((c) => loc.clubIds.includes(c));
    await this.loadLocationUnits();
    if (loc.districtIds.length) return this.locDistricts!.some((d) => loc.districtIds.includes(d));
    return this.locZones.some((z) => loc.zoneIds.includes(z));
  }

  private ints = async (sql: string, p: Record<string, unknown>) => (await this.conn.query(sql, p)).map((r) => Number(Object.values(r)[0])).filter((n) => n > 0);

  private async loadLocationUnits() {
    if (this.locDistricts) return;
    const goalDistricts = await this.ints(
      `SELECT d.fk_district_id FROM goal_role_assignment_districts d JOIN goal_role_assignments a ON a.pk_id = d.fk_assignment_id
       WHERE a.fk_member_id = @Id AND a.fk_member_id > 0 AND a.IsActive = 1 AND a.isdeleted = 0`, { Id: this.memberId });
    this.locDistricts = [...new Set([...this.allDistricts, ...goalDistricts])];
    const zones = new Set<number>();
    if (this.locDistricts.length)
      for (const z of await this.ints("SELECT DISTINCT fk_zone_id FROM district_master WHERE pk_district_id IN @Ids AND fk_zone_id > 0", { Ids: this.locDistricts })) zones.add(z);
    for (const z of await this.ints(
      `SELECT mr.fk_zone_id FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
       WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0 AND r.RoleName = 'ZonalCoordinator' AND mr.fk_zone_id > 0
       UNION
       SELECT gz.fk_zone_id FROM goal_role_assignment_zones gz JOIN goal_role_assignments a ON a.pk_id = gz.fk_assignment_id
       WHERE a.fk_member_id = @Id AND a.fk_member_id > 0 AND a.IsActive = 1 AND a.isdeleted = 0
       UNION
       SELECT a.fk_zone_id FROM goal_role_assignments a WHERE a.fk_member_id = @Id AND a.fk_member_id > 0 AND a.IsActive = 1 AND a.isdeleted = 0 AND a.fk_zone_id > 0`, { Id: this.memberId })) zones.add(z);
    this.locZones = [...zones];
  }

  private async matches(key: string, value: string) {
    const [units, has, ever] = await this.status(key);
    if (units.length === 0) return false;
    if (value === "purchased") return units.some((u) => has.has(u));
    if (value === "not_purchased") return units.some((u) => !has.has(u));
    if (value === "expired") return units.some((u) => ever.has(u) && !has.has(u));
    return true;
  }

  private async loadUnits() {
    if (this.clubs) return;
    this.clubs = [...new Set(await this.ints(
      `SELECT cm.fk_club_id FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
       UNION
       SELECT mr.fk_club_id FROM member_roles mr WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0 AND mr.fk_club_id > 0
       UNION
       SELECT b.fk_club_id FROM board_of_directors b
       JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
       JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id AND y.IsCurrent = 1
       WHERE b.fk_member_master_profile_id = @Id AND b.isdeleted = 0 AND dm.designation_name IN ('Club President', 'Club Secretary')`, { Id: this.memberId }))];
    this.adminDistricts = await this.ints(
      `SELECT DISTINCT mr.fk_district_id FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
       WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0 AND r.RoleName IN ('Admin', 'AG')
         AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)`, { Id: this.memberId });
    const clubDistricts = this.clubs.length ? await this.ints("SELECT DISTINCT fk_district_id FROM club_master WHERE pk_club_id IN @Ids AND fk_district_id > 0", { Ids: this.clubs }) : [];
    this.allDistricts = [...new Set([...this.adminDistricts, ...clubDistricts])];
    this.yearLabel = (await this.conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")) ?? null;
  }

  private async status(key: string): Promise<[string[], Set<string>, Set<string>]> {
    const hit = this.cache.get(key);
    if (hit) return hit;
    await this.loadUnits();
    const clubs = this.clubs!;
    const clubUnits = clubs.map((c) => `c${c}`), districtUnits = this.allDistricts.map((d) => `d${d}`);
    const ids = async (prefix: string, list: number[], sql: string, extra: Record<string, unknown> = {}) =>
      list.length ? new Set((await this.ints(sql, { Ids: list, Year: this.yearLabel, ...extra })).map((i) => `${prefix}${i}`)) : new Set<string>();
    let s: [string[], Set<string>, Set<string>];
    switch (key) {
      case "clubWebsite":
        s = [clubUnits,
          await ids("c", clubs, "SELECT DISTINCT fk_club_id FROM club_websites WHERE fk_club_id IN @Ids AND COALESCE(isdeleted, 0) = 0 AND Status = 'Active' AND CURDATE() BETWEEN StartDate AND EndDate"),
          await ids("c", clubs, "SELECT DISTINCT fk_club_id FROM club_websites WHERE fk_club_id IN @Ids AND COALESCE(isdeleted, 0) = 0")];
        break;
      case "clubDues":
        s = [clubUnits, await ids("c", clubs, "SELECT DISTINCT fk_club_id FROM membership_dues WHERE fk_club_id IN @Ids AND isdeleted = 0 AND IsActive = 1 AND RotaryYear = @Year"), new Set()];
        break;
      case "districtDues":
        s = [districtUnits, await ids("d", this.allDistricts, "SELECT DISTINCT fk_district_id FROM club_dues WHERE fk_district_id IN @Ids AND isdeleted = 0 AND IsActive = 1 AND RotaryYear = @Year"), new Set()];
        break;
      case "districtWebsite":
        s = [districtUnits, await ids("d", this.allDistricts, "SELECT DISTINCT fk_district_id FROM district_websites WHERE fk_district_id IN @Ids AND COALESCE(isdeleted, 0) = 0 AND Status = 'Active'"), new Set()];
        break;
      case "whatsappCredits":
      case "emailCredits": {
        const Type = key === "whatsappCredits" ? "WhatsApp" : "Email";
        const has = await ids("c", clubs, `SELECT DISTINCT fk_club_id FROM club_credits WHERE fk_club_id IN @Ids AND CreditType = @Type AND IsActive = 1 AND isdeleted = 0
                                         AND NOW() <= ToDate AND (CreditCount - UsedCount) > 0`, { Type });
        // District credits belong to the districts the member administers, not their clubs' districts.
        for (const d of await ids("d", this.adminDistricts, `SELECT DISTINCT fk_district_id FROM club_credits WHERE fk_club_id = 0 AND fk_district_id IN @Ids AND CreditType = @Type
                                         AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate AND (CreditCount - UsedCount) > 0`, { Type })) has.add(d);
        s = [[...clubUnits, ...this.adminDistricts.map((d) => `d${d}`)], has, new Set()];
        break;
      }
      default:
        s = [["x"], new Set(["x"]), new Set()];
    }
    this.cache.set(key, s);
    return s;
  }
}

/** Shared web + mobile "active" payload: show/id/content = first item (older app), items[] for the arrows. */
export async function buildActivePayload(conn: DbCommands, memberId: number, includeSuperAdmin: boolean, currentRole: string | null) {
  const rows = await conn.query(
    `SELECT a.pk_announcement_id AS id, a.content AS content, a.target_roles AS targetRoles, a.target_filters AS targetFilters, a.target_locations AS targetLocations
     FROM login_announcements a
     WHERE a.is_active = 1 AND a.isdeleted = 0
       AND NOT EXISTS (SELECT 1 FROM login_announcement_reads r WHERE r.fk_announcement_id = a.pk_announcement_id AND r.fk_member_id = @MemberId)
     ORDER BY a.pk_announcement_id DESC`, { MemberId: memberId });
  if (rows.length === 0) return { show: false, items: [] };
  const memberKeys = await resolveMemberRoleKeys(conn, memberId, includeSuperAdmin);
  let ctx: PurchaseFilterContext | null = null;
  let items: { id: number; content: string; roles: string[] }[] = [];
  for (const row of rows) {
    const target = parseRoles(row.targetRoles as string | null);
    let matched: string[];
    if (target.some((t) => ci(t, ALL))) matched = [ALL];
    else {
      matched = target.filter((t) => [...memberKeys].some((k) => ci(k, t)));
      if (matched.length === 0) continue;
    }
    const filters = parseFilters(row.targetFilters as string | null);
    if (Object.keys(filters).length) {
      ctx ??= new PurchaseFilterContext(conn, memberId);
      if (!(await ctx.matchesAll(filters))) continue;
    }
    const loc = parseLocations(row.targetLocations as string | null);
    if (!isEmpty(loc)) {
      ctx ??= new PurchaseFilterContext(conn, memberId);
      if (!(await ctx.matchesLocations(loc))) continue;
    }
    items.push({ id: Number(row.id), content: String(row.content ?? ""), roles: matched });
  }
  if (items.length === 0) return { show: false, items: [] };
  // The landing dashboard's role first; otherwise newest first (stable sort).
  if (currentRole && currentRole.trim()) {
    const has = (i: (typeof items)[number]) => i.roles.some((r) => ci(r, currentRole));
    items = [...items.filter(has), ...items.filter((i) => !has(i))];
  }
  return { show: true, id: items[0].id, content: items[0].content, items };
}

export async function acknowledge(conn: DbCommands, memberId: number, ids: number[]) {
  for (const id of [...new Set(ids.filter((i) => i > 0))].slice(0, 100))
    await conn.execute("INSERT IGNORE INTO login_announcement_reads (fk_announcement_id, fk_member_id, created_date) VALUES (@AnnId, @MemberId, NOW())", { AnnId: id, MemberId: memberId });
}
