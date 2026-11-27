"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useFeature } from "@/contexts/BrandContext";
import { getDistrictReport, getDistrictReportAvailableYears, getRotaryYears } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { appLocale } from "@/lib/appFormat";
import { mergeDistrictReports, stampGeoSingle } from "./districtReportData";

export type DistrictReportProps = { districtId?: number; initialYearId?: number; servicesOnly?: boolean; agMemberId?: number; agName?: string; hideMembers?: boolean; districtIds?: number[]; hideClubFilter?: boolean; hideAgReports?: boolean; showGeoColumns?: boolean; showCommunicationLogs?: boolean };

export function useDistrictReport({ districtId, initialYearId, servicesOnly = false, agMemberId, agName, hideMembers = false, districtIds, hideClubFilter = false, hideAgReports = false, showGeoColumns = false, showCommunicationLogs = false }: DistrictReportProps) {
  // AG Reports: every "(AG Wise)" row is redundant — the whole report is already this
  // AG, so its AG dropdown would list only them. Hidden rather than left as a no-op.
  const isAgReport = !!agMemberId && agMemberId > 0;
  const showBloodGroup = useFeature("member.bloodGroup");
  // Multi-district ("All Districts") mode — fetch + merge every district in the zone.
  const isMulti = Array.isArray(districtIds) && districtIds.length > 0;
  const effectiveDistrictId = districtId ?? 0;
  // "(AG Wise)" report rows: hidden on an AG report (redundant) and when the caller
  // asks to hide AG-wise reports (hideAgReports). District-level rows keep using !isAgReport.
  const showAgRows = !isAgReport && !hideAgReports;
  // Report downloads: progress inside the clicked button, one at a time on this page.
  const dl = useDownloadProgress();
  const searchParams = useSearchParams();
  const [years, setYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [report, setReport] = useState<any>(null);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Global topbar Rotary year (?yearId). All reports download using THIS year —
  // there is no per-module year dropdown anymore.
  const globalYearId = searchParams?.get("yearId") || "";

  useEffect(() => {
    (async () => {
      try {
        if (isMulti) {
          // No single district → use the global rotary-year list (all districts share years).
          const yrs = await getRotaryYears();
          setYears((yrs || []).map((y: any) => ({
            id: y.id ?? y.pkYearId,
            yearLabel: y.yearLabel ?? y.YearLabel,
            isCurrent: y.isCurrent ?? y.IsCurrent ?? false,
          })));
        } else {
          const yrs = await getDistrictReportAvailableYears(effectiveDistrictId);
          setYears(yrs || []);
        }
      } catch { setErrorMessage("Failed to load years."); }
      finally { setYearsLoading(false); }
    })();
  }, [effectiveDistrictId, isMulti]);

  // Selected year is driven by the global topbar year, falling back to the
  // initialYearId prop and then the current year once the list has loaded.
  useEffect(() => {
    if (globalYearId) { setSelectedYearId(globalYearId); return; }
    if (initialYearId && initialYearId > 0) { setSelectedYearId(String(initialYearId)); return; }
    if (years.length > 0) {
      const cur = years.find((y: any) => y.isCurrent);
      setSelectedYearId(String(cur?.id || years[0].id));
    }
  }, [globalYearId, initialYearId, years]);

  useEffect(() => {
    if (!selectedYearId) return;
    (async () => {
      setReportLoading(true);
      try {
        if (isMulti) {
          // Fetch every district in the zone in parallel, then concatenate the
          // section arrays into ONE payload so each Download button emits a single
          // combined file (all districts, all clubs).
          const reports = await Promise.all(
            districtIds!.map((id) => getDistrictReport(id, Number(selectedYearId)).catch(() => null)),
          );
          setReport(mergeDistrictReports(reports));
        } else {
          const data = await getDistrictReport(effectiveDistrictId, Number(selectedYearId), agMemberId);
          setReport(showGeoColumns ? stampGeoSingle(data) : data);
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load report.");
      } finally { setReportLoading(false); }
    })();
    // districtIds is stable per zone selection; joining avoids an identity-based re-fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDistrictId, selectedYearId, isMulti, (districtIds || []).join(",")]);

  const yearLabel = years.find((y: any) => String(y.id) === selectedYearId)?.yearLabel || "";
  const districtNumber = report?.district?.districtNumber || "";
  // Download filename prefix. On the AG report the file holds that AG's clubs, not the
  // whole district, so "District_5656_..." would misdescribe it — use the AG's name.
  const filePrefix = isMulti
    ? "All_Districts"
    : isAgReport && agName?.trim()
    ? `AG_${agName.trim().replace(/\s+/g, "_")}`
    : `District_${districtNumber}`;

  // Geo-columns view: every report should identify each row's Zone + District (rows
  // are pre-stamped with zoneName/districtNumber). Inject the two columns right after
  // the Sr.No column (or at the front), skipping any the report already carries so
  // Sync/Non-sync/Avenue-count rows keep their own District Number column.
  const injectGeo = (columns: any[]): any[] => {
    if (!showGeoColumns) return columns;
    const has = (k: string) => columns.some((c) => c?.key === k);
    const extra: any[] = [];
    if (!has("zoneName")) extra.push({ key: "zoneName", label: "Zone", width: 16 });
    if (!has("districtNumber")) extra.push({ key: "districtNumber", label: "District Number", width: 16 });
    if (extra.length === 0) return columns;
    const firstIsIndex = columns[0] && (columns[0].index || columns[0].key === "srNo");
    return firstIsIndex ? [columns[0], ...extra, ...columns.slice(1)] : [...extra, ...columns];
  };
  // Report title/subtitle scope label — "District 3142" for one district, "All Districts" for the merge.
  const scopeLabel = isMulti ? "All Districts" : `District ${districtNumber}`;

  const exportSection = (data: any[], sectionName: string, columns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string; numeric?: boolean }[]) => {
    if (!data || data.length === 0) return;
    exportToCSV(data, `${filePrefix}_${sectionName.replace(/\s+/g, "_")}`, injectGeo(columns), {
      title: `${sectionName} | ${scopeLabel}`,
      subtitle: `Rotary Year: ${yearLabel}`,
    });
    // No success toast — browser's file save UI is the confirmation.
  };

  // Variant of exportSection used by filter rows. Filename base is supplied
  // by the row (already includes Club/AG/Designation prefix when applicable);
  // for "All" selections, baseFile starts with the plain report name and the
  // District_{districtNumber}_ prefix is prepended so the convention is:
  //   All clubs    → District_3142_Members_15-06-2026_22-30-15.xlsx
  //   one club     → Thane_Hills_Members_15-06-2026_22-30-15.xlsx
  //   AG           → AG_R_Sharma_Members_15-06-2026_22-30-15.xlsx
  const exportWithFilename = (data: any[], baseFile: string, label: string, columns: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string; numeric?: boolean }[], summary?: string) => {
    if (!data || data.length === 0) return;
    const isClubOrAgScoped = baseFile.includes("_") && !baseFile.startsWith(label.replace(/\s+/g, "_"));
    const finalBase = isClubOrAgScoped
      ? baseFile
      : `${filePrefix}_${baseFile.replace(/\s+/g, "_")}`;
    exportToCSV(data, finalBase, injectGeo(columns), {
      title: `${label} | ${scopeLabel}`,
      subtitle: `Rotary Year: ${yearLabel}`,
      summary,
    });
  };

  // Day + month only (no year) — for DOB / DOA columns per the district-report spec.
  const dayMonth = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString(appLocale(), { day: "2-digit", month: "short" });
  };

  // DD/MM/YYYY — for the Joining Date column.
  const ddmmyyyy = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  };

  // Full Members column set (shared by "Members" and "Members (AG wise)").
  const membersCols: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string; index?: boolean; format?: (v: any, r: any) => string; numeric?: boolean }[] = [
    { key: "srNo", label: "Sr. No.", width: 8, index: true },
    { key: "clubName", label: "Club Name", width: 25 },
    { key: "memberName", label: "Member Name", width: 25 },
    { key: "profilePhoto", label: "Profile Photo", width: 12, hyperlink: true, linkText: "Photo" },
    { key: "classification", label: "Classification", width: 20 },
    { key: "clubDesignation", label: "Club Designation", width: 18 },
    { key: "country", label: "Country", width: 14 },
    { key: "mobile", label: "Mobile", width: 16 },
    { key: "email", label: "Email ID", width: 28 },
    { key: "gender", label: "Gender", width: 10 },
    { key: "primaryLanguage", label: "Primary Language", width: 16 },
    { key: "youthFlag", label: "Youth Flag", width: 10 },
    { key: "dob", label: "DOB", width: 12, format: dayMonth },
    { key: "doa", label: "DOA", width: 12, format: dayMonth },
    ...(showBloodGroup ? [{ key: "bloodGroup", label: "Blood Group", width: 12 }] : []), { key: "tshirtSize", label: "T-Shirt Size", width: 12 },
    { key: "deviceName", label: "Device Name", width: 14 },
    { key: "downloaded", label: "Downloaded", width: 12 },
    { key: "address", label: "Residence Address", width: 45 },
    { key: "rotaryId", label: "Rotary ID", width: 14 },
    // COG (club 31598) rows have no meaningful joining date, so when the report
    // contains COG rows that column is swapped for the DG district + Rotary year
    // the API now returns. A district with no COG rows is completely unchanged.
    ...(((report?.members || []) as any[]).some((r) => r?.cogDistrictNumber || r?.cogYear)
      ? [
          { key: "cogDistrictNumber", label: "District", width: 12 },
          { key: "cogYear", label: "Rotary Year", width: 14 },
        ]
      : [{ key: "riAdmissionDate", label: "Joining Date", width: 14, format: ddmmyyyy }]),
  ];

  // Attendance columns (shared by All Clubs + AG wise).
  const attendanceCols = [
    { key: "srNo", label: "Sr. No.", width: 8, index: true },
    { key: "clubName", label: "Club Name", width: 25 },
    { key: "eventName", label: "Event Name", width: 25 },
    { key: "description", label: "Description", width: 30 },
    { key: "eventDateTime", label: "Event Date & Time", width: 20 },
    { key: "membersCount", label: "Members Count", width: 14, numeric: true },
    { key: "annsCount", label: "Anns Count", width: 12, numeric: true },
    { key: "annetsCount", label: "Annets Count", width: 12, numeric: true },
    { key: "visitorsCount", label: "Visitors Count", width: 14, numeric: true },
    { key: "rotariansOtherClubsCount", label: "Rotarians (Other Clubs) Count", width: 22, numeric: true },
    { key: "districtDelegatesCount", label: "District Delegates Count", width: 20, numeric: true },
  ];

  // Full Avenue-of-Service project columns (shared by AG-wise + All-Clubs).
  const avenueProjectCols = [
    { key: "srNo", label: "Sr. No.", width: 8, index: true },
    { key: "clubName", label: "Club Name", width: 25 },
    { key: "typeOfProject", label: "Type of Project", width: 18 },
    { key: "clubRole", label: "Club Role", width: 16 },
    { key: "coHostName", label: "Co-host", width: 18 },
    { key: "areaOfFocus", label: "Area of Focus", width: 22 },
    { key: "projectDate", label: "Date", width: 14, format: ddmmyyyy },
    { key: "title", label: "Title", width: 28 },
    { key: "description", label: "Description", width: 36 },
    { key: "location", label: "Project Location", width: 20 },
    { key: "projectCost", label: "Project Cost", width: 14, numeric: true },
    { key: "funding", label: "Funding", width: 16 },
    { key: "globalGrantNumber", label: "Global Grant No", width: 18 },
    { key: "csrCompanyName", label: "CSR Company", width: 22 },
    { key: "amountSanctioned", label: "Amount Sanctioned", width: 16, numeric: true },
    { key: "amountReceived", label: "Amount Received", width: 16, numeric: true },
    { key: "amountSpent", label: "Amount Spent", width: 16, numeric: true },
    { key: "hostClubsDistricts", label: "Host Clubs", width: 22 },
    { key: "globalPartners", label: "Global Partner", width: 22 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14, numeric: true },
    { key: "manHours", label: "Man Hours", width: 12, numeric: true },
    { key: "oneTimeOngoing", label: "OneTime/Ongoing", width: 16 },
    { key: "newExisting", label: "New/Existing", width: 14 },
    { key: "rotariansInvolved", label: "Rotarians Involved", width: 18, numeric: true },
    { key: "publicPhotoUrl", label: "Images", width: 12, hyperlink: true, linkText: "Images" },
  ];
  // Avenue-of-Service reports (All Clubs / AG Wise / Club Wise Count) are CLUB
  // Avenue-of-Service projects only. The project payload also carries district-level
  // entries (fk_district_id match → clubName "District Level"); exclude those.
  const allProjects: any[] = (Object.values(report?.projectsByModule || {}).flat() as any[])
    .filter((p) => Number(p?.clubId) > 0 && String(p?.clubName || "") !== "District Level");

  // Resolve list of clubs for the dropdown rows. Falls back to deriving from
  // the bod payload if `clubList` isn't present (older API responses).
  const clubsDropdown: { clubId: number; clubName: string; districtNumber?: string; zoneName?: string }[] = report?.clubList
    ? report.clubList.map((c: any) => ({ clubId: c.clubId, clubName: c.clubName, districtNumber: c.districtNumber, zoneName: c.zoneName }))
    : Array.from(new Map((report?.bod || []).map((r: any) => [r.clubId, { clubId: r.clubId, clubName: r.clubName, districtNumber: r.districtNumber, zoneName: r.zoneName }])).values()) as any;
  const agsDropdown: { agMemberId: number; agName: string; clubId: number; clubName: string }[] = report?.agAllocation || [];
  return {
    districtId, initialYearId, servicesOnly, agMemberId, agName, hideMembers, districtIds, hideClubFilter, hideAgReports, showGeoColumns, showCommunicationLogs,
    isAgReport, showBloodGroup, isMulti, effectiveDistrictId, showAgRows, dl, searchParams, years, setYears, selectedYearId, setSelectedYearId, report, setReport, yearsLoading, setYearsLoading, reportLoading, setReportLoading, errorMessage, setErrorMessage, successMessage, setSuccessMessage, globalYearId, yearLabel, districtNumber, filePrefix, injectGeo, scopeLabel, exportSection, exportWithFilename, dayMonth, ddmmyyyy, membersCols, attendanceCols, avenueProjectCols, allProjects, clubsDropdown, agsDropdown,
  };
}

export type DistrictReportState = ReturnType<typeof useDistrictReport>;
