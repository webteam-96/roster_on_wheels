"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Briefcase, Users, Clock, IndianRupee, ChevronLeft, ChevronRight, Search,
  X,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { getAgDashboardProjects, getAgProjectDetail, getPhotoUrl } from "@/services/api";
import type { AgProjectsResponse, AgProjectRow, AgProjectDetail } from "@/types/agDashboard";
import { useAuth } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";

// Wave 13A2: backend DTO carries a per-row `manHoursIsPending` flag that
// `AgProjectRow` (typings file) doesn't yet expose. We read it via a local
// extension type so this page stays self-contained per the task constraint
// (only modify projects/page.tsx).
type ProjectRowExt = AgProjectRow & { manHoursIsPending?: boolean };
const isManHoursPending = (r: AgProjectRow): boolean =>
  (r as ProjectRowExt).manHoursIsPending === true;
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtInr, fmtDate, ROTARY_BLUE, ROTARY_GOLD, CLUB_PALETTE } from "@/components/dashboard/formatters";
import { formatMoney } from "@/lib/currency";

const PAGE_SIZE = 20;

// Backend emits monthly keys as "Jul 2025" already; we keep a fallback parser
// for the documented "MM-YYYY" alternate so the chart survives either contract.
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function parseMonthKey(key: string): { label: string; sort: string } {
  // "Jul 2025"  → { label: "Jul 25", sort: "2025-07" }
  // "07-2025"   → same
  const m1 = /^([A-Za-z]{3})\s+(\d{4})$/.exec(key);
  if (m1) {
    const mIdx = MONTH_SHORT.findIndex((x) => x.toLowerCase() === m1[1].toLowerCase());
    const mm = (mIdx + 1).toString().padStart(2, "0");
    return { label: `${m1[1]} ${m1[2].slice(2)}`, sort: `${m1[2]}-${mm}` };
  }
  const m2 = /^(\d{1,2})[-\/](\d{4})$/.exec(key);
  if (m2) {
    const mIdx = Math.max(0, Math.min(11, parseInt(m2[1], 10) - 1));
    return { label: `${MONTH_SHORT[mIdx]} ${m2[2].slice(2)}`, sort: `${m2[2]}-${(mIdx+1).toString().padStart(2,"0")}` };
  }
  return { label: key, sort: key };
}

function ClubChip({ name, index }: { name: string; index: number }) {
  const color = CLUB_PALETTE[index % CLUB_PALETTE.length];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-white text-[11px] font-semibold leading-none whitespace-nowrap shadow-sm"
      style={{ backgroundColor: color }}
      title={name}
    >
      {name.length > 28 ? name.slice(0, 26) + "…" : name}
    </span>
  );
}

function FundingChip({ funding }: { funding: string }) {
  const f = (funding || "").toLowerCase();
  let cls = "bg-blue-50 text-blue-700 border-blue-200";
  if (f.includes("self"))                  cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
  else if (f.includes("global"))           cls = "bg-amber-50 text-amber-700 border-amber-200";
  else if (f.includes("district"))         cls = "bg-indigo-50 text-indigo-700 border-indigo-200";
  else if (f.includes("sponsor"))          cls = "bg-purple-50 text-purple-700 border-purple-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${cls} whitespace-nowrap`}>
      {funding || "–"}
    </span>
  );
}

function PendingCell() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
      Pending
    </span>
  );
}

/* ── Project detail popup ─────────────────────────────────────────── */
function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</div>
      <div className="text-sm text-slate-800 mt-0.5 break-words">{children}</div>
    </div>
  );
}

function ProjectDetailModal({
  row, yearId, districtId, onClose,
}: {
  row: AgProjectRow;
  yearId: number | null;
  districtId: number | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AgProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Esc closes the lightbox first, then the modal — a click-anywhere overlay alone
  // strands keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(null); else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, lightbox]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    getAgProjectDetail(row.projectId, row.yearId || yearId, districtId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.message || "Failed to load project details."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [row.projectId, row.yearId, yearId, districtId]);

  const dash = <span className="text-slate-300">, </span>;
  // Fall back to the list row while the detail loads, so the popup is never empty.
  const d = detail;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 sticky top-0 bg-white rounded-t-xl z-10">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800 leading-tight">{d?.title || row.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {d?.clubName || row.clubName}
              {d?.yearLabel ? ` · RY ${d.yearLabel}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 p-1 -m-1 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RotaryLoader size="lg" label="Loading project…" />
          </div>
        ) : err ? (
          <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
        ) : (
          <>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField label="Club">{d?.clubName || row.clubName || dash}</DetailField>
              <DetailField label="Date">{d?.date ? fmtDate(d.date) : row.date ? fmtDate(row.date) : dash}</DetailField>
              <DetailField label="Avenue of Service">{d?.avenue || row.avenue || dash}</DetailField>
              <DetailField label="Area of Focus">{d?.areaOfFocus || row.areaOfFocus || dash}</DetailField>
              <DetailField label="Location">{d?.location || dash}</DetailField>
              <DetailField label="Funding"><FundingChip funding={d?.funding || row.funding} /></DetailField>
              <DetailField label="Cost">
                {(d?.cost ?? row.cost) > 0 ? formatMoney(d?.cost ?? row.cost, d?.currency ?? row.currency) : dash}
              </DetailField>
              <DetailField label="Beneficiaries">
                {(d?.beneficiaries ?? row.beneficiaries) > 0 ? fmtInt(d?.beneficiaries ?? row.beneficiaries) : dash}
              </DetailField>
              <DetailField label="Man Hours">
                {d?.manHoursIsPending ?? isManHoursPending(row)
                  ? <PendingCell />
                  : (d?.manHours ?? row.manHours) > 0 ? fmtInt(d?.manHours ?? row.manHours) : dash}
              </DetailField>
              <DetailField label="Rotarians">{(d?.rotariansInvolved ?? 0) > 0 ? fmtInt(d!.rotariansInvolved) : dash}</DetailField>
              <DetailField label="Rotaractors">{(d?.rotaractorsInvolved ?? 0) > 0 ? fmtInt(d!.rotaractorsInvolved) : dash}</DetailField>
              <DetailField label="RCC">{(d?.rccInvolved ?? 0) > 0 ? fmtInt(d!.rccInvolved) : dash}</DetailField>
              <DetailField label="Project Type">{d?.projectType || dash}</DetailField>
              <DetailField label="Joint Project">
                {d?.isJointProject
                  ? `Yes${d.coHostName ? `: with ${d.coHostName}` : ""}${d.clubRole ? ` (${d.clubRole})` : ""}`
                  : "No"}
              </DetailField>
            </div>

            {d?.description && (
              <div className="px-5 pb-5">
                <DetailField label="Description">
                  <p className="whitespace-pre-wrap text-slate-700">{d.description}</p>
                </DetailField>
              </div>
            )}

            <div className="px-5 pb-5">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-2">
                Photos {d?.photos?.length ? `(${d.photos.length})` : ""}
              </div>
              {!d?.photos || d.photos.length === 0 ? (
                <p className="text-xs text-slate-400">No photos uploaded for this project.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {d.photos.map((ph, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setLightbox(getPhotoUrl(ph.url))}
                      className="group relative block rounded-lg overflow-hidden border border-slate-200 aspect-[4/3] bg-slate-50"
                      title={ph.description || "View photo"}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getPhotoUrl(ph.url)}
                        alt={ph.description || "Project photo"}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                        loading="lazy"
                      />
                      {ph.isPrimary && (
                        <span className="absolute top-1 left-1 text-[9px] font-bold uppercase bg-white/90 text-slate-700 rounded px-1 py-0.5">
                          Primary
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Full-size photo view */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Project photo" className="max-h-full max-w-full object-contain rounded-lg" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            aria-label="Close photo"
            className="absolute top-4 right-4 text-white/80 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function AgProjectsPage() {
  const { selectedDistrictId } = useAuth();
  const yearId = useAgYearId();
  const [data, setData] = useState<AgProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [avenue, setAvenue] = useState<string>("all");
  const [detailRow, setDetailRow] = useState<AgProjectRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAgDashboardProjects(yearId, null, selectedDistrictId)
      .then((d) => { if (!cancelled) { setData(d); setPage(1); } })
      .catch(() => { if (!cancelled) setError("Failed to load projects."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDistrictId, yearId]);

  // Wave 13A2 root-level Pending flag: backend supplies it per-row only, so we
  // derive a root flag as "every row reports manHoursIsPending" (and at least
  // one row exists). When that holds, the Man Hours KPI shows "Pending".
  const rootManHoursPending = useMemo(() => {
    if (!data || data.projects.length === 0) return false;
    return data.projects.every(isManHoursPending) || (data.totalManHours ?? 0) === 0;
  }, [data]);

  const clubBarData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.clubProjectCounts)
      .map(([name, count]) => ({ name, projects: count }))
      .sort((a, b) => b.projects - a.projects);
  }, [data]);

  const monthlyData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.monthlyProjectCounts)
      .map(([key, val]) => {
        const { label, sort } = parseMonthKey(key);
        return { month: label, sortKey: sort, projects: val };
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [data]);

  // Avenue options come from the data itself, so only avenues these clubs actually
  // have projects in are offered — no dead options.
  const avenueOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.projects.forEach((p) => { const a = (p.avenue ?? "").trim(); if (a) set.add(a); });
    return Array.from(set).sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.projects.filter((r) => {
      if (avenue !== "all") {
        if (avenue === "(none)") { if ((r.avenue ?? "").trim()) return false; }
        else if ((r.avenue ?? "").trim() !== avenue) return false;
      }
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.clubName.toLowerCase().includes(q) ||
        (r.avenue ?? "").toLowerCase().includes(q) ||
        (r.funding ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, avenue]);

  // Default sort: newest date first (matches the visual order in the reference screenshots).
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Keep page in range when search or the avenue filter shrinks the list.
  useEffect(() => { setPage(1); }, [search, avenue]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading projects…" />
      </div>
    );
  }
  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!data) return null;

  const clubsList = Array.from(new Set(data.projects.map((p) => p.clubName)));
  const peakMonthly = Math.max(0, ...monthlyData.map((d) => d.projects));
  const yearLabel = data.ag?.yearLabel || "–";
  const manHoursDisplay = rootManHoursPending ? "Pending" : fmtInt(data.totalManHours);

  return (
    <div className="space-y-6">
      {/* Sub-header removed — the topbar already names the page. */}

      {/* ───────── KPI tiles ───────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Projects"
          value={fmtInt(data.totalProjects)}
          subtitle={`Across ${clubsList.length} club${clubsList.length === 1 ? "" : "s"}`}
          icon={Briefcase}
          color="blue"
        />
        <KpiCard
          title="Total Beneficiaries"
          value={fmtInt(data.totalBeneficiaries)}
          subtitle="People directly served"
          icon={Users}
          color="green"
        />
        <KpiCard
          title="Total Man Hours"
          value={manHoursDisplay}
          subtitle={rootManHoursPending ? "Awaiting data column" : "Volunteer time logged"}
          icon={Clock}
          color="gold"
        />
        <KpiCard
          title={`Total Cost (${data.targetCurrency})`}
          value={formatMoney(data.totalCost, data.targetCurrency)}
          subtitle="Combined project spend"
          icon={IndianRupee}
          color="gold"
        />
      </div>

      {/* AG Group Impact Summary band removed — it repeated the KPI tiles above. */}

      {/* ───────── Two-up charts: Projects by Club + Monthly Trend ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Projects by Club</h3>
          <p className="text-[11px] text-slate-500 mb-3">Total projects executed per club</p>
          {clubBarData.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No projects yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, clubBarData.length * 50)}>
              <BarChart data={clubBarData} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf4fb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11, fill: "#4A5A70" }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="projects" radius={[0, 4, 4, 0]} barSize={22}>
                  {clubBarData.map((_, idx) => (
                    <Cell key={idx} fill={idx === 0 ? ROTARY_GOLD : ROTARY_BLUE} />
                  ))}
                  <LabelList dataKey="projects" position="right" style={{ fontSize: 11, fill: "#4A5A70", fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Monthly Projects Trend</h3>
          <p className="text-[11px] text-slate-500 mb-3">Project count by month (RY {yearLabel})</p>
          {monthlyData.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No monthly data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData} margin={{ top: 16, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf4fb" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="projects" radius={[4, 4, 0, 0]} barSize={28}>
                  {monthlyData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.projects === peakMonthly && peakMonthly > 0 ? ROTARY_GOLD : ROTARY_BLUE} />
                  ))}
                  <LabelList dataKey="projects" position="top" style={{ fontSize: 10, fill: "#4A5A70", fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ───────── All Projects table ───────── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">All Projects: Detailed View</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Showing {sortedRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
              –{Math.min(safePage * PAGE_SIZE, sortedRows.length)} of {sortedRows.length} project
              {sortedRows.length === 1 ? "" : "s"}
              {search || avenue !== "all" ? ` · filtered from ${data.projects.length}` : ""}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {/* Avenue of Service filter — options built from the rows on screen. */}
            <select
              value={avenue}
              onChange={(e) => setAvenue(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              aria-label="Filter by Avenue of Service"
            >
              <option value="all">All Avenues of Service</option>
              {avenueOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              <option value="(none)">(No avenue set)</option>
            </select>
            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search projects, clubs…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide border-b border-slate-200">
              <tr>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Club</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Date</th>
                <th className="px-3 py-3 text-left font-semibold">Title</th>
                <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Cost</th>
                <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Beneficiaries</th>
                <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Man Hours</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Funding</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, idx) => {
                const clubIdx = clubsList.indexOf(row.clubName);
                return (
                  <tr
                    key={`${row.clubId}-${idx}-${safePage}`}
                    onClick={() => setDetailRow(row)}
                    className="border-t border-slate-100 hover:bg-blue-50/50 cursor-pointer"
                    title="Click for full project details"
                  >
                    <td className="px-3 py-2.5">
                      <ClubChip name={row.clubName} index={clubIdx >= 0 ? clubIdx : idx} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap text-xs">
                      {fmtDate(row.date)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 font-medium max-w-[280px]">
                      <span title={row.title}>
                        {row.title.length > 56 ? row.title.slice(0, 54) + "…" : row.title}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-700 whitespace-nowrap tabular-nums">
                      {row.cost > 0 ? formatMoney(row.cost, row.currency) : <span className="text-slate-300">, </span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                      {row.beneficiaries > 0 ? fmtInt(row.beneficiaries) : <span className="text-slate-300">, </span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {isManHoursPending(row) ? (
                        <PendingCell />
                      ) : row.manHours > 0 ? (
                        <span className="text-slate-700">{fmtInt(row.manHours)}</span>
                      ) : (
                        <span className="text-slate-300">, </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <FundingChip funding={row.funding} />
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400 text-sm">
                    {search ? "No projects match your search." : "No projects yet."}
                  </td>
                </tr>
              )}
            </tbody>
            {pageRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800 text-xs">
                  <td className="px-3 py-3" colSpan={3}>
                    Page totals ({pageRows.length} project{pageRows.length === 1 ? "" : "s"})
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatMoney(pageRows.reduce((s, r) => s + (r.cost || 0), 0), data.targetCurrency)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {fmtInt(pageRows.reduce((s, r) => s + (r.beneficiaries || 0), 0))}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {pageRows.every(isManHoursPending)
                      ? <PendingCell />
                      : fmtInt(pageRows.reduce((s, r) => s + (isManHoursPending(r) ? 0 : r.manHours || 0), 0))}
                  </td>
                  <td className="px-3 py-3 text-slate-400">, </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Pagination */}
        {sortedRows.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              Page {safePage} of {totalPages} · {PAGE_SIZE} per page
            </p>
            <div className="inline-flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .reduce<(number | "…")[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === "…" ? (
                    <span key={`e${i}`} className="px-1.5 text-slate-400 text-xs">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`min-w-[32px] px-2 py-1.5 text-xs font-medium rounded-md border ${
                        p === safePage
                          ? "bg-blue-600 text-white border-blue-600"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {detailRow && (
        <ProjectDetailModal
          row={detailRow}
          yearId={yearId}
          districtId={selectedDistrictId}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}
