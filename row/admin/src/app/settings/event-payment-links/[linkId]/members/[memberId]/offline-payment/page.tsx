"use client";

import { useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import { recordOfflinePayment } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function OfflinePaymentPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const linkId = Number(params.linkId);
  const memberId = Number(params.memberId);

  const [transactionType, setTransactionType] = useState("NEFT");
  const [transactionId, setTransactionId] = useState("");
  const [givenTo, setGivenTo] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [remark, setRemark] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!transactionType) { setErrorMessage("Transaction type is required."); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("transactionType", transactionType);
      fd.append("transactionId", transactionId);
      fd.append("givenTo", givenTo);
      fd.append("bankName", bankName);
      fd.append("chequeNumber", chequeNumber);
      fd.append("paymentDate", paymentDate);
      fd.append("remark", remark);
      fd.append("sendEmail", String(sendEmail));
      if (attachment) fd.append("attachment", attachment);
      await recordOfflinePayment(linkId, fd);
      setSuccessMessage("Offline payment recorded successfully.");
      setTimeout(() => router.push(`/settings/event-payment-links/${linkId}/members`), 1500);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to record payment.");
    } finally { setSaving(false); }
  };

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/settings/event-payment-links/${linkId}/members`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Record Offline Payment</h2>
            <p className="text-muted-foreground text-base">Member #{memberId} - Link #{linkId}</p>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Payment Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Transaction Type *</Label>
                <Select value={transactionType} onValueChange={setTransactionType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEFT">NEFT</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Transaction ID / Reference</Label>
                <Input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="Transaction reference" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Given To</Label>
                <Input value={givenTo} onChange={e => setGivenTo(e.target.value)} placeholder="Person who received payment" />
              </div>
              <div>
                <Label>Payment Date</Label>
                <DateField value={paymentDate} onChange={setPaymentDate} />
              </div>
            </div>
            {(transactionType === "NEFT" || transactionType === "Cheque") && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Bank Name</Label>
                  <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name" />
                </div>
                {transactionType === "Cheque" && (
                  <div>
                    <Label>Cheque Number</Label>
                    <Input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} placeholder="Cheque number" />
                  </div>
                )}
              </div>
            )}
            <div>
              <Label>Remark</Label>
              <Textarea value={remark} onChange={e => setRemark(e.target.value)} rows={3} placeholder="Additional notes" />
            </div>
            <div>
              <Label>Attachment (receipt/proof)</Label>
              <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf" onChange={e => setAttachment(e.target.files?.[0] || null)} />
              <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, JPG, JPEG, PNG, GIF, WEBP</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
              <Label>Send receipt email to member</Label>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" asChild>
                <Link href={`/settings/event-payment-links/${linkId}/members`}>Cancel</Link>
              </Button>
              <Button onClick={handleSubmit} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />{saving ? "Saving..." : "Record Payment"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
