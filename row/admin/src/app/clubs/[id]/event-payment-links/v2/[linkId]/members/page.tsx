"use client";
import { DataTable } from "@/components/ui/data-table";

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

import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Download, Mail, Receipt, CreditCard, Search, Users, CheckCircle2, XCircle, IndianRupee } from "@/components/icons";
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
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
import { stripBase } from "@/lib/basePath";
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
    ? encodeURIComponent(stripBase(window.location.pathname) + window.location.search)
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
            <h3 className="row-h2">Access Denied</h3>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  const renderTable = (members: EventMember[], loading: boolean, isPaidTab: boolean) => {
    if (loading) {
      return (
        <SkeletonRows />
      );
    }
    return (
      <div className="overflow-x-auto">
        <DataTable
          caption="Members"
          card={false}
          className="[&_table]:min-w-[640px] md:[&_table]:min-w-full"
          rows={members}
          rowKey={(m) => m.id}
          empty="No members found."
          columns={[
{ key: "name", header: "Name", className: "font-medium", cell: (m, _i) => m.memberName || "–" },
{ key: "mobile", header: "Mobile", className: "whitespace-nowrap", cell: (m, _i) => m.mobile || "–" },
{ key: "email", header: "Email", className: "max-w-[180px] truncate", cell: (m, _i) => m.email || "–" },
{ key: "reg", header: "Registration", cell: (m, _i) => m.registrationType || "–" },
{ key: "amount", header: "Amount", align: "right", className: "tabular-nums", cell: (m, _i) => (<>
                  {m.amount ? `${currencySymbol()}${m.amount.toFixed(2)}` : "–"}
</>) },
...(isPaidTab ? [{ key: "paydate", header: "Payment Date", className: "text-xs whitespace-nowrap", cell: (m: (typeof members)[number], _i: number) => (<>
                    {m.paymentDate ? new Date(m.paymentDate).toLocaleDateString() : "–"}
</>) }, { key: "txn", header: "Transaction", cell: (m: (typeof members)[number], _i: number) => (<>
                    <span
                      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${
                        m.isOnline
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {m.isOnline ? (m.transactionId || "Online") : (m.offlineTransactionType || "Offline")}
                    </span>
</>) }] : []),
{ key: "actions", header: "Actions", align: "right", className: "w-48", cell: (m, _i) => (<>
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
                        className="row-btn row-btn-secondary row-btn-sm"
                      >
                        <Receipt size={12} /> Send Receipt
                      </LoadingButton>
                    ) : (
                      <>
                        <LoadingLink
                          href={`/clubs/${clubId}/event-payment-links/${linkId}/members/${m.id}/offline-payment?returnTo=${outboundReturnTo}`}
                          className="row-btn row-btn-secondary row-btn-sm"
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
                          className="row-btn row-btn-secondary row-btn-sm"
                        >
                          <Mail size={12} /> Email
                        </LoadingButton>
                      </>
                    )}
                  </div>
</>) },
          ]}
        />
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
          <PageHeader
            title="Event Members"
            description={<>Payment link #{linkId}</>}
            back={backHref}
            actions={
              <>
<LoadingButton
              onAction={handleExport}
              loadingLabel="Exporting…"
              className="row-btn row-btn-secondary row-btn-sm"
            >
              <Download size={13} /> Export {activeTab === "paid" ? "Paid" : "Unpaid"}
            </LoadingButton>
              </>
            }
          />

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Registrations" value={fmtInt(totalRegistrations)} subtitle="Paid + Unpaid"  icon={Users}        color="blue" />
            <KpiCard title="Paid"                 value={fmtInt(totalPaid)}          subtitle="Confirmed"      icon={CheckCircle2} color="green" />
            <KpiCard title="Unpaid"               value={fmtInt(totalUnpaid)}        subtitle="Pending"        icon={XCircle}      color="gold" />
            <KpiCard title="Revenue"              value={fmtInr(totalRevenue)}       subtitle="Across paid"    icon={IndianRupee}  color="purple" />
          </div>

          {/* Tabs + table */}
          <Card className="overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="paid" className="gap-1.5">
                    <CheckCircle2 size={13} /> Paid ({totalPaid})
                  </TabsTrigger>
                  <TabsTrigger value="unpaid" className="gap-1.5">
                    <XCircle size={13} /> Unpaid ({totalUnpaid})
                  </TabsTrigger>
                </TabsList>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-auto">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      type="text"
                      placeholder="Search…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-7 pr-3 sm:w-48"
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
                        className="row-btn row-btn-secondary row-btn-sm"
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
          </Card>

          <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
