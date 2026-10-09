"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import DateField from "@/components/DateField";
import { useRouter } from "next/navigation";
import {
  getRiDirectorCreditBalance, getRiDirectorCredits, addRiDirectorCredit, getRiDirectorCreditHistory
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Plus, Upload, MessageSquare, MessageCircle, History } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function BalanceCard({ title, balance, total, used, icon: Icon, color }: {
  title: string; balance: number; total: number; used: number; icon: React.ElementType; color: string;
}) {
  return (
    <Card>
      <CardContent className={`p-5 bg-gradient-to-br ${color} rounded-lg text-white`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2"><Icon className="h-5 w-5" />{title}</h3>
        </div>
        <p className="text-4xl font-extrabold">{balance}</p>
        <p className="text-xs opacity-85 mt-1">Balance</p>
        <div className="flex items-center justify-between mt-3 text-xs opacity-90">
          <span>Total: {total}</span><span>Used: {used}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * RI Director credit pool (balance, Add Credits for Super Admin, Usage History). Used by
 * /ri-director/credits and, with `embedded`, by Settings › Wallet's "RI Director Credits" button.
 * `embedded` hides the back button and page title.
 */
export default function RiDirectorCreditsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const { isSuperAdmin } = useAuth();

  const [balance, setBalance] = useState<any>(null);
  const [credits, setCredits] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  const [creditType, setCreditType] = useState<"Email" | "WhatsApp">("Email");
  const [creditCount, setCreditCount] = useState("");
  const [fromDate, setFromDate] = useState(new Date().toISOString().split("T")[0]);
  const [toDate, setToDate] = useState(new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0]);
  const [transactionId, setTransactionId] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, c, h] = await Promise.all([
        getRiDirectorCreditBalance(),
        getRiDirectorCredits(undefined, 1, 100),
        getRiDirectorCreditHistory(undefined, 1, 100),
      ]);
      setBalance(b);
      setCredits(c.items || []);
      setHistory(h.items || []);
    } catch { setErrorMessage("Failed to load."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setCreditType("Email"); setCreditCount("");
    setFromDate(new Date().toISOString().split("T")[0]);
    setToDate(new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0]);
    setTransactionId(""); setPaymentDate(""); setProofFile(null);
  };

  const handleAdd = async () => {
    const count = parseInt(creditCount);
    if (!count || count <= 0) { setErrorMessage("Credit count must be positive."); return; }
    if (!fromDate || !toDate) { setErrorMessage("Date range required."); return; }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("CreditType", creditType);
      fd.append("CreditCount", String(count));
      fd.append("FromDate", fromDate);
      fd.append("ToDate", toDate);
      if (transactionId) fd.append("TransactionId", transactionId);
      if (paymentDate) fd.append("PaymentDate", paymentDate);
      if (proofFile) fd.append("proofDocument", proofFile);
      await addRiDirectorCredit(fd);
      setSuccessMessage("Credits added.");
      setShowAddDialog(false);
      resetForm();
      load();
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to add credits."); }
    finally { setSaving(false); }
  };

  const fmt = (s: string | null) => s ? new Date(s).toLocaleDateString("en-IN") : "-";

  if (loading) return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {embedded ? <div /> : (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href={isSuperAdmin ? "/settings/email-whatsapp-credits" : "/ri-director"}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">RI Director - Credit Management</h2>
              <p className="text-muted-foreground">Manage Email and WhatsApp credit pool</p>
            </div>
          </div>
          )}
          {isSuperAdmin && <Button onClick={() => setShowAddDialog(true)}><Plus className="mr-2 h-4 w-4" />Add Credits</Button>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <BalanceCard title="Email Credits" balance={balance?.emailBalance || 0} total={balance?.emailTotal || 0} used={balance?.emailUsed || 0} icon={MessageSquare} color="from-sky-500 to-blue-600" />
          <BalanceCard title="WhatsApp Credits" balance={balance?.whatsappBalance || 0} total={balance?.whatsappTotal || 0} used={balance?.whatsappUsed || 0} icon={MessageCircle} color="from-emerald-500 to-green-600" />
        </div>

        <Tabs defaultValue="credits">
          <TabsList>
            <TabsTrigger value="credits">Credits</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />Usage History</TabsTrigger>
          </TabsList>
          <TabsContent value="credits">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground font-semibold">Type</TableHead>
                    <TableHead className="text-primary-foreground font-semibold text-center">Count</TableHead>
                    <TableHead className="text-primary-foreground font-semibold text-center">Used</TableHead>
                    <TableHead className="text-primary-foreground font-semibold text-center">Balance</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">From</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">To</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">Txn ID</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">Proof</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">Created</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">Last Used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.length === 0 ? <TableRow><TableCell colSpan={10} className="text-center py-6">No credits added yet.</TableCell></TableRow> : credits.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell><span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${c.creditType === "Email" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>{c.creditType}</span></TableCell>
                      <TableCell className="text-center font-semibold">{c.creditCount}</TableCell>
                      <TableCell className="text-center">{c.usedCount}</TableCell>
                      <TableCell className="text-center font-semibold">{c.creditCount - c.usedCount}</TableCell>
                      <TableCell>{fmt(c.fromDate)}</TableCell>
                      <TableCell>{fmt(c.toDate)}</TableCell>
                      <TableCell>{c.transactionId || "-"}</TableCell>
                      <TableCell>{c.proofDocumentPath ? <a href={`${API_URL}${c.proofDocumentPath}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-sm">View</a> : "-"}</TableCell>
                      <TableCell>{fmt(c.createdDate)}</TableCell>
                      <TableCell>{c.lastUsedDate ? new Date(c.lastUsedDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="history">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground font-semibold">Date</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">Type</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">Source</TableHead>
                    <TableHead className="text-primary-foreground font-semibold">Detail</TableHead>
                    <TableHead className="text-primary-foreground font-semibold text-center">Deducted</TableHead>
                    <TableHead className="text-primary-foreground font-semibold text-center">Balance Before</TableHead>
                    <TableHead className="text-primary-foreground font-semibold text-center">Balance After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-6">No usage yet.</TableCell></TableRow> : history.map((h: any) => (
                    <TableRow key={h.id}>
                      <TableCell>{h.createdDate ? new Date(h.createdDate).toLocaleString("en-IN") : "-"}</TableCell>
                      <TableCell><span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${h.creditType === "Email" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>{h.creditType}</span></TableCell>
                      <TableCell>{h.source}</TableCell>
                      <TableCell className="max-w-xs truncate" title={h.sourceDetail}>{h.sourceDetail || "-"}</TableCell>
                      <TableCell className="text-center text-red-700">-{h.deductedCount}</TableCell>
                      <TableCell className="text-center">{h.balanceBefore}</TableCell>
                      <TableCell className="text-center font-semibold">{h.balanceAfter}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>

        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add RI Director Credits</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-semibold">Credit Type <span className="text-destructive">*</span></Label>
                <Select value={creditType} onValueChange={(v) => setCreditType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Email">Email</SelectItem>
                    <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-semibold">Count <span className="text-destructive">*</span></Label>
                <Input type="number" value={creditCount} onChange={(e) => setCreditCount(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-sm font-semibold">From Date <span className="text-destructive">*</span></Label>
                  <DateField value={fromDate} onChange={setFromDate} />
                </div>
                <div>
                  <Label className="text-sm font-semibold">To Date <span className="text-destructive">*</span></Label>
                  <DateField value={toDate} onChange={setToDate} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-sm font-semibold">Transaction ID</Label>
                  <Input value={transactionId} onChange={(e) => setTransactionId(e.target.value)} />
                </div>
                <div>
                  <Label className="text-sm font-semibold">Payment Date</Label>
                  <DateField value={paymentDate} onChange={setPaymentDate} />
                </div>
              </div>
              <div>
                <Label className="text-sm font-semibold">Proof Document</Label>
                <input ref={proofInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" className="hidden" onChange={(e) => setProofFile(e.target.files?.[0] || null)} />
                <Button variant="outline" onClick={() => proofInputRef.current?.click()} className="w-full justify-start">
                  <Upload className="mr-2 h-4 w-4" />
                  {proofFile ? proofFile.name : "Upload proof (optional)"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, JPEG, PNG</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button onClick={handleAdd} disabled={saving}>{saving ? <RotaryLoader size="sm" /> : "Add Credits"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
