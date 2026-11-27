import XLSX from "xlsx-js-style";
import { fileTimestamp } from "@/lib/dateUtils";
import DistrictGoalReports from "@/components/dashboard/DistrictGoalReports";
import { Megaphone, CalendarClock, Newspaper, FileText, Award, UserCircle, UserCog, Star } from "@/components/icons";
import { ReportSection, SubsectionHeader } from "./DistrictReportRows";
import { OcvReportRow, AwardsClubFilterRow, AwardsAgFilterRow } from "./DistrictReportFilterRows";
import { DistrictReportState } from "./useDistrictReport";

export default function DistrictReportDistrict({ r }: { r: DistrictReportState }) {
  const { hideClubFilter, showGeoColumns, isAgReport, isMulti, effectiveDistrictId, showAgRows, dl, selectedYearId, report, setErrorMessage, yearLabel, districtNumber, filePrefix, exportSection, ddmmyyyy, clubsDropdown, agsDropdown } = r;
  return (
    <>
      {/* ── DISTRICT subsection ───────────────────────────────────── */}
      <SubsectionHeader title="District" />

      {/* District Goal Setting — the district's month-wise / till-date goals (all categories, 2 sheets). */}
      <DistrictGoalReports mode="district" districtId={effectiveDistrictId} yearId={Number(selectedYearId) || undefined} />

      {/* District Projects — hidden on the AG report: district-level, not their clubs. */}
      {!isAgReport && (
      <ReportSection
        title="District Projects"
        icon={Award}
        count={report.districtProjects?.length || 0}
        onExport={() =>
          exportSection(report.districtProjects, "District_Projects", [
            { key: "srNo", label: "Sr. No.", width: 8, index: true },
            { key: "areaOfFocus", label: "Area of Focus", width: 22 },
            { key: "projectDate", label: "Date", width: 14, format: ddmmyyyy },
            { key: "title", label: "Title", width: 28 },
            { key: "description", label: "Description", width: 40 },
            { key: "location", label: "Project Location", width: 22 },
            { key: "projectCost", label: "Project Cost", width: 14, numeric: true },
            { key: "funding", label: "Funding", width: 16 },
            { key: "globalGrantNumber", label: "Global Grant Number", width: 18 },
            { key: "csrCompanyName", label: "Name of the CSR Company", width: 22 },
            { key: "amountSanctioned", label: "Amount Sanctioned", width: 16, numeric: true },
            { key: "amountReceived", label: "Amount Received", width: 16, numeric: true },
            { key: "amountSpent", label: "Amount spent till date", width: 18, numeric: true },
            { key: "hostClubsDistricts", label: "Host Clubs/Districts", width: 22 },
            { key: "globalPartners", label: "Global Partner Clubs/Districts", width: 22 },
            { key: "directBeneficiaries", label: "Beneficiaries", width: 14, numeric: true },
            { key: "manHours", label: "Man Hours", width: 12, numeric: true },
            { key: "rotariansInvolved", label: "Rotarians Involved", width: 18, numeric: true },
            { key: "publicPhotoUrl", label: "Image", width: 12, hyperlink: true, linkText: "Image" },
          ])
        }
      />
      )}

      {/* District Events — from district admin → Foundation → District Events
          (year-wise projects table, DistrictProjectType='Event'). Hidden on the AG
          report: district-level, not their clubs. */}
      {!isAgReport && (
      <ReportSection
        title="District Events"
        icon={CalendarClock}
        count={report.districtEvents?.length || 0}
        onExport={() =>
          exportSection(
            report.districtEvents || [],
            "District_Events",
            [
              { key: "srNo", label: "Sr. No.", width: 8, index: true },
              { key: "title", label: "Title", width: 28 },
              { key: "description", label: "Description", width: 40 },
              { key: "eventDate", label: "Event Date", width: 14, format: ddmmyyyy },
              { key: "imagePath", label: "Image", width: 12, hyperlink: true, linkText: "Image" },
            ],
          )
        }
      />
      )}

      {/* District Upcoming Events — from district admin → Communication → Upcoming
          Events (the upcoming_events feed, district-level entries). Separate from the
          Foundation "District Events" above. Hidden on the AG report. */}
      {!isAgReport && (
      <ReportSection
        title="District Upcoming Events"
        icon={CalendarClock}
        count={(report.events || []).filter((e: any) => e.clubName === "District Level").length}
        onExport={() =>
          exportSection(
            (report.events || []).filter((e: any) => e.clubName === "District Level"),
            "District_Upcoming_Events",
            [
              { key: "srNo", label: "Sr. No.", width: 8, index: true },
              { key: "title", label: "Title", width: 28 },
              { key: "description", label: "Description", width: 40 },
              { key: "eventDate", label: "Event Date", width: 14, format: ddmmyyyy },
              { key: "eventVenue", label: "Venue", width: 24 },
              { key: "registrationLink", label: "Registration Link", width: 26 },
              { key: "status", label: "Status", width: 14 },
              { key: "imagePath", label: "Image", width: 12, hyperlink: true, linkText: "Image" },
            ],
          )
        }
      />
      )}

      {/* District-level Announcements / Newsletters / Documents (district scope
          only; club-scoped copies live in the Clubs subsection above).
          Hidden on the AG report — the club-scoped copies above already cover
          their clubs; these are district-wide and not theirs. */}
      {!isAgReport && (<>
      <ReportSection
        title="Announcements"
        icon={Megaphone}
        count={(report.announcements || []).filter((r: any) => r.clubName === "District Level").length}
        onExport={() => exportSection(
          (report.announcements || []).filter((r: any) => r.clubName === "District Level"),
          "District_Announcements", [
            { key: "srNo", label: "Sr. No.", width: 8, index: true },
            { key: "title", label: "Title", width: 25 },
            { key: "description", label: "Description", width: 30 },
            { key: "imagePath", label: "Image", width: 14, hyperlink: true, linkText: "Image" },
            { key: "publishDate", label: "Publish Date", width: 18 },
            { key: "expiryDate", label: "Expiry Date", width: 18 },
            { key: "status", label: "Status", width: 14 },
          ])} />

      <ReportSection
        title="GML"
        icon={Newspaper}
        count={(report.newsletters || []).filter((r: any) => r.clubName === "District Level").length}
        onExport={() => exportSection(
          // Open URL = the external link (link-type GML) or the uploaded file path.
          (report.newsletters || [])
            .filter((r: any) => r.clubName === "District Level")
            .map((r: any) => ({ ...r, openUrl: r.linkUrl || r.filePath || "" })),
          "District_GML", [
            { key: "srNo", label: "Sr. No.", width: 8, index: true },
            { key: "title", label: "Title", width: 25 },
            { key: "publishDate", label: "Publish Date", width: 18 },
            { key: "attachmentType", label: "Type", width: 12 },
            { key: "openUrl", label: "Link", width: 26, hyperlink: true, linkText: "Open" },
          ])} />

      <ReportSection
        title="Documents"
        icon={FileText}
        count={(report.documents || []).filter((r: any) => r.clubName === "District Level").length}
        onExport={() => exportSection(
          (report.documents || []).filter((r: any) => r.clubName === "District Level"),
          "District_Documents", [
            { key: "srNo", label: "Sr. No.", width: 8, index: true },
            { key: "title", label: "Title", width: 25 },
            { key: "accessType", label: "Access", width: 14 },
            { key: "publishDate", label: "Publish", width: 18 },
            { key: "expiryDate", label: "Expiry", width: 18 },
          ])} />
      </>)}

      {/* AG Allocation */}
      <ReportSection
        title="AG Allocation"
        icon={UserCog}
        count={report.agAllocation?.length || 0}
        onExport={() => {
          // AG details shown ONCE per AG, then blank on that AG's remaining allocated-
          // club rows (only the club columns repeat). Grouped by AG so each block is
          // contiguous; keyed by agMemberId (falling back to agName).
          const agKeys = ["agName", "agClubName", "agMobile", "agEmail"];
          const sorted = [...(report.agAllocation || [])].sort((a: any, b: any) =>
            String(a.agMemberId ?? a.agName ?? "").localeCompare(String(b.agMemberId ?? b.agName ?? "")));
          const seen = new Set<string>();
          const data = sorted.map((r: any) => {
            const key = String(r.agMemberId ?? r.agName ?? "");
            const first = !seen.has(key);
            seen.add(key);
            const out: any = { ...r };
            if (!first) for (const k of agKeys) out[k] = "";
            return out;
          });
          return exportSection(data, "AG_Allocation", [
            { key: "srNo", label: "Sr. No.", width: 8, index: true },
            { key: "agName", label: "AG Name", width: 25 },
            { key: "agClubName", label: "AG Club Name", width: 25 },
            { key: "agMobile", label: "AG Mobile", width: 16 },
            { key: "agEmail", label: "AG Email ID", width: 30 },
            { key: "clubName", label: "Allocated Club Name", width: 30 },
            { key: "clubRotaryId", label: "Club Rotary Id", width: 16 },
          ]);
        }}
      />

    {/* Attendance / BOD / Members / TRF moved up into Members + Clubs
        subsections (with dropdowns). District-level rows continue below.
        Announcements / Events / Newsletters / Documents also moved up
        into the CLUBS subsection per spec. */}

    {/* 1. District Committee — multi-sheet workbook with three sheets:
        District Committee (top-level direct members), Group Committee
        (group-level members), Sub Group Committee (sub-group members). */}
    {/* Hidden on the AG report — district-level roster, not their clubs. */}
    {!isAgReport && (
    <ReportSection
      title="District Committee"
      icon={UserCircle}
      count={(report.committeeMain?.length || 0) + (report.committeeGroup?.length || 0) + (report.committeeSubGroup?.length || 0)}
      onExport={() => {
        const wb = XLSX.utils.book_new();
        // Geo-columns view: lead every sheet with Zone + District Number (rows pre-stamped).
        const geoCols = showGeoColumns
          ? [{ key: "zoneName", label: "Zone", width: 16 }, { key: "districtNumber", label: "District Number", width: 16 }]
          : [];
        const mkSheet = (rows: any[], cols: { key: string; label: string; width?: number }[]) => {
          if (!rows || rows.length === 0) rows = [];
          const headerRow = cols.map((c) => c.label);
          const dataRows = rows.map((r) => cols.map((c) => r[c.key] ?? ""));
          const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
          ws["!cols"] = cols.map((c) => ({ wch: c.width || 18 }));
          // Header style
          cols.forEach((_, idx) => {
            const cell = ws[XLSX.utils.encode_cell({ r: 0, c: idx })];
            if (cell) cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1F4E79" } }, alignment: { horizontal: "center" as const } };
          });
          return ws;
        };
        XLSX.utils.book_append_sheet(wb, mkSheet(report.committeeMain || [], [
          ...geoCols,
          { key: "memberName", label: "Member Name", width: 30 },
          { key: "designation", label: "Designation", width: 28 },
          { key: "mobile", label: "Mobile", width: 16 },
          { key: "email", label: "Email", width: 30 },
        ]), "District Committee");
        XLSX.utils.book_append_sheet(wb, mkSheet(report.committeeGroup || [], [
          ...geoCols,
          { key: "groupName", label: "Group", width: 28 },
          { key: "memberName", label: "Member Name", width: 28 },
          { key: "designation", label: "Designation", width: 26 },
          { key: "mobile", label: "Mobile", width: 16 },
          { key: "email", label: "Email", width: 30 },
        ]), "Group Committee");
        XLSX.utils.book_append_sheet(wb, mkSheet(report.committeeSubGroup || [], [
          ...geoCols,
          { key: "groupName", label: "Group", width: 24 },
          { key: "subGroupName", label: "Sub Group", width: 28 },
          { key: "memberName", label: "Member Name", width: 28 },
          { key: "designation", label: "Designation", width: 26 },
          { key: "mobile", label: "Mobile", width: 16 },
          { key: "email", label: "Email", width: 30 },
        ]), "Sub Group Committee");
        XLSX.writeFile(wb, `${filePrefix}_Committee_${fileTimestamp()}.xlsx`);
      }}
    />
    )}

    {/* 2 + 3. District Awards (All clubs + per-club via dropdown).
        Hidden in "All Districts" mode — each district defines its own award
        columns, so they can't merge into one sheet; available per-district. */}
    {!isMulti && (
    <AwardsClubFilterRow
      title="District Awards (Club Wise)"
      icon={Star}
      clubs={clubsDropdown}
      hideClub={hideClubFilter}
      districtId={effectiveDistrictId}
      districtNumber={districtNumber}
      selectedYearId={selectedYearId}
      onEmpty={setErrorMessage}
      compact
    />
    )}

    {/* 4. District Awards (AG Wise) — hidden on the AG report + when AG-wise suppressed. */}
    {showAgRows && !isMulti && (
    <AwardsAgFilterRow
      title="District Awards (AG Wise)"
      icon={Star}
      ags={agsDropdown}
      districtId={effectiveDistrictId}
      districtNumber={districtNumber}
      selectedYearId={selectedYearId}
      onEmpty={setErrorMessage}
      compact
    />
    )}

    {/* 5 + 6. District Awards Extended (All clubs + per-club via dropdown) */}
    {!isMulti && (
    <AwardsClubFilterRow
      title="District Awards Extended (Club Wise)"
      icon={Star}
      clubs={clubsDropdown}
      hideClub={hideClubFilter}
      districtId={effectiveDistrictId}
      districtNumber={districtNumber}
      selectedYearId={selectedYearId}
      onEmpty={setErrorMessage}
    />
    )}

    {/* 7. District Awards Extended (AG Wise) — hidden on the AG report + when AG-wise suppressed. */}
    {showAgRows && !isMulti && (
    <AwardsAgFilterRow
      title="District Awards Extended (AG Wise)"
      icon={Star}
      ags={agsDropdown}
      districtId={effectiveDistrictId}
      districtNumber={districtNumber}
      selectedYearId={selectedYearId}
      onEmpty={setErrorMessage}
    />
    )}

    {/* 8. Governor's Official Visit (OCV/GOV) — Club Wise + AG Wise, all sub-modules.
        Club Wise needs a single club, so it's dropped when the per-club dropdown is
        hidden (hideClubFilter) or in "All Districts" mode. */}
    {!hideClubFilter && !isMulti && (
    <OcvReportRow
      dl={dl}
      mode="club"
      clubs={clubsDropdown}
      districtId={effectiveDistrictId}
      districtNumber={districtNumber}
      yearId={selectedYearId}
      yearLabel={yearLabel}
      onEmpty={setErrorMessage}
    />
    )}
    {/* AG Wise — hidden on the AG report + when AG-wise reports are suppressed. */}
    {showAgRows && !isMulti && (
    <OcvReportRow
      dl={dl}
      mode="ag"
      ags={agsDropdown}
      districtId={effectiveDistrictId}
      districtNumber={districtNumber}
      yearId={selectedYearId}
      yearLabel={yearLabel}
      onEmpty={setErrorMessage}
    />
    )}
    </>
  );
}
