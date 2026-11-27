"use client";
import { IconButton } from "@/components/ui/icon-button";
import { LinkButton } from "@/components/ui/text-buttons";

import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { useState, useCallback, useEffect } from "react";
import { eventPayPath, getEventPaymentLinks, deleteEventPaymentLink, toggleEventPaymentLinkActive, exportEventMembers, createGoogleSheetForLink, deleteGoogleSheetForLink, refreshEventSettlements, getEventSettlementReport } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Plus, Pencil, Trash2, Users, AlertTriangle, FileSpreadsheet, RefreshCw, BarChart3 } from "@/components/icons";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
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
  weblinkUrl?: string;
  googleSheetUrl?: string;
  googleSheetId?: string;
}

export default function EventPaymentLinksPage() {
  const { isSuperAdmin } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [districtNumberFilter, setDistrictNumberFilter] = useState<string>("all");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteItem, setDeleteItem] = useState<PaymentLink | null>(null);
  const [creatingSheetId, setCreatingSheetId] = useState<number | null>(null);
  const [refreshingSettlementId, setRefreshingSettlementId] = useState<number | null>(null);
  const [settlementReportOpen, setSettlementReportOpen] = useState(false);
  const [settlementReportLoading, setSettlementReportLoading] = useState(false);
  const [settlementReportData, setSettlementReportData] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getEventPaymentLinks({ search: search || undefined });
      setItems(data);
    } catch { setErrorMessage("Failed to load payment links"); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleToggle = async (item: PaymentLink) => {
    try {
      await toggleEventPaymentLinkActive(item.id);
      setSuccessMessage(`Payment link ${item.isActive ? "deactivated" : "activated"}.`);
      fetchData();
    } catch { setErrorMessage("Failed to toggle status."); }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      await deleteEventPaymentLink(deleteItem.id);
      setSuccessMessage("Payment link deleted.");
      fetchData();
    } catch { setErrorMessage("Failed to delete."); }
    setDeleteItem(null);
  };

  const handleCopyUrl = (item: PaymentLink) => {
    const url = `${window.location.origin}${BASE_PATH}${eventPayPath(item)}`;
    navigator.clipboard.writeText(url);
    setSuccessMessage("URL copied to clipboard.");
  };

  const handleRefreshSettlements = async (id: number) => {
    setRefreshingSettlementId(id);
    try {
      await refreshEventSettlements(id);
      setSuccessMessage("Settlements refreshed successfully.");
    } catch { setErrorMessage("Failed to refresh settlements."); }
    finally { setRefreshingSettlementId(null); }
  };

  const handleViewSettlementReport = async (id: number) => {
    setSettlementReportLoading(true);
    setSettlementReportData([]);
    setSettlementReportOpen(true);
    try {
      const data = await getEventSettlementReport(id);
      setSettlementReportData(Array.isArray(data) ? data : data?.settlements || []);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load settlement report.");
      setSettlementReportOpen(false);
    } finally { setSettlementReportLoading(false); }
  };

  const handleDownloadReport = async (linkId: number) => {
    try {
      const blob = await exportEventMembers(linkId, true);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `event_report_${linkId}_${fileTimestamp()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { setErrorMessage("Failed to download report."); }
  };

  // Unique district numbers actually present in the data, alphasort.
  // Memoised so we don't recompute on every keystroke. Empty/null district
  // numbers (e.g. legacy rows) are filtered out so the dropdown shows only
  // real options.
  const districtNumberOptions = Array.from(
    new Set(items.map((i) => i.districtNumber).filter((d): d is string => !!d && d.trim() !== ""))
  ).sort((a, b) => a.localeCompare(b));

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    const matchesSearch = (i.title || "").toLowerCase().includes(q) ||
      (i.districtNumber || "").toLowerCase().includes(q) ||
      (i.clubName || "").toLowerCase().includes(q);
    const matchesDistrict = districtNumberFilter === "all" || (i.districtNumber || "") === districtNumberFilter;
    return matchesSearch && matchesDistrict;
  });

  if (!isSuperAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="row-h2">Access Denied</h3></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <PageHeader
          title="Event Payment Links"
          back="/settings/payments-and-dues"
          actions={
            <>
<NativeSelect
            value={districtNumberFilter}
            onChange={(e) => setDistrictNumberFilter(e.target.value)}
            className="w-auto"
            aria-label="Filter by district number"
          >
            <option value="all">All Districts</option>
            {districtNumberOptions.map((d) => (
              <option key={d} value={d}>District {d}</option>
            ))}
          </NativeSelect>
<SearchBox value={search} onChange={setSearch} placeholder="Search..." className="w-64" />
<Button asChild>
            <Link href="/settings/event-payment-links/create"><Plus className="h-4 w-4 mr-2" />Add</Link>
          </Button>
            </>
          }
        />

        {loading ? (
          <div className="flex justify-center py-10"><ListPageSkeleton /></div>
        ) : (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Sr. No.</TableHead>
                  <TableHead>Form Type</TableHead>
                  <TableHead>District Number</TableHead>
                  <TableHead>Club Name</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-center">Edit</TableHead>
                  <TableHead className="text-center">Member Details</TableHead>
                  <TableHead className="text-center">View | Copy URL</TableHead>
                  <TableHead className="text-center">Delete</TableHead>
                  <TableHead className="text-center">Report</TableHead>
                  <TableHead className="text-center">Report Link</TableHead>
                  <TableHead className="text-center">Disable Link</TableHead>
                  <TableHead className="text-center">GoogleSheet</TableHead>
                  <TableHead className="text-center">Settlement Refresh</TableHead>
                  <TableHead className="text-center">Settlement Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground py-8">No payment links found</TableCell></TableRow>
                ) : filtered.map((item, index) => (
                  <TableRow key={item.id} className="border-b">
                    {/* Sr. No. */}
                    <TableCell className="text-center">{index + 1}</TableCell>

                    {/* Form Type */}
                    <TableCell>{item.formType === 1 ? "Standard" : "Dynamic"}</TableCell>

                    {/* District Number */}
                    <TableCell>{item.districtNumber || ""}</TableCell>

                    {/* Club Name */}
                    <TableCell>{item.clubName || ""}</TableCell>

                    {/* Purpose */}
                    <TableCell className="font-medium">{item.title || ""}</TableCell>

                    {/* Edit */}
                    <TableCell className="text-center">
                      <IconButton aria-label="Edit" onClick={() => router.push(`/settings/event-payment-links/create?editId=${item.id}`)}>
                        <Pencil className="h-5 w-5 text-blue-500 hover:text-blue-700 cursor-pointer" />
                      </IconButton>
                    </TableCell>

                    {/* Member Details */}
                    <TableCell className="text-center">
                      <IconButton aria-label="Members" onClick={() => router.push(`/settings/event-payment-links/${item.id}/members`)}>
                        <Users className="h-5 w-5 text-teal-600 hover:text-teal-800 cursor-pointer" />
                      </IconButton>
                    </TableCell>

                    {/* View | Copy URL */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 text-sm">
                        <LinkButton onClick={() => window.open(withBase(eventPayPath(item)), "_blank")}>View</LinkButton>
                        <span className="text-muted-foreground">|</span>
                        <LinkButton onClick={() => handleCopyUrl(item)}>Copy URL</LinkButton>
                      </div>
                    </TableCell>

                    {/* Delete */}
                    <TableCell className="text-center">
                      <IconButton onClick={() => !item.isActive && setDeleteItem(item)}
                        aria-label="Delete"
                        disabled={item.isActive}
                        title={item.isActive ? "Deactivate link first to delete" : "Delete"}>
                        <Trash2 className="h-5 w-5 text-red-500 hover:text-red-700 cursor-pointer" />
                      </IconButton>
                    </TableCell>

                    {/* Report */}
                    <TableCell className="text-center">
                      <IconButton aria-label="Download report" onClick={() => handleDownloadReport(item.id)}>
                        <FileSpreadsheet className="h-5 w-5 text-red-600 hover:text-red-800 cursor-pointer" />
                      </IconButton>
                    </TableCell>

                    {/* Report Link */}
                    <TableCell className="text-center">
                      <LinkButton onClick={() => {
                        const url = `${window.location.origin}${BASE_PATH}/report/${item.id}`;
                        navigator.clipboard.writeText(url);
                        setSuccessMessage("Report link copied.");
                      }}>
                        Copy URL
                      </LinkButton>
                    </TableCell>

                    {/* Disable Link */}
                    <TableCell className="text-center">
                      <LinkButton onClick={() => handleToggle(item)}
                        tone={item.isActive ? "primary" : "danger"}>
                        {item.isActive ? "Activate" : "Deactivate"}
                      </LinkButton>
                    </TableCell>

                    {/* GoogleSheet */}
                    <TableCell className="text-center">
                      {item.googleSheetId ? (
                        <div className="flex flex-col items-center gap-0.5 text-sm">
                          <LinkButton onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`, "_blank")}>Open</LinkButton>
                          <LinkButton onClick={() => { navigator.clipboard.writeText(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`); setSuccessMessage("Google Sheet URL copied."); }}>Copy URL</LinkButton>
                          <LinkButton tone="danger" onClick={async () => {
                            if (!confirm("Delete this Google Sheet from Drive?")) return;
                            try {
                              setCreatingSheetId(item.id);
                              await deleteGoogleSheetForLink(item.id);
                              setSuccessMessage("Google Sheet deleted.");
                              fetchData();
                            } catch (err: any) {
                              setErrorMessage(err?.response?.data?.message || "Failed to delete Google Sheet.");
                            } finally { setCreatingSheetId(null); }
                          }}>Delete</LinkButton>
                        </div>
                      ) : creatingSheetId === item.id ? (
                        <div className="flex justify-center"><RotaryLoader size="sm" /></div>
                      ) : (
                        <IconButton aria-label="Create Google Sheet" onClick={async () => {
                          try {
                            setCreatingSheetId(item.id);
                            const res = await createGoogleSheetForLink(item.id);
                            item.googleSheetId = res.googleSheetId;
                            setSuccessMessage("Google Sheet created successfully.");
                            fetchData();
                          } catch (err: any) {
                            setErrorMessage(err?.response?.data?.message || "Failed to create Google Sheet.");
                          } finally {
                            setCreatingSheetId(null);
                          }
                        }} title="Create Google Sheet">
                          <FileSpreadsheet className="h-5 w-5 text-green-600" />
                        </IconButton>
                      )}
                    </TableCell>

                    {/* Settlement Refresh */}
                    <TableCell className="text-center">
                      <IconButton
                        onClick={() => handleRefreshSettlements(item.id)}
                        disabled={refreshingSettlementId === item.id}
                        aria-label="Refresh Settlements"
                        title="Refresh Settlements"
                      >
                        {refreshingSettlementId === item.id ? (
                          <RotaryLoader size="sm" />
                        ) : (
                          <RefreshCw className="h-5 w-5 text-blue-500 hover:text-blue-700 cursor-pointer" />
                        )}
                      </IconButton>
                    </TableCell>

                    {/* Settlement Report */}
                    <TableCell className="text-center">
                      <IconButton
                        onClick={() => handleViewSettlementReport(item.id)}
                        aria-label="View Settlement Report"
                        title="View Settlement Report"
                      >
                        <BarChart3 className="h-5 w-5 text-slate-600 hover:text-slate-800 cursor-pointer" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Settlement Report Dialog */}
        <Dialog open={settlementReportOpen} onOpenChange={setSettlementReportOpen}>
          <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Settlement Report</DialogTitle>
            </DialogHeader>
            {settlementReportLoading ? (
              <div className="flex justify-center py-10"><ListPageSkeleton /></div>
            ) : settlementReportData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No settlement data found.</p>
            ) : (
              <Card className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>UTR</TableHead>
                      <TableHead>Settlement Time</TableHead>
                      <TableHead>Payment Source</TableHead>
                      <TableHead>Webhook</TableHead>
                      <TableHead>Order Splits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settlementReportData.map((s: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="text-xs">{s.memberName || s.member_name || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{s.orderId || s.order_id || "-"}</TableCell>
                        <TableCell>{s.vendorName || s.vendor_name || s.vendorId || s.vendor_id || "-"}</TableCell>
                        <TableCell className="text-right">{s.amount != null ? `${currencySymbol()}${Number(s.amount).toLocaleString(appLocale(), { minimumFractionDigits: 2 })}` : "-"}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${s.status === "SETTLED" || s.status === "SUCCESS" ? "bg-green-100 text-green-700" : s.status === "PENDING" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-700"}`}>
                            {s.status || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{s.utr || s.utrNumber || "-"}</TableCell>
                        <TableCell className="text-xs">{s.settlementTime || s.settlement_time ? new Date(s.settlementTime || s.settlement_time).toLocaleString(appLocale()) : "-"}</TableCell>
                        <TableCell className="text-xs">{s.paidSource || s.paid_source || "-"}</TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${s.isWebhookReceived ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}`}>
                            {s.isWebhookReceived ? "Yes" : "No"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={s.orderSplitsJson || s.order_splits_json || ""}>
                          {s.orderSplitsJson || s.order_splits_json || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </DialogContent>
        </Dialog>

        <AlertModal
          open={!!deleteItem}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Payment Link"
          description={`Are you sure you want to delete "${deleteItem?.title}"? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteItem(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
