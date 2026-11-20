"use client";

// Settings > Wallet > Offline (user 2026-11-16):
//   • Deduct  - Super Admin takes credits off one pack for usage outside ROW (e.g. emails the support
//               team sent through a third-party app). Credited stays as given; Used goes up; the reason is kept.
//   • History - the credit tally of that club / district wallet for the pack's type, first day to today: each
//               support-team entry and online purchase on its own line, the ROW sends between them added up
//               into one line, running balance; .xlsx download (Tally + Details).

import { useEffect, useState } from "react";
import XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { Download, Loader2 } from "@/components/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { fileTimestamp } from "@/lib/dateUtils";
import { deductCredit, getCreditHistory, type CreditHistory, type CreditHistoryEntry } from "@/services/api";
import { appLocale } from "@/lib/appFormat";

export interface DeductTarget {
  id: number; districtNumber: string; clubName: string; creditType: string;
  creditCount: number; usedCount: number; remaining: number;
}

const who = (t: { districtNumber: string; clubName?: string | null }) => t.clubName ? `${t.clubName} (${t.districtNumber})` : `District ${t.districtNumber}`;
const n = (v: number) => v.toLocaleString(appLocale());
const when = (d: string) => new Date(d).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function DeductCreditDialog({ item, onClose, onDone, onError }: {
  item: DeductTarget | null; onClose: () => void; onDone: (message: string) => void; onError: (message: string) => void;
}) {
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setCount(""); setReason(""); }, [item?.id]);
  if (!item) return null;

  const num = parseInt(count, 10);
  const valid = Number.isFinite(num) && num > 0 && num <= item.remaining && reason.trim() !== "";
  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const r = await deductCredit(item.id, num, reason.trim());
      onDone(`${n(num)} ${item.creditType} credits deducted for ${who(item)}. Balance ${n(r.balanceBefore)} → ${n(r.balanceAfter)}.`);
    } catch (e: any) {
      onError(e?.response?.data?.message || "Failed to deduct credits.");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deduct credits</DialogTitle>
          <DialogDescription>For credits used outside ROW. Credited stays the same; Used goes up.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-muted px-3 py-2 text-xs">
            {who(item)} · <b>{item.creditType}</b> · Credited {n(item.creditCount)} · Used {n(item.usedCount)} · Current <b>{n(item.remaining)}</b>
          </div>
          <div className="space-y-1.5">
            <Label>Credits to deduct <span className="text-destructive">*</span></Label>
            <Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 901" />
            {Number.isFinite(num) && num > item.remaining && <p className="text-xs text-destructive">Only {n(item.remaining)} left in this pack.</p>}
            {Number.isFinite(num) && num > 0 && num <= item.remaining && (
              <p className="text-xs text-muted-foreground">Current after deduction: <b>{n(item.remaining - num)}</b></p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={450}
              placeholder="e.g. 901 emails sent by the support team through a third-party app"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deduct"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreditHistoryDialog({ creditId, onClose }: { creditId: number | null; onClose: () => void }) {
  const [data, setData] = useState<CreditHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!creditId) return;
    let alive = true;
    setData(null); setError(null);
    getCreditHistory(creditId).then((d) => { if (alive) setData(d); })
      .catch((e: any) => { if (alive) setError(e?.response?.data?.message || "Failed to load history."); });
    return () => { alive = false; };
  }, [creditId]);
  if (!creditId) return null;

  const day = (d: string) => new Date(d).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
  const period = (e: CreditHistoryEntry) => e.dateTo && day(e.dateTo) !== day(e.date) ? `${day(e.date)} – ${day(e.dateTo)}` : when(e.date);
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${n(Math.abs(v))}`;
  const who2 = (e: CreditHistoryEntry) => e.group === "Support" ? "Support team" : e.group === "Online" ? "Online purchase" : e.group === "Expired" ? "Expired" : "ROW";

  // Excel: sheet "Tally" (the grouped lines + totals) and sheet "Details" (every single entry).
  const download = () => {
    if (!data) return;
    const bold = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E3A5F" } } };
    const sheet = (title: string, head: string[], rows: (string | number)[][], widths: number[]) => {
      const ws = XLSX.utils.aoa_to_sheet([[title], [], head, ...rows]);
      head.forEach((_, c) => { const cell = ws[XLSX.utils.encode_cell({ r: 2, c })]; if (cell) cell.s = bold; });
      ws["!cols"] = widths.map((wch) => ({ wch }));
      return ws;
    };
    const head = ["Date", "Who", "What", "Count", "Balance after", "Details"];
    const tallyRows = data.tally.map((e) => [period(e), who2(e), e.source, e.count, e.balanceAfter ?? "", e.detail ?? ""]);
    tallyRows.push([], ["", "", "Credited by support team", data.creditedBySupport], ["", "", "Bought online", data.boughtOnline],
      ["", "", "Sent through ROW", -data.sentThroughRow], ["", "", "Deducted by support team", -data.deductedBySupport],
      ["", "", "Expired unused", -data.expired], ["", "", "Balance", data.balance]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(`${who(data)} · ${data.creditType} credits · tally`, head, tallyRows, [26, 16, 34, 10, 14, 80]), "Tally");
    XLSX.utils.book_append_sheet(wb, sheet(`${who(data)} · ${data.creditType} credits · every entry`, head,
      data.entries.map((e) => [when(e.date), who2(e), e.source, e.count, e.balanceAfter ?? "", e.detail ?? ""]), [22, 16, 30, 10, 14, 80]), "Details");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Credit_Tally_${data.districtNumber}${data.clubName ? "_" + data.clubName.replace(/\W+/g, "_") : ""}_${data.creditType}_${fileTimestamp()}.xlsx`);
  };

  const box = (label: string, value: string, cls = "text-slate-900") => (
    <div className="rounded-lg border px-3 py-2 min-w-0">
      <div className="text-[11px] text-muted-foreground leading-tight">{label}</div>
      <div className={`text-base font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl w-[96vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Credit tally{data ? `: ${who(data)} · ${data.creditType}` : ""}</DialogTitle>
          <DialogDescription>From the first day to today, oldest first. ROW sends between two support-team entries are added up into one line.</DialogDescription>
        </DialogHeader>
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {box("Credited by support team", signed(data.creditedBySupport), "text-emerald-700")}
            {box("Bought online", signed(data.boughtOnline), "text-emerald-700")}
            {box("Sent through ROW", signed(-data.sentThroughRow), "text-rose-700")}
            {box("Deducted by support team", signed(-data.deductedBySupport), "text-rose-700")}
            {box("Expired unused", signed(-data.expired), "text-rose-700")}
            {box(data.balance === data.activeCredited - data.activeUsed ? "Balance (matches Current ✓)" : `Balance (Current shows ${n(data.activeCredited - data.activeUsed)})`, n(data.balance))}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          {error ? <p className="text-sm text-destructive py-6 text-center">{error}</p>
            : !data ? <p className="text-sm text-muted-foreground py-6 text-center"><Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Loading…</p>
            : data.tally.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No history yet.</p>
            : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3">Date</th><th className="pr-3">Who</th><th className="pr-3">What</th>
                    <th className="pr-3 text-right">Count</th><th className="pr-3 text-right">Balance after</th><th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tally.map((e, i) => (
                    <tr key={i} className={`border-b align-top ${e.group === "ROW" ? "" : "bg-muted/40"}`}>
                      <td className="py-2 pr-3 whitespace-nowrap">{period(e)}</td>
                      <td className="pr-3 whitespace-nowrap">
                        <Badge className={e.group === "ROW" ? "bg-slate-600 hover:bg-slate-600" : e.group === "Expired" ? "bg-amber-600 hover:bg-amber-600"
                          : e.count >= 0 ? "bg-emerald-600 hover:bg-emerald-600" : "bg-rose-600 hover:bg-rose-600"}>{who2(e)}</Badge>
                      </td>
                      <td className="pr-3">{e.source}{e.lines > 1 && <span className="text-xs text-muted-foreground"> ({n(e.lines)} entries)</span>}</td>
                      <td className={`pr-3 text-right tabular-nums font-semibold ${e.count >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{signed(e.count)}</td>
                      <td className="pr-3 text-right tabular-nums font-semibold">{e.balanceAfter != null ? n(e.balanceAfter) : ""}</td>
                      <td className="text-xs text-muted-foreground break-words">{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={download} disabled={!data || data.tally.length === 0}><Download className="h-4 w-4 mr-1.5" /> Download</Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
