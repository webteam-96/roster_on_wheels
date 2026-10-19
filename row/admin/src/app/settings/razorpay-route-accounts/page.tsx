"use client";

/**
 * SuperAdmin › Razorpay Route Accounts.
 * --------------------------------------------------------------------------
 * "Add account" creates the Razorpay Route linked account ON Razorpay (linked account +
 * stakeholder + Route product + settlement bank), then stores the returned acc_… id here.
 * The parent Razorpay account must have Route enabled. If the account can't be created,
 * nothing is saved and Razorpay's error is shown; if it's created but a later step fails,
 * the acc_… id is still saved and the warnings are surfaced.
 *
 * "Edit" only changes the local display name / notes / active flag (the acc_… id is
 * immutable once created). Selected per-club in Club Websites → Pricing & Reminders.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, RefreshCw, RotateCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  getRazorpayRouteAccounts,
  createRazorpayRouteAccount,
  updateRazorpayRouteAccount,
  deleteRazorpayRouteAccount,
  sendRazorpayRouteOtp,
  refreshRazorpayRouteAccount,
  refreshAllRazorpayRouteAccounts,
  type RazorpayRouteAccount,
  type RouteAccountOnboardingPayload,
} from "@/services/api";

// Razorpay v2 linked-account business types. The PAN below must match the chosen type
// (e.g. a company PAN for private/public limited, an individual PAN for proprietorship/individual).
const BUSINESS_TYPES: { value: string; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "proprietorship", label: "Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "private_limited", label: "Private Limited" },
  { value: "public_limited", label: "Public Limited" },
  { value: "llp", label: "LLP" },
  { value: "trust", label: "Trust" },
  { value: "society", label: "Society" },
  { value: "ngo", label: "NGO" },
  { value: "not_yet_registered", label: "Not Yet Registered" },
  { value: "educational_institutes", label: "Educational Institutes" },
  { value: "other", label: "Other" },
];

// Minimal onboarding form — Razorpay needs a name, contact email, business type and settlement bank
// to create the linked account; category / address are generic-defaulted server-side.
type OnboardForm = {
  name: string; email: string; businessType: string;
  pan: string; gst: string; nameOnDocument: string;   // KYC
  bankAccountNumber: string; bankIfsc: string; bankBeneficiaryName: string;
  isActive: boolean; notes: string;
};

const emptyOnboard: OnboardForm = {
  name: "", email: "", businessType: "trust",
  pan: "", gst: "", nameOnDocument: "",
  bankAccountNumber: "", bankIfsc: "", bankBeneficiaryName: "",
  isActive: true, notes: "",
};

type EditForm = {
  id: number; accountId: string; name: string; isActive: boolean; notes: string;
  // Settlement bank details — blank means "leave unchanged" (Razorpay's Route API doesn't
  // reliably echo these back, so this is a re-entry/backfill field, not always required).
  bankAccountNumber: string; bankIfsc: string; currentBankLast4: string | null;
};

export default function RazorpayRouteAccountsPage() {
  const [rows, setRows] = useState<RazorpayRouteAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<OnboardForm>(emptyOnboard);
  const [creating, setCreating] = useState(false);

  const [edit, setEdit] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RazorpayRouteAccount | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // OTP-before-create
  const [otpOpen, setOtpOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpEmail, setOtpEmail] = useState("");   // logged-in admin's email the OTP was sent to
  const [sendingOtp, setSendingOtp] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await getRazorpayRouteAccounts(false)) || []); }
    catch { setErrorMessage("Could not load Route accounts."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-sync live Razorpay status once per visit for any not-yet-activated account, so the
  // page never shows a stale "needs_clarification" after Razorpay has activated it in the background.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (autoSynced.current || loading || rows.length === 0) return;
    autoSynced.current = true;
    const pending = rows.some((r) => {
      const s = (r.status || "").toLowerCase();
      return s !== "activated" && s !== "active";
    });
    if (!pending) return;
    (async () => {
      try { await refreshAllRazorpayRouteAccounts(); await load(); } catch { /* silent */ }
    })();
  }, [loading, rows, load]);

  const set = (k: keyof OnboardForm, v: any) => setForm((s) => ({ ...s, [k]: v }));

  const createValid =
    form.name.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.bankAccountNumber.trim().length > 0 &&
    form.bankIfsc.trim().length > 0;

  // Step 1: validate + send an OTP to the logged-in admin's email, then open the OTP dialog.
  const startCreate = async () => {
    if (!createValid) return;
    setSendingOtp(true); setErrorMessage(null);
    try {
      const res = await sendRazorpayRouteOtp();
      setOtpEmail(res.email || "");
      setOtp("");
      setOtpOpen(true);
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Could not send the OTP. Please try again.");
    } finally { setSendingOtp(false); }
  };

  const resendOtp = async () => {
    setSendingOtp(true); setErrorMessage(null);
    try { const res = await sendRazorpayRouteOtp(); setOtpEmail(res.email || otpEmail); setSuccessMessage(`OTP re-sent to ${res.email || "your email"}.`); }
    catch (e: any) { setErrorMessage(e?.response?.data?.message || "Could not resend the OTP."); }
    finally { setSendingOtp(false); }
  };

  // Step 2: verify OTP + create the account on Razorpay.
  const confirmCreate = async () => {
    if (otp.trim().length !== 6) { setErrorMessage("Enter the 6-digit OTP."); return; }
    setCreating(true); setErrorMessage(null);
    const payload: RouteAccountOnboardingPayload = {
      name: form.name.trim(),
      customerFacingBusinessName: form.name.trim(),
      // legal_business_name must match the PAN/GST document; falls back to the account name.
      legalBusinessName: form.nameOnDocument.trim() || form.name.trim(),
      email: form.email.trim(),
      businessType: form.businessType,
      pan: form.pan.trim() || undefined,
      gst: form.gst.trim() || undefined,
      bankAccountNumber: form.bankAccountNumber.trim(),
      bankIfsc: form.bankIfsc.trim().toUpperCase(),
      bankBeneficiaryName: form.bankBeneficiaryName.trim() || undefined,
      isActive: form.isActive,
      notes: form.notes.trim() || undefined,
      otp: otp.trim(),
    };
    try {
      const res = await createRazorpayRouteAccount(payload);
      let msg = `Linked account created: ${res.accountId}${res.status ? ` (status: ${res.status})` : ""}.`;
      if (res.warnings?.length) msg += ` Note: ${res.warnings.join(" | ")}`;
      setSuccessMessage(msg);
      setOtpOpen(false);
      setAddOpen(false);
      setForm(emptyOnboard);
      setOtp("");
      await load();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Could not create the linked account on Razorpay.");
    } finally { setCreating(false); }
  };

  const refreshOne = async (r: RazorpayRouteAccount) => {
    setBusyId(r.id); setErrorMessage(null);
    try { const res = await refreshRazorpayRouteAccount(r.id); setSuccessMessage(`Status: ${res.status || "unknown"}.`); await load(); }
    catch (e: any) { setErrorMessage(e?.response?.data?.message || "Could not refresh status."); }
    finally { setBusyId(null); }
  };

  const refreshAll = async () => {
    setRefreshingAll(true); setErrorMessage(null);
    try { const res = await refreshAllRazorpayRouteAccounts(); setSuccessMessage(`Refreshed ${res.refreshed} account(s).`); await load(); }
    catch (e: any) { setErrorMessage(e?.response?.data?.message || "Could not refresh."); }
    finally { setRefreshingAll(false); }
  };

  const saveEdit = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { setErrorMessage("Display name is required."); return; }
    setSavingEdit(true); setErrorMessage(null);
    try {
      await updateRazorpayRouteAccount(edit.id, {
        accountId: edit.accountId, name: edit.name.trim(), isActive: edit.isActive, notes: edit.notes.trim() || null,
        bankAccountNumber: edit.bankAccountNumber.trim() || undefined,
        bankIfsc: edit.bankIfsc.trim() || undefined,
      });
      setSuccessMessage("Account updated.");
      setEdit(null);
      await load();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Could not save. Please try again.");
    } finally { setSavingEdit(false); }
  };

  const doDelete = async (r: RazorpayRouteAccount) => {
    setBusyId(r.id); setErrorMessage(null); setConfirmDelete(null);
    try { await deleteRazorpayRouteAccount(r.id); setSuccessMessage("Account removed."); await load(); }
    catch (e: any) { setErrorMessage(e?.response?.data?.message || "Could not delete."); }
    finally { setBusyId(null); }
  };

  return (
    <ProtectedRoute>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <SuccessAlert open={!!successMessage} title="Done" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-1">
              <ArrowLeft className="h-4 w-4" /> Settings
            </Link>
            <h1 className="text-2xl font-bold text-azure">Razorpay Route Accounts</h1>
            <p className="text-sm text-slate-500">Linked accounts (acc_…) that club-website payments can be routed to. Adding one creates it on Razorpay.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button variant="outline" onClick={refreshAll} disabled={refreshingAll || rows.length === 0}>
              {refreshingAll ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RotateCw className="h-4 w-4 mr-1.5" />}
              Refresh statuses
            </Button>
            <Button onClick={() => { setForm(emptyOnboard); setAddOpen(true); }}><Plus className="h-4 w-4 mr-1.5" /> Add account</Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Account ID</th>
                <th className="text-left px-4 py-2.5 font-medium">Settlement A/C</th>
                <th className="text-left px-4 py-2.5 font-medium">Razorpay status</th>
                <th className="text-left px-4 py-2.5 font-medium">Enabled</th>
                <th className="px-4 py-2.5 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No Route accounts yet. Add one to route payments.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    {r.notes && <div className="text-xs text-slate-400 max-w-xs truncate">{r.notes}</div>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.accountId}</td>
                  <td className="px-4 py-2.5">
                    {r.bankAccountLast4
                      ? <div><span className="font-mono text-slate-700">•••• {r.bankAccountLast4}</span>{r.bankIfsc && <div className="text-xs text-slate-400 font-mono">{r.bankIfsc}</div>}</div>
                      : <span className="text-slate-300" title="Add via the edit (✎) dialog: Razorpay doesn't expose it for accounts created in their dashboard">, </span>}
                  </td>
                  <td className="px-4 py-2.5">{statusBadge(r.status)}</td>
                  <td className="px-4 py-2.5">
                    {r.isActive ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Enabled</Badge>
                      : <Badge variant="secondary">Disabled</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" title="Refresh status from Razorpay" onClick={() => refreshOne(r)} disabled={busyId === r.id}>
                      {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEdit({ id: r.id, accountId: r.accountId, name: r.name, isActive: !!r.isActive, notes: r.notes || "", bankAccountNumber: "", bankIfsc: "", currentBankLast4: r.bankAccountLast4 })}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(r)} disabled={busyId === r.id}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add — minimal Razorpay Route onboarding */}
        <Dialog open={addOpen} onOpenChange={(o) => { if (!creating) setAddOpen(o); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Add Route account</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Creates the linked account on Razorpay with its PAN/GST and settlement bank. Pick the business type
                that matches the PAN; address is generic-filled. Any remaining KYC (documents) is finished in the
                Razorpay dashboard.
              </p>
              <Field label="Account name *">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Rotary Zone 5 Collections" />
              </Field>
              <Field label="Contact email *">
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="for Razorpay KYC" />
              </Field>

              {/* KYC — business type + PAN + GST + the name exactly as on those documents */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                <div className="text-xs font-semibold text-slate-600">KYC (progresses activation)</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Business type *">
                    <Select value={form.businessType} onValueChange={(v) => set("businessType", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{BUSINESS_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label="Business PAN">
                    <Input value={form.pan} onChange={(e) => set("pan", e.target.value.toUpperCase().slice(0, 10))} placeholder="ABCDT1234E" className="font-mono" />
                  </Field>
                  <Field label="GST (optional)">
                    <Input value={form.gst} onChange={(e) => set("gst", e.target.value.toUpperCase().slice(0, 15))} className="font-mono" />
                  </Field>
                  <Field label="Name on PAN / GST document">
                    <Input value={form.nameOnDocument} onChange={(e) => set("nameOnDocument", e.target.value)} placeholder="Defaults to the account name" />
                  </Field>
                </div>
                <p className="text-[11px] text-slate-400">
                  The PAN must match the business type: a company PAN (4th letter C) for private/public limited, an
                  individual PAN (4th letter P) for individual/proprietorship, etc.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Settlement account no. *">
                  <Input value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value.replace(/\s/g, ""))} />
                </Field>
                <Field label="IFSC *">
                  <Input value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} className="font-mono" />
                </Field>
              </div>
              <Field label="Beneficiary name (optional: defaults to account name)">
                <Input value={form.bankBeneficiaryName} onChange={(e) => set("bankBeneficiaryName", e.target.value)} />
              </Field>
              <Field label="Notes (optional)">
                <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Checkbox checked={form.isActive} onCheckedChange={(v) => set("isActive", !!v)} />
                Active (selectable for club pricing)
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)} disabled={creating || sendingOtp}>Cancel</Button>
              <Button onClick={startCreate} disabled={!createValid || sendingOtp || creating}>
                {sendingOtp ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Sending OTP…</> : "Verify & create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* OTP — verify the contact email before creating on Razorpay */}
        <Dialog open={otpOpen} onOpenChange={(o) => { if (!creating) setOtpOpen(o); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Verify OTP</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                We sent a 6-digit OTP to your email <span className="font-medium">{otpEmail || "on file"}</span>. Enter it to create the linked account.
              </p>
              <Input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit OTP"
                inputMode="numeric"
                className="text-center text-lg tracking-[0.5em] font-mono"
                autoFocus
              />
              <button type="button" onClick={resendOtp} disabled={sendingOtp} className="text-xs text-azure hover:underline disabled:opacity-50">
                {sendingOtp ? "Resending…" : "Resend OTP"}
              </button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOtpOpen(false)} disabled={creating}>Cancel</Button>
              <Button onClick={confirmCreate} disabled={otp.length !== 6 || creating}>
                {creating ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Creating on Razorpay…</> : "Create on Razorpay"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit — local fields only (acc_… is immutable) */}
        <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Edit Route account</DialogTitle></DialogHeader>
            {edit && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Razorpay account ID</Label>
                  <Input value={edit.accountId} disabled className="font-mono bg-slate-50" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Display name</Label>
                  <Input value={edit.name} onChange={(e) => setEdit((s) => s && { ...s, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Notes</Label>
                  <Textarea rows={2} value={edit.notes} onChange={(e) => setEdit((s) => s && { ...s, notes: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Checkbox checked={edit.isActive} onCheckedChange={(v) => setEdit((s) => s && { ...s, isActive: !!v })} />
                  Active (selectable for club pricing)
                </label>
                <div className="space-y-1 pt-2 border-t">
                  <Label className="text-xs text-slate-500">
                    Settlement bank account number
                    {edit.currentBankLast4 ? ` (on file: •••• ${edit.currentBankLast4})` : " (not on file yet)"}
                  </Label>
                  <Input
                    value={edit.bankAccountNumber}
                    onChange={(e) => setEdit((s) => s && { ...s, bankAccountNumber: e.target.value })}
                    placeholder="Leave blank to keep unchanged"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Settlement IFSC</Label>
                  <Input
                    value={edit.bankIfsc}
                    onChange={(e) => setEdit((s) => s && { ...s, bankIfsc: e.target.value.toUpperCase() })}
                    placeholder="Leave blank to keep unchanged"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Remove Route account?</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-600">
              Remove <span className="font-medium">{confirmDelete?.name}</span> ({confirmDelete?.accountId}) from this portal? This does not delete the account on Razorpay. Clubs currently using it must be reassigned first.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => confirmDelete && doDelete(confirmDelete)}>Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

// Razorpay activation status → coloured badge. activated/active = green, rejected/suspended = red,
// needs_clarification = amber, everything else (created/under_review/…) = neutral.
function statusBadge(status: string | null) {
  if (!status) return <span className="text-xs text-slate-400">, </span>;
  const s = status.toLowerCase();
  const label = status.replace(/_/g, " ");
  if (s === "activated" || s === "active")
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{label}</Badge>;
  if (s === "rejected" || s === "suspended")
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{label}</Badge>;
  if (s === "needs_clarification")
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}
