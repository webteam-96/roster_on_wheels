"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getMassEmailDetail, sendMassEmail, getMassEmailRecipients, getClub,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Send, RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

interface MassEmailDetail {
  id: number; fkClubId: number; recipientType: number; fkSubgroupId: number | null;
  subgroupName: string | null; fromName: string; replyName: string | null;
  replyEmail: string | null; subject: string; emailBody: string | null;
  status: string; totalRecipients: number; sentCount: number; failedCount: number;
  sentDate: string | null; createdDate: string;
  recipients: Recipient[];
}

interface Recipient {
  memberId: number; memberName: string; email: string; status: string;
  sentDate: string | null; errorMessage: string | null;
}

export default function MassEmailViewPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const emailId = Number(params.emailId);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [detail, setDetail] = useState<MassEmailDetail | null>(null);
  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function load() {
      try {
        const [club, emailDetail] = await Promise.all([
          getClub(clubId),
          getMassEmailDetail(clubId, emailId),
        ]);
        setClubName(club.clubName);
        setDetail(emailDetail);
      } catch (err: any) {
        setErrorMessage("Failed to load email details.");
      }
      setLoading(false);
    }
    load();
  }, [clubId, emailId]);

  const handleRetry = async () => {
    setRetrying(true);
    setConfirmRetry(false);
    try {
      await sendMassEmail(clubId, emailId);
      setSuccessMessage("Retrying failed emails...");
      // Reload detail after a short delay
      setTimeout(async () => {
        try {
          const updated = await getMassEmailDetail(clubId, emailId);
          setDetail(updated);
        } catch { /* ignore */ }
      }, 2000);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to retry.");
    }
    setRetrying(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Sent": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "Failed": return <XCircle className="h-4 w-4 text-red-500" />;
      case "Pending": return <Clock className="h-4 w-4 text-yellow-500" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Draft": return <Badge variant="secondary">Draft</Badge>;
      case "Sending": return <Badge className="bg-blue-500 hover:bg-blue-600">Sending</Badge>;
      case "Sent": return <Badge className="bg-green-500 hover:bg-green-600">Sent</Badge>;
      case "Failed": return <Badge variant="destructive">Failed</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getRecipientTypeLabel = (type: number) => {
    switch (type) {
      case 1: return "All Members";
      case 2: return "Subgroup";
      case 3: return "Selected Members";
      default: return "Unknown";
    }
  };

  if (loading) return <RotaryLoader />;
  if (!detail) return <div className="text-center py-20 text-muted-foreground">Email not found.</div>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/mass-emails`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Mass Email Detail</h2>
              <p className="text-muted-foreground text-base">{clubName}</p>
            </div>
          </div>
          {canManage && detail.status === "Failed" && (
            <Button onClick={() => setConfirmRetry(true)} disabled={retrying}>
              {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Retry Failed
            </Button>
          )}
        </div>

        {/* Email Details */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{detail.subject}</CardTitle>
              {getStatusBadge(detail.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">From: </span>
                <span className="font-medium">{detail.fromName}</span>
                <span className="text-muted-foreground"> &lt;communication@rizones45678.org&gt;</span>
              </div>
              {detail.replyEmail && (
                <div>
                  <span className="text-muted-foreground">Reply To: </span>
                  <span className="font-medium">{detail.replyName || detail.replyEmail}</span>
                  <span className="text-muted-foreground"> &lt;{detail.replyEmail}&gt;</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Recipients: </span>
                <span className="font-medium">
                  {detail.totalRecipients} ({getRecipientTypeLabel(detail.recipientType)}
                  {detail.subgroupName ? ` - ${detail.subgroupName}` : ""})
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Date: </span>
                <span className="font-medium">
                  {detail.sentDate
                    ? new Date(detail.sentDate).toLocaleString("en-IN")
                    : new Date(detail.createdDate).toLocaleString("en-IN")}
                </span>
              </div>
              {detail.status !== "Draft" && (
                <div className="grid grid-cols-4 gap-3 mt-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">{detail.totalRecipients}</p>
                    <p className="text-xs text-blue-600">Total</p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{detail.sentCount}</p>
                    <p className="text-xs text-green-600">Sent</p>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-red-700">{detail.failedCount}</p>
                    <p className="text-xs text-red-600">Failed</p>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-orange-700">{Math.max(0, detail.totalRecipients - detail.sentCount - detail.failedCount)}</p>
                    <p className="text-xs text-orange-600">Not Delivered</p>
                  </div>
                </div>
              )}
            </div>

            {detail.emailBody && (
              <div className="border-t pt-4">
                <p className="text-sm text-muted-foreground mb-2">Email Body:</p>
                <div className="bg-muted/50 rounded-md p-4 text-sm whitespace-pre-wrap">{detail.emailBody}</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recipients Table */}
        <Card>
          <CardHeader><CardTitle>Recipients ({detail.recipients.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent Date</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.recipients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No recipients.
                    </TableCell>
                  </TableRow>
                ) : (
                  detail.recipients.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{r.memberName}</TableCell>
                      <TableCell className="text-sm">{r.email || "No email"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {getStatusIcon(r.status)}
                          <span className="text-sm">{r.status}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.sentDate ? new Date(r.sentDate).toLocaleString("en-IN") : "-"}
                      </TableCell>
                      <TableCell className="text-sm text-red-600 max-w-[200px] truncate">
                        {r.errorMessage || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <AlertModal
        open={confirmRetry}
        icon={RefreshCw}
        iconClassName="text-primary"
        title="Retry Failed Emails"
        description="This will retry sending to all failed recipients. Credits will be deducted."
        confirmLabel="Retry"
        cancelLabel="Cancel"
        onConfirm={handleRetry}
        onCancel={() => setConfirmRetry(false)}
      />

      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
