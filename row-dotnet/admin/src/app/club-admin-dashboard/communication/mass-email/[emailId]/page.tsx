"use client";

/**
 * Club Admin · Communication → Mass Email → View (V2, inside the club-admin shell).
 * clubId from useAuth().selectedClubId; emailId from the route; Back returns to ?returnTo=.
 */

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getMassEmailDetail, sendMassEmail, getClub } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
interface Recipient { memberId: number; memberName: string; email: string; status: string; sentDate: string | null; errorMessage: string | null; }
interface MassEmailDetail {
  id: number; recipientType: number; subgroupName: string | null; fromName: string;
  replyName: string | null; replyEmail: string | null; subject: string; emailBody: string | null;
  status: string; totalRecipients: number; sentCount: number; failedCount: number;
  sentDate: string | null; createdDate: string; recipients: Recipient[];
}

export default function ClubAdminMassEmailViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedClubId, isSuperAdmin, isAdmin } = useAuth();
  const clubId = selectedClubId ?? 0;
  const emailId = Number(params.emailId);
  const returnTo = searchParams.get("returnTo") || "/club-admin-dashboard/communication?tab=massemail";
  const canManage = isSuperAdmin || isAdmin;

  const [detail, setDetail] = useState<MassEmailDetail | null>(null);
  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!clubId) { setLoading(false); return; }
    Promise.all([getClub(clubId), getMassEmailDetail(clubId, emailId)])
      .then(([club, d]) => { setClubName(club.clubName); setDetail(d); })
      .catch(() => setErrorMessage("Failed to load email details."))
      .finally(() => setLoading(false));
  }, [clubId, emailId]);

  const handleRetry = async () => {
    setRetrying(true); setConfirmRetry(false);
    try {
      await sendMassEmail(clubId, emailId);
      setSuccessMessage("Retrying failed emails...");
      setTimeout(() => getMassEmailDetail(clubId, emailId).then(setDetail).catch(() => {}), 2000);
    } catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to retry."); }
    setRetrying(false);
  };

  const statusIcon = (s: string) => s === "Sent" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : s === "Failed" ? <XCircle className="h-4 w-4 text-red-500" /> : <Clock className="h-4 w-4 text-yellow-500" />;
  const statusBadge = (s: string) => {
    if (s === "Sent") return <Badge className="bg-green-500 hover:bg-green-600">Sent</Badge>;
    if (s === "Sending") return <Badge className="bg-blue-500 hover:bg-blue-600">Sending</Badge>;
    if (s === "Failed") return <Badge variant="destructive">Failed</Badge>;
    return <Badge variant="secondary">{s}</Badge>;
  };
  const recipientLabel = (t: number) => (t === 1 ? "All Members" : t === 2 ? "Subgroup" : t === 3 ? "Selected Members" : "Unknown");

  if (!clubId) return null;
  if (loading) return <RotaryLoader />;
  if (!detail) return <div className="text-center py-20 text-muted-foreground">Email not found.</div>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => router.push(returnTo)} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-[#1e3a5f]">Mass Email Detail</h2>
              <p className="text-slate-500 text-sm mt-0.5">{clubName}</p>
            </div>
          </div>
          {canManage && detail.status === "Failed" && (
            <Button onClick={() => setConfirmRetry(true)} disabled={retrying} className="bg-[#1e3a5f] hover:bg-[#152a44] text-white">
              {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}Retry Failed
            </Button>
          )}
        </div>

        <Card>
          <CardHeader><div className="flex items-center justify-between"><CardTitle>{detail.subject}</CardTitle>{statusBadge(detail.status)}</div></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">From: </span><span className="font-medium">{detail.fromName}</span><span className="text-muted-foreground"> &lt;support@example.org&gt;</span></div>
              {detail.replyEmail && (<div><span className="text-muted-foreground">Reply To: </span><span className="font-medium">{detail.replyName || detail.replyEmail}</span><span className="text-muted-foreground"> &lt;{detail.replyEmail}&gt;</span></div>)}
              <div><span className="text-muted-foreground">Recipients: </span><span className="font-medium">{detail.totalRecipients} ({recipientLabel(detail.recipientType)}{detail.subgroupName ? ` - ${detail.subgroupName}` : ""})</span></div>
              <div><span className="text-muted-foreground">Date: </span><span className="font-medium">{detail.sentDate ? new Date(detail.sentDate).toLocaleString(appLocale()) : new Date(detail.createdDate).toLocaleString(appLocale())}</span></div>
            </div>
            {detail.status !== "Draft" && (
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-blue-700">{detail.totalRecipients}</p><p className="text-xs text-blue-600">Total</p></div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-700">{detail.sentCount}</p><p className="text-xs text-green-600">Sent</p></div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-red-700">{detail.failedCount}</p><p className="text-xs text-red-600">Failed</p></div>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-orange-700">{Math.max(0, detail.totalRecipients - detail.sentCount - detail.failedCount)}</p><p className="text-xs text-orange-600">Not Delivered</p></div>
              </div>
            )}
            {detail.emailBody && (<div className="border-t pt-4"><p className="text-sm text-muted-foreground mb-2">Email Body:</p><div className="bg-muted/50 rounded-md p-4 prose prose-sm max-w-none break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_img]:h-auto [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_a]:break-all" dangerouslySetInnerHTML={{ __html: detail.emailBody }} /></div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recipients ({detail.recipients.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Sent Date</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
              <TableBody>
                {detail.recipients.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No recipients.</TableCell></TableRow>
                ) : detail.recipients.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.memberName}</TableCell>
                    <TableCell className="text-sm">{r.email || "No email"}</TableCell>
                    <TableCell><div className="flex items-center gap-1.5">{statusIcon(r.status)}<span className="text-sm">{r.status}</span></div></TableCell>
                    <TableCell className="text-sm">{r.sentDate ? new Date(r.sentDate).toLocaleString(appLocale()) : "-"}</TableCell>
                    <TableCell className="text-sm text-red-600 max-w-[200px] truncate">{r.errorMessage || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <AlertModal open={confirmRetry} icon={RefreshCw} iconClassName="text-[#1e3a5f]" title="Retry Failed Emails"
        description="This will retry sending to all failed recipients. Credits will be deducted." confirmLabel="Retry" cancelLabel="Cancel"
        onConfirm={handleRetry} onCancel={() => setConfirmRetry(false)} />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
