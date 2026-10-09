"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getPublicClubDues, payPublicClubDues, offlinePublicClubDues, verifyPublicClubDuesPayment, clubDuesAssetUrl, getPublicClubDuesOfflineAccounts, ClubDuesOfflineAccountOption } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RotaryLoader from "@/components/RotaryLoader";

declare global { interface Window { Razorpay?: any } }

function PayInner() {
  const params = useParams();
  const query = useSearchParams();
  const duesId = Number(params.duesId);
  const clubId = Number(query.get("clubId") || 0);
  const token = query.get("token") || "";

  const [data, setData] = useState<any>(null);
  const [accounts, setAccounts] = useState<ClubDuesOfflineAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const dues = await getPublicClubDues(duesId, clubId, token);
        setData(dues);
        // Fetched here (not inside OfflineForm) because the pending-submission lock below needs to
        // know how many accounts this club can deposit into. Failure is non-fatal — the form falls
        // back to no picker, exactly as before.
        if (dues?.modeOfPayment === 2 || dues?.modeOfPayment === 3) {
          try { setAccounts(await getPublicClubDuesOfflineAccounts(duesId, clubId, token)); } catch {}
        }
      }
      catch (e: any) { setErr(e?.response?.data?.message || "This link is invalid or expired."); }
      finally { setLoading(false); }
    })();
    /* eslint-disable-next-line */
  }, []);

  const payOnline = async () => {
    setPaying(true); setErr(null);
    try {
      const res = await payPublicClubDues(duesId, token, { fkClubId: clubId });
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => resolve(); s.onerror = () => reject();
          document.body.appendChild(s);
        });
      }
      const rzp = new window.Razorpay({
        key: res.keyId,
        order_id: res.razorpayOrderId,
        amount: res.amountPaise,
        currency: "INR",
        name: data.purpose || "District Dues",
        description: `${data.clubName} — District ${data.districtNumber}`,
        prefill: { name: res.customerName || "", email: res.customerEmail || "", contact: res.customerPhone || "" },
        handler: async (r: any) => {
          try {
            const v = await verifyPublicClubDuesPayment(duesId, {
              paymentId: res.paymentId,
              razorpayOrderId: r.razorpay_order_id,
              razorpayPaymentId: r.razorpay_payment_id,
              razorpaySignature: r.razorpay_signature,
            });
            if (v.isSuccess) {
              window.location.href = `/pay/club-dues/${duesId}/thank-you?paid=1&amount=${v.amount ?? ""}&club=${encodeURIComponent(v.memberName || data.clubName || "")}`;
            } else { setErr("Payment could not be verified."); setPaying(false); }
          } catch { setErr("Payment verification failed."); setPaying(false); }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.open();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Payment could not be started.");
      setPaying(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RotaryLoader size="lg" /></div>;
  if (err && !data) return <div className="min-h-screen flex items-center justify-center p-6 text-center text-red-600">{err}</div>;

  const bgUrl = clubDuesAssetUrl(data.backgroundImage);
  const logoUrl = clubDuesAssetUrl(data.purposeLogo);
  // A submission is already awaiting the District Treasurer — don't let this link be used to send
  // another one (the server rejects it anyway). Clubs configured to deposit into MORE than one
  // account legitimately send one submission per account, so they keep the button; the server still
  // blocks a repeat for an account that is already pending.
  const offlineLocked = !!data.isPending && accounts.length <= 1;

  return (
    <div
      className="min-h-screen bg-muted/30 flex items-center justify-center p-4 bg-cover bg-center"
      style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
    >
      <div className="bg-background rounded-xl shadow-lg w-full max-w-md p-6 space-y-5">
        <div className="text-center space-y-2">
          {logoUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={logoUrl} alt="" className="h-16 mx-auto object-contain" />
          )}
          <div>
            <h1 className="text-xl font-bold text-primary">{data.purpose || "District Dues"}</h1>
            <p className="text-muted-foreground text-sm">{data.clubName} · District {data.districtNumber}</p>
          </div>
        </div>

        {done ? (
          <div className="text-center text-green-700 py-6">{done}</div>
        ) : data.isFullyPaid ? (
          <div className="text-center text-green-700 py-6">All members are fully paid. Nothing due.</div>
        ) : (
          <>
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm"><span>Members</span><span>{data.memberCount}</span></div>
              <div className="flex justify-between text-sm"><span>Rate / member</span><span>₹{data.perMemberRate}</span></div>
              {data.onlineAmountOwed !== data.amountOwed ? (
                <>
                  <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Offline amount</span><span>₹{Number(data.amountOwed).toLocaleString("en-IN")}</span></div>
                  <div className="flex justify-between text-sm font-semibold"><span>Online amount{data.onlineSurchargePercent > 0 ? <span className="font-normal text-muted-foreground"> (+{data.onlineSurchargePercent}%)</span> : null}</span><span>₹{Number(data.onlineAmountOwed).toLocaleString("en-IN")}</span></div>
                </>
              ) : (
                <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Amount due</span><span>₹{Number(data.amountOwed).toLocaleString("en-IN")}</span></div>
              )}
            </div>
            {data.isPending && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                <span className="font-medium">An offline payment for your club is already submitted and awaiting verification.</span>{" "}
                {offlineLocked
                  ? "The District Treasurer will approve or reject it — please don't submit it again. If it is rejected you'll be able to resubmit from this page."
                  : "If you deposited into another of your club's accounts, you can still submit that one separately."}
              </div>
            )}
            {!data.isPending && data.lastRejectedDate && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <span className="font-medium">Your last offline payment was rejected.</span>
                {data.lastRejectedReason && <> Reason: {data.lastRejectedReason}.</>} Please resubmit.
              </div>
            )}
            {err && <p className="text-sm text-red-600 text-center">{err}</p>}

            {(data.modeOfPayment === 1 || data.modeOfPayment === 3) && (
              <Button className="w-full" onClick={payOnline} disabled={paying}>
                {paying && <RotaryLoader size="sm" />}Pay ₹{Number(data.onlineAmountOwed).toLocaleString("en-IN")} online
              </Button>
            )}
            {(data.modeOfPayment === 2 || data.modeOfPayment === 3) && !offlineLocked && (
              <Button variant="outline" className="w-full" onClick={() => setShowOffline((v) => !v)}>Record offline payment</Button>
            )}

            {showOffline && !offlineLocked && (
              <OfflineForm duesId={duesId} clubId={clubId} token={token} accounts={accounts}
                onDone={() => setDone("Submitted for verification. The District Treasurer will review it.")} onError={setErr} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OfflineForm({ duesId, clubId, token, accounts, onDone, onError }: { duesId: number; clubId: number; token: string; accounts: ClubDuesOfflineAccountOption[]; onDone: () => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState("1");
  const [ref, setRef] = useState("");
  const [remark, setRemark] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedAccount = accounts.find((a) => a.fkRouteAccountId === Number(accountId));

  const submit = async () => {
    if (accounts.length > 0 && !accountId) { onError("Select which account this payment went into."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("FkClubId", String(clubId));
      if (accountId) fd.append("FkRouteAccountId", accountId);
      fd.append("TransactionType", mode);
      fd.append("TransactionId", ref);
      fd.append("Remark", remark);
      if (file) fd.append("attachment", file);
      await offlinePublicClubDues(duesId, token, fd);
      onDone();
    } catch (e: any) { onError(e?.response?.data?.message || "Failed to submit."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 border rounded-lg p-4">
      {accounts.length > 0 && (
        <div className="space-y-1">
          <Label>Account</Label>
          <select className="w-full border rounded-md h-9 px-2" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Which bank account did this go into?</option>
            {accounts.map((a) => <option key={a.fkRouteAccountId} value={a.fkRouteAccountId}>{a.accountLabel}</option>)}
          </select>
        </div>
      )}
      {accountId && selectedAccount && (
        <p className="text-sm text-muted-foreground">
          Amount: <b>₹{Number(selectedAccount.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>.
        </p>
      )}
      <div className="space-y-1">
        <Label>Mode</Label>
        <select className="w-full border rounded-md h-9 px-2" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="1">Cash</option><option value="2">Cheque</option><option value="3">NEFT</option><option value="4">UPI</option><option value="5">Other</option>
        </select>
      </div>
      <div className="space-y-1"><Label>Transaction / reference</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      <div className="space-y-1"><Label>Remark</Label><Input value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
      <div className="space-y-1"><Label>Receipt (optional)</Label><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
      <Button className="w-full" onClick={submit} disabled={busy}>{busy && <RotaryLoader size="sm" />}Submit for verification</Button>
    </div>
  );
}

export default function ClubDuesPayPage() {
  return <Suspense fallback={null}><PayInner /></Suspense>;
}
