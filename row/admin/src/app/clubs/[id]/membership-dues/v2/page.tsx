"use client";

/**
 * Club Dues v2 listing — Club Admin facing.
 *
 * V1 logic preserved verbatim — same API calls, same year filter, same
 * search, same per-row actions. Only the visual presentation changes
 * (ClubAdminShell chrome, KPI tiles, dense slate table).
 *
 * Per Club Admin permission rule (memory: "Club Admin can only view/edit,
 * not create/delete modules created by SuperAdmin") the listing has:
 *   - NO Add button
 *   - NO Delete action
 * Edit, View, Copy URL, Report download, Report Link, Members and
 * Google Sheet links are all preserved.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Pencil, FileSpreadsheet, Users, Search,
  Wallet, CheckCircle2, AlertCircle, ExternalLink, Copy, X,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  getMembershipDuesList, exportMembershipDuesReport, getClub,
} from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

interface MembershipDuesItem {
  id: number;
  districtNumber?: string;
  clubName?: string;
  rotaryYear?: string;
  purpose?: string;
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  isActive: boolean;
  weblinkUrl?: string;
  googleSheetId?: string;
  createdDate: string;
}

export default function ClubMembershipDuesV2Page() {
  useSyncClubIdFromUrl();
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);

  const [items, setItems] = useState<MembershipDuesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [clubName, setClubName] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → edit/members → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/membership-dues/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  useEffect(() => {
    getClub(clubId).then((c) => setClubName(c.clubName || "")).catch(() => {});
  }, [clubId]);

  // Note: year filter is NOT sent to API — applied client-side only, so the
  // year dropdown keeps all available years after selection.
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMembershipDuesList({
        clubId,
        search: search || undefined,
      });
      setItems(data);
    } catch {
      setErrorMessage("Failed to load club dues");
    } finally {
      setLoading(false);
    }
  }, [clubId, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounce search input → committed search (400ms after last keystroke).
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const handleCopyUrl = (item: MembershipDuesItem) => {
    const url = `${window.location.origin}/pay/dues/${item.id}`;
    navigator.clipboard.writeText(url);
    setSuccessMessage("URL copied to clipboard.");
  };

  const handleCopyReportLink = (item: MembershipDuesItem) => {
    const url = `${window.location.origin}/report/dues/${item.id}`;
    navigator.clipboard.writeText(url);
    setSuccessMessage("Report link copied.");
  };

  const handleDownloadReport = async (item: MembershipDuesItem) => {
    try {
      const blob = await exportMembershipDuesReport(item.id);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `membership-dues-${item.id}_${fileTimestamp()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setErrorMessage("Failed to download report.");
    }
  };

  // Filter items locally too (V1 parity: search box filters both server + client)
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((i) => {
      const matchesSearch = !q ||
        (i.purpose || "").toLowerCase().includes(q) ||
        (i.districtNumber || "").toLowerCase().includes(q) ||
        (i.clubName || "").toLowerCase().includes(q);
      const matchesYear = !yearFilter || i.rotaryYear === yearFilter;
      return matchesSearch && matchesYear;
    });
  }, [items, search, yearFilter]);

  // Year dropdown — data-only (memory: never pad with rotary_year_master)
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    items.forEach((i) => { if (i.rotaryYear) years.add(i.rotaryYear); });
    return Array.from(years).sort().reverse();
  }, [items]);

  // KPI aggregates across all items (not filtered — total picture)
  const kpiTotalRecords = items.length;
  const kpiPaid = items.reduce((sum, i) => sum + (i.paidCount || 0), 0);
  const kpiUnpaid = items.reduce((sum, i) => sum + (i.unpaidCount || 0), 0);
  const kpiMembers = items.reduce((sum, i) => sum + (i.memberCount || 0), 0);

  if (!isSuperAdmin && !isAdmin) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Club Dues"
          pageSubtitle="Manage member dues and reminders"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex flex-col items-center justify-center py-20">
            <h3 className="text-lg font-semibold text-slate-700">Access Denied</h3>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Dues"
        pageSubtitle="Manage member dues and reminders"
        activeNavHref="/club-admin-dashboard/membership-dues"
      >
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Link
                href={`/clubs/${clubId}/dashboard`}
                className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Back"
              >
                <ArrowLeft size={15} />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-slate-800">Club Dues</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {clubName || "–"} · View &amp; manage member dues collection
                </p>
              </div>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Dues Records" value={fmtInt(kpiTotalRecords)} subtitle="Active dues" icon={Wallet}        color="blue" />
            <KpiCard title="Paid Members"       value={fmtInt(kpiPaid)}         subtitle="Across all years" icon={CheckCircle2} color="green" />
            <KpiCard title="Unpaid Members"     value={fmtInt(kpiUnpaid)}       subtitle="Pending collection" icon={AlertCircle}  color="red" />
            <KpiCard title="Total Members"      value={fmtInt(kpiMembers)}      subtitle="On rolls" icon={Users}        color="purple" />
          </div>

          {/* Empty state (no dues at all) */}
          {!loading && items.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 flex flex-col items-center justify-center space-y-5">
              <div className="text-center max-w-lg space-y-3">
                <h3 className="text-xl font-bold text-slate-800">
                  Collect 100% of Your Club Dues Without a Single Follow-up Call
                </h3>
                <p className="text-sm text-slate-500">
                  Club dues collection has not been set up for this club yet. Click below
                  to learn more about our automated dues collection system.
                </p>
              </div>
              <button
                type="button"
                onClick={() => window.open("https://club.example.org/", "_blank")}
                className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
              >
                Learn More
              </button>
            </div>
          )}

          {/* Table card */}
          {(loading || items.length > 0) && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Dues Records</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Manage dues per Rotary year · {filtered.length} record{filtered.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  >
                    <option value="">All Years</option>
                    {availableYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <div className="relative w-full sm:w-auto">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search title or year…"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="pl-7 pr-7 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-56 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                    />
                    {searchInput && (
                      <button
                        type="button"
                        onClick={() => setSearchInput("")}
                        aria-label="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  {/*
                    NO Add button: Club Admin can only view/edit dues records,
                    not create them — those are seeded by SuperAdmin.
                  */}
                </div>
              </div>

              <div className="overflow-x-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <RotaryLoader size="md" label="Loading dues records…" />
                  </div>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                      <tr>
                        <th className="px-3 py-2.5 text-left w-10">Sr</th>
                        <th className="px-3 py-2.5 text-left">Year</th>
                        <th className="px-3 py-2.5 text-left">Title</th>
                        <th className="px-3 py-2.5 text-center">Paid</th>
                        <th className="px-3 py-2.5 text-center">Unpaid</th>
                        <th className="px-3 py-2.5 text-center">Members</th>
                        <th className="px-3 py-2.5 text-center">Edit</th>
                        <th className="px-3 py-2.5 text-center">Payment Page</th>
                        <th className="px-3 py-2.5 text-center">Report</th>
                        <th className="px-3 py-2.5 text-center">Report Link</th>
                        <th className="px-3 py-2.5 text-center">Google Sheet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                            No club dues match your filters.
                          </td>
                        </tr>
                      ) : filtered.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-blue-50/40">
                          <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{item.rotaryYear || "–"}</td>
                          <td className="px-3 py-2 font-medium text-slate-800">{item.purpose || "–"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {fmtInt(item.paidCount)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                              {fmtInt(item.unpaidCount)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                router.push(`/clubs/${clubId}/membership-dues/v2/${item.id}/members?returnTo=${returnTo}`)
                              }
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
                              aria-label="View members"
                              title="View members"
                            >
                              <Users size={14} />
                            </button>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                router.push(`/clubs/${clubId}/membership-dues/v2/edit/${item.id}?returnTo=${returnTo}`)
                              }
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
                              aria-label="Edit dues record"
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="inline-flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => window.open(`/pay/dues/${item.id}`, "_blank")}
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                                title="Open payment page"
                              >
                                <ExternalLink size={12} /> View
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => handleCopyUrl(item)}
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                                title="Copy payment page URL"
                              >
                                <Copy size={12} /> Copy
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDownloadReport(item)}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50 hover:border-rose-200"
                              aria-label="Download CSV report"
                              title="Download CSV"
                            >
                              <FileSpreadsheet size={14} />
                            </button>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleCopyReportLink(item)}
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                              title="Copy report URL"
                            >
                              <Copy size={12} /> Copy URL
                            </button>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {item.googleSheetId ? (
                              <div className="inline-flex flex-col items-center gap-0.5 text-xs">
                                <button
                                  type="button"
                                  onClick={() =>
                                    window.open(
                                      `https://docs.google.com/spreadsheets/d/${item.googleSheetId}`,
                                      "_blank"
                                    )
                                  }
                                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                                  title="Open Google Sheet"
                                >
                                  <ExternalLink size={12} /> Open
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      `https://docs.google.com/spreadsheets/d/${item.googleSheetId}`
                                    );
                                    setSuccessMessage("Google Sheet URL copied.");
                                  }}
                                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                                  title="Copy Google Sheet URL"
                                >
                                  <Copy size={12} /> Copy URL
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-300">, </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
                {filtered.length} record{filtered.length === 1 ? "" : "s"}
              </div>
            </div>
          )}

          <SuccessAlert
            open={!!successMessage}
            title="Success"
            description={successMessage || ""}
            onOk={() => setSuccessMessage(null)}
          />
          <ErrorAlert
            open={!!errorMessage}
            title="Error"
            description={errorMessage || ""}
            onOk={() => setErrorMessage(null)}
          />
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
