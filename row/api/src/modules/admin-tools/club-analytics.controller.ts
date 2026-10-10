import { Controller, Get, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { queryInt } from "../../common/binding";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { badRequest, file, forbid } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db } from "../../database/db.service";
import { hideRotaract, notRotaract } from "../../services/club-scope.helper";
import { YearTableResolver } from "../../services/year-table.resolver";
import { ExcelJS, toBuffer, XLSX_CONTENT_TYPE } from "../../services/xlsx";

type Row = Record<string, unknown>;
const N = (v: unknown) => (v === null || v === undefined ? 0 : Math.trunc(Number(v)) || 0);
const S = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const SD = (v: unknown) => (S(v).trim() ? S(v) : "—");
const argb = (h: string) => `FF${h.replace("#", "").toUpperCase()}`;
const now = () => nowIn(Brand.Current.locale.defaultTimeZone);

/** Port of ClubAnalyticsController.cs: per-club counts report (one club, a district, or every club for SuperAdmin). */
@Controller("api/club-analytics")
@Authorize()
export class ClubAnalyticsController {
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver) {}

  @Get("excel")
  async excel(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const roles = u.findFirst("roles") ?? "";
    const superAdmin = roles.includes("SuperAdmin");
    if (!(roles.includes("Admin") || superAdmin)) return forbid();
    const [districtId, clubId] = [queryInt(d), queryInt(c)];
    const allClubs = !(clubId !== null && clubId > 0) && !(districtId !== null && districtId > 0);
    if (allClubs && !superAdmin) return forbid();
    const yr = queryInt(y) ?? (Number(await this.db.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1")) || 0);
    if (yr <= 0) return badRequest({ message: "No rotary year available." });
    const yearLabel = (await this.db.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", { Y: yr })) ?? "";
    const projTable = (await this.yearTables.resolveByYearId(this.db, yr))?.projectsTable ?? "";
    const totalProj = projTable ? `(SELECT COUNT(*) FROM \`${projTable}\` p WHERE p.fk_club_id = c.pk_club_id AND p.isdeleted = 0)` : "0";
    const av = (key: string) => projTable
      ? `(SELECT COUNT(*) FROM \`${projTable}\` p JOIN module_master m ON m.pk_module_id = p.fk_module_id WHERE p.fk_club_id = c.pk_club_id AND p.isdeleted = 0 AND m.ModuleKey = '${key}')` : "0";
    const bod = (desig: string, col: string) => `(SELECT ${col} FROM board_of_directors b JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
        JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @Y AND dm.designation_name = '${desig}' AND b.isdeleted = 0 LIMIT 1)`;
    const fnd = (key: string) => `(SELECT e.NumericValue FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id WHERE e.EntityType = 'Club' AND e.fk_club_id = c.pk_club_id
        AND e.fk_year_id = @Y AND COALESCE(e.isdeleted, 0) = 0 AND f.FieldKey = '${key}' ORDER BY e.pk_id DESC LIMIT 1)`;
    const inYear = (alias: string, col: string) => `${alias}.${col} >= y.StartDate AND ${alias}.${col} < DATE_ADD(y.EndDate, INTERVAL 1 DAY)`;
    const clubFilter = clubId !== null && clubId > 0 ? "c.pk_club_id = @Club" : districtId !== null && districtId > 0 ? "c.fk_district_id = @Dist" : "1 = 1";
    const rows = await this.db.query(
      `SELECT c.pk_club_id AS clubId, d.DistrictNumber AS districtNumber, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isSynced,
              (CASE WHEN EXISTS (SELECT 1 FROM club_websites w WHERE w.fk_club_id = c.pk_club_id AND COALESCE(w.isdeleted, 0) = 0 AND (COALESCE(w.IsPurchased, 0) = 1 OR w.Status = 'Active')) THEN 1 ELSE 0 END) AS hasWebsite,
              (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS memberCount,
              (SELECT COUNT(*) FROM board_of_directors b WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @Y AND b.isdeleted = 0) AS bodCount,
              (SELECT COUNT(*) FROM club_attendance a WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @Y AND a.isdeleted = 0) AS meetingCount,
              ${totalProj} AS serviceProjectCount, ${av("club_service")} AS clubService, ${av("community_service")} AS communityService,
              ${av("vocational_service")} AS vocationalService, ${av("international_service")} AS internationalService,
              ${av("new_generation_service")} AS newGenerationService, ${av("public_image_initiative")} AS publicImageInitiative,
              (SELECT COUNT(*) FROM newsletters n JOIN rotary_year_master y ON y.pk_year_id = @Y WHERE n.fk_club_id = c.pk_club_id AND n.isdeleted = 0 AND ${inYear("n", "PublishDateTime")}) AS newsletterCount,
              (SELECT COUNT(*) FROM ocv_documents o WHERE o.fk_club_id = c.pk_club_id AND o.fk_year_id = @Y AND o.isdeleted = 0) AS ocvCount,
              (SELECT COUNT(*) FROM announcements a JOIN rotary_year_master y ON y.pk_year_id = @Y WHERE a.fk_club_id = c.pk_club_id AND a.isdeleted = 0 AND ${inYear("a", "PublishDateTime")}) AS announcementCount,
              (SELECT COUNT(*) FROM upcoming_events e JOIN rotary_year_master y ON y.pk_year_id = @Y WHERE e.fk_club_id = c.pk_club_id AND e.isdeleted = 0 AND ${inYear("e", "PublishDate")}) AS eventCount,
              (CASE WHEN EXISTS (SELECT 1 FROM membership_dues md WHERE md.fk_club_id = c.pk_club_id AND md.RotaryYear = @YearLabel AND COALESCE(md.isdeleted, 0) = 0) THEN 1 ELSE 0 END) AS hasClubDues,
              ${fnd("club_annual_fund_ytd")} AS foundationAnnual, ${fnd("club_polioplus_ytd")} AS foundationPolio,
              ${fnd("club_endowment_ytd")} AS foundationEndowment, ${fnd("club_other_funds_ytd")} AS foundationOther,
              ${bod("Club President", "m.MemberName")} AS presidentName, ${bod("Club President", "m.PrimaryMobileNumber")} AS presidentMobile, ${bod("Club President", "m.EmailId")} AS presidentEmail,
              ${bod("Club Secretary", "m.MemberName")} AS secretaryName, ${bod("Club Secretary", "m.PrimaryMobileNumber")} AS secretaryMobile, ${bod("Club Secretary", "m.EmailId")} AS secretaryEmail
       FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE ${clubFilter} AND c.isdeleted = 0 AND COALESCE(c.IsActive, 1) = 1${hideRotaract(superAdmin) ? " AND " + notRotaract("c") : ""}
       ORDER BY d.DistrictNumber, c.ClubName`,
      { Y: yr, Club: clubId ?? 0, Dist: districtId ?? 0, YearLabel: yearLabel },
    );
    // OCV dues (single club): every active dues type, with the paid-on date when uploaded.
    let ocvDues: Row[] = [];
    if (clubId !== null && clubId > 0 && rows.length > 0) {
      const duesCat = Number(await this.db.executeScalar("SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'dues' LIMIT 1")) || 0;
      if (duesCat > 0)
        ocvDues = await this.db.query(
          `SELECT COALESCE(t.TypeName, '') AS name, COALESCE(SUM(d.Amount), 0) AS amount, MAX(d.PaidOn) AS paidOn
           FROM ocv_document_type t
           LEFT JOIN ocv_documents d ON d.fk_type_id = t.pk_type_id AND d.fk_club_id = @Club AND d.fk_category_id = @Cat AND d.fk_year_id = @Y AND d.isdeleted = 0
           WHERE t.fk_category_id = @Cat AND t.isdeleted = 0 AND t.IsActive = 1
           GROUP BY t.pk_type_id, t.TypeName, t.SortOrder ORDER BY t.SortOrder, t.TypeName`,
          { Club: clubId, Cat: duesCat, Y: yr });
    }
    const bytes = clubId !== null && clubId > 0 && rows.length > 0 ? await clubReport(rows[0], yearLabel, ocvDues) : await clubsTable(rows);
    return file(bytes, XLSX_CONTENT_TYPE, `club-analytics-${formatDate(now(), "yyyyMMdd-HHmm")}.xlsx`);
  }
}

/** Single club: a print-friendly vertical report in sections, fitted to one portrait page. */
async function clubReport(row: Row, yearLabel: string, ocvDues: Row[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Club Report");
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 52;
  let r = 1;
  const band = (text: string, opts: { size: number; bold?: boolean; italic?: boolean; color: string; fill?: string; height?: number }) => {
    ws.mergeCells(r, 1, r, 2);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { size: opts.size, bold: opts.bold, italic: opts.italic, color: { argb: argb(opts.color) } };
    if (opts.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(opts.fill) } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    if (opts.height) ws.getRow(r).height = opts.height;
    r++;
  };
  band(S(row.clubName), { size: 18, bold: true, color: "#FFFFFF", fill: "#1a365d", height: 34 });
  band(`District ${S(row.districtNumber)}   ·   Rotary Year ${yearLabel}   ·   Club ID ${S(row.clubRotaryId)}`, { size: 10, color: "#475569", fill: "#eef2f7", height: 20 });
  band(`Generated ${formatDate(now(), "dd MMM yyyy, hh:mm tt")}`, { size: 8, italic: true, color: "#94a3b8" });
  r++;
  const border = { style: "thin" as const, color: { argb: argb("#cbd5e1") } };
  const section = (label: string) => {
    ws.mergeCells(r, 1, r, 2);
    const c = ws.getCell(r, 1);
    c.value = label;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb("#2d7fc7") } };
    c.alignment = { vertical: "middle" };
    ws.getRow(r).height = 22;
    r++;
  };
  const kv = (key: string, val: string | number, money = false) => {
    const k = ws.getCell(r, 1), v = ws.getCell(r, 2);
    k.value = key;
    k.font = { bold: true, color: { argb: argb("#334155") } };
    k.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb("#f1f5f9") } };
    v.value = val;
    if (money) v.numFmt = "#,##0.00";
    k.border = { top: border, bottom: border, left: border };
    v.border = { top: border, bottom: border, right: border };
    k.alignment = v.alignment = { vertical: "middle" };
    r++;
  };
  const amt = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);
  section("Membership & Governance");
  kv("Member Count", N(row.memberCount)); kv("Board of Directors (BOD)", N(row.bodCount)); r++;
  section("Avenue of Service");
  kv("Total Service Projects", N(row.serviceProjectCount)); kv("Club Service", N(row.clubService)); kv("Community Service", N(row.communityService));
  kv("Vocational Service", N(row.vocationalService)); kv("International Service", N(row.internationalService));
  kv("New Generation Service", N(row.newGenerationService)); kv("Public Image Initiative", N(row.publicImageInitiative)); r++;
  section("Communications");
  kv("Newsletters", N(row.newsletterCount)); kv("OCV Documents", N(row.ocvCount)); kv("Announcements", N(row.announcementCount)); kv("Upcoming Events", N(row.eventCount)); r++;
  section("Status");
  kv("Club Dues", N(row.hasClubDues) === 1 ? "Yes" : "No"); kv("Club Website", N(row.hasWebsite) === 1 ? "Yes" : "No"); kv("Sync", N(row.isSynced) === 1 ? "Yes" : "No"); r++;
  section("Foundation (TRF — till date, from Goal Setting)");
  kv("Annual Fund", amt(row.foundationAnnual), true); kv("Polio Plus", amt(row.foundationPolio), true);
  kv("Endowment", amt(row.foundationEndowment), true); kv("Other Funds", amt(row.foundationOther), true); r++;
  section("Dues");
  if (ocvDues.length === 0) kv("Dues", "No dues records");
  else for (const d of ocvDues) kv(S(d.name), d.paidOn === null || d.paidOn === undefined ? "—" : `Paid · ${formatDate(S(d.paidOn), "dd MMM yyyy")}`);
  r++;
  section("Leadership Contacts");
  kv("President", SD(row.presidentName)); kv("President — Mobile", SD(row.presidentMobile)); kv("President — Email", SD(row.presidentEmail));
  kv("Secretary", SD(row.secretaryName)); kv("Secretary — Mobile", SD(row.secretaryMobile)); kv("Secretary — Email", SD(row.secretaryEmail));
  ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
    margins: { top: 0.6, bottom: 0.6, left: 0.5, right: 0.5, header: 0.3, footer: 0.3 }, printArea: `A1:B${r - 1}` };
  return toBuffer(wb);
}

/** District / all clubs: one row per club. */
async function clubsTable(rows: Row[]) {
  const headers = ["Sr.No.", "District Number", "Club Name", "Club ID", "RI Sync", "Club Website", "Member Count", "BOD Count", "Club Meeting Count", "Service Project Count",
    "Club Service", "Community Service", "Vocational Service", "International Service", "New Generation Service", "Public Image Initiative",
    "NewsLetters", "OCV", "Announcement", "Events", "President Name", "President Mobile Number", "President Email ID", "Secretary Name", "Secretary Mobile Number", "Secretary Email ID"];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Club Analytics");
  headers.forEach((h, i) => {
    const c = ws.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb("#2d7fc7") } };
  });
  rows.forEach((row, i) => {
    ws.getRow(i + 2).values = [i + 1, S(row.districtNumber), S(row.clubName), S(row.clubRotaryId), N(row.isSynced) === 1 ? "Yes" : "No", N(row.hasWebsite) === 1 ? "Yes" : "No",
      N(row.memberCount), N(row.bodCount), N(row.meetingCount), N(row.serviceProjectCount), N(row.clubService), N(row.communityService), N(row.vocationalService),
      N(row.internationalService), N(row.newGenerationService), N(row.publicImageInitiative), N(row.newsletterCount), N(row.ocvCount), N(row.announcementCount), N(row.eventCount),
      S(row.presidentName), S(row.presidentMobile), S(row.presidentEmail), S(row.secretaryName), S(row.secretaryMobile), S(row.secretaryEmail)];
  });
  headers.forEach((_, i) => {
    let w = 8;
    for (let r = 1; r <= rows.length + 1; r++) w = Math.max(w, String(ws.getCell(r, i + 1).value ?? "").length + 2);
    ws.getColumn(i + 1).width = w;
  });
  return toBuffer(wb);
}
