"use client";

/**
 * OCV / GOV v2 Live Documents — frontend overhaul replacement.
 *
 * Same APIs as v1: getClub, getTrfYears, getLiveDocumentsExport.
 * Same module catalog grouped into OCV/GOV (6 modules) and Club (12 modules).
 * Per-row Download button hits the export endpoint and streams to CSV via
 * exportToCSV with the same column configs as v1.
 *
 * `?returnTo=` honored on the back arrow; defaults to /clubs/[id]/ocv-gov/v2.
 */

import { useEffect, useMemo, useState } from "react";
import { useFeature } from "@/contexts/BrandContext";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Calendar, Download, FileSpreadsheet, FolderOpen, Users, Loader2, Search,
} from "@/components/icons";
import { getClub, getTrfYears, getLiveDocumentsExport } from "@/services/api";
import type { ReportYear } from "@/types/clubMonthlyReport";
import { exportToCSV } from "@/utils/csvExport";
import { formatBirthAnniversary } from "@/lib/dateUtils";

// Strip year from birthday + anniversary columns before exporting (project-wide
// rule). Same helper shape as the V1 OCV-Gov page.
const BIRTH_ANNIV_FIELDS = ["birthDate", "anniversaryDate", "familyBirthDate", "familyAnniversaryDate"];
function stripYear<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const k of BIRTH_ANNIV_FIELDS) {
      if (out[k] != null) out[k] = formatBirthAnniversary(out[k] as string);
    }
    return out as T;
  });
}
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { SkeletonRows } from "@/components/row/AppKit";

// ── Module catalog (same shape & columns as v1) ────────────────────────────
interface ModuleItem {
  key: string;
  label: string;
  group: "ocv" | "club";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: { key: string; label: string; width?: number }[];
}

const MODULES: ModuleItem[] = [
  // OCV/GOV
  { key: "static_documents", label: "Static Documents", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "amount", label: "Amount", width: 12 }, { key: "paidOn", label: "Paid On", width: 15 },
    { key: "customType", label: "Custom Type", width: 20 }, { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "financial_documents", label: "Financial Documents", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "amount", label: "Amount", width: 12 }, { key: "paidOn", label: "Paid On", width: 15 },
    { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "trust_documents", label: "Trust Documents", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "grants", label: "Grants", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "amount", label: "Amount", width: 12 }, { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "additional_documents", label: "Additional Documents", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  { key: "dues", label: "Dues", group: "ocv", columns: [
    { key: "documentType", label: "Document Type", width: 25 }, { key: "fileName", label: "File Name", width: 30 },
    { key: "amount", label: "Amount", width: 12 }, { key: "paidOn", label: "Paid On", width: 15 },
    { key: "uploadDate", label: "Upload Date", width: 18 },
  ]},
  // Club
  { key: "community_service", label: "Community Service Projects", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 },
    { key: "location", label: "Location", width: 20 },
    { key: "projectCost", label: "Cost", width: 12 }, { key: "directBeneficiaries", label: "Beneficiaries", width: 14 },
    { key: "manHours", label: "Man Hours", width: 12 }, { key: "funding", label: "Funding", width: 15 },
  ]},
  { key: "vocational_service", label: "Vocational Service", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "international_service", label: "International Service", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "new_generation_service", label: "New Generation Service", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "public_image_initiative", label: "Public Image Initiative", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "club_service", label: "Club Service", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "projectDate", label: "Date", width: 15 },
    { key: "areaOfFocus", label: "Area of Focus", width: 20 },
    { key: "location", label: "Location", width: 20 }, { key: "projectCost", label: "Cost", width: 12 },
    { key: "directBeneficiaries", label: "Beneficiaries", width: 14 }, { key: "manHours", label: "Man Hours", width: 12 },
  ]},
  { key: "announcements", label: "Announcements", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "description", label: "Description", width: 30 },
    { key: "publishDate", label: "Publish Date", width: 18 }, { key: "expiryDate", label: "Expiry Date", width: 18 },
  ]},
  { key: "upcoming_events", label: "Upcoming Events", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "eventDate", label: "Event Date", width: 18 },
    { key: "eventVenue", label: "Venue", width: 20 }, { key: "publishDate", label: "Publish Date", width: 18 },
    { key: "status", label: "Status", width: 12 }, { key: "registrationLink", label: "Link", width: 25 },
  ]},
  { key: "newsletters", label: "Newsletters", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "publishDate", label: "Publish Date", width: 18 },
    { key: "expiryDate", label: "Expiry Date", width: 18 }, { key: "attachmentType", label: "Type", width: 10 },
    { key: "status", label: "Status", width: 12 },
  ]},
  { key: "documents", label: "Documents", group: "club", columns: [
    { key: "title", label: "Title", width: 25 }, { key: "accessType", label: "Access Type", width: 15 },
    { key: "publishDate", label: "Publish Date", width: 18 }, { key: "expiryDate", label: "Expiry Date", width: 18 },
  ]},
  { key: "attendance", label: "Attendance", group: "club", columns: [
    { key: "eventName", label: "Event", width: 25 }, { key: "eventDateTime", label: "Date", width: 18 },
    { key: "membersPresent", label: "Members Present", width: 16 }, { key: "visitors", label: "Visitors", width: 10 },
    { key: "rotarians", label: "Rotarians", width: 10 }, { key: "totalMembers", label: "Total Active", width: 12 },
    { key: "attendancePercent", label: "Attendance %", width: 14 },
  ]},
  { key: "board_of_directors", label: "Board of Directors", group: "club", columns: [
    { key: "designation", label: "Designation", width: 25 }, { key: "memberName", label: "Name", width: 25 },
    { key: "mobile", label: "Mobile", width: 15 }, { key: "email", label: "Email", width: 25 },
  ]},
  { key: "members", label: "Members", group: "club", columns: [
    { key: "memberName", label: "Name", width: 25 }, { key: "mobile", label: "Mobile", width: 15 },
    { key: "email", label: "Email", width: 25 }, { key: "rotaryId", label: "Rotary ID", width: 15 },
    { key: "gender", label: "Gender", width: 10 }, { key: "birthDate", label: "Birth Date", width: 15 },
    { key: "anniversaryDate", label: "Anniversary", width: 15 }, { key: "bloodGroup", label: "Blood Group", width: 12 },
    { key: "joinedDate", label: "Joined", width: 15 }, { key: "isActive", label: "Active", width: 8 },
  ]},
  { key: "trf_contributions", label: "TRF Contributions", group: "club", columns: [
    { key: "donorName", label: "Donor", width: 25 }, { key: "fundName", label: "Fund Name", width: 20 },
    { key: "fundType", label: "Type", width: 15 }, { key: "amountUsd", label: "Amount (USD)", width: 15 },
    { key: "trfDate", label: "Date", width: 18 },
  ]},
];

export default function LiveDocumentsV2Page() {
  useSyncClubIdFromUrl();
  const showBloodGroup = useFeature("member.bloodGroup");
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const urlYearId = searchParams.get("yearId");
  const inboundReturnTo = searchParams.get("returnTo");

  const backHref = inboundReturnTo || `/clubs/${clubId}/ocv-gov/v2`;

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cmrOn = useFeatureLoadedOn("club_monthly_report");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [club, yrs] = await Promise.all([
          getClub(clubId),
          getTrfYears(clubId, cmrOn),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setYears(yrs);
        if (urlYearId && yrs.some((y) => y.id === Number(urlYearId))) {
          setSelectedYearId(Number(urlYearId));
        } else {
          const cur = yrs.find((y) => y.isCurrent);
          setSelectedYearId(cur ? cur.id : yrs[0]?.id ?? null);
        }
      } catch {
        if (!cancelled) setErrorMessage("Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, cmrOn]);

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MODULES;
    return MODULES.filter((m) => m.label.toLowerCase().includes(q));
  }, [search]);

  const ocvModules = filtered.filter((m) => m.group === "ocv");
  const clubModules = filtered.filter((m) => m.group === "club");

  async function handleDownload(mod: ModuleItem) {
    if (!selectedYearId) {
      setErrorMessage("Please select a Rotary Year.");
      return;
    }
    setDownloading(mod.key);
    try {
      const data = await getLiveDocumentsExport(clubId, selectedYearId, mod.key);
      const arr = Array.isArray(data) ? stripYear(data) : [];
      if (arr.length === 0) {
        setErrorMessage(`No data found for ${mod.label}.`);
        setDownloading(null);
        return;
      }
      exportToCSV(arr, `${clubName}_${mod.label.replace(/\s+/g, "_")}`, showBloodGroup ? mod.columns : mod.columns.filter((c) => c.key !== "bloodGroup"), {
        title: `${mod.label} | ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}`,
      });
      setSuccessMessage(`${mod.label} downloaded.`);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (err as any)?.response?.data;
      setErrorMessage(e?.message || `Failed to download ${mod.label}.`);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="OCV Live Documents"
        pageSubtitle="Export per-module live data"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2 min-w-0">
            <Link
              href={backHref}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-slate-800 leading-tight">Live Documents</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "–"} · Download Excel snapshots module-wise
              </p>
            </div>
          </div>

          {!loading && years.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                <Calendar size={13} /> Year
              </span>
              <select
                value={selectedYearId ?? ""}
                onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
                className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42] min-w-[10rem]"
              >
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}{y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* KPI tiles */}
        {!loading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="OCV / GOV Modules"
              value={fmtInt(MODULES.filter((m) => m.group === "ocv").length)}
              subtitle="Document categories"
              icon={FolderOpen}
              color="blue"
            />
            <KpiCard
              title="Club Modules"
              value={fmtInt(MODULES.filter((m) => m.group === "club").length)}
              subtitle="Activity exports"
              icon={Users}
              color="purple"
            />
            <KpiCard
              title="Rotary Year"
              value={yearLabel}
              subtitle="Active selection"
              icon={Calendar}
              color="gold"
            />
            <KpiCard
              title="Format"
              value="Excel"
              subtitle="CSV with column widths"
              icon={FileSpreadsheet}
              color="green"
            />
          </div>
        )}

        {/* Search */}
        {!loading && (
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search modules…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {filtered.length} module{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
        )}

        {loading ? (
          <SkeletonRows />
        ) : (
          <>
            {/* OCV/GOV Section */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <FolderOpen size={16} className="text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-800">OCV / GOV Documents</h2>
                <span className="ml-auto text-xs text-slate-500">{ocvModules.length} listed</span>
              </div>
              {ocvModules.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-slate-400">No modules match your search.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {ocvModules.map((mod) => (
                    <li key={mod.key} className="flex items-center justify-between px-5 py-3 hover:bg-blue-50/40">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                          <FileSpreadsheet size={14} />
                        </span>
                        <span className="text-sm font-medium text-slate-800 truncate">{mod.label}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownload(mod)}
                        disabled={downloading === mod.key || !selectedYearId}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                      >
                        {downloading === mod.key ? (
                          <>
                            <Loader2 className="animate-spin" size={12} /> Downloading…
                          </>
                        ) : (
                          <>
                            <Download size={12} /> Download
                          </>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Club Modules Section */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <Users size={16} className="text-violet-600" />
                <h2 className="text-sm font-semibold text-slate-800">Club Modules</h2>
                <span className="ml-auto text-xs text-slate-500">{clubModules.length} listed</span>
              </div>
              {clubModules.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-slate-400">No modules match your search.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {clubModules.map((mod) => (
                    <li key={mod.key} className="flex items-center justify-between px-5 py-3 hover:bg-blue-50/40">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <FileSpreadsheet size={14} />
                        </span>
                        <span className="text-sm font-medium text-slate-800 truncate">{mod.label}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownload(mod)}
                        disabled={downloading === mod.key || !selectedYearId}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                      >
                        {downloading === mod.key ? (
                          <>
                            <Loader2 className="animate-spin" size={12} /> Downloading…
                          </>
                        ) : (
                          <>
                            <Download size={12} /> Download
                          </>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
