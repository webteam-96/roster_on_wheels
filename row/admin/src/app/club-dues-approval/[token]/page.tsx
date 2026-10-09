"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getClubDuesApproval, decideClubDuesApproval } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RotaryLoader from "@/components/RotaryLoader";
import { CheckCircle2, XCircle } from "lucide-react";

const MODES: Record<string, string> = { "1": "Cash", "2": "Cheque", "3": "NEFT", "4": "UPI", "5": "Other" };

export default function ClubDuesApprovalPage() {
  const params = useParams();
  const token = String(params.token);
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setInfo(await getClubDuesApproval(token)); }
      catch (e: any) { setErr(e?.response?.data?.message || "This approval link is invalid or expired."); }
      finally { setLoading(false); }
    })();
    /* eslint-disable-next-line */
  }, []);

  const decide = async (isApproved: boolean) => {
    // A rejection must carry a reason; approval needs nothing. Validate here on the page.
    if (!isApproved && !reason.trim()) { setReasonErr(true); return; }
    setBusy(true);
    try {
      const res = await decideClubDuesApproval(token, { isApproved, rejectionReason: reason.trim() });
      setResult(res?.alreadyHandled ? res.message : isApproved ? "Payment approved. Thank you." : "Payment rejected.");
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed."); } finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RotaryLoader size="lg" /></div>;
  if (err) return <div className="min-h-screen flex items-center justify-center p-6 text-center text-red-600">{err}</div>;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-lg w-full max-w-md p-6 space-y-5">
        <h1 className="text-xl font-bold text-primary text-center">District Dues — Approval</h1>
        {result ? (
          <div className="text-center py-6 space-y-2">
            {/* Icon derives from the outcome message so it works for both a fresh
                decision and an "already rejected/approved" response. */}
            {result.toLowerCase().includes("reject")
              ? <XCircle className="h-14 w-14 text-red-600 mx-auto" />
              : <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto" />}
            <p>{result}</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span>District</span><b>{info.districtNumber}</b></div>
              <div className="flex justify-between"><span>Club</span><b>{info.clubName}</b></div>
              <div className="flex justify-between"><span>Members covered</span><b>{info.memberCountCovered}</b></div>
              <div className="flex justify-between"><span>Mode</span><b>{MODES[String(info.offlineTransactionType)] || info.offlineTransactionType}</b></div>
              {info.offlineTransactionId && <div className="flex justify-between"><span>Reference</span><b>{info.offlineTransactionId}</b></div>}
              {info.offlineRemark && <div className="flex justify-between"><span>Remark</span><span>{info.offlineRemark}</span></div>}
              <div className="flex justify-between text-base border-t pt-2"><span>Amount</span><b>₹{Number(info.amount).toLocaleString("en-IN")}</b></div>
              {info.offlineStatus && info.offlineStatus !== "Pending" && <p className="text-amber-600">Already {info.offlineStatus.toLowerCase()}.</p>}
            </div>
            <div className="space-y-1">
              <Label>Rejection reason <span className="text-muted-foreground">(required only to reject)</span></Label>
              <Input value={reason} onChange={(e) => { setReason(e.target.value); if (reasonErr) setReasonErr(false); }}
                className={reasonErr ? "border-red-500" : ""} placeholder="Why is this being rejected?" />
              {reasonErr && <p className="text-xs text-red-600">Please enter a reason to reject this payment.</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="destructive" className="flex-1" onClick={() => decide(false)} disabled={busy}>Reject</Button>
              <Button className="flex-1" onClick={() => decide(true)} disabled={busy}>{busy && <RotaryLoader size="sm" />}Approve</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
