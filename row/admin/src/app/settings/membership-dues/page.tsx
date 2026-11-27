"use client";
import { IconButton } from "@/components/ui/icon-button";
import { LinkButton } from "@/components/ui/text-buttons";

import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { useState, useCallback, useEffect, useMemo } from "react";
import DuesDraftsCard from "@/components/dues/DuesDraftsCard";
import { duesPayPath, getMembershipDuesList, deleteMembershipDues, toggleMembershipDuesActive, createMembershipDuesGoogleSheet, deleteMembershipDuesGoogleSheet, refreshMembershipDuesSettlements, getMembershipDuesSettlementReport, bulkMembershipDuesReminderEmail } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrencySymbol } from "@/lib/currency";
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
import { Plus, Pencil, Trash2, AlertTriangle, FileSpreadsheet, Mail, RefreshCw, BarChart3, Send } from "@/components/icons";
import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { withBase, BASE_PATH } from "@/lib/basePath";
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
  currency?: string; // "INR" | "USD" — display sign only
  notifyEmail?: boolean;    // Super Admin channel flags (missing = on)
  notifyWhatsApp?: boolean;
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
  const [settlementCurrency, setSettlementCurrency] = useState<string | undefined>(undefined);

  // Bulk reminder
  const [bulkEmailRemarkOpen, setBulkEmailRemarkOpen] = useState(false);
  const [bulkEmailRemarkDuesId, setBulkEmailRemarkDuesId] = useState<number>(0);
  const [bulkEmailRemark, setBulkEmailRemark] = useState("");

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
    const url = `${window.location.origin}${BASE_PATH}${duesPayPath(item)}`;
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
    setSettlementCurrency(items.find(i => i.id === id)?.currency);
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
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="row-h2">Access Denied</h3></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <PageHeader
          title="Club Dues"
          back="/settings/payments-and-dues"
          actions={
            <>
<NativeSelect
            value={districtFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
            className="w-auto"
          >
            <option value="">All Districts</option>
            {availableDistricts.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </NativeSelect>
<NativeSelect
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="w-auto"
          >
            <option value="">All Years</option>
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </NativeSelect>
<NativeSelect
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-auto"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelect>
<SearchBox value={search} onChange={setSearch} placeholder="Search..." className="w-64" />
<Button asChild>
            <Link href="/settings/membership-dues/create"><Plus className="h-4 w-4 mr-2" />Add</Link>
          </Button>
            </>
          }
        />

        <DuesDraftsCard kind="club" stepLabels={["Basic Info & Payment", "Fee Types & Amounts", "Vendor Splits", "Member List", "Images & Email"]} />

        {loading ? (
          <div className="flex justify-center py-10"><ListPageSkeleton /></div>
        ) : (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Sr. No.</TableHead>
                  <TableHead>District Number</TableHead>
                  <TableHead>Club Name</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-center">Edit</TableHead>
                  <TableHead className="text-center">View | Copy URL</TableHead>
                  <TableHead className="text-center">Delete</TableHead>
                  <TableHead className="text-center">Report</TableHead>
                  <TableHead className="text-center">Report Link</TableHead>
                  <TableHead className="text-center">Disable Link</TableHead>
                  <TableHead className="text-center">Settlement Refresh</TableHead>
                  <TableHead className="text-center">Settlement Report</TableHead>
                  <TableHead className="text-center">GoogleSheet</TableHead>
                  <TableHead className="text-center">Reminder</TableHead>
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
                      <IconButton aria-label="Edit" onClick={() => router.push(`/settings/membership-dues/create?editId=${item.id}`)}>
                        <Pencil className="h-5 w-5 text-blue-500 hover:text-blue-700 cursor-pointer" />
                      </IconButton>
                    </TableCell>

                    {/* View | Copy URL */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 text-sm">
                        <LinkButton onClick={() => {
                          window.open(withBase(duesPayPath(item)), "_blank");
                        }}>View</LinkButton>
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

                    {/* Report — opens the public dues report page (which has its own Download button) */}
                    <TableCell className="text-center">
                      <IconButton
                        onClick={() => window.open(`${window.location.origin}${BASE_PATH}/report/dues/${item.id}`, "_blank", "noopener,noreferrer")}
                        title="Open dues report"
                        aria-label="Open dues report">
                        <FileSpreadsheet className="h-5 w-5 text-red-600 hover:text-red-800 cursor-pointer" />
                      </IconButton>
                    </TableCell>

                    {/* Report Link */}
                    <TableCell className="text-center">
                      <LinkButton onClick={() => {
                        const url = `${window.location.origin}${BASE_PATH}/report/dues/${item.id}`;
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
                        <BarChart3 className="h-5 w-5 text-slate-500 hover:text-slate-700 cursor-pointer" />
                      </IconButton>
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
                              await deleteMembershipDuesGoogleSheet(item.id);
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
                            const res = await createMembershipDuesGoogleSheet(item.id);
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

                    <TableCell className="text-center">
                      <div className="flex gap-2 justify-center">
                        {item.notifyEmail !== false && (
                        <IconButton aria-label="Bulk Email Reminder" title="Bulk Email Reminder"
                          onClick={() => { setBulkEmailRemarkDuesId(item.id); setBulkEmailRemark(""); setBulkEmailRemarkOpen(true); }}>
                          <Mail className="h-4 w-4 text-orange-600" />
                        </IconButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
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


        {/* Settlement Report Dialog */}
        <Dialog open={settlementReportOpen} onOpenChange={setSettlementReportOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
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
                        <TableCell className="font-mono text-xs">{s.cfOrderId || s.orderId || s.order_id || "-"}</TableCell>
                        <TableCell>{s.vendorName || s.vendor_name || s.vendorId || s.vendor_id || "-"}</TableCell>
                        <TableCell className="text-right">{s.amount != null ? `${getCurrencySymbol(settlementCurrency)}${Number(s.amount).toLocaleString(appLocale(), { minimumFractionDigits: 2 })}` : "-"}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${(s.settlementStatus || s.status) === "SETTLED" || (s.settlementStatus || s.status) === "SUCCESS" ? "bg-green-100 text-green-700" : (s.settlementStatus || s.status) === "PENDING" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-700"}`}>
                            {s.settlementStatus || s.status || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{s.settlementUtr || s.utr || s.utrNumber || "-"}</TableCell>
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
                } catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to send email reminders."); }
              }} className="w-full">Send Reminders</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
