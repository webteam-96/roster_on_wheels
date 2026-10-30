"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Plus, Trash2, Search, ShieldCheck, Loader2, Phone, Mail, Building2 } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import {
  listSuperAdmins,
  searchSuperAdminCandidates,
  sendSuperAdminOtp,
  verifySuperAdminOtp,
  SuperAdminRow,
  SuperAdminSearchRow,
} from "@/services/api";

type DialogStep = "search" | "send-otp" | "enter-otp";

export default function SuperAdminRoleConfigPage() {
  const { user, isSuperAdmin } = useAuth();
  const currentUserId = user?.memberId;

  const [rows, setRows] = useState<SuperAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [step, setStep] = useState<DialogStep>("search");
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<SuperAdminSearchRow[]>([]);
  const [selected, setSelected] = useState<SuperAdminSearchRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  // No "Debug OTP" here: showing the code let whoever started the promotion approve it themselves.
  // The code now only reaches the approver by email.

  // Remove dialog state
  const [removeTarget, setRemoveTarget] = useState<SuperAdminRow | null>(null);
  const [removeStep, setRemoveStep] = useState<"send-otp" | "enter-otp">("send-otp");
  const [removeOtp, setRemoveOtp] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setRows(await listSuperAdmins());
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load SuperAdmins");
    } finally { setLoading(false); }
  };

  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin]);

  useEffect(() => {
    if (!searchQ || searchQ.trim().length < 2) { setCandidates([]); return; }
    const t = setTimeout(async () => {
      try {
        setSearching(true);
        setCandidates(await searchSuperAdminCandidates(searchQ));
      } catch (e: any) {
        setError(e?.response?.data?.message ?? "Search failed");
      } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  if (!isSuperAdmin) return (
    <ProtectedRoute>
      <div className="flex flex-col items-center justify-center py-20">
        <h3 className="text-lg font-semibold">Access Denied</h3>
        <p className="text-muted-foreground mt-2">Only SuperAdmin can access this page.</p>
      </div>
    </ProtectedRoute>
  );
  if (loading) return <ProtectedRoute><RotaryLoader /></ProtectedRoute>;

  // ── Add flow ─────────────────────────────────────────────────────────────
  const openAdd = () => {
    setAddOpen(true); setStep("search"); setSearchQ(""); setCandidates([]);
    setSelected(null); setOtpValue("");
  };

  const pickCandidate = (c: SuperAdminSearchRow) => {
    setSelected(c);
    setStep("send-otp");
  };
  const sendOtpForPromote = async () => {
    if (!selected) return;
    try {
      setBusy(true);
      const r = await sendSuperAdminOtp(selected.memberId, "PROMOTE");
      setStep("enter-otp");
      setSuccess(`OTP sent (Email: ${r.sentEmail ? "✓" : "✗"}). Ask the approver for the code.`);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to send OTP");
    } finally { setBusy(false); }
  };
  const verifyPromote = async () => {
    if (!selected) return;
    try {
      setBusy(true);
      const r = await verifySuperAdminOtp(selected.memberId, "PROMOTE", otpValue);
      setSuccess(r.message + (r.credentialsSent ? " Credentials emailed to the new SuperAdmin." : ""));
      setAddOpen(false);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "OTP verification failed");
    } finally { setBusy(false); }
  };

  // ── Remove flow ──────────────────────────────────────────────────────────
  const openRemove = (row: SuperAdminRow) => {
    if (row.memberId === currentUserId) {
      setError("You cannot remove your own SuperAdmin role.");
      return;
    }
    setRemoveTarget(row); setRemoveStep("send-otp"); setRemoveOtp("");
  };
  const sendOtpForRemove = async () => {
    if (!removeTarget) return;
    try {
      setRemoveBusy(true);
      const r = await sendSuperAdminOtp(removeTarget.memberId, "REMOVE");
      setRemoveStep("enter-otp");
      setSuccess(`OTP sent (Email: ${r.sentEmail ? "✓" : "✗"}). Ask the approver for the code.`);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to send OTP");
    } finally { setRemoveBusy(false); }
  };
  const verifyRemove = async () => {
    if (!removeTarget) return;
    try {
      setRemoveBusy(true);
      const r = await verifySuperAdminOtp(removeTarget.memberId, "REMOVE", removeOtp);
      setSuccess(r.message);
      setRemoveTarget(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "OTP verification failed");
    } finally { setRemoveBusy(false); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" /> Super Admin Role Config
            </h2>
            <p className="text-muted-foreground text-sm">Add or remove SuperAdmin access: OTP-gated by the approver on record.</p>
          </div>
          <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" /> Add SuperAdmin</Button>
        </div>

        <SuccessAlert open={!!success} title="Done" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error ?? ""} onOk={() => setError(null)} />

        <Card>
          <CardHeader><CardTitle className="text-lg">Current SuperAdmins ({rows.length})</CardTitle></CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No SuperAdmins found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                    <tr>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Mobile</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Promoted On</th>
                      <th className="px-3 py-2 text-left">Promoted By</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => {
                      const isSelf = r.memberId === currentUserId;
                      return (
                        <tr key={r.memberId} className={isSelf ? "bg-primary/5" : ""}>
                          <td className="px-3 py-2 font-medium">{r.memberName}{isSelf && <Badge variant="outline" className="ml-2 text-xs">You</Badge>}</td>
                          <td className="px-3 py-2">{r.mobile ?? "–"}</td>
                          <td className="px-3 py-2">{r.email ?? "–"}</td>
                          <td className="px-3 py-2">{r.promotedOn ? new Date(r.promotedOn).toLocaleDateString() : "–"}</td>
                          <td className="px-3 py-2">{r.promotedByName ?? "–"}</td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:bg-red-50 disabled:opacity-40"
                              onClick={() => openRemove(r)}
                              disabled={isSelf}
                              title={isSelf ? "Cannot remove yourself" : "Remove SuperAdmin role"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Add Dialog ───────────────────────────────────────────────── */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add SuperAdmin</DialogTitle>
            </DialogHeader>

            {step === "search" && (
              <div className="space-y-3">
                <Label>Search member by name, mobile, email or Rotary ID</Label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" autoFocus placeholder="Start typing..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
                </div>
                <div className="max-h-80 overflow-y-auto divide-y border rounded-md">
                  {searching && <div className="p-3 text-sm text-muted-foreground">Searching...</div>}
                  {!searching && searchQ.length >= 2 && candidates.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">No members found (or already SuperAdmin).</div>
                  )}
                  {candidates.map((c) => (
                    <button key={c.memberId} onClick={() => pickCandidate(c)} className="w-full text-left p-3 hover:bg-muted/40 transition-colors">
                      <div className="font-medium">{c.memberName}</div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {c.mobile && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" aria-hidden />{c.mobile}</span>}
                        {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" aria-hidden />{c.email}</span>}
                        {c.rotaryId && <span>RID {c.rotaryId}</span>}
                        {c.clubName && <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" aria-hidden />{c.clubName}</span>}
                        {c.districtNumber && <span>D {c.districtNumber}</span>}
                        {c.zoneName && <span>Zone {c.zoneName}</span>}
                      </div>
                      {c.currentRoles && (
                        <div className="text-xs mt-1"><Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">Has role: {c.currentRoles}</Badge></div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === "send-otp" && selected && (
              <div className="space-y-3">
                <div className="rounded-md border p-3 bg-muted/30 text-sm">
                  Promoting <strong>{selected.memberName}</strong> to SuperAdmin.
                </div>
                <p className="text-sm text-muted-foreground">
                  An OTP will be sent to the approver on record (their mobile + email). Ask them for the code, then enter it on the next step.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setStep("search")} disabled={busy}>Back</Button>
                  <Button onClick={sendOtpForPromote} disabled={busy}>
                    {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</> : "Send OTP"}
                  </Button>
                </DialogFooter>
              </div>
            )}

            {step === "enter-otp" && selected && (
              <div className="space-y-3">
                <div className="rounded-md border p-3 bg-muted/30 text-sm">
                  Enter the 6-digit OTP to confirm promoting <strong>{selected.memberName}</strong>.
                </div>
                <Input autoFocus maxLength={6} placeholder="6-digit OTP" value={otpValue} onChange={(e) => setOtpValue(e.target.value.replace(/[^0-9]/g, ""))} />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setStep("send-otp")} disabled={busy}>Back</Button>
                  <Button onClick={verifyPromote} disabled={otpValue.length !== 6 || busy}>
                    {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying...</> : "Verify & Promote"}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Remove Dialog ────────────────────────────────────────────── */}
        <Dialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Remove SuperAdmin</DialogTitle></DialogHeader>
            {removeTarget && (
              <>
                <div className="rounded-md border p-3 bg-red-50 border-red-200 text-sm">
                  Removing SuperAdmin role from <strong>{removeTarget.memberName}</strong>.
                  {removeTarget.email && <> They will be notified at <strong>{removeTarget.email}</strong>.</>}
                </div>

                {removeStep === "send-otp" && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      An OTP will be sent to the approver on record. Ask them for the code to confirm this removal.
                    </p>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={removeBusy}>Cancel</Button>
                      <Button variant="destructive" onClick={sendOtpForRemove} disabled={removeBusy}>
                        {removeBusy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</> : "Send OTP"}
                      </Button>
                    </DialogFooter>
                  </>
                )}

                {removeStep === "enter-otp" && (
                  <>
                    <Input autoFocus maxLength={6} placeholder="6-digit OTP" value={removeOtp} onChange={(e) => setRemoveOtp(e.target.value.replace(/[^0-9]/g, ""))} />
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRemoveStep("send-otp")} disabled={removeBusy}>Back</Button>
                      <Button variant="destructive" onClick={verifyRemove} disabled={removeOtp.length !== 6 || removeBusy}>
                        {removeBusy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying...</> : "Verify & Remove"}
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
