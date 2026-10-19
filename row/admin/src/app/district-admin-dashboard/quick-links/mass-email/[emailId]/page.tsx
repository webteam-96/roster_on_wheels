"use client";

/**
 * V2 — Mass Email detail (read-only preview) under the District Admin shell.
 * ---------------------------------------------------------------------------
 * Additive port of the V1 detail
 *   (src/app/districts/[id]/mass-emails/[emailId]/page.tsx)
 * with V2 conventions:
 *   - districtId from useAuth().selectedDistrictId (no /districts/[id] param).
 *   - Back honours ?returnTo=; falls back to the Mass Email listing.
 *   - Header actions: Edit (Draft only → compose?editId=), Send (Draft only),
 *     Delete. Draft edit/send/delete + Failed retry all funnel through send/delete.
 *   - ?yearId= is forwarded through every navigation.
 *   - Body is rendered as HTML (rich text from the quill compose editor).
 *   - Design palette: navy #17458f, gold #F7A81B, slate borders/text.
 */

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getDistrictMassEmailDetail, sendDistrictMassEmail, deleteDistrictMassEmail, getDistrict,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  ArrowLeft, Send, Pencil, Trash2, CheckCircle2, XCircle, Clock, Loader2, AlertTriangle,
} from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
const BASE = "/district-admin-dashboard/quick-links/mass-email";

function withSearch(base: string, extra: Record<string, string | null | undefined>) {
  const p = new URLSearchParams();
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

interface Recipient { memberId: number; memberName: string; email: string; status: string; sentDate: string | null; errorMessage: string | null; }
interface MassEmailDetail {
  id: number; recipientType: number; fkSubgroupId: number | null;
  subgroupName: string | null; fromName: string; replyName: string | null;
  replyEmail: string | null; subject: string; emailBody: string | null;
  status: string; totalRecipients: number; sentCount: number; failedCount: number;
  sentDate: string | null; createdDate: string; recipients: Recipient[];
}

export default function DistrictAdminMassEmailDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedDistrictId, isSuperAdmin, isAdmin } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const emailId = Number(params.emailId);
  const returnTo = searchParams.get("returnTo");
  const yearId = searchParams.get("yearId");
  const canManage = isSuperAdmin || isAdmin;

  const goBack = () => router.push(withSearch(returnTo || BASE, { yearId }));

  const [detail, setDetail] = useState<MassEmailDetail | null>(null);
  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!districtId) return;
    async function load() {
      try {
        const [d, emailDetail] = await Promise.all([getDistrict(districtId), getDistrictMassEmailDetail(districtId, emailId)]);
        setDistrictName(`District ${d.districtNumber}`); setDetail(emailDetail);
      } catch { setErrorMessage("Failed to load email details."); }
      setLoading(false);
    }
    load();
  }, [districtId, emailId]);

  const handleSend = async () => {
    setProcessing(true); setConfirmSend(false);
    try {
      await sendDistrictMassEmail(districtId, emailId);
      setSuccessMessage("Email is being sent.");
      setTimeout(async () => { try { const updated = await getDistrictMassEmailDetail(districtId, emailId); setDetail(updated); } catch {} }, 2000);
    } catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to send."); }
    setProcessing(false);
  };

  const handleDelete = async () => {
    setProcessing(true); setConfirmDelete(false);
    try {
      await deleteDistrictMassEmail(districtId, emailId);
      setSuccessMessage("Email deleted successfully.");
      setTimeout(goBack, 1000);
    } catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to delete."); setProcessing(false); }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Sent": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "Failed": return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-amber-500" />;
    }
  };
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Draft": return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">Draft</Badge>;
      case "Sending": return <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Sending</Badge>;
      case "Sent": return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Sent</Badge>;
      case "Failed": return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Failed</Badge>;
      default: return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">{status}</Badge>;
    }
  };
  const getRecipientTypeLabel = (type: number) => {
    switch (type) { case 1: return "All Members"; case 2: return "Clubs"; case 3: return "Subgroups"; default: return "–"; }
  };

  if (!districtId) return null;
  if (loading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;
  if (!detail) return <div className="text-center py-20 text-slate-500">Email not found.</div>;

  const isDraft = detail.status === "Draft";

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={goBack}
              className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-ink">Mass Email Detail</h2>
              <p className="text-slate-500 text-sm mt-0.5">{districtName}</p>
            </div>
          </div>
          {canManage && isDraft && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
                onClick={() => router.push(withSearch(`${BASE}/compose`, { editId: String(detail.id), returnTo, yearId }))}
              >
                <Pencil className="h-4 w-4 mr-2" />Edit
              </Button>
              <Button className="bg-azure hover:bg-mint-ink text-white" onClick={() => setConfirmSend(true)} disabled={processing}>
                {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}Send
              </Button>
              <Button
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => setConfirmDelete(true)}
                disabled={processing}
              >
                <Trash2 className="h-4 w-4 mr-2" />Delete
              </Button>
            </div>
          )}
        </div>

        {/* Summary card */}
        <div className="rounded-2xl border border-slate-200 shadow-sm bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-azure/5">
            <h3 className="text-sm font-semibold text-slate-800 truncate">{detail.subject}</h3>
            {getStatusBadge(detail.status)}
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-500">From: </span><span className="font-medium text-slate-800">{detail.fromName}</span></div>
              {detail.replyEmail && <div><span className="text-slate-500">Reply To: </span><span className="font-medium text-slate-800">{detail.replyName || detail.replyEmail} &lt;{detail.replyEmail}&gt;</span></div>}
              <div><span className="text-slate-500">Recipients: </span><span className="font-medium text-slate-800">{detail.totalRecipients} ({getRecipientTypeLabel(detail.recipientType)}{detail.subgroupName ? ` - ${detail.subgroupName}` : ""})</span></div>
              <div><span className="text-slate-500">Date: </span><span className="font-medium text-slate-800">{detail.sentDate ? new Date(detail.sentDate).toLocaleString(appLocale()) : new Date(detail.createdDate).toLocaleString(appLocale())}</span></div>
            </div>

            {!isDraft && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center"><p className="text-2xl font-bold text-blue-700">{detail.totalRecipients}</p><p className="text-xs text-blue-600">Total</p></div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center"><p className="text-2xl font-bold text-emerald-700">{detail.sentCount}</p><p className="text-xs text-emerald-600">Sent</p></div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center"><p className="text-2xl font-bold text-red-700">{detail.failedCount}</p><p className="text-xs text-red-600">Failed</p></div>
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center"><p className="text-2xl font-bold text-orange-700">{Math.max(0, detail.totalRecipients - detail.sentCount - detail.failedCount)}</p><p className="text-xs text-orange-600">Not Delivered</p></div>
              </div>
            )}

            {detail.emailBody && (
              <div className="border-t border-slate-100 pt-4">
                <p className="text-sm text-slate-500 mb-2">Email Body:</p>
                <div
                  className={
                    "bg-slate-50 rounded-lg p-4 prose prose-sm max-w-none break-words " +
                    "[overflow-wrap:anywhere] [&_*]:max-w-full [&_img]:h-auto " +
                    "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_a]:break-all"
                  }
                  dangerouslySetInnerHTML={{ __html: detail.emailBody }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Recipients table */}
        <div className="rounded-2xl border border-slate-200 shadow-sm bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-azure/5">
            <h3 className="text-sm font-semibold text-slate-800">Recipients ({detail.recipients.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:opacity-100 border-b-2 border-marigold" style={{ backgroundColor: "#17458f" }}>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Name</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Email</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Status</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Sent Date</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.recipients.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-10">No recipients.</TableCell></TableRow>
                ) : detail.recipients.map((r, i) => (
                  <TableRow key={i} className="hover:bg-slate-50/70 transition-colors border-slate-100">
                    <TableCell className="font-medium text-slate-800">{r.memberName}</TableCell>
                    <TableCell className="text-sm text-slate-600">{r.email || "No email"}</TableCell>
                    <TableCell><div className="flex items-center gap-1.5">{getStatusIcon(r.status)}<span className="text-sm text-slate-700">{r.status}</span></div></TableCell>
                    <TableCell className="text-sm text-slate-600">{r.sentDate ? new Date(r.sentDate).toLocaleString(appLocale()) : "-"}</TableCell>
                    <TableCell className="text-sm text-red-600 max-w-[200px] truncate">{r.errorMessage || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <AlertModal
        open={confirmSend}
        onOpenChange={(o) => !o && setConfirmSend(false)}
        icon={Send}
        iconClassName="text-ink"
        title="Send Email"
        description="Send this email to all recipients now?"
        confirmLabel="Send"
        cancelLabel="Cancel"
        onConfirm={handleSend}
        onCancel={() => setConfirmSend(false)}
      />
      <AlertModal
        open={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(false)}
        icon={AlertTriangle}
        iconClassName="text-red-500"
        title="Delete Email"
        description="Are you sure you want to delete this draft email? This action cannot be undone."
        confirmLabel="Delete"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
