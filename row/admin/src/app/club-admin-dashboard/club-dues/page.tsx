"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import {
  getClubDuesOfficerClubs, getClubDuesOfficerSnapshot, payClubDuesOfficer,
  verifyClubDuesOfficer, getClubDuesOfficerPayLink, recordClubDuesOfficerOffline,
  getClubDuesOfficerOfflineAccounts, ClubDuesOfflineAccountOption,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Link2, RefreshCw } from "@/components/icons";

import { appLocale, currencySymbol } from "@/lib/appFormat";
declare global { interface Window { Razorpay?: any } }

interface OfficerClub {
  duesId: number;
  clubId: number;
  clubName?: string;
  purpose?: string;
  rotaryYear?: string;
  districtNumber?: string;
}

export default function ClubAdminClubDuesPage() {
  const [clubs, setClubs] = useState<OfficerClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the club open on this dashboard (user 2026-10-08): an officer of another club
  // must not see that club's dues while viewing this one.
  const { selectedClubId } = useAuth();
  const { overview } = useClubAdminCache();
  const openClubId = selectedClubId ?? overview?.club?.clubId ?? null;

  useEffect(() => {
    (async () => {
      try { setClubs(await getClubDuesOfficerClubs()); }
      catch (e: any) { setError(e?.response?.data?.message || "Failed to load district dues."); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;
  const shown = openClubId ? clubs.filter((c) => c.clubId === openClubId) : [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">District Dues</h2>
        <p className="text-muted-foreground text-base">Pay your club&apos;s district dues. Amount due = unpaid members × rate.</p>
      </div>

      {shown.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          No active district dues campaign for this club, or you are not its office bearer.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((c) => (
            <ClubDuesCard key={`${c.duesId}-${c.clubId}`} club={c} onSuccess={setSuccess} onError={setError} />
          ))}
        </div>
      )}

      <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

function ClubDuesCard({ club, onSuccess, onError }: { club: OfficerClub; onSuccess: (m: string) => void; onError: (m: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [showOffline, setShowOffline] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getClubDuesOfficerSnapshot(club.duesId, club.clubId)); }
    catch (e: any) { onError(e?.response?.data?.message || "Failed to load dues."); }
    finally { setLoading(false); }
  }, [club.duesId, club.clubId, onError]);

  useEffect(() => { load(); }, [load]);

  const payOnline = async () => {
    setPaying(true);
    try {
      const res = await payClubDuesOfficer(club.duesId, club.clubId);
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
        name: data?.purpose || "District Dues",
        description: `${data?.clubName || club.clubName}: District ${data?.districtNumber || club.districtNumber}`,
        prefill: { name: res.customerName || "", email: res.customerEmail || "", contact: res.customerPhone || "" },
        handler: async (r: any) => {
          try {
            const v = await verifyClubDuesOfficer(club.duesId, club.clubId, {
              paymentId: res.paymentId,
              razorpayOrderId: r.razorpay_order_id,
              razorpayPaymentId: r.razorpay_payment_id,
              razorpaySignature: r.razorpay_signature,
            });
            if (v.isSuccess) { onSuccess(`Payment received for ${data?.clubName || club.clubName}.`); load(); }
            else onError("Payment could not be verified.");
          } catch { onError("Payment verification failed."); }
          finally { setPaying(false); }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.open();
    } catch (e: any) {
      onError(e?.response?.data?.message || "Payment could not be started.");
      setPaying(false);
    }
  };

  const copyLink = async () => {
    try {
      const res = await getClubDuesOfficerPayLink(club.duesId, club.clubId);
      await navigator.clipboard.writeText(res.url);
      onSuccess("Pay link copied. This link stays active and does not expire.");
    } catch { onError("Failed to generate link."); }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-lg">{data?.clubName || club.clubName}</h3>
            <p className="text-xs text-muted-foreground">{data?.purpose || club.purpose || "District Dues"} · District {data?.districtNumber || club.districtNumber} · {club.rotaryYear}</p>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={load} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><RotaryLoader size="sm" /></div>
        ) : !data ? null : data.isFullyPaid ? (
          <div className="text-center text-green-700 py-4 text-sm font-medium">All members are fully paid. Nothing due.</div>
        ) : (
          <>
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm"><span>Members</span><span>{data.memberCount}</span></div>
              <div className="flex justify-between text-sm"><span>Paid</span><span className="text-green-600">{data.paidCount}</span></div>
              <div className="flex justify-between text-sm"><span>Unpaid</span><span className="text-red-600">{data.unpaidCount}</span></div>
              <div className="flex justify-between text-sm"><span>Rate / member</span><span>{currencySymbol()}{data.perMemberRate}</span></div>
              {data.onlineAmountOwed !== data.amountOwed ? (
                <>
                  <div className="flex justify-between font-bold text-base border-t pt-2"><span>Offline amount</span><span>{currencySymbol()}{Number(data.amountOwed).toLocaleString(appLocale())}</span></div>
                  <div className="flex justify-between text-sm font-semibold"><span>Online amount{data.onlineSurchargePercent > 0 ? <span className="font-normal text-muted-foreground"> (+{data.onlineSurchargePercent}%)</span> : null}</span><span>{currencySymbol()}{Number(data.onlineAmountOwed).toLocaleString(appLocale())}</span></div>
                </>
              ) : (
                <div className="flex justify-between font-bold text-base border-t pt-2"><span>Amount due</span><span>{currencySymbol()}{Number(data.amountOwed).toLocaleString(appLocale())}</span></div>
              )}
            </div>
            {data.isPending && <p className="text-xs text-amber-600 text-center">An offline payment is already awaiting approval.</p>}
            {!data.isPending && data.lastRejectedDate != null && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <span className="font-medium">Your last offline payment was rejected.</span>
                {data.lastRejectedReason && <> Reason: {data.lastRejectedReason}.</>} Please resubmit.
              </div>
            )}

            <div className="flex flex-col gap-2">
              {(data.modeOfPayment === 1 || data.modeOfPayment === 3) && (
                <Button onClick={payOnline} disabled={paying}>
                  {paying && <RotaryLoader size="sm" />}Pay {currencySymbol()}{Number(data.onlineAmountOwed).toLocaleString(appLocale())} online
                </Button>
              )}
              {(data.modeOfPayment === 2 || data.modeOfPayment === 3) && (
                <Button variant="outline" onClick={() => setShowOffline((v) => !v)}>Record offline payment</Button>
              )}
              <Button variant="ghost" size="sm" onClick={copyLink}><Link2 className="mr-2 h-4 w-4" />Copy 3-hour pay link</Button>
            </div>

            {showOffline && (
              <OfflineForm duesId={club.duesId} clubId={club.clubId} amountOwed={data.amountOwed}
                onDone={() => { setShowOffline(false); onSuccess("Submitted for approval. The district will review it."); load(); }}
                onError={onError} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OfflineForm({ duesId, clubId, amountOwed, onDone, onError }: { duesId: number; clubId: number; amountOwed: number; onDone: () => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState("1");
  const [ref, setRef] = useState("");
  const [remark, setRemark] = useState("");
  const [accounts, setAccounts] = useState<ClubDuesOfflineAccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getClubDuesOfficerOfflineAccounts(duesId, clubId).then(setAccounts).catch(() => {});
  }, [duesId, clubId]);

  const selectedAccount = accounts.find((a) => a.fkRouteAccountId === Number(accountId));

  const submit = async () => {
    if (accounts.length > 0 && !accountId) { onError("Select which account this payment went into."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      if (accountId) fd.append("FkRouteAccountId", accountId);
      fd.append("TransactionType", mode);
      fd.append("TransactionId", ref);
      fd.append("Remark", remark);
      if (file) fd.append("attachment", file);
      await recordClubDuesOfficerOffline(duesId, clubId, fd);
      onDone();
    } catch (e: any) { onError(e?.response?.data?.message || "Failed to submit."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 border rounded-lg p-4">
      <p className="text-xs text-amber-600">Offline payments are submitted for district approval before members are marked paid.</p>
      {accounts.length > 0 && (
        <div className="space-y-1">
          <Label>Account</Label>
          <select className="w-full border border-input bg-background rounded-md h-9 px-2 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Which bank account did this go into?</option>
            {accounts.map((a) => <option key={a.fkRouteAccountId} value={a.fkRouteAccountId}>{a.accountLabel}</option>)}
          </select>
        </div>
      )}
      {(accounts.length === 0 || accountId) && (
        <p className="text-sm text-muted-foreground">
          Amount: <b>{currencySymbol()}{Number(accounts.length === 0 ? amountOwed : selectedAccount?.amount ?? 0).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>.
        </p>
      )}
      <div className="space-y-1">
        <Label>Mode</Label>
        <select className="w-full border border-input bg-background rounded-md h-9 px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="1">Cash</option><option value="2">Cheque</option><option value="3">NEFT</option><option value="4">UPI</option><option value="5">Other</option>
        </select>
      </div>
      <div className="space-y-1"><Label>Transaction / reference</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      <div className="space-y-1"><Label>Remark</Label><Input value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
      <div className="space-y-1"><Label>Receipt (optional)</Label><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
      <Button className="w-full" onClick={submit} disabled={busy}>{busy && <RotaryLoader size="sm" />}Submit for approval</Button>
    </div>
  );
}
