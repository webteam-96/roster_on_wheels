"use client";

/**
 * Club Admin Dashboard › Payment Links tab
 * --------------------------------------------------------------------------
 * Mirror of the membership-dues dashboard look & feel, but scoped to
 * Event Payment Links only (moved out of the membership-dues page so each
 * area has its own home).
 *
 * - KPI tiles: Total Links / Active Links / Paid / Unpaid (aggregated counts)
 * - Table styled to match the v2 event-payment-links listing
 * - NO Add button (Club Admin restriction — edit-only)
 * - NO Delete button
 * - Manage in full editor → /clubs/[id]/event-payment-links/v2/edit?editId=…
 * - View Members         → /clubs/[id]/event-payment-links/v2/[linkId]/members
 *
 * Data: existing getEventPaymentLinks API ({ clubId }). No new backend surface.
 * The clubId is resolved via ClubAdminDashboardCache (same source as MD page).
 */

import { LinkButton } from "@/components/ui/text-buttons"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Receipt, Link2, BadgeCheck, CheckCircle2, XCircle,
  Search, ExternalLink, Copy, Edit3, Users, FileBarChart,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { getEventPaymentLinks } from "@/services/api";
import SectionHeader from "@/components/dashboard/SectionHeader";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYearless, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";

import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
import { withBase, BASE_PATH } from "@/lib/basePath";
interface EventPaymentLinkRow {
  id: number;
  formType: number;
  title?: string;
  registrationCount: number;
  paidCount: number;
  unpaidCount: number;
  isActive: boolean;
  createdDate: string;
  googleSheetId?: string;
}

export default function ClubAdminPaymentLinksPage() {
  const router = useRouter();
  const { membershipDues, status, refresh } = useClubAdminCache();
  const clubId = membershipDues?.club.clubId ?? null;

  // A payment link carries NO Rotary year — it is live and taking money now — so
  // editing one needs CURRENT-year rights, the same rule the server applies.
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const { years, currentYearId } = useRotaryYears();
  const linkRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId ?? 0), [user?.scopedRoles, clubId]);
  const canManage = (isSuperAdmin || isAdmin) && canEditYearless(linkRights, currentYearId, isSuperAdmin);
  const editableYears = heldYearLabels(linkRights, years.map((y) => ({ id: y.id, label: y.yearLabel })));

  const [items, setItems] = useState<EventPaymentLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const returnTo = encodeURIComponent("/club-admin-dashboard/payment-links");

  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;
    setLoading(true);
    getEventPaymentLinks({ clubId })
      .then((res) => {
        if (cancelled) return;
        setItems(Array.isArray(res) ? (res as EventPaymentLinkRow[]) : []);
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMessage("Failed to load payment links.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clubId]);

  const filtered = useMemo<EventPaymentLinkRow[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => (i.title || "").toLowerCase().includes(q));
  }, [items, search]);

  // KPI aggregates
  const totalLinks   = items.length;
  const activeLinks  = items.filter((i) => i.isActive).length;
  const totalPaid    = items.reduce((sum, i) => sum + (i.paidCount || 0), 0);
  const totalUnpaid  = items.reduce((sum, i) => sum + (i.unpaidCount || 0), 0);

  const copyToClipboard = (text: string, label: string) => {
    try {
      navigator.clipboard.writeText(text);
      setSuccessMessage(`${label} copied to clipboard.`);
    } catch {
      setErrorMessage("Failed to copy.");
    }
  };

  // ── Loading / fallback states ─────────────────────────────────────────
  if (status === "loading" && !membershipDues) {
    return (
      <div className="flex items-center justify-center py-20">
        <ListPageSkeleton />
      </div>
    );
  }
  if (!clubId) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to resolve club context.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert  open={!!errorMessage}   title="Error"   description={errorMessage   || ""} onOk={() => setErrorMessage(null)} />

      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SectionHeader
          title="Payment Links Module"
          subtitle="Online event registrations, payment links and tracking"
          icon={Receipt}
        />
        <div className="flex flex-wrap items-center gap-2">
          {membershipDues?.club.yearLabel && (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
              RY {membershipDues.club.yearLabel}
            </span>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Links"
          value={fmtInt(totalLinks)}
          subtitle="All payment links configured"
          icon={Link2}
          color="blue"
        />
        <KpiCard
          title="Active Links"
          value={fmtInt(activeLinks)}
          subtitle="Currently enabled"
          icon={BadgeCheck}
          color="green"
        />
        <KpiCard
          title="Paid"
          value={fmtInt(totalPaid)}
          subtitle="Across all links"
          icon={CheckCircle2}
          color="gold"
        />
        <KpiCard
          title="Unpaid"
          value={fmtInt(totalUnpaid)}
          subtitle="Pending registrations"
          icon={XCircle}
          color="red"
        />
      </div>

      {/* Search bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="relative w-full sm:w-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 w-64"
          />
        </div>
      </div>

      {/* Payment links table */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="row-h3">Online Event &amp; Payment Links</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {loading
                ? "Loading…"
                : `Showing ${filtered.length} of ${items.length} link${items.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <LinkButton size="sm"
            type="button"
            onClick={() => router.push(`/clubs/${clubId}/event-payment-links/v2?returnTo=${returnTo}`)}
          >
            Manage in full editor <ExternalLink size={11} />
          </LinkButton>
        </div>

        <div className="overflow-x-auto">
          <Table className="w-full min-w-[640px] md:min-w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 text-left">Title</TableHead>
                <TableHead className="px-4 text-left">Type</TableHead>
                <TableHead className="px-4 text-center">Paid</TableHead>
                <TableHead className="px-4 text-center">Unpaid</TableHead>
                <TableHead className="px-4 text-center">Status</TableHead>
                <TableHead className="px-4 text-left">Created</TableHead>
                <TableHead className="px-4 text-center">Report</TableHead>
                <TableHead className="px-4 text-center">Google Sheet</TableHead>
                <TableHead className="px-4 text-center w-28">Members</TableHead>
                <TableHead className="px-4 text-center w-16">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="px-4 py-10 text-center">
                    <span className="inline-flex items-center justify-center">
                      <RotaryLoader size="md" label="Loading payment links…" />
                    </span>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="px-4 py-10 text-center text-slate-400">
                    {search ? "No links match your search." : "No payment links configured yet."}
                  </TableCell>
                </TableRow>
              ) : filtered.map((item) => {
                const reportUrl = typeof window !== "undefined"
                  ? `${window.location.origin}${BASE_PATH}/report/${item.id}`
                  : `/report/${item.id}`;
                const sheetUrl = item.googleSheetId
                  ? `https://docs.google.com/spreadsheets/d/${item.googleSheetId}`
                  : null;
                return (
                  <TableRow key={item.id} className="hover:bg-blue-50/40">
                    <TableCell className="px-4 py-2.5 font-medium text-slate-800 max-w-[220px] truncate">
                      {item.title || "Untitled"}
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border bg-slate-50 text-slate-700 border-slate-200">
                        {item.formType === 1 ? "Standard" : "Dynamic"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 tabular-nums">
                        {item.paidCount}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 tabular-nums">
                        {item.unpaidCount}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                        item.isActive
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}>
                        {item.isActive ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(item.createdDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" })}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
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
                          onClick={() => copyToClipboard(reportUrl, "Report link")}
                          aria-label="Copy report link"
                        >
                          <Copy size={12} /> Copy
                        </LinkButton>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
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
                            onClick={() => copyToClipboard(sheetUrl, "Google Sheet URL")}
                            aria-label="Copy Google Sheet URL"
                          >
                            <Copy size={12} /> Copy URL
                          </LinkButton>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">–</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
                      <Button
                        type="button"
                        onClick={() => router.push(`/clubs/${clubId}/event-payment-links/v2/${item.id}/members?returnTo=${returnTo}`)}
                        variant="outline" size="sm"
                        aria-label="View members"
                      >
                        <Users size={12} /> Members
                      </Button>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
                      {canManage ? (
                        <IconButton
                          type="button"
                          onClick={() => router.push(`/clubs/${clubId}/event-payment-links/v2/edit?editId=${item.id}&returnTo=${returnTo}`)}
                          aria-label="Edit payment link"
                          title="Manage in full editor"
                        >
                          <Edit3 size={13} />
                        </IconButton>
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          {filtered.length} record{filtered.length === 1 ? "" : "s"}
        </div>
      </Card>

      {/* Refresh hint */}
      {status === "partial" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 flex items-center justify-between">
          <span>Some dashboard data failed to load.</span>
          <LinkButton onClick={() => refresh()}>Retry</LinkButton>
        </div>
      )}
    </div>
  );
}
