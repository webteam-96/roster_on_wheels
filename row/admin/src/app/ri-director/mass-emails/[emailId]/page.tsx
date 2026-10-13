"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRiDirectorMassEmail, sendRiDirectorMassEmail, getRiDirectorCreditBalance } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Send, Pencil, RotateCw } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Pending: "bg-gray-100 text-gray-700",
    Sent: "bg-green-100 text-green-700",
    Failed: "bg-red-100 text-red-700",
    Draft: "bg-gray-100 text-gray-700",
    Sending: "bg-blue-100 text-blue-700",
    Partial: "bg-amber-100 text-amber-700",
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${colors[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
}

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const emailId = Number(params.emailId);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sendConfirm, setSendConfirm] = useState(false);
  const [emailBalance, setEmailBalance] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getRiDirectorMassEmail(emailId)); }
    catch { setErrorMessage("Failed to load."); }
    finally { setLoading(false); }
  }, [emailId]);

  useEffect(() => { load(); }, [load]);

  const openSendConfirm = async () => {
    setSendConfirm(true);
    try { const b = await getRiDirectorCreditBalance(); setEmailBalance(b.emailBalance); }
    catch { setEmailBalance(null); }
  };

  const handleSend = async () => {
    if (emailBalance !== null && data && data.totalRecipients > emailBalance) {
      setSendConfirm(false); setEmailBalance(null);
      setErrorMessage(`Insufficient Email credits. Required: ${data.totalRecipients}, Available: ${emailBalance}.`);
      return;
    }
    try {
      await sendRiDirectorMassEmail(emailId);
      setSendConfirm(false); setEmailBalance(null);
      setSuccessMessage("Sending started.");
      load();
    } catch (e: any) { setSendConfirm(false); setEmailBalance(null); setErrorMessage(e?.response?.data?.message || "Failed to send."); }
  };

  if (loading) return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;
  if (!data) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href="/ri-director/mass-emails"><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Mass Email Detail</h2>
              <p className="text-muted-foreground">{data.subject}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {data.status === "Draft" && <>
              <Button variant="outline" onClick={() => router.push(`/ri-director/mass-emails/${emailId}/edit`)}><Pencil className="mr-2 h-4 w-4" />Edit</Button>
              <Button onClick={openSendConfirm}><Send className="mr-2 h-4 w-4" />Send Now</Button>
            </>}
            {(data.status === "Failed" || data.status === "Partial" || data.status === "Sending") && (
              <Button onClick={openSendConfirm}><RotateCw className="mr-2 h-4 w-4" />Resume / Retry</Button>
            )}
          </div>
        </div>

        <Card><CardContent className="p-6 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-muted-foreground text-xs">Status</p><StatusBadge status={data.status} /></div>
            <div><p className="text-muted-foreground text-xs">Total</p><p className="font-semibold">{data.totalRecipients}</p></div>
            <div><p className="text-muted-foreground text-xs">Sent</p><p className="font-semibold text-green-700">{data.sentCount}</p></div>
            <div><p className="text-muted-foreground text-xs">Failed</p><p className="font-semibold text-red-700">{data.failedCount}</p></div>
          </div>
          <div className="pt-3 border-t space-y-2 text-sm">
            <div><span className="font-semibold">From:</span> {data.fromName}</div>
            {data.replyEmail && <div><span className="font-semibold">Reply To:</span> {data.replyName || ""} &lt;{data.replyEmail}&gt;</div>}
            <div><span className="font-semibold">Subject:</span> {data.subject}</div>
            {data.emailBody && <div className="pt-2 border-t"><p className="font-semibold text-xs text-muted-foreground mb-1">Body</p><div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: data.emailBody }} /></div>}
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground font-semibold w-12">S.No.</TableHead>
                <TableHead className="text-primary-foreground font-semibold">Name</TableHead>
                <TableHead className="text-primary-foreground font-semibold">Email</TableHead>
                <TableHead className="text-primary-foreground font-semibold text-center">Status</TableHead>
                <TableHead className="text-primary-foreground font-semibold">Sent Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.recipients || []).map((r: any, i: number) => (
                <TableRow key={r.memberId}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{r.memberName}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell className="text-center"><StatusBadge status={r.status} /></TableCell>
                  <TableCell>{r.sentDate ? new Date(r.sentDate).toLocaleString(appLocale()) : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>

        <AlertModal
          open={sendConfirm}
          onOpenChange={(o) => { if (!o) { setSendConfirm(false); setEmailBalance(null); } }}
          icon={Send}
          iconClassName={emailBalance !== null && data.totalRecipients > emailBalance ? "text-destructive" : "text-primary"}
          title="Send Mass Email"
          description={
            <div className="space-y-2">
              <p>Send to <span className="font-semibold">{data.totalRecipients}</span> recipient(s)?</p>
              <div className="text-sm border-t pt-2 space-y-1">
                <div>Required Email credits: <span className="font-semibold">{data.totalRecipients}</span></div>
                <div>Available balance: <span className={`font-semibold ${emailBalance !== null && data.totalRecipients > emailBalance ? "text-destructive" : "text-green-700"}`}>{emailBalance === null ? "..." : emailBalance}</span></div>
                {emailBalance !== null && data.totalRecipients > emailBalance && (
                  <div className="text-destructive font-medium mt-1">⚠️ Insufficient credits. Send blocked.</div>
                )}
              </div>
            </div>
          }
          confirmLabel="Send"
          onConfirm={handleSend}
          cancelLabel="Cancel"
          onCancel={() => { setSendConfirm(false); setEmailBalance(null); }}
        />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
