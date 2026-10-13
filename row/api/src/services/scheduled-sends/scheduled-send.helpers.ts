import type { DbCommands } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { broadcastConsentFilter } from "../privacy-consent";

/**
 * Shared by the scheduled email (and WhatsApp) senders: scope, recipients, the
 * source name and media URLs of announcements / events / newsletters / projects.
 */

export interface Recipient {
  memberId: number;
  memberName: string;
  /** EmailId for email sends, the mobile number for WhatsApp. */
  contact: string;
}

/** `null`/0 as null, else the id. */
export function nz(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** A district id makes it district scope; a club id club scope; otherwise the stored Scope (RI rows carry neither id). */
export function resolveScope(clubId: unknown, districtId: unknown, scopeCol: unknown): string {
  if (districtId !== null && districtId !== undefined) return "district";
  if (Number(clubId ?? 0) > 0) return "club";
  const s = typeof scopeCol === "string" ? scopeCol : "";
  return !s.trim() ? "club" : s.toLowerCase();
}

const CHAIN_ACTIVE = `cm.IsActive = 1 AND cm.isdeleted = 0
      AND c.IsActive = 1 AND c.isdeleted = 0
      AND d.IsActive = 1 AND d.isdeleted = 0
      AND z.IsActive = 1 AND z.isdeleted = 0
      AND m.isdeleted = 0`;

const parseIds = (s: string | null | undefined) =>
  !s || !s.trim() ? [] : s.split(",").map((x) => Number.parseInt(x.trim(), 10)).filter((v) => Number.isFinite(v) && v > 0);

/**
 * Members who receive a club / district / RI item: active members along a live
 * club → district → zone chain, each once, with a non-empty `contactColumn`.
 * RI items go to everyone, or the chosen zones / districts / RI sub-groups.
 */
export async function resolveRecipients(
  conn: DbCommands, contactColumn: string, scope: string, clubId: number, districtId: number | null,
  target: string | null, zoneIdsStr: string | null, districtIdsStr: string | null, subgroupIdsStr: string | null,
): Promise<Recipient[]> {
  // Members who withdrew or never gave consent are skipped when ROW privacy is on (WS7-05).
  const has = `m.${contactColumn} IS NOT NULL AND m.${contactColumn} <> ''${broadcastConsentFilter()}`;
  const select = `SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.${contactColumn} AS contact`;
  const map = (rows: Record<string, unknown>[]) =>
    rows.map((r) => ({ memberId: Number(r.memberId), memberName: String(r.memberName ?? ""), contact: String(r.contact ?? "") }));
  const fromClubMembers = `FROM club_members cm
      JOIN club_master c ON c.pk_club_id = cm.fk_club_id
      JOIN district_master d ON d.pk_district_id = c.fk_district_id
      JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
      JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id`;

  // DISTINCT: a member with two active rows in the same club is counted (and charged) once.
  if (scope === "club")
    return map(await conn.query(`${select} ${fromClubMembers} WHERE cm.fk_club_id = @Id AND ${CHAIN_ACTIVE} AND ${has}`, { Id: clubId }));
  if (scope === "district")
    return map(await conn.query(`${select} ${fromClubMembers} WHERE c.fk_district_id = @Id AND ${CHAIN_ACTIVE} AND ${has}`, { Id: districtId ?? 0 }));

  const base = `${select}
      FROM member_master_profile m
      JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
      JOIN club_master c ON c.pk_club_id = cm.fk_club_id
      JOIN district_master d ON d.pk_district_id = c.fk_district_id
      JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
      WHERE ${CHAIN_ACTIVE} AND ${has}`;
  switch ((target ?? "all").toLowerCase()) {
    case "zones": {
      const ids = parseIds(zoneIdsStr);
      return ids.length ? map(await conn.query(`${base} AND d.fk_zone_id IN @ZoneIds`, { ZoneIds: ids })) : [];
    }
    case "districts": {
      const ids = parseIds(districtIdsStr);
      return ids.length ? map(await conn.query(`${base} AND c.fk_district_id IN @DistrictIds`, { DistrictIds: ids })) : [];
    }
    case "subgroups": {
      const ids = parseIds(subgroupIdsStr);
      if (!ids.length) return [];
      return map(await conn.query(
        `${select}
         FROM sub_group_members sm
         JOIN sub_groups sg ON sg.pk_sub_group_id = sm.fk_sub_group_id AND sg.Scope = 'ri' AND sg.isdeleted = 0
         JOIN member_master_profile m ON m.pk_member_master_profile_id = sm.fk_member_master_profile_id
         WHERE sm.fk_sub_group_id IN @Ids AND sm.isdeleted = 0 AND m.isdeleted = 0
           AND ${has}`,
        { Ids: ids },
      ));
    }
    default:
      return map(await conn.query(base));
  }
}

/** The sender line: the club name, "RI District <number>", "RI Director" for RI items, else the product name. */
export async function resolveSourceName(conn: DbCommands, scope: string, clubId: number | null, districtId: number | null): Promise<string> {
  try {
    if (scope === "club" && clubId !== null) {
      const name = await conn.executeScalar<string>("SELECT ClubName FROM club_master WHERE pk_club_id = @Id", { Id: clubId });
      return name ?? "Rotary Club";
    }
    if (scope === "district" && districtId !== null) {
      const num = await conn.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId });
      return `RI District ${num ?? "-"}`;
    }
  } catch {
    // falls through to the generic name
  }
  return scope === "ri" ? "RI Director" : Brand.Current.productName;
}

/**
 * Announcement / event images and newsletter files are stored as a file name; the
 * served path is /Documents/{folder}/Group{id}/{file} (ri/ for RI items).
 */
export function buildMediaPath(folder: string, scope: string, clubId: number | null, districtId: number | null, fileName: string | null | undefined): string | null {
  if (!fileName || !fileName.trim()) return null;
  if (fileName.startsWith("/") || fileName.startsWith("http")) return fileName;
  if (scope === "ri") return `/Documents/${folder}/ri/${fileName}`;
  if (districtId !== null && districtId > 0) return `/Documents/${folder}/Group${districtId}/${fileName}`;
  if (clubId !== null && clubId > 0) return `/Documents/${folder}/Group${clubId}/${fileName}`;
  return `/Documents/${folder}/${fileName}`;
}

/** A served path as an absolute URL on the API's base address. */
export function buildAbsoluteUrl(backendUrl: string | undefined, relative: string | null | undefined): string {
  if (!relative || !relative.trim()) return "";
  if (relative.startsWith("http")) return relative;
  const backend = backendUrl ?? "http://localhost:5000";
  return `${backend.replace(/\/+$/, "")}${relative.startsWith("/") ? relative : "/" + relative}`;
}

/** mysql2 / socket errors that mean the connection dropped, which the next tick retries. */
export function isTransientDbBlip(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ER_CON_COUNT_ERROR"].includes(err.code ?? "")) return true;
  const m = err.message ?? "";
  return m.includes("Connect Timeout") || m.includes("Couldn't connect to server") || m.includes("forcibly closed");
}
