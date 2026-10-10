import type { DbCommands } from "../../database/db.service";
import type { YearTableResolver } from "../../services/year-table.resolver";

/** C# DateTime.ToString("yyyy-MM-dd") of a DB value. */
export const dayOf = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** C# ToString("yyyy-MM-ddTHH:mm:ss"): seconds precision; ROW's UTC "Z" marker is kept. */
export const stampOf = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.replace(/\.\d+/, "") : null);
export const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const MEMBER_PHOTO = (m = "m") => `CASE WHEN ${m}.ProfilePhotoPath IS NULL OR ${m}.ProfilePhotoPath = '' THEN NULL
  WHEN ${m}.ProfilePhotoPath LIKE '/Documents/directory/%' THEN ${m}.ProfilePhotoPath
  ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(${m}.ProfilePhotoPath, '/', -1)) END`;
export const EVENT_IMAGE = (a = "") => `CASE WHEN ${a}ImagePath IS NULL OR ${a}ImagePath = '' THEN NULL WHEN ${a}ImagePath LIKE '/%' THEN ${a}ImagePath
  WHEN ${a}Scope = 'ri' THEN CONCAT('/Documents/Event/ri/', ${a}ImagePath)
  WHEN ${a}fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', ${a}fk_district_id, '/', ${a}ImagePath)
  ELSE CONCAT('/Documents/Event/Group', ${a}fk_club_id, '/', ${a}ImagePath) END`;
export const NEWSLETTER_FILE = `CASE WHEN FilePath IS NULL OR FilePath = '' THEN NULL WHEN FilePath LIKE '/%' THEN FilePath
  WHEN Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', FilePath)
  WHEN fk_district_id IS NOT NULL AND fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', fk_district_id, '/', FilePath)
  WHEN fk_club_id IS NOT NULL AND fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', fk_club_id, '/', FilePath) ELSE NULL END`;

/** A (paid or trial) website exists and the club, district and zone are all active: the public kill switch. */
export async function isClubServiceable(conn: DbCommands, clubId: number): Promise<boolean> {
  return Number(await conn.executeScalar(
    `SELECT COUNT(*) FROM club_websites w
     JOIN club_master c ON c.pk_club_id = w.fk_club_id JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
     WHERE w.fk_club_id = @ClubId AND w.isdeleted = 0 AND c.isdeleted = 0 AND c.IsActive = 1 AND d.isdeleted = 0 AND d.IsActive = 1 AND z.isdeleted = 0 AND z.IsActive = 1`,
    { ClubId: clubId })) > 0;
}

/** One leg per year-wise projects table holding an active row for @ClubId. */
export async function yearProjectLegs(conn: DbCommands, yearTables: YearTableResolver): Promise<string> {
  const tables = await yearTables.getAllExistingYearTables(conn);
  return tables.length === 0 ? "SELECT NULL AS fk_year_id WHERE 1=0"
    : tables.map((t) => `(SELECT ${t.yearId} AS fk_year_id FROM \`${t.projectsTable}\` WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1 LIMIT 1)`).join(" UNION ");
}

/** Default year: the current year if the club has data in it, else the most recent year with data. */
export async function resolveClubYear(conn: DbCommands, yearTables: YearTableResolver, clubId: number): Promise<number | null> {
  const v = await conn.executeScalar(
    `SELECT y.pk_year_id FROM rotary_year_master y
     WHERE y.pk_year_id IN (
         SELECT DISTINCT fk_year_id FROM board_of_directors WHERE fk_club_id = @ClubId AND isdeleted = 0
         UNION SELECT fk_year_id FROM (${await yearProjectLegs(conn, yearTables)}) yp
         UNION SELECT DISTINCT fk_year_id FROM upcoming_events WHERE fk_club_id = @ClubId AND isdeleted = 0 AND IsActive = 1)
     ORDER BY y.IsCurrent DESC, y.pk_year_id DESC LIMIT 1`, { ClubId: clubId });
  return v === null || v === undefined ? null : Number(v);
}

/** Null-safe sum: null when every input is null. */
export function sumNullable(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}
