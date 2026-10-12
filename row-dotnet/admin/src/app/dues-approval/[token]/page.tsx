"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getDuesApprovalSnapshot, applyDuesApproval } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, ShieldCheck, Mail, Building2, Calendar, IndianRupee, FileText, Receipt } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatAmount(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  if (isNaN(v)) return String(n);
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function PublicDuesApprovalPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = String(params?.token || "");
  // Picked by the email button. "approve" / "reject" → focused single-action
  // view. Anything else → fall back to the dual-button view.
  const initialAction = (searchParams.get("action") || "").toLowerCase();
  const intendedAction: "approve" | "reject" | null =
    initialAction === "approve" ? "approve"
    : initialAction === "reject" ? "reject"
    : null;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [approveRemark, setApproveRemark] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  // Tracks whether the admin clicked Approve / Reject in THIS browser session.
  // When false, a final status came from the GET (someone else already
  // handled it) — show "Already approved/rejected" wording. When true, the
  // status changed because of an action the admin just took on this page —
  // show "Payment approved/rejected".
  const [justActioned, setJustActioned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const snapshot = await getDuesApprovalSnapshot(token);
      setData(snapshot);
    } catch (err: any) {
      setLoadError(err?.response?.data?.message || "This approval link could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  // After the snapshot is fetched, auto-open the dialog that matches the
  // ?action=approve|reject the user clicked from the email. Only do it once
  // and only when the payment is actually pending — if someone already
  // handled it, the page falls through to the "already handled" banner.
  const dialogAutoOpened = useRef(false);
  useEffect(() => {
    if (dialogAutoOpened.current) return;
    if (!data) return;
    if (data.status !== "Pending") return;
    if (intendedAction === "approve") {
      dialogAutoOpened.current = true;
      setApproveRemark("");
      setActionError(null);
      setApproveDialogOpen(true);
    } else if (intendedAction === "reject") {
      dialogAutoOpened.current = true;
      setRejectReason("");
      setActionError(null);
      setRejectDialogOpen(true);
    }
  }, [data, intendedAction]);

  const handleApprove = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      const result = await applyDuesApproval(token, { action: "approve", approvalRemark: approveRemark.trim() || undefined });
      setData(result);
      // Only mark "justActioned" if the request actually changed state —
      // backend returns alreadyHandled:true when it was a no-op (someone
      // else got there first), in which case the wording should still say
      // "already approved".
      if (!result?.alreadyHandled) setJustActioned(true);
      setApproveDialogOpen(false);
      setApproveRemark("");
    } catch (err: any) {
      setActionError(err?.response?.data?.message || "Failed to approve payment.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setActionError("Rejection reason is required.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      const result = await applyDuesApproval(token, { action: "reject", rejectionReason: rejectReason.trim() });
      setData(result);
      setRejectDialogOpen(false);
      setRejectReason("");
    } catch (err: any) {
      setActionError(err?.response?.data?.message || "Failed to reject payment.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading approval…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              Approval Link Unavailable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">{loadError}</p>
            <p className="text-xs text-slate-500 mt-3">
              If this is unexpected, ask the member to re-submit, or log in to the admin portal directly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const status = String(data.status || "");
  const isPending = status === "Pending";
  const isApproved = status === "Approved";
  const isRejected = status === "Rejected";
  const alreadyHandled = !!data.alreadyHandled;

  const handled = data.handled || {};
  const dues = data.dues || {};
  const member = data.member || {};
  const club = data.club || {};
  const actor = data.actor || {};

  const attachmentUrl = dues.attachment
    ? (String(dues.attachment).startsWith("/") ? `${API_BASE_URL}${dues.attachment}` : `${API_BASE_URL}/${dues.attachment}`)
    : null;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Brand strip */}
        <div className="bg-[#1a365d] text-white text-center py-3 rounded-lg shadow-sm">
          <h1 className="text-base font-semibold">ROW</h1>
          <p className="text-xs opacity-80">Club Dues — Offline Payment Approval</p>
        </div>

        {/* Status banner */}
        {isApproved && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="p-4 flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 mt-0.5 shrink-0" />
              <div className="text-sm text-emerald-900">
                <p className="font-semibold">
                  {alreadyHandled ? "This payment was already approved" : "Payment approved"}
                </p>
                <p className="text-xs text-emerald-800 mt-1">
                  on {formatDate(handled.approvedOn)} by <strong>{handled.approvedByName || "—"}</strong>
                  {handled.approvalSource ? <> · via {handled.approvalSource}</> : null}
                </p>
                {handled.approvalRemark && (
                  <p className="text-xs text-emerald-800 mt-1">Remark: {handled.approvalRemark}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        {isRejected && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 flex items-start gap-3">
              <XCircle className="h-6 w-6 text-red-600 mt-0.5 shrink-0" />
              <div className="text-sm text-red-900">
                <p className="font-semibold">
                  {alreadyHandled ? "This payment was already rejected" : "Payment rejected"}
                </p>
                <p className="text-xs text-red-800 mt-1">
                  on {formatDate(handled.rejectedOn)} by <strong>{handled.rejectedByName || "—"}</strong>
                  {handled.rejectionSource ? <> · via {handled.rejectionSource}</> : null}
                </p>
                {handled.rejectionReason && (
                  <p className="text-xs text-red-800 mt-1">Reason: {handled.rejectionReason}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payment details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[#1a365d]">
              <Receipt className="h-5 w-5" />
              Payment Details
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-6">
              <div>
                <dt className="text-xs text-slate-500">Member</dt>
                <dd className="font-medium">{member.name || "—"}</dd>
                <dd className="text-xs text-slate-500">{member.email || ""}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 flex items-center gap-1"><Building2 className="h-3 w-3" /> Club</dt>
                <dd className="font-medium">{club.name || "—"}</dd>
                <dd className="text-xs text-slate-500">District {club.districtNumber || "—"} · RY {dues.rotaryYear || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Purpose</dt>
                <dd className="font-medium">{dues.purpose || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Fee Type</dt>
                <dd className="font-medium">{dues.feeLabel || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 flex items-center gap-1"><IndianRupee className="h-3 w-3" /> Amount</dt>
                <dd className="font-semibold text-base">{formatAmount(dues.amount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 flex items-center gap-1"><Calendar className="h-3 w-3" /> Payment Date</dt>
                <dd className="font-medium">{formatDate(dues.paymentDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Payment Mode</dt>
                <dd className="font-medium">{dues.transactionType || "—"}</dd>
              </div>
              {dues.transactionId && (
                <div>
                  <dt className="text-xs text-slate-500">Transaction ID</dt>
                  <dd className="font-medium">{dues.transactionId}</dd>
                </div>
              )}
              {dues.givenTo && (
                <div>
                  <dt className="text-xs text-slate-500">Given To</dt>
                  <dd className="font-medium">{dues.givenTo}</dd>
                </div>
              )}
              {dues.bankName && (
                <div>
                  <dt className="text-xs text-slate-500">Bank</dt>
                  <dd className="font-medium">{dues.bankName}</dd>
                </div>
              )}
              {dues.chequeNumber && (
                <div>
                  <dt className="text-xs text-slate-500">Cheque #</dt>
                  <dd className="font-medium">{dues.chequeNumber}</dd>
                </div>
              )}
              {dues.memberRemark && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">Member's Remark</dt>
                  <dd className="text-sm">{dues.memberRemark}</dd>
                </div>
              )}
              {attachmentUrl && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500 flex items-center gap-1"><FileText className="h-3 w-3" /> Attachment</dt>
                  <dd>
                    <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">
                      Open attachment
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Actor card */}
        <Card className="border-slate-200">
          <CardContent className="p-4 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-[#1a365d] mt-0.5 shrink-0" />
            <div className="text-sm text-slate-700">
              <p>
                Signed in as <strong>{actor.name || "—"}</strong>{" "}
                {actor.designation && <Badge variant="outline" className="ml-1">{actor.designation}</Badge>}
              </p>
              <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                <Mail className="h-3 w-3" /> {actor.email || "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Your action will be recorded against your name in the audit log.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Action buttons — only when pending */}
        {isPending && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-slate-700 mb-3">Decide whether to approve or reject this payment:</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  size="lg"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => { setApproveRemark(""); setActionError(null); setApproveDialogOpen(true); }}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" /> Approve
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => { setRejectReason(""); setActionError(null); setRejectDialogOpen(true); }}
                >
                  <XCircle className="h-4 w-4 mr-2" /> Reject
                </Button>
              </div>
              {actionError && <p className="text-xs text-red-700 mt-3">{actionError}</p>}
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-slate-400 pt-2">
          This is generated by ROW
        </p>
      </div>

      {/* Approve dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              You're about to approve {formatAmount(dues.amount)} from <strong>{member.name}</strong> for <strong>{dues.feeLabel}</strong>.
            </p>
            <div>
              <Label>Approval Remark <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Textarea
                rows={3}
                value={approveRemark}
                onChange={(e) => setApproveRemark(e.target.value)}
                placeholder="Optional remark — will appear on the receipt email if provided"
              />
            </div>
            {actionError && <p className="text-xs text-red-700">{actionError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)} disabled={submitting}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleApprove} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {submitting ? "Approving…" : "Confirm Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              You're about to reject {formatAmount(dues.amount)} from <strong>{member.name}</strong> for <strong>{dues.feeLabel}</strong>.
            </p>
            <div>
              <Label>Rejection Reason <span className="text-red-600">*</span></Label>
              <Textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter the reason for rejection (required)"
                required
              />
            </div>
            {actionError && <p className="text-xs text-red-700">{actionError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)} disabled={submitting}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={submitting || !rejectReason.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
              {submitting ? "Rejecting…" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
