"use client";

/**
 * SuperAdmin › Club Websites › Pricing & Reminders (per Rotary year).
 * --------------------------------------------------------------------------
 * Set a per-club price (Amount + GST %) and payment gateway (Razorpay Normal or
 * Razorpay Route), per Rotary year, for one club or a whole district (batch). Then
 * bulk-send buy/renew reminders (email) carrying an encrypted pay link to
 * each club's current-year President + Secretary.
 *
 * Rule: GST 0% requires the Route gateway with an active linked account (enforced here
 * and on the server). The reminder link's amount is always re-resolved server-side.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "@/components/DateField";
import { RefreshCw, Loader2, Send, Pencil, Layers, Copy, Check, Wallet, Download } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import {
  getDistricts,
  getClubWebsitePricingYears,
  getClubWebsitePricing,
  upsertClubWebsitePricing,
  batchClubWebsitePricing,
  sendClubWebsiteReminders,
  getRazorpayRouteAccounts,
  getClubWebsiteRouteAccount,
  setClubWebsiteRouteAccount,
  getWalletClubBalances,
  getWebsiteDefaultPricing,
  sendWebsiteDefaultPricingOtp,
  saveWebsiteDefaultPricing,
  type ClubWebsitePricingRow,
  type RazorpayRouteAccount,
  type WalletCommonLinks,
  type WalletClubBalanceRow,
  type WebsiteDefaultPricing,
} from "@/services/api";

import { appLocale, currencySymbol, todayLocal } from "@/lib/appFormat";
const inr = (n: number) => `${currencySymbol()}${Number(n || 0).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "–");

type EditState = {
  open: boolean;
  mode: "single" | "batch";
  clubId?: number;
  clubName?: string;
  orderType?: string;      // "New" | "Renewal" — which amount applies to THIS club (single mode)
  baseAmount: string;      // New / purchase price
  renewalAmount: string;   // Renewal price
  gstPercent: string;
  gatewayType: "normal" | "route";
};

const emptyEdit: EditState = {
  open: false, mode: "single", baseAmount: "14999", renewalAmount: "10999", gstPercent: "18",
  gatewayType: "normal",
};

export default function PricingRemindersTab() {
  const [years, setYears] = useState<{ id: number; label: string; isCurrent: number }[]>([]);
  const [yearId, setYearId] = useState<string>("");
  const [districts, setDistricts] = useState<any[]>([]);
  const [districtId, setDistrictId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [expiringInDays, setExpiringInDays] = useState<string>("");   // filter: website expires within N days
  const [expiryFrom, setExpiryFrom] = useState<string>("");           // filter: explicit expiry date range (independent of the above)
  const [expiryTo, setExpiryTo] = useState<string>("");
  const [routeAccounts, setRouteAccounts] = useState<RazorpayRouteAccount[]>([]);
  const [routeAccountId, setRouteAccountId] = useState<string>("");   // the ONE global club-website Route account
  const [routeAll, setRouteAll] = useState(false);                     // route EVERY club-website payment through it
  const [savingRoute, setSavingRoute] = useState(false);

  const [rows, setRows] = useState<ClubWebsitePricingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [edit, setEdit] = useState<EditState>(emptyEdit);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);       // which copy button just fired
  const [commonLinks, setCommonLinks] = useState<WalletCommonLinks | null>(null);

  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceRows, setBalanceRows] = useState<WalletClubBalanceRow[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // System-wide DEFAULT pricing (New/Renewal/GST) — the fallback for clubs with no override. OTP-gated edit.
  const [defPricing, setDefPricing] = useState<WebsiteDefaultPricing | null>(null);
  const [defOpen, setDefOpen] = useState(false);
  const [defNew, setDefNew] = useState("14999");
  const [defRenewal, setDefRenewal] = useState("10999");
  const [defGst, setDefGst] = useState("18");
  const [defOtp, setDefOtp] = useState("");
  const [defOtpSent, setDefOtpSent] = useState(false);
  const [defOtpInfo, setDefOtpInfo] = useState("");
  const [defSendingOtp, setDefSendingOtp] = useState(false);
  const [defSaving, setDefSaving] = useState(false);

  const loadDefaultPricing = useCallback(async () => {
    try { setDefPricing(await getWebsiteDefaultPricing()); } catch { /* non-fatal */ }
  }, []);

  const openDefaultEdit = () => {
    setDefNew(String(defPricing?.newAmount ?? 14999));
    setDefRenewal(String(defPricing?.renewalAmount ?? 10999));
    setDefGst(String(defPricing?.gstPercent ?? 18));
    setDefOtp(""); setDefOtpSent(false); setDefOtpInfo("");
    setDefOpen(true);
  };

  const sendDefaultOtp = async () => {
    const n = Number(defNew), r = Number(defRenewal), g = Number(defGst);
    if ([n, r, g].some((x) => Number.isNaN(x)) || n < 0 || r < 0 || g < 0 || g > 100) {
      setErrorMessage("Enter valid amounts and a GST% between 0 and 100 before sending the OTP."); return;
    }
    setDefSendingOtp(true); setErrorMessage(null);
    try {
      const res = await sendWebsiteDefaultPricingOtp({ newAmount: n, renewalAmount: r, gstPercent: g });
      setDefOtpSent(true);
      setDefOtpInfo(`OTP sent to ${res.maskedEmail || "your registered email"}. Valid ${res.expiryMinutes} min.${res.debugOtp ? ` (dev: ${res.debugOtp})` : ""}`);
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Could not send OTP. Please try again.");
    } finally { setDefSendingOtp(false); }
  };

  const saveDefaultPricing = async () => {
    const n = Number(defNew), r = Number(defRenewal), g = Number(defGst);
    if ([n, r, g].some((x) => Number.isNaN(x)) || n < 0 || r < 0 || g < 0 || g > 100) {
      setErrorMessage("Enter valid amounts and a GST% between 0 and 100."); return;
    }
    if (defOtp.trim().length !== 6) { setErrorMessage("Enter the 6-digit OTP."); return; }
    setDefSaving(true); setErrorMessage(null);
    try {
      await saveWebsiteDefaultPricing({ newAmount: n, renewalAmount: r, gstPercent: g, otp: defOtp.trim() });
      setSuccessMessage("Default pricing updated. Clubs with no override now use these prices.");
      setDefOpen(false);
      await loadDefaultPricing();
      await load();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Could not save default pricing.");
    } finally { setDefSaving(false); }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
    } catch {
      // Clipboard blocked (e.g. non-secure context) — surface the link so it can be copied manually.
      setErrorMessage(`Copy failed. Link:\n${text}`);
    }
  };

  const openBalances = async () => {
    setBalanceOpen(true); setBalanceLoading(true);
    try { setBalanceRows(await getWalletClubBalances()); }
    catch { setErrorMessage("Could not load club balances."); }
    finally { setBalanceLoading(false); }
  };

  const downloadBalancesCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Club", "District", "Email Balance",
      "President", "President Mobile", "President Email",
      "Secretary", "Secretary Mobile", "Secretary Email"];
    const lines = [header.map(esc).join(",")];
    for (const r of balanceRows) {
      lines.push([
        r.clubName, r.districtNumber ? `District ${r.districtNumber}` : "",
        r.emailBalance,
        r.presidentName, r.presidentMobile, r.presidentEmail,
        r.secretaryName, r.secretaryMobile, r.secretaryEmail,
      ].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `club-credit-balances-${todayLocal()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Bootstrap: years, districts, active route accounts.
  useEffect(() => {
    (async () => {
      try {
        const [yr, dRes, ra, gra] = await Promise.all([
          getClubWebsitePricingYears(),
          getDistricts(1, 9999, undefined, 1),
          getRazorpayRouteAccounts(true),
          getClubWebsiteRouteAccount(),
        ]);
        setYears(yr || []);
        const cur = (yr || []).find((y) => y.isCurrent) || (yr || [])[0];
        if (cur) setYearId(String(cur.id));
        setDistricts(((dRes as any).items || []).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
        setRouteAccounts(ra || []);
        setRouteAccountId(gra.routeAccountId ? String(gra.routeAccountId) : "");
        setRouteAll(!!gra.routeAll);
      } catch {
        setErrorMessage("Could not load pricing setup. Please refresh.");
      }
    })();
  }, []);

  useEffect(() => { loadDefaultPricing(); }, [loadDefaultPricing]);

  const load = useCallback(async () => {
    if (!yearId) return;
    const expDays = expiringInDays.trim() === "" ? undefined : Number(expiringInDays);
    // Need at least one narrowing filter (district, search, expiring-within, or an expiry date range) to list.
    if (!districtId && !search.trim() && expDays === undefined && !expiryFrom && !expiryTo) {
      setRows([]); setTotal(0); setSelected(new Set()); return;
    }
    setLoading(true);
    try {
      const res = await getClubWebsitePricing({
        yearId: Number(yearId),
        districtId: districtId ? Number(districtId) : undefined,
        search: search.trim() || undefined,
        expiringInDays: expDays !== undefined && !Number.isNaN(expDays) ? expDays : undefined,
        expiryFrom: expiryFrom || undefined,
        expiryTo: expiryTo || undefined,
        page: 1,
        pageSize: 500,
      });
      setRows(res.items || []);
      setTotal(res.total || 0);
      setCommonLinks(res.commonLinks || null);
      setSelected(new Set());
    } catch {
      setErrorMessage("Could not load clubs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [yearId, districtId, search, expiringInDays, expiryFrom, expiryTo]);

  useEffect(() => { load(); }, [yearId, districtId, expiringInDays, expiryFrom, expiryTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Common (pick-a-club) links are year-independent — fetch once (pageSize 1) so they show before any filter.
  useEffect(() => {
    if (!yearId || commonLinks) return;
    getClubWebsitePricing({ yearId: Number(yearId), pageSize: 1 })
      .then((res) => setCommonLinks(res.commonLinks || null))
      .catch(() => {});
  }, [yearId, commonLinks]);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.clubId));
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.clubId)));
  };
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openSingle = (r: ClubWebsitePricingRow) => {
    setEdit({
      open: true, mode: "single", clubId: r.clubId, clubName: r.clubName, orderType: r.orderType,
      baseAmount: String(r.baseAmount ?? 10999),
      renewalAmount: String(r.renewalAmount ?? r.baseAmount ?? 10999),
      gstPercent: String(r.gstPercent ?? 18),
      gatewayType: (r.gatewayType === "route" ? "route" : "normal"),
    });
  };
  const openBatch = async () => {
    // Pre-fill with the LIVE system-wide default (New / Renewal / GST). Re-fetch on open so the
    // popup always reflects the latest saved default (e.g. changed via the OTP editor or by
    // another admin), never a stale/hardcoded value. SuperAdmin can then override for this district.
    let d = defPricing;
    try { d = await getWebsiteDefaultPricing(); setDefPricing(d); } catch { /* keep last-known */ }
    setEdit({
      ...emptyEdit, open: true, mode: "batch",
      baseAmount: String(d?.newAmount ?? emptyEdit.baseAmount),
      renewalAmount: String(d?.renewalAmount ?? emptyEdit.renewalAmount),
      gstPercent: String(d?.gstPercent ?? emptyEdit.gstPercent),
    });
  };

  // GST 0% => gateway must be Route. The Route account itself is the single global one below.
  const gst0 = useMemo(() => Number(edit.gstPercent) === 0, [edit.gstPercent]);
  const editValid = useMemo(() => {
    const base = Number(edit.baseAmount), renewal = Number(edit.renewalAmount), gst = Number(edit.gstPercent);
    if (Number.isNaN(base) || base < 0) return false;
    if (Number.isNaN(renewal) || renewal < 0) return false;
    if (Number.isNaN(gst) || gst < 0 || gst > 100) return false;
    if (edit.gatewayType === "route" && !routeAccountId) return false;   // a global Route account must be selected
    if (gst0 && edit.gatewayType !== "route") return false;
    return true;
  }, [edit, gst0, routeAccountId]);

  const persistRoute = async (accId: string, all: boolean) => {
    setSavingRoute(true); setErrorMessage(null);
    try { await setClubWebsiteRouteAccount(accId ? Number(accId) : null, all); setSuccessMessage("Saved."); await load(); }
    catch (e: any) { setErrorMessage(e?.response?.data?.message || "Could not save the Route account."); }
    finally { setSavingRoute(false); }
  };
  const saveRouteAccount = async (v: string) => {
    setRouteAccountId(v);
    // Clearing the account can't leave "route all" on.
    const all = v ? routeAll : false;
    if (!v) setRouteAll(false);
    await persistRoute(v, all);
  };
  const saveRouteAll = async (on: boolean) => {
    setRouteAll(on);
    await persistRoute(routeAccountId, on);
  };

  const saveEdit = async () => {
    if (!editValid) return;
    setSaving(true);
    setErrorMessage(null);
    const payload = {
      yearId: Number(yearId),
      baseAmount: Number(edit.baseAmount),
      renewalAmount: Number(edit.renewalAmount),
      gstPercent: Number(edit.gstPercent),
      gatewayType: edit.gatewayType,
    };
    try {
      if (edit.mode === "single" && edit.clubId) {
        await upsertClubWebsitePricing(edit.clubId, payload);
        setSuccessMessage("Price updated.");
      } else {
        // Batch: selected clubs if any, else the whole current district.
        const clubIds = selected.size > 0 ? Array.from(selected) : undefined;
        if (!clubIds && !districtId) { setErrorMessage("Select a district or specific clubs first."); setSaving(false); return; }
        const res = await batchClubWebsitePricing({
          ...payload,
          districtId: clubIds ? undefined : Number(districtId),
          clubIds,
        });
        setSuccessMessage(`Price applied to ${res.updated} club(s).`);
      }
      setEdit(emptyEdit);
      await load();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const sendReminders = async () => {
    if (selected.size === 0) return;
    setSending(true);
    setErrorMessage(null);
    try {
      const res = await sendClubWebsiteReminders(Array.from(selected), Number(yearId));
      let msg = `Reminders: ${res.clubsProcessed} club(s) processed: ${res.emailsSent} email(s), ${res.failed} failed.`;
      if (res.skipped?.length) msg += ` Skipped ${res.skipped.length}: ` + res.skipped.slice(0, 5).map((s) => `${s.clubName} (${s.reason})`).join("; ");
      setSuccessMessage(msg);
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Could not send reminders. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const gatewayLabel = (r: ClubWebsitePricingRow) =>
    (routeAll || r.gatewayType === "route") ? "Route" : "Normal";

  return (
    <div className="space-y-4">
      <SuccessAlert open={!!successMessage} title="Done" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Club Wallet</h2>
          <p className="text-sm text-slate-500">Club-website pricing &amp; pay-link reminders, plus shareable email credit top-up links.</p>
        </div>
        <Button variant="outline" onClick={openDefaultEdit} className="shrink-0">
          <Pencil className="h-4 w-4 mr-1.5" /> Default Amount of Club Website
          {defPricing && <span className="ml-1.5 text-xs text-slate-400">New {inr(defPricing.newTotal)} · Renew {inr(defPricing.renewalTotal)}</span>}
        </Button>
      </div>

      {/* Common (pick-a-club) shareable links — open a search, payer picks their club, sees status, pays. */}
      {commonLinks && (
        <div className="rounded-[20px] border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium text-slate-700">Shareable links: any club</div>
          <p className="text-[11px] text-slate-400 mt-0.5 mb-3">Each opens a search: the club leader picks their club, sees its status, and pays. Copy &amp; share. These links have no expiry.</p>
          <div className="flex flex-wrap gap-2">
            {([["Club Website", "website"], ["Email Credits", "email"]] as const).map(([label, kind]) => {
              const key = `common:${kind}`;
              return (
                <Button key={kind} variant="outline" size="sm" onClick={() => copyText(key, commonLinks[kind])}>
                  {copiedKey === key ? <Check className="h-4 w-4 mr-1.5 text-emerald-600" /> : <Copy className="h-4 w-4 mr-1.5" />}
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* One global Route account for ALL club-website Route payments */}
      <div className="rounded-[20px] border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">Club-website Route account</Label>
            <Select value={routeAccountId || "none"} onValueChange={(v) => saveRouteAccount(v === "none" ? "" : v)}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select an account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Route disabled)</SelectItem>
                {routeAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.accountId})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className={`flex items-center gap-2 text-sm pb-2 ${routeAccountId ? "text-slate-700" : "text-slate-400"}`}>
            <Checkbox checked={routeAll} disabled={!routeAccountId || savingRoute} onCheckedChange={(v) => saveRouteAll(!!v)} />
            Route <span className="font-medium">all</span> club-website payments through this account
          </label>
          {savingRoute && <span className="text-xs text-slate-400 pb-2">Saving…</span>}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          {routeAll
            ? <><span className="font-medium text-indigo-600">All</span> club-website payments settle to this one linked account (per-club gateway is overridden).</>
            : <>Only clubs whose gateway is <span className="font-medium">Route</span> settle to this one linked account.</>}
          {routeAccounts.length === 0 && <> No active accounts yet: add one in Settings → Razorpay Route Accounts.</>}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Rotary Year</Label>
          <Select value={yearId} onValueChange={setYearId}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y.id} value={String(y.id)}>{y.label}{y.isCurrent ? " (current)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">District</Label>
          <Select value={districtId || "all"} onValueChange={(v) => setDistrictId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select district" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All (search required)</SelectItem>
              {districts.map((d: any) => (
                <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Expiring within (days)</Label>
          <Input type="number" min={0} value={expiringInDays} onChange={(e) => setExpiringInDays(e.target.value)}
            placeholder="e.g. 30" className="w-32" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Expiry from</Label>
          <DateField value={expiryFrom} onChange={setExpiryFrom} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Expiry to</Label>
          <DateField value={expiryTo} onChange={setExpiryTo} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Search club</Label>
          <div className="flex flex-wrap gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Club name / Rotary ID" className="w-56" />
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={openBalances}>
          <Wallet className="h-4 w-4 mr-1.5" /> Check balance
        </Button>
        <Button variant="outline" onClick={openBatch} disabled={rows.length === 0}>
          <Layers className="h-4 w-4 mr-1.5" /> Set price for {selected.size > 0 ? `${selected.size} selected` : "district"}
        </Button>
        <Button onClick={sendReminders} disabled={selected.size === 0 || sending}>
          {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
          Send reminders ({selected.size})
        </Button>
        {rows.length > 0 && <span className="text-xs text-slate-500">{rows.length} of {total} club(s)</span>}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2.5 w-8"><Checkbox checked={allChecked} onCheckedChange={toggleAll} /></th>
              <th className="text-left px-3 py-2.5 font-medium">Club</th>
              <th className="text-left px-3 py-2.5 font-medium">Type</th>
              <th className="text-right px-3 py-2.5 font-medium">Amount</th>
              <th className="text-right px-3 py-2.5 font-medium">GST%</th>
              <th className="text-right px-3 py-2.5 font-medium">Total</th>
              <th className="text-left px-3 py-2.5 font-medium">Gateway</th>
              <th className="text-left px-3 py-2.5 font-medium">President / Secretary</th>
              <th className="text-right px-3 py-2.5 font-medium">
                Copy links
                <div className="text-[10px] font-normal text-slate-400">Valid for 30 days</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">Pick a district, search, or set an “expiring within” filter to list clubs.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.clubId} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-3 py-2 align-top"><Checkbox checked={selected.has(r.clubId)} onCheckedChange={() => toggleOne(r.clubId)} /></td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{r.clubName}</div>
                  <div className="text-xs text-slate-400">D{r.districtNumber} · {r.clubRotaryId || "–"}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${r.orderType === "Renewal" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{r.orderType}</span>
                  {r.orderType === "Renewal" && r.endDate && <div className="text-xs text-slate-400 mt-0.5">exp {fmtDate(r.endDate)}</div>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {inr(r.orderType === "Renewal" ? r.renewalAmount : r.baseAmount)}
                  {!r.isCustom && <span className="text-[10px] text-slate-400 ml-1">(default)</span>}
                </td>
                <td className="px-3 py-2 text-right">{Number(r.gstPercent)}%</td>
                <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {inr(r.orderType === "Renewal" ? r.renewalTotalAmount : r.totalAmount)}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs ${(routeAll || r.gatewayType === "route") ? "text-indigo-700" : "text-slate-600"}`}>{gatewayLabel(r)}</span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  <div>{r.presidentName || "–"} {r.presidentMobile ? `· ${r.presidentMobile}` : ""}</div>
                  <div className="text-slate-400">{r.secretaryName || "–"} {r.secretaryMobile ? `· ${r.secretaryMobile}` : ""}</div>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-0.5">
                    {([["Web", "website", r.payLink], ["Email", "email", r.emailPayLink]] as const).map(([lbl, kind, url]) => {
                      const key = `row:${r.clubId}:${kind}`;
                      return (
                        <Button key={kind} variant="ghost" size="sm" className="h-7 px-2 text-xs" title={`Copy ${lbl} link`} onClick={() => copyText(key, url)}>
                          {copiedKey === key ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <><Copy className="h-3.5 w-3.5 mr-1" />{lbl}</>}
                        </Button>
                      );
                    })}
                    <Button variant="ghost" size="sm" className="h-7 px-2" title="Edit price" onClick={() => openSingle(r)}><Pencil className="h-4 w-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit / batch dialog */}
      <Dialog open={edit.open} onOpenChange={(o) => !o && setEdit(emptyEdit)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {edit.mode === "single" ? `Price: ${edit.clubName}` :
                selected.size > 0 ? `Set price for ${selected.size} selected club(s)` :
                `Set price for entire district`}
            </DialogTitle>
            {edit.mode === "batch" && defPricing && (
              <p className="text-xs text-slate-500 mt-1">
                Pre-filled with the system default: New <span className="font-medium text-slate-700">{inr(defPricing.newAmount)}</span> · Renewal <span className="font-medium text-slate-700">{inr(defPricing.renewalAmount)}</span> (+{defPricing.gstPercent}% GST). Change below to override for this district.
              </p>
            )}
          </DialogHeader>
          <div className="space-y-4">
            {(() => {
              // Single mode → show only the amount that applies to THIS club (Renewal club → Renewal,
              // New club → New). Batch mode → both (a district has a mix of new + renewal clubs).
              const showNew = edit.mode === "batch" || edit.orderType !== "Renewal";
              const showRenewal = edit.mode === "batch" || edit.orderType === "Renewal";
              return (
            <div className="grid grid-cols-2 gap-3">
              {showNew && (
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">New Amount (₹, excl. GST)</Label>
                <Input type="number" min={0} value={edit.baseAmount} onChange={(e) => setEdit((s) => ({ ...s, baseAmount: e.target.value }))} />
              </div>
              )}
              {showRenewal && (
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Renewal Amount (₹, excl. GST)</Label>
                <Input type="number" min={0} value={edit.renewalAmount} onChange={(e) => setEdit((s) => ({ ...s, renewalAmount: e.target.value }))} />
              </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">GST %</Label>
                <Input type="number" min={0} max={100} value={edit.gstPercent} onChange={(e) => setEdit((s) => ({ ...s, gstPercent: e.target.value }))} />
              </div>
            </div>
              );
            })()}
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Payment gateway</Label>
              <Select
                value={edit.gatewayType}
                onValueChange={(v) => setEdit((s) => ({ ...s, gatewayType: v as "normal" | "route" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal" disabled={gst0}>Razorpay Normal</SelectItem>
                  <SelectItem value="route">Razorpay Route</SelectItem>
                </SelectContent>
              </Select>
              {gst0 && <p className="text-xs text-amber-600">GST 0% requires the Route gateway.</p>}
              {edit.gatewayType === "route" && !routeAccountId && (
                <p className="text-xs text-red-600">Select the club-website Route account at the top of this tab first.</p>
              )}
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1.5">
              {(edit.mode === "batch" || edit.orderType !== "Renewal") && (
              <div className="flex justify-between">
                <span className="text-slate-500">New total payable</span>
                <span className="font-semibold text-slate-800">
                  {inr(Number(edit.baseAmount || 0) + Math.round(Number(edit.baseAmount || 0) * Number(edit.gstPercent || 0)) / 100)}
                </span>
              </div>
              )}
              {(edit.mode === "batch" || edit.orderType === "Renewal") && (
              <div className="flex justify-between">
                <span className="text-slate-500">Renewal total payable</span>
                <span className="font-semibold text-slate-800">
                  {inr(Number(edit.renewalAmount || 0) + Math.round(Number(edit.renewalAmount || 0) * Number(edit.gstPercent || 0)) / 100)}
                </span>
              </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(emptyEdit)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={!editValid || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Default pricing — system-wide, OTP-gated edit */}
      <Dialog open={defOpen} onOpenChange={(o) => !o && setDefOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Default pricing: system-wide</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-slate-500">These prices apply to every club that has no district- or club-specific override. Saving requires an OTP sent to the authorised approver.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">New Amount (₹, excl. GST)</Label>
                <Input type="number" min={0} value={defNew} onChange={(e) => setDefNew(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Renewal Amount (₹, excl. GST)</Label>
                <Input type="number" min={0} value={defRenewal} onChange={(e) => setDefRenewal(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">GST %</Label>
                <Input type="number" min={0} max={100} value={defGst} onChange={(e) => setDefGst(e.target.value)} />
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">New total payable</span>
                <span className="font-semibold text-slate-800">{inr(Number(defNew || 0) + Math.round(Number(defNew || 0) * Number(defGst || 0)) / 100)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Renewal total payable</span>
                <span className="font-semibold text-slate-800">{inr(Number(defRenewal || 0) + Math.round(Number(defRenewal || 0) * Number(defGst || 0)) / 100)}</span>
              </div>
            </div>
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-slate-500">OTP</Label>
                  <Input value={defOtp} inputMode="numeric" placeholder="6-digit code"
                    onChange={(e) => setDefOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </div>
                <Button variant="outline" onClick={sendDefaultOtp} disabled={defSendingOtp}>
                  {defSendingOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : (defOtpSent ? "Resend OTP" : "Send OTP")}
                </Button>
              </div>
              {defOtpInfo
                ? <p className="text-[11px] text-emerald-600">{defOtpInfo}</p>
                : <p className="text-[11px] text-slate-400">Click “Send OTP”: a code goes to the authorised approver to confirm the change.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefOpen(false)}>Cancel</Button>
            <Button onClick={saveDefaultPricing} disabled={defSaving || !defOtpSent || defOtp.trim().length !== 6}>
              {defSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check balance — clubs with a live email credit balance */}
      <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Wallet className="h-5 w-5 text-slate-600" /> Clubs with credit balance
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Clubs where email credits are &gt; 0.
              {balanceRows.length > 0 && <> {balanceRows.length} club(s).</>}
            </p>
            <Button variant="outline" size="sm" onClick={downloadBalancesCsv} disabled={balanceLoading || balanceRows.length === 0}>
              <Download className="h-4 w-4 mr-1.5" /> Download CSV
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Club</th>
                  <th className="text-right px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">President</th>
                  <th className="text-left px-3 py-2 font-medium">Secretary</th>
                </tr>
              </thead>
              <tbody>
                {balanceLoading ? (
                  <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
                ) : balanceRows.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400">No clubs with a credit balance.</td></tr>
                ) : balanceRows.map((r) => (
                  <tr key={r.clubId} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{r.clubName}</div>
                      <div className="text-xs text-slate-400">D{r.districtNumber}</div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{r.emailBalance.toLocaleString(appLocale())}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      <div className="font-medium text-slate-700">{r.presidentName || "–"}</div>
                      <div>{r.presidentMobile || ""}</div>
                      <div className="text-slate-400 break-all">{r.presidentEmail || ""}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      <div className="font-medium text-slate-700">{r.secretaryName || "–"}</div>
                      <div>{r.secretaryMobile || ""}</div>
                      <div className="text-slate-400 break-all">{r.secretaryEmail || ""}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
