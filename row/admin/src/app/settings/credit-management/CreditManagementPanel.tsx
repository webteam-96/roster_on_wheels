"use client";

import { useState, useEffect, useCallback } from "react";
import DateField from "@/components/DateField";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCreditList, addCredit, updateCredit, deleteCredit, getDistricts, getDistrictClubs, getCreditUsageHistory,
} from "@/services/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pencil, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Plus, Loader2, Download } from "@/components/icons";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
interface DistrictOption { id: number; districtNumber: string; }
interface ClubOption { id: number; clubName: string; clubCode: string; }
interface CreditItem {
  id: number; districtNumber: string; clubName: string; creditType: string;
  previousCount: number; creditCount: number; usedCount: number; remaining: number;
  fromDate: string; toDate: string; isActive: boolean; isExpired: boolean;
  transactionId?: string; paymentDate?: string; proofDocumentPath?: string;
  createdDate: string; lastUsedDate?: string | null;
}
interface UsageHistoryItem {
  id: number; clubName: string; districtNumber: string; creditType: string;
  deductedCount: number; source: string; sourceId?: number; sourceDetail?: string;
  balanceBefore: number; balanceAfter: number; createdDate: string;
}

/**
 * Offline credit entry (Super Admin gives email credits by hand) — the former
 * /settings/credit-management page, now shown inside Settings › Wallet under "Offline".
 * `embedded` hides the page header; `onChanged` lets Wallet refresh its combined list.
 */
export default function CreditManagementPanel({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void } = {}) {
  const { isSuperAdmin } = useAuth();

  // Form state
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [formDistrictId, setFormDistrictId] = useState("");
  const [formClubId, setFormClubId] = useState("");
  const formCreditType = "Email";
  const [formCreditCount, setFormCreditCount] = useState("");
  const [formToDate, setFormToDate] = useState("");
  const [formTransactionId, setFormTransactionId] = useState("");
  const [formPaymentDate, setFormPaymentDate] = useState("");
  const [formProofDocument, setFormProofDocument] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // List state
  const [items, setItems] = useState<CreditItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterDistrictId, setFilterDistrictId] = useState("");
  const [filterClubId, setFilterClubId] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClubs, setFilterClubs] = useState<ClubOption[]>([]);

  // Usage History state
  const [historyItems, setHistoryItems] = useState<UsageHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFilterDistrictId, setHistoryFilterDistrictId] = useState("");
  const [historyFilterClubId, setHistoryFilterClubId] = useState("");
  const [historyFilterType, setHistoryFilterType] = useState("");
  const [historyFilterClubs, setHistoryFilterClubs] = useState<ClubOption[]>([]);
  const [activeTab, setActiveTab] = useState("credits");

  // Edit dialog state
  const [editItem, setEditItem] = useState<CreditItem | null>(null);
  const [editCount, setEditCount] = useState("");
  const [editToDate, setEditToDate] = useState("");
  const [editTransactionId, setEditTransactionId] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteItem, setDeleteItem] = useState<CreditItem | null>(null);

  const openEdit = (item: CreditItem) => {
    setEditItem(item);
    setEditCount(String(item.creditCount));
    setEditToDate(item.toDate.split("T")[0]);
    setEditTransactionId(item.transactionId || "");
  };
  const handleEditSave = async () => {
    if (!editItem) return;
    const newCount = parseInt(editCount);
    if (isNaN(newCount) || newCount < editItem.usedCount) {
      setErrorMessage(`Count must be a number and at least ${editItem.usedCount} (already used).`);
      return;
    }
    setEditSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("CreditCount", String(newCount));
      fd.append("ToDate", editToDate);
      if (editTransactionId) fd.append("TransactionId", editTransactionId);
      await updateCredit(editItem.id, fd);
      setSuccessMessage("Credit updated successfully.");
      setEditItem(null);
      await fetchCredits();
      onChanged?.();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update credit.");
    } finally { setEditSubmitting(false); }
  };
  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      await deleteCredit(deleteItem.id);
      setSuccessMessage("Credit deleted successfully.");
      setDeleteItem(null);
      await fetchCredits();
      onChanged?.();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to delete credit.");
      setDeleteItem(null);
    }
  };

  // Alerts
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pageSize = 20;

  // Load districts
  useEffect(() => {
    async function loadDistricts() {
      try {
        const res = await getDistricts(1, 200);
        setDistricts(res.items.map((d: any) => ({ id: d.id, districtNumber: d.districtNumber })).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      } catch { /* ignore */ }
    }
    loadDistricts();
  }, []);

  // Load clubs when form district changes
  useEffect(() => {
    if (!formDistrictId) { setClubs([]); return; }
    async function loadClubs() {
      try {
        const res = await getDistrictClubs(Number(formDistrictId));
        setClubs(res.map((c: any) => ({ id: c.id, clubName: c.clubName, clubCode: c.clubCode })));
      } catch { /* ignore */ }
    }
    loadClubs();
  }, [formDistrictId]);

  // Load filter clubs when filter district changes
  useEffect(() => {
    if (!filterDistrictId) { setFilterClubs([]); return; }
    async function loadFilterClubs() {
      try {
        const res = await getDistrictClubs(Number(filterDistrictId));
        setFilterClubs(res.map((c: any) => ({ id: c.id, clubName: c.clubName, clubCode: c.clubCode })));
      } catch { /* ignore */ }
    }
    loadFilterClubs();
  }, [filterDistrictId]);

  // Load history filter clubs
  useEffect(() => {
    if (!historyFilterDistrictId) { setHistoryFilterClubs([]); return; }
    async function loadHistoryClubs() {
      try {
        const res = await getDistrictClubs(Number(historyFilterDistrictId));
        setHistoryFilterClubs(res.map((c: any) => ({ id: c.id, clubName: c.clubName, clubCode: c.clubCode })));
      } catch { /* ignore */ }
    }
    loadHistoryClubs();
  }, [historyFilterDistrictId]);

  const fetchCredits = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (filterDistrictId) params.districtId = Number(filterDistrictId);
      if (filterClubId) params.clubId = Number(filterClubId);
      if (filterType) params.creditType = filterType;
      if (filterStatus) params.status = filterStatus;
      const res = await getCreditList(params);
      setItems(res.items);
      setTotalCount(res.totalCount);
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filterDistrictId, filterClubId, filterType, filterStatus]);

  useEffect(() => { fetchCredits(); }, [fetchCredits]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params: Record<string, any> = { page: historyPage, pageSize };
      if (historyFilterDistrictId) params.districtId = Number(historyFilterDistrictId);
      if (historyFilterClubId) params.clubId = Number(historyFilterClubId);
      if (historyFilterType) params.creditType = historyFilterType;
      const res = await getCreditUsageHistory(params);
      setHistoryItems(res);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, [historyPage, historyFilterDistrictId, historyFilterClubId, historyFilterType]);

  useEffect(() => {
    if (activeTab === "history") fetchHistory();
  }, [activeTab, fetchHistory]);

  const buildFormData = (creditType: string, count: string): FormData => {
    const fd = new FormData();
    fd.append("fkDistrictId", formDistrictId);
    fd.append("fkClubId", formClubId || "0");
    fd.append("creditType", creditType);
    fd.append("creditCount", count);
    fd.append("toDate", formToDate);
    if (formTransactionId) fd.append("transactionId", formTransactionId);
    if (formPaymentDate) fd.append("paymentDate", formPaymentDate);
    if (formProofDocument) fd.append("proofDocument", formProofDocument);
    return fd;
  };

  const handleAddCredit = async () => {
    if (!formDistrictId || !formToDate) {
      setErrorMessage("District and Expiry Date are required.");
      return;
    }
    if (!formCreditCount) {
      setErrorMessage("Please enter credit count.");
      return;
    }

    setSubmitting(true);
    try {
        await addCredit(buildFormData(formCreditType, formCreditCount));
      setSuccessMessage("Credits added successfully. Confirmation email sent to admin.");
      setFormClubId(""); setFormCreditCount("");
      setFormToDate("");
      setFormTransactionId(""); setFormPaymentDate(""); setFormProofDocument(null);
      fetchCredits();
      onChanged?.();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to add credits.");
    }
    setSubmitting(false);
  };

  const formatSource = (source: string) => {
    const map: Record<string, string> = {
      MassEmail: "Mass Email",
      MembershipDues_Reminder: "Dues Reminder",
      MembershipDues_BulkReminder: "Dues Bulk Reminder",
      MembershipDues_Receipt: "Dues Receipt",
    };
    return map[source] || source;
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access this page.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {!embedded && (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings/email-credits"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Credit Management</h2>
            <p className="text-muted-foreground text-base">Manage email credits for clubs</p>
          </div>
        </div>
        )}

        {/* Add Credit Form */}
        <Card>
          <CardHeader><CardTitle>Add Credits</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>District *</Label>
                <Select value={formDistrictId} onValueChange={(v) => { setFormDistrictId(v); setFormClubId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Select District" /></SelectTrigger>
                  <SelectContent>
                    {districts.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Club <span className="text-muted-foreground text-xs">(optional. Leave blank for district-level)</span></Label>
                <Select value={formClubId} onValueChange={setFormClubId} disabled={!formDistrictId}>
                  <SelectTrigger><SelectValue placeholder="All Clubs (District Level)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">All Clubs (District Level)</SelectItem>
                    {clubs.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Credit Count *</Label>
                  <Input type="number" value={formCreditCount} onChange={(e) => setFormCreditCount(e.target.value)} placeholder="e.g. 500" min="1" />
                </div>
              <div className="space-y-2">
                <Label>Expiry Date *</Label>
                <DateField value={formToDate} onChange={setFormToDate} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Transaction ID</Label>
                <Input value={formTransactionId} onChange={(e) => setFormTransactionId(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <DateField value={formPaymentDate} onChange={setFormPaymentDate} />
              </div>
              <div className="space-y-2">
                <Label>Proof Document</Label>
                <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={(e) => setFormProofDocument(e.target.files?.[0] || null)} />
                <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, JPEG, PNG</p>
              </div>
            </div>
            <Button onClick={handleAddCredit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Add Credit
            </Button>
          </CardContent>
        </Card>

        {/* Tabs: Credits / Usage History */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="credits">Credits</TabsTrigger>
            <TabsTrigger value="history">Usage History</TabsTrigger>
          </TabsList>

          <TabsContent value="credits" className="space-y-4 mt-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Select value={filterDistrictId} onValueChange={(v) => { setFilterDistrictId(v === "all" ? "" : v); setFilterClubId(""); setPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All Districts" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Districts</SelectItem>
                      {districts.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filterClubId} onValueChange={(v) => { setFilterClubId(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All Clubs" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Clubs</SelectItem>
                      {filterClubs.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filterType} onValueChange={(v) => { setFilterType(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="Email">Email</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Export + Credits Table */}
            {items.length > 0 && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => exportToCSV(items, "credits", [
                  { key: "districtNumber", label: "District" }, { key: "clubName", label: "Club" },
                  { key: "creditType", label: "Type" }, { key: "creditCount", label: "Total" },
                  { key: "usedCount", label: "Used" }, { key: "remaining", label: "Remaining" },
                  { key: "toDate", label: "Expiry" }, { key: "transactionId", label: "Txn ID" },
                  { key: "isActive", label: "Active" }, { key: "isExpired", label: "Expired" },
                  { key: "createdDate", label: "Created Date" }, { key: "lastUsedDate", label: "Last Used" },
                ])}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
              </div>
            )}
            {loading ? (
              <RotaryLoader />
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>District</TableHead>
                        <TableHead>Club</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Previous</TableHead>
                        <TableHead className="text-right">Credited</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Used</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead>Txn ID</TableHead>
                        <TableHead>Proof</TableHead>
                        <TableHead>Credited On</TableHead>
                        <TableHead>Last Used</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                            No credits found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>{item.districtNumber}</TableCell>
                            <TableCell>{item.clubName}</TableCell>
                            <TableCell>
                              <Badge variant={item.creditType === "Email" ? "default" : "secondary"}>
                                {item.creditType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{item.previousCount}</TableCell>
                            <TableCell className="text-right text-green-600 font-medium">+{item.creditCount - item.previousCount > 0 ? item.creditCount - item.previousCount : item.creditCount}</TableCell>
                            <TableCell className="text-right font-bold">{item.remaining}</TableCell>
                            <TableCell className="text-right">{item.usedCount}</TableCell>
                            <TableCell className="text-sm">{new Date(item.toDate).toLocaleDateString(appLocale())}</TableCell>
                            <TableCell className="text-sm">{item.transactionId || "\u2014"}</TableCell>
                            <TableCell>
                              {item.proofDocumentPath ? (
                                <a href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${item.proofDocumentPath}`}
                                  target="_blank" className="text-xs text-blue-600 hover:underline">View</a>
                              ) : "\u2014"}
                            </TableCell>
                            <TableCell className="text-sm">{new Date(item.createdDate).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</TableCell>
                            <TableCell className="text-sm">{item.lastUsedDate ? new Date(item.lastUsedDate).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–"}</TableCell>
                            <TableCell>
                              {item.isExpired ? (
                                <Badge variant="destructive">Expired</Badge>
                              ) : item.isActive ? (
                                <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>
                              ) : (
                                <Badge variant="secondary">Inactive</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {!item.isExpired && item.isActive ? (
                                <div className="flex gap-1 justify-end">
                                  <Button variant="outline" size="sm" onClick={() => openEdit(item)} title="Edit">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  {item.usedCount === 0 && (
                                    <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteItem(item)} title="Delete">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">, </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm text-muted-foreground">
                        Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, totalCount)} of {totalCount}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1}>
                          Previous
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {/* History Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Select value={historyFilterDistrictId} onValueChange={(v) => { setHistoryFilterDistrictId(v === "all" ? "" : v); setHistoryFilterClubId(""); setHistoryPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All Districts" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Districts</SelectItem>
                      {districts.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={historyFilterClubId} onValueChange={(v) => { setHistoryFilterClubId(v === "all" ? "" : v); setHistoryPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All Clubs" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Clubs</SelectItem>
                      {historyFilterClubs.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={historyFilterType} onValueChange={(v) => { setHistoryFilterType(v === "all" ? "" : v); setHistoryPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="Email">Email</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Usage History Table */}
            {historyLoading ? (
              <RotaryLoader />
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date/Time</TableHead>
                        <TableHead>District</TableHead>
                        <TableHead>Club</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Detail</TableHead>
                        <TableHead className="text-right">Deducted</TableHead>
                        <TableHead className="text-right">Before</TableHead>
                        <TableHead className="text-right">After</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                            No usage history found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        historyItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-sm whitespace-nowrap">
                              {new Date(item.createdDate).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </TableCell>
                            <TableCell>{item.districtNumber || "\u2014"}</TableCell>
                            <TableCell>{item.clubName || "\u2014"}</TableCell>
                            <TableCell>
                              <Badge variant={item.creditType === "Email" ? "default" : "secondary"}>
                                {item.creditType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{formatSource(item.source)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={item.sourceDetail || ""}>
                              {item.sourceDetail || "\u2014"}
                            </TableCell>
                            <TableCell className="text-right text-red-600 font-medium">-{item.deductedCount}</TableCell>
                            <TableCell className="text-right">{item.balanceBefore}</TableCell>
                            <TableCell className="text-right font-medium">{item.balanceAfter}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>

                  {historyItems.length >= pageSize && (
                    <div className="flex items-center justify-end mt-4 gap-2">
                      <Button variant="outline" size="sm" onClick={() => setHistoryPage(p => p - 1)} disabled={historyPage <= 1}>
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">Page {historyPage}</span>
                      <Button variant="outline" size="sm" onClick={() => setHistoryPage(p => p + 1)} disabled={historyItems.length < pageSize}>
                        Next
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

      {/* Edit Credit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Credit Pack</DialogTitle>
          </DialogHeader>
          {editItem && (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-muted-foreground">
                {editItem.clubName} · {editItem.creditType} · Used: {editItem.usedCount}
              </div>
              <div className="space-y-1.5">
                <Label>Credit Count <span className="text-destructive">*</span></Label>
                <Input type="number" value={editCount} onChange={(e) => setEditCount(e.target.value)} min={editItem.usedCount} />
                <p className="text-xs text-muted-foreground">Must be at least {editItem.usedCount} (already used).</p>
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date <span className="text-destructive">*</span></Label>
                <DateField value={editToDate} onChange={setEditToDate} />
              </div>
              <div className="space-y-1.5">
                <Label>Transaction ID</Label>
                <Input value={editTransactionId} onChange={(e) => setEditTransactionId(e.target.value)} placeholder="Optional" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSubmitting}>
              {editSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Credit Pack?</DialogTitle>
          </DialogHeader>
          {deleteItem && (
            <p className="text-sm">
              Are you sure you want to delete <strong>{deleteItem.creditCount} {deleteItem.creditType}</strong> credits for <strong>{deleteItem.clubName}</strong>? This cannot be undone.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  );
}
