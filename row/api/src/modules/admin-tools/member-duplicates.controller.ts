import { Body, Controller, Get, Logger, Post, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryBool, queryInt, queryString } from "../../common/binding";
import { toDotnetJson } from "../../common/http";
import { badRequest, forbid, notFound, ok, statusCode } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";

/**
 * Port of MemberDuplicateController.cs: SuperAdmin tool to find and resolve members sharing a mobile / email.
 * A pair is a cross-slot match: one member holds a value as PRIMARY, another as SECONDARY (own primary blank).
 * Merge keeps one (snapshot to bak_member_dup_merge first); dismiss records a "keep both" pair.
 */
const ensureTables = async (conn: DbCommands) => {
  await conn.execute(`CREATE TABLE IF NOT EXISTS member_dup_ignored (
      pk_id INT AUTO_INCREMENT PRIMARY KEY, member_low_id INT NOT NULL, member_high_id INT NOT NULL, match_reason VARCHAR(40) NULL, note VARCHAR(500) NULL,
      created_by INT NULL, created_date DATETIME NOT NULL, UNIQUE KEY uq_dup_pair (member_low_id, member_high_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await conn.execute(`CREATE TABLE IF NOT EXISTS bak_member_dup_merge (
      pk_id INT AUTO_INCREMENT PRIMARY KEY, kept_member_id INT NOT NULL, deleted_member_id INT NOT NULL, snapshot LONGTEXT NULL,
      created_by INT NULL, created_date DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await conn.execute(`CREATE TABLE IF NOT EXISTS member_dup_remark (
      pk_id INT AUTO_INCREMENT PRIMARY KEY, member_low_id INT NOT NULL, member_high_id INT NOT NULL, remark VARCHAR(1000) NULL,
      created_by INT NULL, created_date DATETIME NOT NULL, modified_by INT NULL, modified_date DATETIME NULL,
      UNIQUE KEY uq_dup_remark_pair (member_low_id, member_high_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
};

// memberA = the parked side (blank primary), memberB = holder; matchTypes 'Mobile' | 'Email' | 'Email+Mobile'.
const PAIR_SQL = `
  SELECT x.memberA_id, x.memberB_id, x.ridA, x.ridB,
         MAX(CASE WHEN x.matchType='Mobile' THEN x.sharedValue END) AS sharedMobile,
         MAX(CASE WHEN x.matchType='Email'  THEN x.sharedValue END) AS sharedEmail,
         GROUP_CONCAT(DISTINCT x.matchType ORDER BY x.matchType SEPARATOR '+') AS matchTypes
  FROM (
      SELECT a.pk_member_master_profile_id AS memberA_id, b.pk_member_master_profile_id AS memberB_id,
             a.RotaryId AS ridA, b.RotaryId AS ridB, b.PrimaryMobileNumber AS sharedValue, 'Mobile' AS matchType
      FROM member_master_profile a
      JOIN member_master_profile b ON TRIM(a.SecondaryMobileNumber) = TRIM(b.PrimaryMobileNumber) AND a.pk_member_master_profile_id <> b.pk_member_master_profile_id
      WHERE a.isdeleted = 0 AND b.isdeleted = 0 AND TRIM(COALESCE(a.SecondaryMobileNumber,'')) <> '' AND TRIM(COALESCE(a.PrimaryMobileNumber,'')) = ''
      UNION ALL
      SELECT a.pk_member_master_profile_id, b.pk_member_master_profile_id, a.RotaryId, b.RotaryId, b.EmailId, 'Email'
      FROM member_master_profile a
      JOIN member_master_profile b ON TRIM(a.SecondaryEmailId) = TRIM(b.EmailId) AND a.pk_member_master_profile_id <> b.pk_member_master_profile_id
      WHERE a.isdeleted = 0 AND b.isdeleted = 0 AND TRIM(COALESCE(a.SecondaryEmailId,'')) <> '' AND TRIM(COALESCE(a.EmailId,'')) = ''
  ) x
  GROUP BY x.memberA_id, x.memberB_id, x.ridA, x.ridB`;
const IGNORED = `EXISTS (SELECT 1 FROM member_dup_ignored ig WHERE ig.member_low_id = LEAST(d.memberA_id, d.memberB_id) AND ig.member_high_id = GREATEST(d.memberA_id, d.memberB_id))`;

const loadProfile = (conn: DbCommands, id: number) => conn.queryFirstOrDefault(
  `SELECT pk_member_master_profile_id AS id, MemberName AS memberName, RotaryId AS rotaryId, EmailId AS emailId, SecondaryEmailId AS secondaryEmailId,
          PrimaryMobileNumber AS primaryMobileNumber, SecondaryMobileNumber AS secondaryMobileNumber, fk_primary_country_id AS fkPrimaryCountryId, fk_secondary_country_id AS fkSecondaryCountryId,
          BirthDate AS birthDate, AnniversaryDate AS anniversaryDate, BloodGroup AS bloodGroup, Gender AS gender, PrimaryLanguage AS primaryLanguage, IsYouth AS isYouth,
          MemberIntroduction AS memberIntroduction, DonorRecognition AS donorRecognition, Facebook AS facebook, Instagram AS instagram, LinkedIn AS linkedIn, Twitter AS twitter,
          Youtube AS youtube, Website AS website, ProfilePhotoPath AS profilePhotoPath, created_date AS createdDate
   FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0`, { Id: id });
const loadClubs = (conn: DbCommands, id: number) => conn.query(
  `SELECT cm.pk_club_member_id AS clubMemberId, cm.fk_club_id AS fkClubId, c.ClubName AS clubName, dm.DistrictNumber AS districtNumber, cm.Designation AS designation,
          cm.IsHonoraryMember AS isHonorary, cm.JoinedDate AS joinedDate
   FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
   WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0 AND cm.IsActive = 1 ORDER BY c.ClubName`, { Id: id });
const loadFamily = (conn: DbCommands, id: number) => conn.query(
  `SELECT pk_member_family_details_id AS familyId, Name AS name, Relation AS relation, PhoneNumber AS phoneNumber, EmailId AS emailId, BirthDate AS birthDate,
          AnniversaryDate AS anniversaryDate, BloodGroup AS bloodGroup
   FROM member_family_details WHERE fk_member_master_profile_id = @Id AND isdeleted = 0 ORDER BY pk_member_family_details_id`, { Id: id });
/** System roles, BOD, DC, GDC, SGDC and DG, flattened. */
const loadRoles = (conn: DbCommands, id: number) => conn.query(
  `SELECT 'System' AS source, r.RoleName AS label, c.ClubName AS context, NULL AS year
   FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id LEFT JOIN club_master c ON c.pk_club_id = mr.fk_club_id
   WHERE mr.fk_member_master_profile_id = @Id AND mr.isdeleted = 0 AND mr.IsActive = 1
   UNION ALL
   SELECT 'BOD', COALESCE(dg.designation_name, bod.custom_designation, 'Board Member'), c.ClubName, y.YearLabel
   FROM board_of_directors bod LEFT JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
   LEFT JOIN club_master c ON c.pk_club_id = bod.fk_club_id LEFT JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
   WHERE bod.fk_member_master_profile_id = @Id AND bod.isdeleted = 0
   UNION ALL
   SELECT 'DC', dcm.district_designation, dcm.club_name, y.YearLabel
   FROM district_committee_member dcm LEFT JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
   WHERE dcm.fk_member_id = @Id AND dcm.isdeleted = 0 AND dcm.is_active = 1
   UNION ALL
   SELECT 'GDC', CONCAT(COALESCE(g.group_name,''), ' — ', COALESCE(gm.district_designation,'')), gm.club_name, y.YearLabel
   FROM district_committee_group_member gm JOIN district_committee_group g ON g.id = gm.fk_group_id LEFT JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
   WHERE gm.fk_member_id = @Id AND gm.isdeleted = 0 AND gm.is_active = 1
   UNION ALL
   SELECT 'SGDC', CONCAT(COALESCE(sg.sub_group_name,''), ' — ', COALESCE(sgm.district_designation,'')), sgm.club_name, NULL
   FROM district_committee_sub_group_member sgm JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id
   WHERE sgm.fk_member_id = @Id AND sgm.isdeleted = 0 AND sgm.is_active = 1
   UNION ALL
   SELECT 'DG', COALESCE(dgv.description, 'District Governor'), dm.DistrictNumber, y.YearLabel
   FROM district_governors dgv LEFT JOIN district_master dm ON dm.pk_district_id = dgv.fk_district_id LEFT JOIN rotary_year_master y ON y.pk_year_id = dgv.fk_year_id
   WHERE dgv.fk_member_id = @Id AND dgv.isdeleted = 0`, { Id: id });

/** Frontend field → column; the only fields a merge / keep-both edit may write. */
const UPDATABLE: Record<string, string> = {
  rotaryid: "RotaryId", membername: "MemberName", emailid: "EmailId", secondaryemailid: "SecondaryEmailId", primarymobilenumber: "PrimaryMobileNumber",
  secondarymobilenumber: "SecondaryMobileNumber", birthdate: "BirthDate", anniversarydate: "AnniversaryDate", bloodgroup: "BloodGroup", gender: "Gender",
  primarylanguage: "PrimaryLanguage", memberintroduction: "MemberIntroduction", donorrecognition: "DonorRecognition", facebook: "Facebook", instagram: "Instagram",
  linkedin: "LinkedIn", twitter: "Twitter", youtube: "Youtube", website: "Website", fkprimarycountryid: "fk_primary_country_id", fksecondarycountryid: "fk_secondary_country_id",
};
const UNIQUE_CONTACT = new Set(["primarymobilenumber", "secondarymobilenumber", "emailid", "secondaryemailid"]);
const RESTORE: [string, string][] = [
  ["memberName", "MemberName"], ["rotaryId", "RotaryId"], ["emailId", "EmailId"], ["secondaryEmailId", "SecondaryEmailId"], ["primaryMobileNumber", "PrimaryMobileNumber"],
  ["secondaryMobileNumber", "SecondaryMobileNumber"], ["fkPrimaryCountryId", "fk_primary_country_id"], ["fkSecondaryCountryId", "fk_secondary_country_id"], ["birthDate", "BirthDate"],
  ["anniversaryDate", "AnniversaryDate"], ["bloodGroup", "BloodGroup"], ["gender", "Gender"], ["primaryLanguage", "PrimaryLanguage"], ["isYouth", "IsYouth"],
  ["memberIntroduction", "MemberIntroduction"], ["donorRecognition", "DonorRecognition"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["linkedIn", "LinkedIn"],
  ["twitter", "Twitter"], ["youtube", "Youtube"], ["website", "Website"], ["profilePhotoPath", "ProfilePhotoPath"],
];

/** JsonElement → DB value as RIZones did it: blank string → null, bool → 1/0, object / array → null. */
export function toDbValue(v: unknown): unknown {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}
const dict = (v: unknown): [string, unknown][] => (v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v) : []);
const id = (b: unknown, k: string) => { const n = Number(bodyField(b, k)); return Number.isInteger(n) ? n : 0; };
const blank = (s: unknown) => s === null || s === undefined || String(s).trim() === "";

/** `SET col = @p_col, ...` from whitelisted edits. */
function editSets(edits: [string, unknown][], skipRotaryId: boolean) {
  const sets: string[] = [], pars: Record<string, unknown> = {};
  for (const [k, v] of edits) {
    const col = UPDATABLE[k.toLowerCase()];
    if (!col || (skipRotaryId && col === "RotaryId")) continue;
    sets.push(`${col} = @p_${col}`);
    pars[`p_${col}`] = toDbValue(v);
  }
  return { sets, pars };
}
const pks = (root: Record<string, unknown>, prop: string, key: string) =>
  (Array.isArray(root[prop]) ? (root[prop] as Record<string, unknown>[]) : []).map((e) => (e && typeof e === "object" ? e[key] : null)).filter((x): x is number => Number.isInteger(x) && (x as number) > 0);

@Controller("api/admin/member-duplicates")
@Authorize()
export class MemberDuplicatesController {
  private readonly log = new Logger("MemberDuplicateController");
  constructor(private readonly db: Db) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  @Get("count")
  async count(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return this.db.session(async (conn) => {
      await ensureTables(conn);
      const r = (await conn.queryFirstOrDefault(
        `SELECT COUNT(*) AS total, COALESCE(SUM(d.matchTypes='Mobile'),0) AS mobile, COALESCE(SUM(d.matchTypes='Email'),0) AS email,
                COALESCE(SUM(d.matchTypes='Email+Mobile'),0) AS bothCount
         FROM (${PAIR_SQL}) d WHERE NOT ${IGNORED}`))!;
      return ok({ total: Number(r.total), mobile: Number(r.mobile), email: Number(r.email), both: Number(r.bothCount) });
    });
  }

  /** The pair self-join has no index, so it is materialised once into a temp table, then counted / searched / paged. */
  @Get("list")
  async list(@User() u: CurrentUser, @Query("page") pageQ?: string, @Query("pageSize") sizeQ?: string, @Query("type") typeQ?: string,
             @Query("search") searchQ?: string, @Query("dismissed") dismissedQ?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const page = Math.max(1, queryInt(pageQ, 1)!);
    let pageSize = queryInt(sizeQ, 20)!;
    if (pageSize < 1 || pageSize > 200) pageSize = 20;
    const dismissed = queryBool(dismissedQ, false)!;
    const type = (queryString(typeQ) ?? "").toLowerCase();
    return this.db.session(async (conn) => {
      await ensureTables(conn);
      await conn.execute("DROP TEMPORARY TABLE IF EXISTS tmp_dup");
      const clubSearch = (side: string) => `(SELECT GROUP_CONCAT(CONCAT_WS(' ', c.ClubName, dm.DistrictNumber) SEPARATOR ' | ')
               FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
               WHERE cm.fk_member_master_profile_id = d.member${side}_id AND cm.isdeleted = 0)`;
      const firstClub = (side: string) => `(SELECT c.ClubName FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
               WHERE cm.fk_member_master_profile_id = d.member${side}_id AND cm.isdeleted = 0 AND cm.IsActive = 1 ORDER BY cm.pk_club_member_id LIMIT 1)`;
      await conn.execute(
        `CREATE TEMPORARY TABLE tmp_dup AS
         SELECT d.memberA_id AS memberAId, d.memberB_id AS memberBId, d.ridA, d.ridB, d.sharedMobile, d.sharedEmail, d.matchTypes,
                ma.MemberName AS nameA, mb.MemberName AS nameB, ma.PrimaryMobileNumber AS mobA, mb.PrimaryMobileNumber AS mobB,
                ma.SecondaryMobileNumber AS smobA, mb.SecondaryMobileNumber AS smobB, ma.EmailId AS emailA, mb.EmailId AS emailB,
                ma.SecondaryEmailId AS semailA, mb.SecondaryEmailId AS semailB,
                ${firstClub("A")} AS clubA, ${firstClub("B")} AS clubB, ${clubSearch("A")} AS clubsSearchA, ${clubSearch("B")} AS clubsSearchB,
                (SELECT r.remark FROM member_dup_remark r WHERE r.member_low_id = LEAST(d.memberA_id, d.memberB_id) AND r.member_high_id = GREATEST(d.memberA_id, d.memberB_id)) AS remark
         FROM (${PAIR_SQL}) d
         JOIN member_master_profile ma ON ma.pk_member_master_profile_id = d.memberA_id
         JOIN member_master_profile mb ON mb.pk_member_master_profile_id = d.memberB_id
         WHERE ${dismissed ? IGNORED : `NOT ${IGNORED}`}`);
      const typeSql = type === "mobile" ? " AND matchTypes = 'Mobile' " : type === "email" ? " AND matchTypes = 'Email' " : type === "both" ? " AND matchTypes = 'Email+Mobile' " : "";
      const q = (searchQ ?? "").trim();
      const searchSql = q ? ` AND (${["nameA", "nameB", "ridA", "ridB", "sharedMobile", "sharedEmail", "mobA", "mobB", "smobA", "smobB", "emailA", "emailB", "semailA", "semailB",
        "clubsSearchA", "clubsSearchB", "remark"].map((c) => `${c} LIKE @Q`).join(" OR ")})` : "";
      const args = { Take: pageSize, Skip: (page - 1) * pageSize, Q: `%${q}%` };
      const total = Number(await conn.executeScalar(`SELECT COUNT(*) FROM tmp_dup WHERE 1=1 ${typeSql} ${searchSql}`, args));
      const items = await conn.query(
        `SELECT memberAId, memberBId, ridA, ridB, sharedMobile, sharedEmail, matchTypes, nameA, nameB, clubA, clubB, remark
         FROM tmp_dup WHERE 1=1 ${typeSql} ${searchSql} ORDER BY nameA ASC, memberAId LIMIT @Take OFFSET @Skip`, args);
      return ok({ total, page, pageSize, items });
    });
  }

  @Get("pair")
  async pair(@User() u: CurrentUser, @Query("aId") aQ?: string, @Query("bId") bQ?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const aId = queryInt(aQ, 0)!, bId = queryInt(bQ, 0)!;
    if (aId <= 0 || bId <= 0 || aId === bId) return badRequest({ message: "Two distinct member ids required." });
    const [memberA, memberB] = [await loadProfile(this.db, aId), await loadProfile(this.db, bId)];
    if (!memberA || !memberB) return notFound({ message: "One or both members not found." });
    const bloodOn = Brand.feature("member.bloodGroup"), familyOn = Brand.feature("member.familyDetails");
    const family = async (mid: number) => (familyOn ? (await loadFamily(this.db, mid)).map((f) => (bloodOn ? f : { ...f, bloodGroup: null })) : []);
    if (!bloodOn) memberA.bloodGroup = memberB.bloodGroup = null;
    return ok({
      memberA, memberB, clubsA: await loadClubs(this.db, aId), clubsB: await loadClubs(this.db, bId), rolesA: await loadRoles(this.db, aId), rolesB: await loadRoles(this.db, bId),
      familyA: await family(aId), familyB: await family(bId),
    });
  }

  /** Merge: keep one member, soft-delete the other, move its contact to the survivor's secondary, transfer clubs + roles + family. One transaction. */
  @Post("resolve")
  async resolve(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const keepId = id(body, "keepId"), delId = id(body, "deleteId");
    if (keepId <= 0 || delId <= 0 || keepId === delId) return badRequest({ message: "keepId and deleteId must be two distinct members." });
    const by = this.userId(u);
    const survivor = dict(bodyField(body, "survivor"));
    const clubs = (Array.isArray(bodyField(body, "clubs")) ? (bodyField(body, "clubs") as unknown[]) : []).map((c) => ({
      fkClubId: id(c, "fkClubId"), isHonorary: bodyField(c, "isHonorary") === true, joinedDate: blank(bodyField(c, "joinedDate")) ? null : String(bodyField(c, "joinedDate")),
    }));
    return this.db.session(async (conn) => {
      await ensureTables(conn);
      const keep = await loadProfile(conn, keepId), loser = await loadProfile(conn, delId);
      if (!keep || !loser) return notFound({ message: "Member not found (already merged?)." });
      const loserMob = loser.primaryMobileNumber as string | null, loserEmail = loser.emailId as string | null;
      const snapshot = toDotnetJson({
        keep, delete: loser, keepClubs: await loadClubs(conn, keepId), deleteClubs: await loadClubs(conn, delId), keepRoles: await loadRoles(conn, keepId),
        deleteRoles: await loadRoles(conn, delId), keepFamily: await loadFamily(conn, keepId), deleteFamily: await loadFamily(conn, delId),
      });
      const KD = { Keep: keepId, Del: delId };
      try {
        await conn.transaction(async (tx) => {
          await tx.execute("INSERT INTO bak_member_dup_merge (kept_member_id, deleted_member_id, snapshot, created_by, created_date) VALUES (@Keep, @Del, @Snap, @By, NOW())",
            { ...KD, Snap: snapshot, By: by });
          // Free only the loser's primary mobile + email; its RotaryId goes only when the survivor takes it (a RID shift).
          await tx.execute("UPDATE member_master_profile SET PrimaryMobileNumber = NULL, EmailId = NULL, modified_by = @By, modified_date = NOW() WHERE pk_member_master_profile_id = @Id", { Id: delId, By: by });
          const rid = toDbValue(survivor.find(([k]) => k === "rotaryId")?.[1]);
          if (typeof rid === "string" && rid.trim() && typeof loser.rotaryId === "string" && rid.toLowerCase() === loser.rotaryId.toLowerCase())
            await tx.execute("UPDATE member_master_profile SET RotaryId = NULL WHERE pk_member_master_profile_id = @Id", { Id: delId });
          const { sets, pars } = editSets(survivor, false);
          if (sets.length > 0)
            await tx.execute(`UPDATE member_master_profile SET ${[...sets, "modified_by = @By", "modified_date = NOW()"].join(", ")} WHERE pk_member_master_profile_id = @Id`, { ...pars, Id: keepId, By: by });
          // Keep the loser's contact on the survivor's secondary slots (only when blank and distinct).
          const now = (await tx.queryFirstOrDefault("SELECT PrimaryMobileNumber AS pmob, SecondaryMobileNumber AS smob, EmailId AS pemail, SecondaryEmailId AS semail FROM member_master_profile WHERE pk_member_master_profile_id=@Id", { Id: keepId }))!;
          if (!blank(loserMob) && blank(now.smob) && now.pmob !== loserMob)
            await tx.execute("UPDATE member_master_profile SET SecondaryMobileNumber=@V, modified_date=NOW() WHERE pk_member_master_profile_id=@Id", { V: loserMob, Id: keepId });
          if (!blank(loserEmail) && blank(now.semail) && String(now.pemail ?? "").toLowerCase() !== loserEmail!.toLowerCase())
            await tx.execute("UPDATE member_master_profile SET SecondaryEmailId=@V, modified_date=NOW() WHERE pk_member_master_profile_id=@Id", { V: loserEmail, Id: keepId });
          await tx.execute("UPDATE member_master_profile SET isdeleted = 1, deleted_by = @By, deleted_date = NOW() WHERE pk_member_master_profile_id = @Id", { Id: delId, By: by });
          await applyClubs(tx, keepId, clubs, by);
          await tx.execute("UPDATE club_members SET isdeleted = 1, IsActive = 0, deleted_by = @By, deleted_date = NOW() WHERE fk_member_master_profile_id = @Id AND isdeleted = 0", { Id: delId, By: by });
          await tx.execute("UPDATE member_roles SET fk_member_master_profile_id=@Keep, modified_date=NOW() WHERE fk_member_master_profile_id=@Del AND isdeleted=0", KD);
          await tx.execute("UPDATE board_of_directors SET fk_member_master_profile_id=@Keep, modified_date=NOW() WHERE fk_member_master_profile_id=@Del AND isdeleted=0", KD);
          await tx.execute("UPDATE district_committee_member SET fk_member_id=@Keep, modified_date=NOW() WHERE fk_member_id=@Del AND isdeleted=0", KD);
          await tx.execute("UPDATE district_committee_group_member SET fk_member_id=@Keep, modified_date=NOW() WHERE fk_member_id=@Del AND isdeleted=0", KD);
          // The re-point can list the survivor twice in one Club Presidents / Secretaries group for the same club: keep the oldest row.
          await tx.execute(
            `UPDATE district_committee_group_member t
             JOIN (SELECT MIN(m.id) AS keep_id, m.fk_group_id, m.fk_club_id
                   FROM district_committee_group_member m
                   JOIN district_committee_group g ON g.id = m.fk_group_id AND g.isdeleted = 0
                    AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__' OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')
                   WHERE m.fk_member_id = @Keep AND m.isdeleted = 0 GROUP BY m.fk_group_id, m.fk_club_id HAVING COUNT(*) > 1
             ) dup ON dup.fk_group_id = t.fk_group_id AND dup.fk_club_id = t.fk_club_id
             SET t.isdeleted = 1, t.modified_date = NOW()
             WHERE t.fk_member_id = @Keep AND t.isdeleted = 0 AND t.id <> dup.keep_id`, KD);
          await tx.execute("UPDATE district_committee_sub_group_member SET fk_member_id=@Keep, modified_date=NOW() WHERE fk_member_id=@Del AND isdeleted=0", KD);
          await tx.execute("UPDATE district_governors SET fk_member_id=@Keep, modified_date=NOW() WHERE fk_member_id=@Del AND isdeleted=0", KD);
          await tx.execute("UPDATE member_family_details SET fk_member_master_profile_id=@Keep, modified_date=NOW() WHERE fk_member_master_profile_id=@Del AND isdeleted=0", KD);
          // One spouse per member: keep the latest-changed one.
          await tx.execute(
            `UPDATE member_family_details f
             JOIN (SELECT pk_member_family_details_id AS pk_id, ROW_NUMBER() OVER (ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC) AS rn
                   FROM member_family_details WHERE fk_member_master_profile_id = @Keep AND LOWER(TRIM(Relation)) = 'spouse' AND COALESCE(isdeleted,0) = 0
             ) x ON x.pk_id = f.pk_member_family_details_id AND x.rn > 1
             SET f.isdeleted = 1, f.deleted_date = NOW()`, KD);
          await tx.execute(
            `UPDATE member_roles t
             JOIN (SELECT MIN(pk_member_role_id) AS keep_pk, fk_member_master_profile_id, fk_role_id, COALESCE(fk_club_id,0) AS club
                   FROM member_roles WHERE fk_member_master_profile_id = @Keep AND isdeleted = 0
                   GROUP BY fk_member_master_profile_id, fk_role_id, COALESCE(fk_club_id,0) HAVING COUNT(*) > 1
             ) dup ON dup.fk_member_master_profile_id = t.fk_member_master_profile_id AND dup.fk_role_id = t.fk_role_id AND dup.club = COALESCE(t.fk_club_id,0)
             SET t.isdeleted = 1, t.modified_date = NOW()
             WHERE t.pk_member_role_id <> dup.keep_pk AND t.isdeleted = 0`, KD);
        });
      } catch (e) {
        this.log.error(`Member merge failed (keep ${keepId}, delete ${delId}): ${(e as Error).message}`);
        return statusCode(500, { message: "Merge failed and was rolled back.", detail: (e as Error).message });
      }
      this.log.log(`Member merge: kept ${keepId}, deleted ${delId} by user ${by}.`);
      return ok({ success: true, keptId: keepId, deletedId: delId });
    });
  }

  /** Upsert or clear (blank) the free-text remark on the canonical (low, high) pair. */
  @Post("remark")
  async remark(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const a = id(body, "memberAId"), b = id(body, "memberBId");
    if (a <= 0 || b <= 0 || a === b) return badRequest({ message: "Two distinct member ids required." });
    const raw = bodyField(body, "remark");
    const remark = blank(raw) ? null : String(raw).trim();
    const p = { Low: Math.min(a, b), High: Math.max(a, b), Remark: remark, By: this.userId(u) };
    return this.db.session(async (conn) => {
      await ensureTables(conn);
      if (remark === null) {
        await conn.execute("DELETE FROM member_dup_remark WHERE member_low_id = @Low AND member_high_id = @High", p);
        return ok({ success: true, remark: null });
      }
      await conn.execute(
        `INSERT INTO member_dup_remark (member_low_id, member_high_id, remark, created_by, created_date) VALUES (@Low, @High, @Remark, @By, NOW())
         ON DUPLICATE KEY UPDATE remark = VALUES(remark), modified_by = @By, modified_date = NOW();`, p);
      return ok({ success: true, remark });
    });
  }

  /** "Keep both": each member's edits go to its own row (never merged), then the pair is recorded as ignored. */
  @Post("dismiss")
  async dismiss(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const a = id(body, "memberAId"), b = id(body, "memberBId");
    if (a <= 0 || b <= 0 || a === b) return badRequest({ message: "Two distinct member ids required." });
    const by = this.userId(u);
    const editsA = dict(bodyField(body, "editsA")), editsB = dict(bodyField(body, "editsB"));
    const text = (k: string) => { const v = bodyField(body, k); return v === null || v === undefined ? null : String(v); };
    return this.db.session(async (conn) => {
      await ensureTables(conn);
      try {
        await conn.transaction(async (tx) => {
          // Free changed unique contact fields on both first, so a swap between the two doesn't trip a unique index.
          for (const [mid, edits] of [[a, editsA], [b, editsB]] as const) {
            const cols = edits.filter(([k]) => UNIQUE_CONTACT.has(k.toLowerCase())).map(([k]) => `${UPDATABLE[k.toLowerCase()]} = NULL`);
            if (cols.length) await tx.execute(`UPDATE member_master_profile SET ${cols.join(", ")} WHERE pk_member_master_profile_id = @Id`, { Id: mid });
          }
          for (const [mid, edits] of [[a, editsA], [b, editsB]] as const) {
            const { sets, pars } = editSets(edits, true);
            if (sets.length) await tx.execute(`UPDATE member_master_profile SET ${[...sets, "modified_by = @By", "modified_date = NOW()"].join(", ")} WHERE pk_member_master_profile_id = @Id`, { ...pars, Id: mid, By: by });
          }
          await tx.execute(
            `INSERT INTO member_dup_ignored (member_low_id, member_high_id, match_reason, note, created_by, created_date) VALUES (@Low, @High, @Reason, @Note, @By, NOW())
             ON DUPLICATE KEY UPDATE match_reason=VALUES(match_reason), note=VALUES(note), created_by=VALUES(created_by), created_date=NOW()`,
            { Low: Math.min(a, b), High: Math.max(a, b), Reason: text("reason"), Note: text("note"), By: by });
        });
      } catch (e) {
        return statusCode(500, { message: "Could not save & keep both records.", detail: (e as Error).message });
      }
      return ok({ success: true });
    });
  }

  @Post("undismiss")
  async undismiss(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const a = id(body, "memberAId"), b = id(body, "memberBId");
    if (a <= 0 || b <= 0 || a === b) return badRequest({ message: "Two distinct member ids required." });
    return this.db.session(async (conn) => {
      await ensureTables(conn);
      await conn.execute("DELETE FROM member_dup_ignored WHERE member_low_id = @Low AND member_high_id = @High", { Low: Math.min(a, b), High: Math.max(a, b) });
      return ok({ success: true });
    });
  }

  /** Undo a merge from its snapshot: both profiles, club links and family rows by primary key. Roles are not restored (stored descriptively). */
  @Post("revert")
  async revert(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const keptId = id(body, "keptId"), deletedId = id(body, "deletedId");
    if (keptId <= 0 || deletedId <= 0 || keptId === deletedId) return badRequest({ message: "keptId and deletedId must be two distinct members." });
    const by = this.userId(u);
    return this.db.session(async (conn) => {
      await ensureTables(conn);
      const snap = await conn.executeScalar<string>("SELECT snapshot FROM bak_member_dup_merge WHERE kept_member_id = @K AND deleted_member_id = @D ORDER BY pk_id DESC LIMIT 1", { K: keptId, D: deletedId });
      if (blank(snap)) return notFound({ message: "No merge backup found for this pair — nothing to revert." });
      let root: Record<string, unknown>;
      try { root = JSON.parse(snap!); } catch { return statusCode(500, { message: "Merge backup is malformed — cannot revert automatically." }); }
      if (!root || typeof root !== "object" || !("delete" in root) || !("keep" in root)) return statusCode(500, { message: "Merge backup is malformed — cannot revert automatically." });
      const restore = async (tx: DbCommands, mid: number, prof: unknown, reactivate: boolean) => {
        if (!prof || typeof prof !== "object" || Array.isArray(prof)) return;
        const p = prof as Record<string, unknown>, sets: string[] = [], pars: Record<string, unknown> = { Id: mid, By: by };
        for (const [key, col] of RESTORE) {
          if (!(key in p)) continue;
          sets.push(`${col} = @p_${col}`);
          pars[`p_${col}`] = toDbValue(p[key]);
        }
        if (reactivate) sets.push("isdeleted = 0", "deleted_by = NULL", "deleted_date = NULL");
        sets.push("modified_by = @By", "modified_date = NOW()");
        await tx.execute(`UPDATE member_master_profile SET ${sets.join(", ")} WHERE pk_member_master_profile_id = @Id`, pars);
      };
      try {
        await conn.transaction(async (tx) => {
          // Free the unique fields on both first so restoring the exact snapshot never collides transiently.
          await tx.execute("UPDATE member_master_profile SET RotaryId = NULL, PrimaryMobileNumber = NULL, SecondaryMobileNumber = NULL, EmailId = NULL, SecondaryEmailId = NULL WHERE pk_member_master_profile_id IN (@A, @B)",
            { A: keptId, B: deletedId });
          await restore(tx, keptId, root.keep, false);
          await restore(tx, deletedId, root.delete, true);
          const clubPks = [...new Set([...pks(root, "deleteClubs", "clubMemberId"), ...pks(root, "keepClubs", "clubMemberId")])];
          if (clubPks.length)
            await tx.execute("UPDATE club_members SET isdeleted = 0, IsActive = 1, deleted_by = NULL, deleted_date = NULL, modified_by = @By, modified_date = NOW() WHERE pk_club_member_id IN @Pks", { Pks: clubPks, By: by });
          for (const [prop, owner] of [["deleteFamily", deletedId], ["keepFamily", keptId]] as const) {
            const fam = pks(root, prop, "familyId");
            if (fam.length) await tx.execute("UPDATE member_family_details SET fk_member_master_profile_id = @Owner, isdeleted = 0, modified_date = NOW() WHERE pk_member_family_details_id IN @Pks", { Owner: owner, Pks: fam });
          }
        });
      } catch (e) {
        return statusCode(500, { message: "Revert failed and was rolled back.", detail: (e as Error).message });
      }
      const loserHadRoles = Array.isArray(root.deleteRoles) && root.deleteRoles.length > 0;
      return ok({
        success: true, restoredMemberId: deletedId,
        rolesNote: loserHadRoles ? "The deleted member had roles that were transferred during the merge and could NOT be auto-restored — please re-check that member's roles manually." : null,
      });
    });
  }

  @Get("merge-history")
  async mergeHistory(@User() u: CurrentUser, @Query("limit") limitQ?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    let limit = queryInt(limitQ, 50)!;
    if (limit < 1 || limit > 200) limit = 50;
    return this.db.session(async (conn) => {
      await ensureTables(conn);
      return ok(await conn.query(
        `SELECT b.pk_id AS id, b.kept_member_id AS keptId, b.deleted_member_id AS deletedId, b.created_date AS mergedOn, k.MemberName AS keptName, k.RotaryId AS keptRid,
                d.MemberName AS deletedName, d.RotaryId AS deletedRid, d.PrimaryMobileNumber AS deletedMobile, d.isdeleted AS deletedStillGone
         FROM bak_member_dup_merge b
         LEFT JOIN member_master_profile k ON k.pk_member_master_profile_id = b.kept_member_id
         LEFT JOIN member_master_profile d ON d.pk_member_master_profile_id = b.deleted_member_id
         ORDER BY b.pk_id DESC LIMIT @Limit`, { Limit: limit }));
    });
  }

  @Get("districts")
  async districts(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.query("SELECT pk_district_id AS id, DistrictNumber AS districtNumber FROM district_master WHERE isdeleted = 0 ORDER BY DistrictNumber"));
  }

  @Get("clubs")
  async clubs(@User() u: CurrentUser, @Query("districtId") d?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const districtId = queryInt(d, 0)!;
    if (districtId <= 0) return badRequest({ message: "districtId required." });
    return ok(await this.db.query("SELECT pk_club_id AS id, ClubName AS clubName FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 ORDER BY ClubName", { D: districtId }));
  }
}

/** The survivor's curated club set: drop links not in it, then reactivate / update / insert each one. */
async function applyClubs(tx: DbCommands, memberId: number, clubs: { fkClubId: number; isHonorary: boolean; joinedDate: string | null }[], by: number) {
  const keepIds = [...new Set(clubs.map((c) => c.fkClubId))];
  await tx.execute(
    `UPDATE club_members SET isdeleted=1, IsActive=0, deleted_by=@By, deleted_date=NOW() WHERE fk_member_master_profile_id=@Id AND isdeleted=0${keepIds.length ? " AND fk_club_id NOT IN @Clubs" : ""}`,
    { Id: memberId, By: by, Clubs: keepIds });
  for (const c of clubs) {
    const existing = await tx.executeScalar<number>("SELECT pk_club_member_id FROM club_members WHERE fk_member_master_profile_id=@Id AND fk_club_id=@Club ORDER BY isdeleted, pk_club_member_id LIMIT 1",
      { Id: memberId, Club: c.fkClubId });
    const p = { Hon: c.isHonorary ? 1 : 0, Joined: c.joinedDate, By: by };
    if (existing !== null && existing !== undefined)
      await tx.execute(
        `UPDATE club_members SET isdeleted=0, IsActive=1, IsHonoraryMember=@Hon, JoinedDate=COALESCE(@Joined, JoinedDate), deleted_by=NULL, deleted_date=NULL, modified_by=@By, modified_date=NOW()
         WHERE pk_club_member_id=@Pk`, { ...p, Pk: existing });
    else
      await tx.execute(
        `INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, IsHonoraryMember, created_by, created_date, isdeleted)
         VALUES (@Club, @Id, COALESCE(@Joined, CURDATE()), 1, @Hon, @By, NOW(), 0)`, { ...p, Club: c.fkClubId, Id: memberId });
  }
}
