import { Controller, Get, Param, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { paramInt, queryInt, queryString } from "../../common/binding";
import { formatNumber } from "../../common/dotnet-format";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db } from "../../database/db.service";
import { hideRotaract, notRotaract } from "../../services/club-scope.helper";
import { cogJoinedDateExpr, cogSelectColumns } from "../../services/cog-designation.helper";
import { isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { getClubPeerMemberIds, shouldShowEmail, shouldShowPhone, viewerMemberId, viewerSharesClubWithMember } from "../../services/member-privacy.helper";
import { isSuperAdmin } from "../../services/user-permission.helper";

export function normalizeAnswerType(raw: string | null | undefined): string {
  const r = (raw ?? "").trim().toLowerCase().replace(/[ _-]/g, "");
  if (["yesno", "yn", "boolean", "bool", "yes", "no"].includes(r)) return "yesno";
  if (["chooseone", "choose", "select", "option", "options", "radio"].includes(r)) return "choose_one";
  return "number";
}
/** decimal: integers without decimals, else "0.##". */
export const fmtAchieved = (n: number) => (Number.isInteger(n) ? String(n) : formatNumber(n, "0.##"));
const dec = (s: unknown): number | null => { const t = String(s ?? "").trim(); return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null; };

/** Port of CitationMatrixController.cs: per-club Base | Achieved | Total citation matrix for the Excel exports. */
@Controller("api/citation-matrix")
@Authorize()
export class CitationMatrixController {
  constructor(private readonly db: Db) {}

  @Get()
  async matrix(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    const districtId = queryInt(d, 0);
    const clubId = queryInt(c);
    if (districtId <= 0) return badRequest({ message: "districtId is required." });
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: "This district or its zone is inactive." });
    let yearId = queryInt(y, 0);
    if (yearId <= 0) yearId = Number(await this.db.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")) || 0;
    if (yearId <= 0) return badRequest({ message: "No current rotary year configured." });
    const district = await this.db.queryFirstOrDefault("SELECT pk_district_id AS districtId, DistrictNumber AS districtNumber FROM district_master WHERE pk_district_id = @D AND isdeleted = 0", { D: districtId });
    if (!district) return notFound({ message: "District not found." });
    const year = await this.db.queryFirstOrDefault("SELECT pk_year_id AS id, YearLabel AS yearLabel FROM rotary_year_master WHERE pk_year_id = @Id", { Id: yearId });
    let clubFilter = clubId !== null && clubId > 0 ? " AND pk_club_id = @ClubId" : "";
    if (hideRotaract(isSuperAdmin(u))) clubFilter += " AND " + notRotaract("");
    const p = { D: districtId, Y: yearId, ClubId: clubId };
    const clubs = await this.db.query(`SELECT pk_club_id AS clubId, ClubName AS clubName FROM club_master WHERE fk_district_id = @D AND isdeleted = 0${clubFilter} ORDER BY ClubName`, p);
    const categories = await this.db.query("SELECT pk_id AS id, category_name AS name, sort_order AS sortOrder FROM district_citation_category WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0 ORDER BY sort_order, category_name", p);
    // The title carries the sub-item lineage so each auto question column is unique.
    const autoQs = await this.db.query(
      `SELECT q.pk_id AS questionId, q.fk_category_id AS categoryId,
              CONCAT(a.activity_name, IFNULL((
                  SELECT CONCAT(' · ', GROUP_CONCAT(
                      CASE
                          WHEN LOWER(s.sub_item_type) = 'area_of_focus' THEN COALESCE(aof_only.name, s.sub_item_name)
                          WHEN LOWER(s.sub_item_type) = 'category' THEN CONCAT(COALESCE(aof_for_cat.name, '?'), ' → ', COALESCE(cat_only.name, s.sub_item_name))
                          WHEN LOWER(s.sub_item_type) IN ('sub_category','subcategory') THEN CONCAT(COALESCE(aof_for_sub.name, '?'), ' → ', COALESCE(cat_for_sub.name, '?'), ' → ', COALESCE(sub_only.name, s.sub_item_name))
                          ELSE s.sub_item_name
                      END
                      ORDER BY s.sort_order SEPARATOR ' / '))
                  FROM district_citation_auto_question_sub s
                  LEFT JOIN area_of_focus_master aof_only      ON LOWER(s.sub_item_type) = 'area_of_focus' AND aof_only.pk_area_of_focus_id = s.sub_item_id
                  LEFT JOIN category_master cat_only           ON LOWER(s.sub_item_type) = 'category' AND cat_only.pk_category_id = s.sub_item_id
                  LEFT JOIN area_of_focus_master aof_for_cat   ON LOWER(s.sub_item_type) = 'category' AND aof_for_cat.pk_area_of_focus_id = cat_only.fk_area_of_focus_id
                  LEFT JOIN sub_category_master sub_only       ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND sub_only.pk_sub_category_id = s.sub_item_id
                  LEFT JOIN category_master cat_for_sub        ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND cat_for_sub.pk_category_id = sub_only.fk_category_id
                  LEFT JOIN area_of_focus_master aof_for_sub   ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND aof_for_sub.pk_area_of_focus_id = cat_for_sub.fk_area_of_focus_id
                  WHERE s.fk_auto_question_id = q.pk_id AND s.isdeleted = 0), '')) AS title,
              q.sort_order AS sortOrder,
              (COALESCE(q.points, 0) + COALESCE((SELECT SUM(s.points) FROM district_citation_auto_question_sub s WHERE s.fk_auto_question_id = q.pk_id AND s.isdeleted = 0), 0)) AS basePoints
       FROM district_citation_auto_question q
       INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
       WHERE q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0
       ORDER BY q.fk_category_id, q.sort_order, a.activity_name`, p);
    const manualQs = await this.db.query(
      `SELECT sc.pk_id AS questionId, mc.fk_category_id AS categoryId, CONCAT(mc.criteria_name, ' — ', sc.sub_criteria_title) AS title,
              (mc.sort_order * 1000 + sc.sort_order) AS sortOrder, sc.points AS basePoints, sc.answer_type AS answerType
       FROM district_citation_manual_sub_criteria sc INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
       WHERE mc.fk_district_id = @D AND mc.fk_year_id = @Y AND mc.isdeleted = 0 AND sc.isdeleted = 0
       ORDER BY mc.fk_category_id, sortOrder`, p);
    const optionText = new Map((await this.db.query(
      `SELECT o.pk_id AS id, o.option_text AS optionText FROM district_citation_manual_sub_criteria_option o
       INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = o.fk_sub_criteria_id
       INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
       WHERE mc.fk_district_id = @D AND mc.fk_year_id = @Y AND o.isdeleted = 0 AND sc.isdeleted = 0 AND mc.isdeleted = 0`, p,
    )).map((o) => [Number(o.id), String(o.optionText ?? "")]));
    const clubIdCsv = clubs.length > 0 ? clubs.map((x) => Number(x.clubId)).join(",") : "0";
    const entries = await this.db.query(
      `SELECT e.fk_club_id AS clubId, e.entry_type AS entryType, e.fk_question_id AS questionId, e.answer_value AS answerValue, (e.points_earned + e.bonus_earned) AS score
       FROM district_citation_club_entry e WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.isdeleted = 0 AND e.fk_club_id IN (${clubIdCsv})`, p);

    const columns: object[] = [];
    const matrixCategories: object[] = [];
    for (const cat of categories) {
      const catId = Number(cat.id);
      const cols = [
        ...autoQs.filter((q) => Number(q.categoryId) === catId).map((q) => ({ type: "auto", questionId: Number(q.questionId), title: String(q.title ?? ""), basePoints: Number(q.basePoints ?? 0), answerType: "number" })),
        ...manualQs.filter((q) => Number(q.categoryId) === catId).map((q) => ({ type: "manual", questionId: Number(q.questionId), title: String(q.title ?? ""), basePoints: Number(q.basePoints ?? 0), answerType: normalizeAnswerType(q.answerType as string | null) })),
      ];
      if (cols.length === 0) continue;
      matrixCategories.push({ id: catId, name: String(cat.name ?? ""), span: cols.length });
      columns.push(...cols);
    }
    const rows = clubs.map((club) => {
      const cid = Number(club.clubId);
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const e of entries.filter((x) => Number(x.clubId) === cid)) {
        const key = `${e.entryType}-${Number(e.questionId)}`;
        groups.set(key, [...(groups.get(key) ?? []), e]);
      }
      const cells: Record<string, object> = {};
      for (const [key, g] of groups) {
        const total = g.reduce((a, e) => a + Number(e.score ?? 0), 0);
        let achievedDisplay: string, achievedNumeric: number | null;
        if (g[0].entryType === "auto") {
          const nums = g.map((e) => dec(e.answerValue)).filter((x): x is number => x !== null);
          achievedNumeric = nums.length ? nums.reduce((a, b) => a + b, 0) : null;
          achievedDisplay = achievedNumeric === null ? "" : fmtAchieved(achievedNumeric);
        } else {
          const raw = String(g[0].answerValue ?? "");
          const meta = manualQs.find((q) => Number(q.questionId) === Number(g[0].questionId));
          const atype = meta ? normalizeAnswerType(meta.answerType as string | null) : "number";
          achievedNumeric = null;
          if (atype === "yesno") {
            const l = raw.trim().toLowerCase();
            achievedDisplay = l === "yes" ? "Yes" : l === "no" ? "No" : "";
          } else if (atype === "choose_one") {
            achievedDisplay = /^\s*-?\d+\s*$/.test(raw) && optionText.has(parseInt(raw, 10)) ? optionText.get(parseInt(raw, 10))! : raw;
          } else {
            const n = dec(raw);
            achievedNumeric = n;
            achievedDisplay = n === null ? raw : fmtAchieved(n);
          }
        }
        cells[key] = { achievedDisplay, achievedNumeric, total };
      }
      return { clubId: cid, clubName: String(club.clubName ?? ""), cells };
    });
    return ok({ districtId, districtNumber: String(district.districtNumber ?? ""), yearId, yearLabel: year ? String(year.yearLabel ?? "") : "", categories: matrixCategories, columns, rows });
  }
}

const PHOTO = (col: string) => `CASE
                   WHEN m.${col} IS NULL OR m.${col} = '' THEN NULL
                   WHEN m.${col} LIKE '/Documents/directory/%' THEN m.${col}
                   ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.${col}, '/', -1))
               END`;

/** Port of FindRotarianController.cs: member search for signed-in app users, with the members' privacy flags applied. */
@Controller("api/mobile/find-rotarian")
@Authorize()
export class FindRotarianController {
  constructor(private readonly db: Db) {}

  @Get()
  async search(
    @User() u: CurrentUser, @Query("name") name?: string, @Query("keyword") keyword?: string, @Query("city") city?: string, @Query("clubName") clubName?: string,
    @Query("districtNumber") districtNumber?: string, @Query("mobile") mobile?: string, @Query("page") pg?: string, @Query("pageSize") ps?: string,
  ) {
    const [nm, kw, ci, cn, dn, mo] = [name, keyword, city, clubName, districtNumber, mobile].map((v) => (queryString(v) ?? "").trim());
    let page = queryInt(pg, 1), pageSize = queryInt(ps, 20);
    if (!nm && !kw && !ci && !cn && !dn && !mo) return ok({ items: [], totalCount: 0, page, pageSize });
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;
    let where = `
      FROM member_master_profile m
      JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
      JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
      JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
      WHERE m.isdeleted = 0`;
    const p: Record<string, unknown> = {};
    if (nm) { where += " AND m.MemberName LIKE @Nm"; p.Nm = `%${nm}%`; }
    if (kw) {
      where += ` AND (m.RotaryId LIKE @Kw OR m.MemberIntroduction LIKE @Kw
        OR EXISTS (SELECT 1 FROM member_address_details ma WHERE ma.fk_member_master_profile_id = m.pk_member_master_profile_id AND ma.isdeleted = 0 AND (ma.Keywords LIKE @Kw OR ma.BusinessName LIKE @Kw))
        OR EXISTS (SELECT 1 FROM club_members cm2 WHERE cm2.fk_member_master_profile_id = m.pk_member_master_profile_id AND COALESCE(cm2.isdeleted, 0) = 0 AND (cm2.Designation LIKE @Kw OR cm2.ClassificationProfession LIKE @Kw)))`;
      p.Kw = `%${kw}%`;
    }
    if (ci) { where += " AND (c.City LIKE @Ci OR EXISTS (SELECT 1 FROM member_address_details ma WHERE ma.fk_member_master_profile_id = m.pk_member_master_profile_id AND ma.isdeleted = 0 AND ma.City LIKE @Ci))"; p.Ci = `%${ci}%`; }
    if (cn) { where += " AND (c.ClubName LIKE @Cn OR c.ClubRotaryId LIKE @Cn)"; p.Cn = `%${cn}%`; }
    if (dn) { where += " AND d.DistrictNumber LIKE @Dn"; p.Dn = `%${dn}%`; }
    if (mo) { where += " AND (m.PrimaryMobileNumber LIKE @Mo OR m.SecondaryMobileNumber LIKE @Mo)"; p.Mo = `%${mo}%`; }
    const totalCount = Number(await this.db.executeScalar(`SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${where}`, p));
    const raw = await this.db.query(
      `SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${PHOTO("ProfilePhotoPath")} AS profilePhoto, m.RotaryId AS rotaryId,
              m.EmailId AS email, m.PrimaryMobileNumber AS mobile, m.ShowPhoneInMyClub AS showPhoneInMyClub, m.ShowPhoneInAllClubs AS showPhoneInAllClubs,
              m.ShowEmailInMyClub AS showEmailInMyClub, m.ShowEmailInAllClubs AS showEmailInAllClubs, m.Gender AS gender, c.ClubName AS clubName,
              c.ClubRotaryId AS clubRotaryId, d.DistrictNumber AS districtNumber, c.City AS city, c.State AS state, cm.IsHonoraryMember AS isHonorary, cm.IsActive AS isActive
       ${where} ORDER BY m.MemberName LIMIT @PageSize OFFSET @Offset`,
      { ...p, Offset: (page - 1) * pageSize, PageSize: pageSize },
    );
    // Cross-club search: "my club" flags apply only to the viewer's club peers.
    const viewer = viewerMemberId(u);
    const peers = await getClubPeerMemberIds(this.db, viewer);
    const items = raw.map((r) => {
      const id = Number(r.memberId);
      const shares = peers.has(id);
      return {
        memberId: id, memberName: r.memberName ?? null, profilePhoto: r.profilePhoto ?? null, rotaryId: r.rotaryId ?? null,
        email: shouldShowEmail(viewer, id, shares, r.showEmailInMyClub, r.showEmailInAllClubs) ? (r.email ?? null) : null,
        mobile: shouldShowPhone(viewer, id, shares, r.showPhoneInMyClub, r.showPhoneInAllClubs) ? (r.mobile ?? null) : null,
        gender: r.gender ?? null, clubName: r.clubName ?? null, clubRotaryId: r.clubRotaryId ?? null, districtNumber: r.districtNumber ?? null,
        city: r.city ?? null, state: r.state ?? null, isHonorary: r.isHonorary !== null && r.isHonorary !== undefined && Number(r.isHonorary) !== 0 && r.isHonorary !== false,
        isActive: r.isActive === null || r.isActive === undefined || (r.isActive !== false && Number(r.isActive) !== 0),
      };
    });
    return ok({ items, totalCount, page, pageSize });
  }

  @Get(":memberId")
  async detail(@User() u: CurrentUser, @Param("memberId") idText: string) {
    const memberId = paramInt(idText, "memberId");
    const member = await this.db.queryFirstOrDefault(
      `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, ${PHOTO("ProfilePhotoPath")} AS profilePhoto, ${PHOTO("FamilyPhotoPath")} AS familyPhoto,
              m.RotaryId AS rotaryId, m.EmailId AS email, m.PrimaryMobileNumber AS primaryMobile, m.SecondaryMobileNumber AS secondaryMobile,
              m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate, m.BloodGroup AS bloodGroup, m.Gender AS gender, m.PrimaryLanguage AS primaryLanguage,
              m.IsYouth AS isYouth, m.IsPersonalDetailsVisible AS isPersonalDetailsVisible, m.IsFamilyDetailsVisible AS isFamilyDetailsVisible,
              m.ShowPhoneInMyClub AS showPhoneInMyClub, m.ShowPhoneInAllClubs AS showPhoneInAllClubs, m.ShowEmailInMyClub AS showEmailInMyClub, m.ShowEmailInAllClubs AS showEmailInAllClubs,
              m.MemberIntroduction AS memberIntroduction, m.Facebook AS facebook, m.Instagram AS instagram, m.LinkedIn AS linkedIn, m.Twitter AS twitter,
              m.Youtube AS youtube, m.Website AS website, m.DonorRecognition AS donorRecognition,
              pc.CountryName AS primaryCountry, pc.PhoneCode AS primaryPhoneCode, sc.CountryName AS secondaryCountry, sc.PhoneCode AS secondaryPhoneCode
       FROM member_master_profile m
       LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
       LEFT JOIN country_master sc ON sc.pk_country_id = m.fk_secondary_country_id
       WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0`,
      { Id: memberId },
    );
    if (!member) return notFound({ message: "Member not found." });
    const viewer = viewerMemberId(u);
    const shares = await viewerSharesClubWithMember(this.db, viewer, memberId);
    if (!shouldShowPhone(viewer, memberId, shares, member.showPhoneInMyClub, member.showPhoneInAllClubs)) member.primaryMobile = null;
    if (!shouldShowEmail(viewer, memberId, shares, member.showEmailInMyClub, member.showEmailInAllClubs)) member.email = null;
    for (const k of ["showPhoneInMyClub", "showPhoneInAllClubs", "showEmailInMyClub", "showEmailInAllClubs"]) delete member[k];
    if (!Brand.feature("member.bloodGroup")) member.bloodGroup = null;
    const addresses = await this.db.query(
      `SELECT a.AddressType AS addressType, a.PhoneNumber AS phoneNumber, a.Address AS address, a.City AS city, a.State AS state, a.PinCode AS pinCode,
              co.CountryName AS country, a.BusinessName AS businessName, a.BusinessEmailId AS businessEmail, a.Keywords AS keywords
       FROM member_address_details a LEFT JOIN country_master co ON co.pk_country_id = a.fk_country_id
       WHERE a.fk_member_master_profile_id = @Id AND a.isdeleted = 0`, { Id: memberId });
    const clubs = await this.db.query(
      `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
              CASE WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath ELSE CONCAT('/uploads/club/', c.ClubLogoPath) END AS clubLogo,
              c.City AS city, c.State AS state, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName,
              ${cogJoinedDateExpr("cm")} AS joinedDate, ${cogSelectColumns("cm")}, cm.Designation AS designation, cm.ClassificationProfession AS classification
       FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
       ORDER BY c.ClubName`, { Id: memberId });
    const yearId = await this.db.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
    const designations = yearId === null || yearId === undefined ? [] : await this.db.query(
      `SELECT dm.designation_name AS designationName, c.ClubName AS clubName, dm.sort_order AS sortOrder
       FROM board_of_directors b JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id JOIN club_master c ON c.pk_club_id = b.fk_club_id
       WHERE b.fk_member_master_profile_id = @Id AND b.fk_year_id = @YearId AND b.isdeleted = 0 ORDER BY dm.sort_order`, { Id: memberId, YearId: yearId });
    return ok({ member, addresses, clubs, designations });
  }
}
