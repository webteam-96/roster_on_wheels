"use client";

/**
 * Event Payment Links v2 listing — modernised, dashboard-style layout.
 *
 * Mirrors the Club Admin Dashboard visual language (KPI tiles, dense table,
 * per-row edit pencil). Data still flows through the v1 API surface
 * (getEventPaymentLinks) so no backend changes are required.
 *
 * Per V2 contract: NO Add button (admin can only edit existing links) and
 * NO Delete button (view + edit only). All chrome wrapped in ClubAdminShell.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  Loader2, Search, Edit3, Users, ExternalLink, Copy, FileBarChart,
  Link2, CheckCircle2, XCircle, BadgeCheck,
} from "@/components/icons";
import { getEventPaymentLinks } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import LoadingLink from "@/components/v2/LoadingLink";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { SkeletonRows } from "@/components/row/AppKit";

interface PaymentLink {
  id: number;
  formType: number;
  districtNumber?: string;
  clubName?: string;
  title?: string;
  registrationCount: number;
  paidCount: number;
  unpaidCount: number;
  isActive: boolean;
  createdDate: string;
  createdByName?: string;
  googleSheetId?: string;
}

export default function EventPaymentLinksV2ListingPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [items, setItems] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → members/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/event-payment-links/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getEventPaymentLinks({ clubId, search: search || undefined });
      setItems(data);
    } catch {
      setErrorMessage("Failed to load payment links");
    } finally {
      setLoading(false);
    }
  }, [clubId, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo<PaymentLink[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => (i.title || "").toLowerCase().includes(q));
  }, [items, search]);

  // KPI aggregates
  const totalLinks = items.length;
  const activeLinks = items.filter((i) => i.isActive).length;
  const totalPaid = items.reduce((sum, i) => sum + (i.paidCount || 0), 0);
  const totalUnpaid = items.reduce((sum, i) => sum + (i.unpaidCount || 0), 0);

  const handleCopy = (text: string, label: string) => {
    try {
      navigator.clipboard.writeText(text);
      setSuccessMessage(`${label} copied to clipboard.`);
    } catch {
      setErrorMessage("Failed to copy.");
    }
  };

  if (!canManage) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Event Payment Links"
          pageSubtitle="Manage event payment configuration"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex flex-col items-center justify-center py-20">
            <h3 className="text-lg font-semibold text-slate-800">Access Denied</h3>
            <p className="text-xs text-slate-500 mt-1">You do not have permission to view this page.</p>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Event Payment Links"
        pageSubtitle="Manage event payment configuration"
        activeNavHref="/club-admin-dashboard/membership-dues"
      >
        <div className="space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Links"   value={fmtInt(totalLinks)}   subtitle="All payment links"   icon={Link2}        color="blue" />
            <KpiCard title="Active Links"  value={fmtInt(activeLinks)}  subtitle="Currently enabled"   icon={BadgeCheck}   color="green" />
            <KpiCard title="Paid"          value={fmtInt(totalPaid)}    subtitle="Across all links"    icon={CheckCircle2} color="gold" />
            <KpiCard title="Unpaid"        value={fmtInt(totalUnpaid)}  subtitle="Pending registrations" icon={XCircle}    color="purple" />
          </div>

          {/* Table card */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Payment Link Records</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Edit configuration, view paid / unpaid members, copy report links
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-auto">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search title…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-56 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                {/* NO Add button on V2 — admin only edits existing links. */}
              </div>
            </div>

            {loading ? (
              <SkeletonRows />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] md:min-w-full text-sm">
                  <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Title</th>
                      <th className="px-3 py-2.5 text-left">Type</th>
                      <th className="px-3 py-2.5 text-center">Paid</th>
                      <th className="px-3 py-2.5 text-center">Unpaid</th>
                      <th className="px-3 py-2.5 text-left">Status</th>
                      <th className="px-3 py-2.5 text-left">Created</th>
                      <th className="px-3 py-2.5 text-center">Report</th>
                      <th className="px-3 py-2.5 text-center">Google Sheet</th>
                      <th className="px-3 py-2.5 text-center w-24">Members</th>
                      <th className="px-3 py-2.5 text-center w-16">Edit</th>
                      {/* NO Delete column on V2 — view + edit only. */}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                          {search ? "No links match your search." : "No payment links found."}
                        </td>
                      </tr>
                    ) : filtered.map((item) => {
                      const reportUrl = typeof window !== "undefined"
                        ? `${window.location.origin}/report/${item.id}`
                        : `/report/${item.id}`;
                      const sheetUrl = item.googleSheetId
                        ? `https://docs.google.com/spreadsheets/d/${item.googleSheetId}`
                        : null;
                      return (
                        <tr key={item.id} className="hover:bg-blue-50/40">
                          <td className="px-3 py-2 font-medium text-slate-800 max-w-[220px] truncate">
                            {item.title || "Untitled"}
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                              {item.formType === 1 ? "Standard" : "Dynamic"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 tabular-nums">
                              {item.paidCount}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 tabular-nums">
                              {item.unpaidCount}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
                                item.isActive
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-slate-50 text-slate-600 border-slate-200"
                              }`}
                            >
                              {item.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                            {new Date(item.createdDate).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => window.open(`/report/${item.id}`, "_blank")}
                                className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                aria-label="Open report"
                              >
                                <FileBarChart size={12} /> View
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => handleCopy(reportUrl, "Report link")}
                                className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                aria-label="Copy report link"
                              >
                                <Copy size={12} /> Copy
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {sheetUrl ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => window.open(sheetUrl, "_blank")}
                                  className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                  aria-label="Open Google Sheet"
                                >
                                  <ExternalLink size={12} /> Open
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(sheetUrl, "Google Sheet URL")}
                                  className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                  aria-label="Copy Google Sheet URL"
                                >
                                  <Copy size={12} /> Copy URL
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300">, </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <LoadingLink
                              href={`/clubs/${clubId}/event-payment-links/v2/${item.id}/members?returnTo=${returnTo}`}
                              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                              aria-label="View members"
                            >
                              <Users size={12} /> Members
                            </LoadingLink>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <LoadingLink
                              href={`/clubs/${clubId}/event-payment-links/v2/edit?editId=${item.id}&returnTo=${returnTo}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit payment link"
                            >
                              <Edit3 size={13} />
                            </LoadingLink>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
              {filtered.length} record{filtered.length === 1 ? "" : "s"}
            </div>
          </div>

          <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
