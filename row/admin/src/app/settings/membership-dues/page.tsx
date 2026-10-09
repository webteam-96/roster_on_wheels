"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { getMembershipDuesList, deleteMembershipDues, toggleMembershipDuesActive, createMembershipDuesGoogleSheet, deleteMembershipDuesGoogleSheet, refreshMembershipDuesSettlements, getMembershipDuesSettlementReport, bulkMembershipDuesReminderEmail, bulkMembershipDuesReminderWhatsApp } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, Users, AlertTriangle, FileSpreadsheet, Mail, RefreshCw, BarChart3, Send } from "lucide-react";
import { Input } from "@/components/ui/input";

const WhatsAppIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);
import { Label } from "@/components/ui/label";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

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

export default function MembershipDuesPage() {
  const { isSuperAdmin } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<MembershipDuesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteItem, setDeleteItem] = useState<MembershipDuesItem | null>(null);
  const [creatingSheetId, setCreatingSheetId] = useState<number | null>(null);
  const [refreshingSettlementId, setRefreshingSettlementId] = useState<number | null>(null);
  const [settlementReportOpen, setSettlementReportOpen] = useState(false);
  const [settlementReportLoading, setSettlementReportLoading] = useState(false);
  const [settlementReportData, setSettlementReportData] = useState<any[]>([]);

  // Bulk reminder
  const [bulkEmailRemarkOpen, setBulkEmailRemarkOpen] = useState(false);
  const [bulkEmailRemarkDuesId, setBulkEmailRemarkDuesId] = useState<number>(0);
  const [bulkEmailRemark, setBulkEmailRemark] = useState("");
  const [bulkWhatsAppConfirmItem, setBulkWhatsAppConfirmItem] = useState<MembershipDuesItem | null>(null);

  // Note: year/district filters are NOT sent to API — applied client-side only.
  // Sending them shrinks `items`, which collapses the year/district dropdowns
  // (they derive their options from items).
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMembershipDuesList({ search: search || undefined });
      setItems(data);
    } catch { setErrorMessage("Failed to load Club Dues"); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleToggle = async (item: MembershipDuesItem) => {
    try {
      await toggleMembershipDuesActive(item.id);
      setSuccessMessage(`Club Dues ${item.isActive ? "deactivated" : "activated"}.`);
      fetchData();
    } catch { setErrorMessage("Failed to toggle status."); }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      await deleteMembershipDues(deleteItem.id);
      setSuccessMessage("Club Dues deleted.");
      fetchData();
    } catch { setErrorMessage("Failed to delete."); }
    setDeleteItem(null);
  };

  const handleCopyUrl = (item: MembershipDuesItem) => {
    const url = `${window.location.origin}/pay/dues/${item.id}`;
    navigator.clipboard.writeText(url);
    setSuccessMessage("URL copied to clipboard.");
  };

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    items.forEach(i => { if (i.rotaryYear) years.add(i.rotaryYear); });
    return Array.from(years).sort().reverse();
  }, [items]);

  const availableDistricts = useMemo(() => {
    const districts = new Set<string>();
    items.forEach(i => { if (i.districtNumber) districts.add(i.districtNumber); });
    return Array.from(districts).sort();
  }, [items]);

  const handleRefreshSettlements = async (id: number) => {
    setRefreshingSettlementId(id);
    try {
      await refreshMembershipDuesSettlements(id);
      setSuccessMessage("Settlements refreshed successfully.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to refresh settlements.");
    } finally {
      setRefreshingSettlementId(null);
    }
  };

  const handleViewSettlementReport = async (id: number) => {
    setSettlementReportLoading(true);
    setSettlementReportData([]);
    setSettlementReportOpen(true);
    try {
      const data = await getMembershipDuesSettlementReport(id);
      setSettlementReportData(Array.isArray(data) ? data : data?.settlements || []);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load settlement report.");
      setSettlementReportOpen(false);
    } finally {
      setSettlementReportLoading(false);
    }
  };

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    const matchesSearch = !q || (i.purpose || "").toLowerCase().includes(q) ||
      (i.districtNumber || "").toLowerCase().includes(q) ||
      (i.clubName || "").toLowerCase().includes(q);
    const matchesYear = !yearFilter || i.rotaryYear === yearFilter;
    const matchesDistrict = !districtFilter || i.districtNumber === districtFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" && i.isActive) || (statusFilter === "inactive" && !i.isActive);
    return matchesSearch && matchesYear && matchesDistrict && matchesStatus;
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
            <h2 className="text-2xl font-bold tracking-tight text-primary">Club Dues</h2>
          </div>
          <select
            value={districtFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">All Districts</option>
            {availableDistricts.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">All Years</option>
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <SearchBox value={search} onChange={setSearch} placeholder="Search..." className="w-64" />
          <Button asChild>
            <Link href="/settings/membership-dues/create"><Plus className="h-4 w-4 mr-2" />Add</Link>
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary text-primary-foreground hover:bg-primary">
                  <TableHead className="text-primary-foreground w-[50px]">Sr. No.</TableHead>
                  <TableHead className="text-primary-foreground">District Number</TableHead>
                  <TableHead className="text-primary-foreground">Club Name</TableHead>
                  <TableHead className="text-primary-foreground">Year</TableHead>
                  <TableHead className="text-primary-foreground">Title</TableHead>
                  <TableHead className="text-primary-foreground text-center">Edit</TableHead>
                  <TableHead className="text-primary-foreground text-center">View | Copy URL</TableHead>
                  <TableHead className="text-primary-foreground text-center">Delete</TableHead>
                  <TableHead className="text-primary-foreground text-center">Report</TableHead>
                  <TableHead className="text-primary-foreground text-center">Report Link</TableHead>
                  <TableHead className="text-primary-foreground text-center">Disable Link</TableHead>
                  <TableHead className="text-primary-foreground text-center">Settlement Refresh</TableHead>
                  <TableHead className="text-primary-foreground text-center">Settlement Report</TableHead>
                  <TableHead className="text-primary-foreground text-center">GoogleSheet</TableHead>
                  <TableHead className="text-primary-foreground text-center">Reminder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground py-8">No Club Dues found</TableCell></TableRow>
                ) : filtered.map((item, index) => (
                  <TableRow key={item.id} className="border-b">
                    {/* Sr. No. */}
                    <TableCell className="text-center">{index + 1}</TableCell>

                    {/* District Number */}
                    <TableCell>{item.districtNumber || ""}</TableCell>

                    {/* Club Name */}
                    <TableCell>{item.clubName || ""}</TableCell>

                    {/* Year */}
                    <TableCell>{item.rotaryYear || ""}</TableCell>

                    {/* Title */}
                    <TableCell className="font-medium">{item.purpose || ""}</TableCell>

                    {/* Edit */}
                    <TableCell className="text-center">
                      <button onClick={() => router.push(`/settings/membership-dues/create?editId=${item.id}`)}
                        className="inline-flex items-center justify-center">
                        <Pencil className="h-5 w-5 text-blue-500 hover:text-blue-700 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* View | Copy URL */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 text-sm">
                        <button onClick={() => {
                          window.open(`/pay/dues/${item.id}`, "_blank");
                        }}
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

                    {/* Report — opens the public dues report page (which has its own Download button) */}
                    <TableCell className="text-center">
                      <button
                        onClick={() => window.open(`${window.location.origin}/report/dues/${item.id}`, "_blank", "noopener,noreferrer")}
                        title="Open dues report"
                        className="inline-flex items-center justify-center">
                        <FileSpreadsheet className="h-5 w-5 text-red-600 hover:text-red-800 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* Report Link */}
                    <TableCell className="text-center">
                      <button onClick={() => {
                        const url = `${window.location.origin}/report/dues/${item.id}`;
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
                        <BarChart3 className="h-5 w-5 text-purple-500 hover:text-purple-700 cursor-pointer" />
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
                              await deleteMembershipDuesGoogleSheet(item.id);
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
                            const res = await createMembershipDuesGoogleSheet(item.id);
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

                    {/* Reminder — Email (with remark) + WhatsApp */}
                    <TableCell className="text-center">
                      <div className="flex gap-2 justify-center">
                        <button className="text-orange-600 hover:text-orange-800" title="Bulk Email Reminder"
                          onClick={() => { setBulkEmailRemarkDuesId(item.id); setBulkEmailRemark(""); setBulkEmailRemarkOpen(true); }}>
                          <Mail className="h-4 w-4" />
                        </button>
                        <button className="text-green-600 hover:text-green-800" title="Bulk WhatsApp Reminder"
                          onClick={() => setBulkWhatsAppConfirmItem(item)}>
                          <WhatsAppIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <AlertModal
          open={!!deleteItem}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Club Dues"
          description={`Are you sure you want to delete "${deleteItem?.purpose}"? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteItem(null)}
        />

        <AlertModal
          open={!!bulkWhatsAppConfirmItem}
          icon={Send}
          iconClassName="text-green-600"
          title="Send Bulk WhatsApp Reminder"
          description={`Send a WhatsApp reminder to every unpaid member of "${bulkWhatsAppConfirmItem?.purpose}"? This cannot be undone.`}
          confirmLabel="Send"
          confirmClassName="bg-green-600 text-white hover:bg-green-700"
          onConfirm={async () => {
            if (!bulkWhatsAppConfirmItem) return;
            const id = bulkWhatsAppConfirmItem.id;
            setBulkWhatsAppConfirmItem(null);
            try {
              await bulkMembershipDuesReminderWhatsApp(id);
              setSuccessMessage("WhatsApp reminders sent to unpaid members!");
            } catch { setErrorMessage("Failed to send WhatsApp reminders."); }
          }}
          cancelLabel="Cancel"
          onCancel={() => setBulkWhatsAppConfirmItem(null)}
        />

        {/* Settlement Report Dialog */}
        <Dialog open={settlementReportOpen} onOpenChange={setSettlementReportOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Settlement Report</DialogTitle>
            </DialogHeader>
            {settlementReportLoading ? (
              <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
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
                        <TableCell className="font-mono text-xs">{s.cfOrderId || s.orderId || s.order_id || "-"}</TableCell>
                        <TableCell>{s.vendorName || s.vendor_name || s.vendorId || s.vendor_id || "-"}</TableCell>
                        <TableCell className="text-right">{s.amount != null ? `\u20B9${Number(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "-"}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${(s.settlementStatus || s.status) === "SETTLED" || (s.settlementStatus || s.status) === "SUCCESS" ? "bg-green-100 text-green-700" : (s.settlementStatus || s.status) === "PENDING" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-700"}`}>
                            {s.settlementStatus || s.status || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{s.settlementUtr || s.utr || s.utrNumber || "-"}</TableCell>
                        <TableCell className="text-xs">{s.settlementTime || s.settlement_time ? new Date(s.settlementTime || s.settlement_time).toLocaleString("en-IN") : "-"}</TableCell>
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

        {/* Bulk Email Reminder Remark Dialog */}
        <Dialog open={bulkEmailRemarkOpen} onOpenChange={setBulkEmailRemarkOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Send Bulk Email Reminder</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Send email reminder to all unpaid members for applicable fee types.</p>
              <div><Label>Remark (optional)</Label><Input value={bulkEmailRemark} onChange={e => setBulkEmailRemark(e.target.value)} placeholder="Add a remark to the reminder email" /></div>
              <Button onClick={async () => {
                try {
                  await bulkMembershipDuesReminderEmail(bulkEmailRemarkDuesId, { remark: bulkEmailRemark || undefined });
                  setSuccessMessage("Email reminders sent to unpaid members!");
                  setBulkEmailRemarkOpen(false);
                  setBulkEmailRemark("");
                } catch { setErrorMessage("Failed to send email reminders."); }
              }} className="w-full">Send Reminders</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
