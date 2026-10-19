"use client";

/**
 * Event Payment Links v2 — Members page (paid / unpaid tabs).
 *
 * Cloned from v1 src/app/clubs/[id]/event-payment-links/[linkId]/members/page.tsx
 * with identical data flow (getEventMembers, sendEventReceipt, reminders, bulk,
 * export). Visuals re-skinned to the dashboard look (ClubAdminShell, KPI tiles,
 * shadcn Tabs, slate-bordered card).
 *
 * v2 reads `?returnTo=` for the back button.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Download, Mail, Receipt, CreditCard,
  Loader2, Search, Users, CheckCircle2, XCircle, IndianRupee,
} from "@/components/icons";
import { getEventMembers, sendEventReceipt, sendEventReminderEmail, bulkReminderEmail, exportEventMembers } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import LoadingButton from "@/components/v2/LoadingButton";
import LoadingLink from "@/components/v2/LoadingLink";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtInr } from "@/components/dashboard/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { currencySymbol } from "@/lib/appFormat";
interface EventMember {
  id: number;
  memberName?: string;
  mobile?: string;
  email?: string;
  registrationType?: string;
  amount?: number;
  isPaid: boolean;
  isOnline: boolean;
  paymentDate?: string;
  transactionId?: string;
  offlineTransactionType?: string;
  districtNumber?: string;
  clubName?: string;
}

export default function EventMembersV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const linkId = Number(params.linkId);
  const returnTo = searchParams.get("returnTo") || "";

  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const listingHref = `/clubs/${clubId}/event-payment-links/v2`;
  const backHref = returnTo || listingHref;

  // returnTo for outbound links from this page (offline payment route)
  const outboundReturnTo = typeof window !== "undefined"
    ? encodeURIComponent(window.location.pathname + window.location.search)
    : encodeURIComponent(`/clubs/${clubId}/event-payment-links/v2/${linkId}/members`);

  const [activeTab, setActiveTab] = useState("paid");
  const [paidMembers, setPaidMembers] = useState<EventMember[]>([]);
  const [unpaidMembers, setUnpaidMembers] = useState<EventMember[]>([]);
  const [paidLoading, setPaidLoading] = useState(true);
  const [unpaidLoading, setUnpaidLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);

  const fetchPaid = useCallback(async () => {
    try {
      setPaidLoading(true);
      setPaidMembers(await getEventMembers(linkId, true, search || undefined));
    } catch {
      setErrorMessage("Failed to load paid members");
    } finally {
      setPaidLoading(false);
    }
  }, [linkId, search]);

  const fetchUnpaid = useCallback(async () => {
    try {
      setUnpaidLoading(true);
      setUnpaidMembers(await getEventMembers(linkId, false, search || undefined));
    } catch {
      setErrorMessage("Failed to load unpaid members");
    } finally {
      setUnpaidLoading(false);
    }
  }, [linkId, search]);

  // Always fetch both lists so the KPI tiles + tab counts are accurate without
  // having to click each tab (mirrors v1, which also derives counts from the
  // currently-fetched array but only fetched the active tab — V2 is stricter).
  useEffect(() => { fetchPaid(); }, [fetchPaid]);
  useEffect(() => { fetchUnpaid(); }, [fetchUnpaid]);

  const handleExport = async () => {
    try {
      const blob = await exportEventMembers(linkId, activeTab === "paid");
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `event_members_${activeTab}_${linkId}_${fileTimestamp()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setErrorMessage("Failed to export.");
    }
  };

  // KPI aggregates
  const totalPaid = paidMembers.length;
  const totalUnpaid = unpaidMembers.length;
  const totalRegistrations = totalPaid + totalUnpaid;
  const totalRevenue = useMemo(
    () => paidMembers.reduce((sum, m) => sum + (m.amount || 0), 0),
    [paidMembers],
  );

  if (!canManage) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Event Members"
          pageSubtitle="Paid and unpaid registrations"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex flex-col items-center justify-center py-20">
            <h3 className="text-lg font-semibold text-slate-800">Access Denied</h3>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  const renderTable = (members: EventMember[], loading: boolean, isPaidTab: boolean) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="animate-spin mr-2" size={16} /> Loading members…
        </div>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Name</th>
              <th className="px-3 py-2.5 text-left">Mobile</th>
              <th className="px-3 py-2.5 text-left">Email</th>
              <th className="px-3 py-2.5 text-left">Registration</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              {isPaidTab && <th className="px-3 py-2.5 text-left">Payment Date</th>}
              {isPaidTab && <th className="px-3 py-2.5 text-left">Transaction</th>}
              <th className="px-3 py-2.5 text-right w-48">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.length === 0 ? (
              <tr>
                <td colSpan={isPaidTab ? 8 : 6} className="px-4 py-10 text-center text-slate-400">
                  No members found.
                </td>
              </tr>
            ) : members.map((m) => (
              <tr key={m.id} className="hover:bg-blue-50/40">
                <td className="px-3 py-2 font-medium text-slate-800">{m.memberName || "–"}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{m.mobile || "–"}</td>
                <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate">{m.email || "–"}</td>
                <td className="px-3 py-2 text-slate-700">{m.registrationType || "–"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {m.amount ? `${currencySymbol()}${m.amount.toFixed(2)}` : "–"}
                </td>
                {isPaidTab && (
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {m.paymentDate ? new Date(m.paymentDate).toLocaleDateString() : "–"}
                  </td>
                )}
                {isPaidTab && (
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
                        m.isOnline
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {m.isOnline ? (m.transactionId || "Online") : (m.offlineTransactionType || "Offline")}
                    </span>
                  </td>
                )}
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1 flex-wrap">
                    {isPaidTab ? (
                      <LoadingButton
                        onAction={async () => {
                          try {
                            await sendEventReceipt(m.id);
                            setSuccessMessage("Receipt sent.");
                          } catch {
                            setErrorMessage("Failed to send receipt.");
                          }
                        }}
                        loadingLabel="Sending…"
                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Receipt size={12} /> Send Receipt
                      </LoadingButton>
                    ) : (
                      <>
                        <LoadingLink
                          href={`/clubs/${clubId}/event-payment-links/${linkId}/members/${m.id}/offline-payment?returnTo=${outboundReturnTo}`}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                        >
                          <CreditCard size={12} /> Offline
                        </LoadingLink>
                        <LoadingButton
                          onAction={async () => {
                            try {
                              await sendEventReminderEmail(m.id);
                              setSuccessMessage("Email reminder sent.");
                            } catch {
                              setErrorMessage("Failed to send email.");
                            }
                          }}
                          loadingLabel="Sending…"
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Mail size={12} /> Email
                        </LoadingButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Event Members"
        pageSubtitle="Paid and unpaid registrations"
        activeNavHref="/club-admin-dashboard/membership-dues"
      >
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Link
                href={backHref}
                className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Back"
              >
                <ArrowLeft size={15} />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-slate-800">Event Members</h1>
                <p className="text-xs text-slate-500 mt-0.5">Payment link #{linkId}</p>
              </div>
            </div>
            <LoadingButton
              onAction={handleExport}
              loadingLabel="Exporting…"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download size={13} /> Export {activeTab === "paid" ? "Paid" : "Unpaid"}
            </LoadingButton>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Registrations" value={fmtInt(totalRegistrations)} subtitle="Paid + Unpaid"  icon={Users}        color="blue" />
            <KpiCard title="Paid"                 value={fmtInt(totalPaid)}          subtitle="Confirmed"      icon={CheckCircle2} color="green" />
            <KpiCard title="Unpaid"               value={fmtInt(totalUnpaid)}        subtitle="Pending"        icon={XCircle}      color="gold" />
            <KpiCard title="Revenue"              value={fmtInr(totalRevenue)}       subtitle="Across paid"    icon={IndianRupee}  color="purple" />
          </div>

          {/* Tabs + table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <TabsList className="bg-slate-100 p-1 h-auto">
                  <TabsTrigger value="paid" className="px-3 py-1.5 text-xs gap-1.5">
                    <CheckCircle2 size={13} /> Paid ({totalPaid})
                  </TabsTrigger>
                  <TabsTrigger value="unpaid" className="px-3 py-1.5 text-xs gap-1.5">
                    <XCircle size={13} /> Unpaid ({totalUnpaid})
                  </TabsTrigger>
                </TabsList>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {activeTab === "unpaid" && (
                    <>
                      <LoadingButton
                        onAction={async () => {
                          setBulkSending(true);
                          try {
                            await bulkReminderEmail(linkId);
                            setSuccessMessage("Bulk email sent.");
                          } catch {
                            setErrorMessage("Failed to send bulk email.");
                          } finally {
                            setBulkSending(false);
                          }
                        }}
                        forcePending={bulkSending}
                        loadingLabel="Sending…"
                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Mail size={12} /> Bulk Email
                      </LoadingButton>
                    </>
                  )}
                </div>
              </div>

              <TabsContent value="paid" className="mt-0">
                {renderTable(paidMembers, paidLoading, true)}
              </TabsContent>
              <TabsContent value="unpaid" className="mt-0">
                {renderTable(unpaidMembers, unpaidLoading, false)}
              </TabsContent>
            </Tabs>

            <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
              {activeTab === "paid"
                ? `${paidMembers.length} paid member${paidMembers.length === 1 ? "" : "s"}`
                : `${unpaidMembers.length} unpaid member${unpaidMembers.length === 1 ? "" : "s"}`}
            </div>
          </div>

          <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
