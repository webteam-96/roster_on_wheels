"use client";

import { useState, useCallback, useEffect } from "react";
import { getEventPaymentLinks, deleteEventPaymentLink, toggleEventPaymentLinkActive, exportEventMembers, createGoogleSheetForLink, deleteGoogleSheetForLink, refreshEventSettlements, getEventSettlementReport } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, Users, AlertTriangle, FileSpreadsheet, Download, RefreshCw, BarChart3 } from "@/components/icons";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
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
    const url = `${window.location.origin}/pay/${item.id}`;
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
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings/payments-and-dues"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">Event Payment Links</h2>
          </div>
          <select
            value={districtNumberFilter}
            onChange={(e) => setDistrictNumberFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Filter by district number"
          >
            <option value="all">All Districts</option>
            {districtNumberOptions.map((d) => (
              <option key={d} value={d}>District {d}</option>
            ))}
          </select>
          <SearchBox value={search} onChange={setSearch} placeholder="Search..." className="w-64" />
          <Button asChild>
            <Link href="/settings/event-payment-links/create"><Plus className="h-4 w-4 mr-2" />Add</Link>
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><ListPageSkeleton /></div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary text-primary-foreground hover:bg-primary">
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
                      <button onClick={() => router.push(`/settings/event-payment-links/create?editId=${item.id}`)}
                        className="inline-flex items-center justify-center">
                        <Pencil className="h-5 w-5 text-blue-500 hover:text-blue-700 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* Member Details */}
                    <TableCell className="text-center">
                      <button onClick={() => router.push(`/settings/event-payment-links/${item.id}/members`)}
                        className="inline-flex items-center justify-center">
                        <Users className="h-5 w-5 text-teal-600 hover:text-teal-800 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* View | Copy URL */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 text-sm">
                        <button onClick={() => window.open(`/pay/${item.id}`, "_blank")}
                          className="text-blue-600 hover:text-blue-800 hover:underline">View</button>
                        <span className="text-muted-foreground">|</span>
                        <button onClick={() => handleCopyUrl(item)}
                          className="text-blue-600 hover:text-blue-800 hover:underline">Copy URL</button>
                      </div>
                    </TableCell>

                    {/* Delete */}
                    <TableCell className="text-center">
                      <button onClick={() => !item.isActive && setDeleteItem(item)}
                        className={`inline-flex items-center justify-center ${item.isActive ? "opacity-30 cursor-not-allowed" : ""}`}
                        disabled={item.isActive}
                        title={item.isActive ? "Deactivate link first to delete" : "Delete"}>
                        <Trash2 className="h-5 w-5 text-red-500 hover:text-red-700 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* Report */}
                    <TableCell className="text-center">
                      <button onClick={() => handleDownloadReport(item.id)}
                        className="inline-flex items-center justify-center">
                        <FileSpreadsheet className="h-5 w-5 text-red-600 hover:text-red-800 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* Report Link */}
                    <TableCell className="text-center">
                      <button onClick={() => {
                        const url = `${window.location.origin}/report/${item.id}`;
                        navigator.clipboard.writeText(url);
                        setSuccessMessage("Report link copied.");
                      }} className="text-sm text-blue-600 hover:text-blue-800 hover:underline">
                        Copy URL
                      </button>
                    </TableCell>

                    {/* Disable Link */}
                    <TableCell className="text-center">
                      <button onClick={() => handleToggle(item)}
                        className={`text-sm font-medium ${item.isActive ? "text-green-600 hover:text-green-800" : "text-red-600 hover:text-red-800"} hover:underline`}>
                        {item.isActive ? "Activate" : "Deactivate"}
                      </button>
                    </TableCell>

                    {/* GoogleSheet */}
                    <TableCell className="text-center">
                      {item.googleSheetId ? (
                        <div className="flex flex-col items-center gap-0.5 text-sm">
                          <button onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`, "_blank")}
                            className="text-blue-600 hover:text-blue-800 hover:underline">Open</button>
                          <button onClick={() => { navigator.clipboard.writeText(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`); setSuccessMessage("Google Sheet URL copied."); }}
                            className="text-blue-600 hover:text-blue-800 hover:underline">Copy URL</button>
                          <button onClick={async () => {
                            if (!confirm("Delete this Google Sheet from Drive?")) return;
                            try {
                              setCreatingSheetId(item.id);
                              await deleteGoogleSheetForLink(item.id);
                              setSuccessMessage("Google Sheet deleted.");
                              fetchData();
                            } catch (err: any) {
                              setErrorMessage(err?.response?.data?.message || "Failed to delete Google Sheet.");
                            } finally { setCreatingSheetId(null); }
                          }} className="text-red-600 hover:text-red-800 hover:underline">Delete</button>
                        </div>
                      ) : creatingSheetId === item.id ? (
                        <div className="flex justify-center"><RotaryLoader size="sm" /></div>
                      ) : (
                        <button onClick={async () => {
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
                        }} className="text-green-600 hover:text-green-800" title="Create Google Sheet">
                          <FileSpreadsheet className="h-5 w-5 mx-auto" />
                        </button>
                      )}
                    </TableCell>

                    {/* Settlement Refresh */}
                    <TableCell className="text-center">
                      <button
                        onClick={() => handleRefreshSettlements(item.id)}
                        disabled={refreshingSettlementId === item.id}
                        className="inline-flex items-center justify-center"
                        title="Refresh Settlements"
                      >
                        {refreshingSettlementId === item.id ? (
                          <RotaryLoader size="sm" />
                        ) : (
                          <RefreshCw className="h-5 w-5 text-blue-500 hover:text-blue-700 cursor-pointer" />
                        )}
                      </button>
                    </TableCell>

                    {/* Settlement Report */}
                    <TableCell className="text-center">
                      <button
                        onClick={() => handleViewSettlementReport(item.id)}
                        className="inline-flex items-center justify-center"
                        title="View Settlement Report"
                      >
                        <BarChart3 className="h-5 w-5 text-purple-600 hover:text-purple-800 cursor-pointer" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
              <div className="overflow-x-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted">
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
                        <TableCell className="text-right">{s.amount != null ? `\u20B9${Number(s.amount).toLocaleString(appLocale(), { minimumFractionDigits: 2 })}` : "-"}</TableCell>
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
              </div>
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
