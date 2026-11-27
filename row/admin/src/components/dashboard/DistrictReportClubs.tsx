import { saveAs } from "file-saver";
import { fileTimestamp } from "@/lib/dateUtils";
import DistrictGoalReports from "@/components/dashboard/DistrictGoalReports";
import { getDistrictClubOfficersRi, downloadClubAnalyticsDistrict } from "@/services/api";
import {
  BarChart3,
  CalendarClock,
  Newspaper,
  CheckSquare,
  Award,
  IndianRupee,
  Building2,
  UserCog,
  ClipboardList,
} from "@/components/icons";
import { ReportSection, SubsectionHeader, ClubFilterRow, DuesReportRow, ClubMonthlyProjectDetailsRow } from "./DistrictReportRows";
import { AgFilterRow, AvenueFilterRow, AvenueCountRow } from "./DistrictReportFilterRows";
import { DistrictReportState } from "./useDistrictReport";

export default function DistrictReportClubs({ r }: { r: DistrictReportState }) {
  const { agMemberId, districtIds, hideClubFilter, showGeoColumns, isMulti, effectiveDistrictId, showAgRows, dl, years, selectedYearId, report, setErrorMessage, yearLabel, districtNumber, exportSection, exportWithFilename, ddmmyyyy, attendanceCols, avenueProjectCols, allProjects, clubsDropdown, agsDropdown } = r;
  return (
    <>
      {/* ── CLUBS subsection ──────────────────────────────────────── */}
      <SubsectionHeader title="Clubs" />

      {/* 1. Attendance (All Clubs) */}
      <ClubFilterRow
        title="Attendance (All Clubs)"
        icon={CheckSquare}
        rows={report.attendance || []}
        clubs={clubsDropdown}
        hideClub={hideClubFilter}
        defaultFile="Attendance"
        baseColumns={attendanceCols}
        onDownload={exportWithFilename}
      />

      {/* 2. Attendance (AG wise) — hidden on the AG report + when AG-wise suppressed. */}
      {showAgRows && (
      <AgFilterRow
        title="Attendance (AG wise)"
        icon={CheckSquare}
        rows={report.attendance || []}
        ags={agsDropdown}
        defaultFile="Attendance_AG_wise"
        baseColumns={attendanceCols}
        onDownload={exportWithFilename}
      />
      )}

      {/* Avenue reports are grouped together here, right after Attendance:
          All Clubs → AG Wise → Club Wise Count. */}

      {/* Avenue of Service (All Clubs) — club + avenue dropdowns, full columns */}
      <AvenueFilterRow
        title="Avenue Of Service (All Clubs)"
        icon={Award}
        rows={allProjects}
        clubs={hideClubFilter ? undefined : clubsDropdown}
        defaultFile="Avenue_Of_Service_All_Clubs"
        baseColumns={avenueProjectCols}
        onDownload={exportWithFilename}
      />

      {/* Avenue of Service (AG wise) — hidden on the AG report + when AG-wise suppressed. */}
      {showAgRows && (
      <AvenueFilterRow
        title="Avenue Of Service (AG Wise)"
        icon={Award}
        rows={allProjects}
        ags={agsDropdown}
        agMandatory
        defaultFile="Avenue_of_Service_AG_wise"
        baseColumns={avenueProjectCols}
        onDownload={exportWithFilename}
      />
      )}

      {/* Avenue of Service (Club Wise Count) — club + avenue dropdowns */}
      <AvenueCountRow
        title="Avenue Of Service (Club Wise Count)"
        icon={Building2}
        rows={allProjects}
        clubs={hideClubFilter ? undefined : clubsDropdown}
        districtNumber={districtNumber}
        defaultFile="Avenue_Of_Service_Club_Wise_Count"
        onDownload={exportWithFilename}
      />

      {/* 6. Club Analytics — per-club counts .xlsx (one row per club of this district). */}
      <ReportSection
        title="Club Analytics"
        icon={BarChart3}
        count={clubsDropdown.length}
        dl={dl}
        dlKey="club-analytics"
        onExport={async () => {
          const blob = await downloadClubAnalyticsDistrict(Number(selectedYearId) || undefined, effectiveDistrictId);
          saveAs(blob, `Club_Analytics_D${districtNumber || ""}_${fileTimestamp()}.xlsx`);
        }}
      />

      {/* Club Goal Setting — pick a club (or District all), download its month-wise/till-date goals. */}
      <DistrictGoalReports mode="club" districtId={effectiveDistrictId} yearId={Number(selectedYearId) || undefined} />

      {/* 8. Club Monthly Report (Project Details) — per (club, month) aggregate,
          same columns as the club-admin club report; All Clubs or one club. */}
      <ClubMonthlyProjectDetailsRow
        rows={report.clubMonthlyProjectDetails || []}
        clubs={clubsDropdown}
        ags={agsDropdown}
        hideClub={hideClubFilter}
        showGeo={showGeoColumns}
        yearLabel={yearLabel}
        districtNumber={districtNumber}
        isCurrentYear={!!years.find((y: any) => String(y.id) === selectedYearId)?.isCurrent}
      />

      {/* 8b. Club Monthly Report AG wise (Project Details) — hidden on the AG report
          + when AG-wise reports are suppressed (hideAgReports). */}
      {showAgRows && (
      <ClubMonthlyProjectDetailsRow
        mode="ag"
        rows={report.clubMonthlyProjectDetails || []}
        clubs={clubsDropdown}
        ags={agsDropdown}
        yearLabel={yearLabel}
        districtNumber={districtNumber}
        isCurrentYear={!!years.find((y: any) => String(y.id) === selectedYearId)?.isCurrent}
      />
      )}

      {/* 9. Club Monthly Report (Submission Details) — per-club per-month pivot */}
      <ReportSection
        title="Club Monthly Report (Submission Details)"
        icon={ClipboardList}
        count={clubsDropdown.length}
        onExport={() => {
          const subsByClub = new Map<number, Map<number, string>>();
          for (const r of report.monthlyReportSubmissions || []) {
            const m = subsByClub.get(Number(r.clubId)) || new Map<number, string>();
            m.set(Number(r.reportMonth), r.submittedDate ? new Date(r.submittedDate).toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
            subsByClub.set(Number(r.clubId), m);
          }
          // AG assigned to each CLUB for the report's rotary year. agAllocation is
          // already year-scoped server-side (district_ag.fk_year_id = yearId) and
          // arrives with the report payload, so this is a plain in-memory lookup —
          // no extra query and no per-row work. district_ag is unique on
          // (fk_club_id, fk_year_id), so a club has at most one AG per year.
          const agByClub = new Map<number, string>();
          for (const a of agsDropdown) if (!agByClub.has(Number(a.clubId))) agByClub.set(Number(a.clubId), a.agName);
          const ALL_MONTHS = ["July","August","September","October","November","December","January","February","March","April","May","June"];
          const ALL_MONTHNUMS = [7,8,9,10,11,12,1,2,3,4,5,6];
          // For the CURRENT rotary year, only show months up to the current month
          // (don't pad future months). Past/completed years show all 12.
          const selYear = years.find((y: any) => String(y.id) === selectedYearId);
          let monthCount = 12;
          if (selYear?.isCurrent) {
            const cm = new Date().getMonth() + 1;           // 1-12
            monthCount = (cm >= 7 ? cm - 7 : cm + 5) + 1;   // July=1 … June=12
          }
          const MONTHS = ALL_MONTHS.slice(0, monthCount);
          const MONTHNUMS = ALL_MONTHNUMS.slice(0, monthCount);
          const rows = clubsDropdown.map((club, i) => {
            const subs = subsByClub.get(club.clubId) || new Map();
            const agName = agByClub.get(Number(club.clubId)) || "";
            const row: any = showGeoColumns
              ? { srNo: i + 1, zoneName: club.zoneName || "", districtNumber: club.districtNumber || districtNumber, clubName: club.clubName, agName }
              : { srNo: i + 1, district: `District ${districtNumber}`, clubName: club.clubName, agName };
            MONTHNUMS.forEach((m, idx) => {
              const date = subs.get(m);
              row[`m${idx}_status`] = date ? "Submitted" : "Not Submitted";
              row[`m${idx}_date`]   = date || "";
            });
            return row;
          });
          const cols: any[] = showGeoColumns
            ? [
                { key: "srNo", label: "Sr.No.", width: 8 },
                { key: "zoneName", label: "Zone", width: 16 },
                { key: "districtNumber", label: "District Number", width: 16 },
                { key: "clubName", label: "Club Name", width: 25 },
                { key: "agName", label: "AG Name", width: 24 },
              ]
            : [
                { key: "srNo", label: "Sr.No.", width: 8 },
                { key: "district", label: "District", width: 14 },
                { key: "clubName", label: "Club Name", width: 25 },
                { key: "agName", label: "AG Name", width: 24 },
              ];
          MONTHS.forEach((m, idx) => {
            cols.push({ key: `m${idx}_status`, label: `${m} Submitted/Not Submitted`, width: 22 });
            cols.push({ key: `m${idx}_date`,   label: `${m} Date`, width: 22 });
          });
          exportWithFilename(rows, "Club_Monthly_Report_Submission_Details", "Club Monthly Report (Submission Details)", cols);
        }}
      />

      {/* Dues (OCV) — flat list per (club × dues type) with Club + Dues-type filters,
          per-club subtotal, per-type total and grand total in the Excel export. */}
      <DuesReportRow
        rows={report?.duesReport || []}
        clubs={clubsDropdown}
        onDownload={exportWithFilename}
      />

      {/* 12. TRF Contributions */}
      <ClubFilterRow
        title="TRF Contributions"
        icon={IndianRupee}
        rows={report.trf || []}
        clubs={clubsDropdown}
        hideClub={hideClubFilter}
        defaultFile="TRF_Contributions"
        baseColumns={[
          { key: "clubName", label: "Club", width: 25 },
          { key: "trfDate", label: "Date", width: 14 },
          { key: "donorName", label: "Member Name", width: 25 },
          { key: "fundName", label: "Fund", width: 20 },
          { key: "amountUsd", label: "Amount (USD)", width: 15, numeric: true },
        ]}
        onDownload={exportWithFilename}
      />

      {/* 11. Non Synchronized Clubs (renamed from Non RI Synchronized Clubs) */}
      <ReportSection
        title="Non Synchronized Clubs"
        icon={Building2}
        count={report.nonRiSyncedClubs?.length || 0}
        onExport={() =>
          exportSection(report.nonRiSyncedClubs, "Non_Synchronized_Clubs", [
            { key: "srNo", label: "Sr. No.", width: 8, index: true },
            { key: "clubId", label: "Club ID", width: 14 },
            { key: "clubName", label: "Club Name", width: 30 },
            { key: "charterDate", label: "Charter Date", width: 16, format: ddmmyyyy },
            { key: "address", label: "Address", width: 45 },
          ])
        }
      />

      {/* 12. Synchronized Clubs (renamed) — same header as Non Synchronized */}
      <ReportSection
        title="Synchronized Clubs"
        icon={Building2}
        count={report.riSyncedClubs?.length || 0}
        onExport={() =>
          exportSection(report.riSyncedClubs, "Synchronized_Clubs", [
            { key: "srNo", label: "Sr. No.", width: 8, index: true },
            { key: "clubName", label: "Club Name", width: 30 },
            { key: "districtNumber", label: "District Number", width: 14 },
            { key: "president", label: "President", width: 25 },
            { key: "presidentMobile", label: "President Mobile", width: 16 },
            { key: "presidentEmail", label: "President Email", width: 30 },
            { key: "secretary", label: "Secretary", width: 25 },
            { key: "secretaryMobile", label: "Secretary Mobile", width: 16 },
            { key: "secretaryEmail", label: "Secretary Email", width: 30 },
          ])
        }
      />

      {/* 14. Club Officers (From RI) — live from Rotary.org for the selected year. */}
      <ReportSection
        title="Club Officers (From RI)"
        icon={UserCog}
        count={clubsDropdown.length}
        onExport={async () => {
          try {
            const rows = isMulti
              ? (await Promise.all(districtIds!.map((id) => getDistrictClubOfficersRi(id, Number(selectedYearId)).catch(() => [] as any[])))).flat()
              : await getDistrictClubOfficersRi(effectiveDistrictId, Number(selectedYearId), undefined, agMemberId);
            if (!rows || rows.length === 0) { setErrorMessage("No club officers found from Rotary.org for the selected year."); return; }
            // On-demand rows aren't part of the stamped payload — attach Zone + District
            // by matching each officer row to its club (geo-columns view only).
            let officerRows = rows;
            if (showGeoColumns) {
              const geoById = new Map(clubsDropdown.map((c) => [Number(c.clubId), { districtNumber: c.districtNumber, zoneName: c.zoneName }]));
              const geoByName = new Map(clubsDropdown.map((c) => [String(c.clubName || "").trim().toLowerCase(), { districtNumber: c.districtNumber, zoneName: c.zoneName }]));
              officerRows = rows.map((r: any) => {
                const g = geoById.get(Number(r.clubId)) || geoByName.get(String(r.clubName || "").trim().toLowerCase());
                return { ...r, districtNumber: r.districtNumber ?? g?.districtNumber ?? districtNumber, zoneName: r.zoneName ?? g?.zoneName ?? (report?.district?.zoneName ?? "") };
              });
            }
            exportSection(officerRows, "Club_Officers_RI", [
              { key: "srNo", label: "Sr.No.", width: 8, index: true },
              { key: "clubName", label: "Club Name", width: 26 },
              { key: "presidentName", label: "President Name", width: 24 },
              { key: "presidentEmail", label: "President EmailID", width: 28 },
              { key: "presidentMobile", label: "President MobileNumber", width: 18 },
              { key: "secretaryName", label: "Secretary Name", width: 24 },
              { key: "secretaryEmail", label: "Secretary Email ID", width: 28 },
              { key: "secretaryMobile", label: "Secretary Mobile Number", width: 18 },
              { key: "execSecretaryName", label: "Club Executive Secretary Name", width: 26 },
              { key: "execSecretaryMobile", label: "Club Executive Secretary Number", width: 18 },
              { key: "execSecretaryEmail", label: "Club Executive Secretary Email", width: 28 },
              { key: "treasurerName", label: "Club Treasurer", width: 24 },
              { key: "treasurerEmail", label: "Club Treasurer EmailID", width: 28 },
              { key: "treasurerMobile", label: "Club Treasurer MobileNumber", width: 18 },
              { key: "foundationChairName", label: "Club Foundation Chair", width: 24 },
              { key: "foundationChairEmail", label: "Club Foundation Chair EmailID", width: 28 },
              { key: "foundationChairMobile", label: "Club Foundation Chair MobileNumber", width: 18 },
              { key: "membershipChairName", label: "Club Membership Chair", width: 24 },
              { key: "membershipChairEmail", label: "Club Membership Chair EmailID", width: 28 },
              { key: "membershipChairMobile", label: "Club Membership Chair MobileNumber", width: 18 },
              { key: "publicImageChairName", label: "Club Public Image Chair", width: 24 },
              { key: "publicImageChairEmail", label: "Club Public Image Chair EmailID", width: 28 },
              { key: "publicImageChairMobile", label: "Club Public Image Chair MobileNumber", width: 18 },
              { key: "serviceProjectsChairName", label: "Club Service Projects Chair", width: 24 },
              { key: "serviceProjectsChairEmail", label: "Club Service Projects Chair EmailID", width: 28 },
              { key: "serviceProjectsChairMobile", label: "Club Service Projects Chair MobileNumber", width: 18 },
            ]);
          } catch { setErrorMessage("Failed to fetch club officers from Rotary.org."); }
        }}
      />

      {/* Upcoming Events / Newsletters — CLUB scope (All Clubs or one club).
          District-level entries live in the District subsection below. GML is a
          DISTRICT-only term, so club-scope stays "Newsletters".
          (Announcements + Documents are district-only — removed from club scope.) */}
      <ClubFilterRow
        title="Upcoming Events"
        icon={CalendarClock}
        rows={(report.events || []).filter((r: any) => r.clubName !== "District Level")}
        clubs={clubsDropdown}
        hideClub={hideClubFilter}
        defaultFile="Upcoming_Events"
        baseColumns={[
          { key: "clubName", label: "Club", width: 25 },
          { key: "title", label: "Title", width: 25 },
          { key: "description", label: "Description", width: 30 },
          { key: "eventDate", label: "Event Date", width: 14, format: ddmmyyyy },
          { key: "eventVenue", label: "Venue", width: 20 },
          { key: "imagePath", label: "Image", width: 14, hyperlink: true, linkText: "Image" },
          { key: "registrationLink", label: "Registration", width: 14, hyperlink: true, linkText: "Link" },
          { key: "publishDate", label: "Publish Date", width: 18 },
          { key: "status", label: "Status", width: 14 },
        ]}
        onDownload={exportWithFilename}
      />

      <ClubFilterRow
        title="Newsletters"
        icon={Newspaper}
        rows={(report.newsletters || []).filter((r: any) => r.clubName !== "District Level")}
        clubs={clubsDropdown}
        hideClub={hideClubFilter}
        defaultFile="Newsletters"
        baseColumns={[
          { key: "clubName", label: "Club", width: 25 },
          { key: "title", label: "Title", width: 25 },
          { key: "publishDate", label: "Publish Date", width: 18 },
          { key: "expiryDate", label: "Expiry", width: 18 },
          { key: "attachmentType", label: "Type", width: 12 },
          { key: "status", label: "Status", width: 14 },
        ]}
        onDownload={exportWithFilename}
      />
    </>
  );
}
