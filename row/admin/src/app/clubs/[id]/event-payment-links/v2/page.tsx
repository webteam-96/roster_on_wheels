"use client";
import { DataTable } from "@/components/ui/data-table";
import { LinkButton } from "@/components/ui/text-buttons";

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

import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
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
import { withBase, BASE_PATH } from "@/lib/basePath";

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
            <h3 className="row-h2">Access Denied</h3>
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
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="row-h3">Payment Link Records</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Edit configuration, view paid / unpaid members, copy report links
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-auto">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="Search title…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-7 pr-3 sm:w-56"
                  />
                </div>
                {/* NO Add button on V2 — admin only edits existing links. */}
              </div>
            </div>

            {loading ? (
              <SkeletonRows />
            ) : (
              <div className="overflow-x-auto">
                <DataTable
                  caption="Payment links"
                  card={false}
                  className="[&_table]:min-w-[640px] md:[&_table]:min-w-full"
                  rows={filtered}
                  rowKey={(item) => item.id}
                  empty={search ? "No links match your search." : "No payment links found."}
                  columns={[
{ key: "title", header: "Title", className: "font-medium max-w-[220px] truncate", cell: (item, _i) => (<>
                            {item.title || "Untitled"}
</>) },
{ key: "type", header: "Type", cell: (item, _i) => (<>
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border bg-slate-50 text-slate-700 border-slate-200">
                              {item.formType === 1 ? "Standard" : "Dynamic"}
                            </span>
</>) },
{ key: "paid", header: "Paid", align: "center", cell: (item, _i) => (<>
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 tabular-nums">
                              {item.paidCount}
                            </span>
</>) },
{ key: "unpaid", header: "Unpaid", align: "center", cell: (item, _i) => (<>
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 tabular-nums">
                              {item.unpaidCount}
                            </span>
</>) },
{ key: "status", header: "Status", cell: (item, _i) => (<>
                            <span
                              className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${
                                item.isActive
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-slate-50 text-slate-600 border-slate-200"
                              }`}
                            >
                              {item.isActive ? "Active" : "Inactive"}
                            </span>
</>) },
{ key: "created", header: "Created", className: "text-xs whitespace-nowrap", cell: (item, _i) => (<>
                            {new Date(item.createdDate).toLocaleDateString()}
</>) },
{ key: "report", header: "Report", align: "center", cell: (item, _i) => {
                      const reportUrl = typeof window !== "undefined"
                        ? `${window.location.origin}${BASE_PATH}/report/${item.id}`
                        : `/report/${item.id}`;
return (<>
                            <div className="flex items-center justify-center gap-1.5">
                              <LinkButton size="sm"
                                type="button"
                                onClick={() => window.open(withBase(`/report/${item.id}`), "_blank")}

                                aria-label="Open report"
                              >
                                <FileBarChart size={12} /> View
                              </LinkButton>
                              <span className="text-slate-300">|</span>
                              <LinkButton size="sm"
                                type="button"
                                onClick={() => handleCopy(reportUrl, "Report link")}

                                aria-label="Copy report link"
                              >
                                <Copy size={12} /> Copy
                              </LinkButton>
                            </div>
</>);
} },
{ key: "sheet", header: "Google Sheet", align: "center", cell: (item, _i) => {
                      const sheetUrl = item.googleSheetId
                        ? `https://docs.google.com/spreadsheets/d/${item.googleSheetId}`
                        : null;
return (<>
                            {sheetUrl ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <LinkButton size="sm"
                                  type="button"
                                  onClick={() => window.open(sheetUrl, "_blank")}

                                  aria-label="Open Google Sheet"
                                >
                                  <ExternalLink size={12} /> Open
                                </LinkButton>
                                <LinkButton size="sm"
                                  type="button"
                                  onClick={() => handleCopy(sheetUrl, "Google Sheet URL")}

                                  aria-label="Copy Google Sheet URL"
                                >
                                  <Copy size={12} /> Copy URL
                                </LinkButton>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300">–</span>
                            )}
</>);
} },
{ key: "members", header: "Members", align: "center", className: "w-24", cell: (item, _i) => (<>
                            <LoadingLink
                              href={`/clubs/${clubId}/event-payment-links/v2/${item.id}/members?returnTo=${returnTo}`}
                              className="row-btn row-btn-secondary row-btn-sm"
                              aria-label="View members"
                            >
                              <Users size={12} /> Members
                            </LoadingLink>
</>) },
{ key: "edit", header: "Edit", align: "center", className: "w-16", cell: (item, _i) => (<>
                            <LoadingLink
                              href={`/clubs/${clubId}/event-payment-links/v2/edit?editId=${item.id}&returnTo=${returnTo}`}
                              className="row-icon-btn"
                              aria-label="Edit payment link"
                            >
                              <Edit3 size={13} />
                            </LoadingLink>
</>) },
                  ]}
                />
              </div>
            )}

            <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
              {filtered.length} record{filtered.length === 1 ? "" : "s"}
            </div>
          </Card>

          <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
