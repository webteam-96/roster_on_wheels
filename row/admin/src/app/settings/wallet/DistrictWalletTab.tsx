"use client";

/**
 * SuperAdmin › Wallet › District Wallet.
 * --------------------------------------------------------------------------
 * Per-district WhatsApp/Email credit balances with shareable top-up pay-links (specific + common).
 * Credits have a fixed rate (no per-district pricing) — this tab is copy-links only.
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ErrorAlert from "@/components/ErrorAlert";
import { getWalletDistricts, type WalletDistrictRow } from "@/services/api";

import { appLocale } from "@/lib/appFormat";
export default function DistrictWalletTab() {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<WalletDistrictRow[]>([]);
  const [commonLinks, setCommonLinks] = useState<{ whatsapp: string; email: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
    } catch {
      setErrorMessage(`Copy failed. Link:\n${text}`);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWalletDistricts(search.trim() || undefined);
      setRows(res.items || []);
      setCommonLinks(res.commonLinks || null);
    } catch {
      setErrorMessage("Could not load districts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

      <div>
        <h2 className="text-lg font-semibold text-slate-800">District Wallet</h2>
        <p className="text-sm text-slate-500">Shareable WhatsApp/Email credit top-up links per district.</p>
      </div>

      {/* Common (pick-a-district) shareable links */}
      {commonLinks && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium text-slate-700">Shareable links — any district</div>
          <p className="text-[11px] text-slate-400 mt-0.5 mb-3">Each opens a search: the district admin picks their district, sees its balance, and pays. Copy &amp; share.</p>
          <div className="flex flex-wrap gap-2">
            {([["WhatsApp Credits", "whatsapp"], ["Email Credits", "email"]] as const).map(([label, kind]) => {
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

      {/* Filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Search district</Label>
          <div className="flex gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="District number" className="w-48" />
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {rows.length > 0 && <span className="text-xs text-slate-500 pb-2">{rows.length} district(s)</span>}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2.5 font-medium">District</th>
              <th className="text-right px-3 py-2.5 font-medium">WhatsApp balance</th>
              <th className="text-right px-3 py-2.5 font-medium">Email balance</th>
              <th className="text-right px-3 py-2.5 font-medium">Copy links</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400">No districts found.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.districtId} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-3 py-2 font-medium text-slate-800">District {r.districtNumber}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{r.whatsappBalance.toLocaleString(appLocale())}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{r.emailBalance.toLocaleString(appLocale())}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-0.5">
                    {([["WA", "whatsapp", r.whatsappPayLink], ["Email", "email", r.emailPayLink]] as const).map(([lbl, kind, url]) => {
                      const key = `row:${r.districtId}:${kind}`;
                      return (
                        <Button key={kind} variant="ghost" size="sm" className="h-7 px-2 text-xs" title={`Copy ${lbl} link`} onClick={() => copyText(key, url)}>
                          {copiedKey === key ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <><Copy className="h-3.5 w-3.5 mr-1" />{lbl}</>}
                        </Button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
