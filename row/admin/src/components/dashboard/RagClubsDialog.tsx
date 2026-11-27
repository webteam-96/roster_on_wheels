"use client";

// RAG Analysis popup (user 2026-10-30): the district's clubs with their Rotary.org member count, grouped
// by the 5 Rotary.org bands - the same figures the RAG card counts, so each group adds up to its number.

import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Search } from "@/components/icons";
import XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getGoalRagClubs, type GoalRagClub } from "@/services/api";
import { RAG_BANDS } from "@/lib/goalRotaryLayout";
import { fileTimestamp } from "@/lib/dateUtils";
import { appLocale } from "@/lib/appFormat";

const bandOf = (n: number) => (n <= 10 ? 0 : n <= 25 ? 1 : n <= 50 ? 2 : n <= 100 ? 3 : 4);

export default function RagClubsDialog({ open, onClose, yearId, districtId, title }: {
  open: boolean; onClose: () => void; yearId: number; districtId: number; title: string;
}) {
  const [clubs, setClubs] = useState<GoalRagClub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setClubs(null); setError(null);
    getGoalRagClubs(yearId, districtId)
      .then((r) => { if (!cancelled) setClubs(r); })
      .catch(() => { if (!cancelled) setError("Could not load the clubs."); });
    return () => { cancelled = true; };
  }, [open, yearId, districtId]);

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (clubs ?? []).filter((c) => !t || c.clubName.toLowerCase().includes(t));
    return RAG_BANDS.map((b, i) => ({ band: b, clubs: list.filter((c) => bandOf(c.members) === i).sort((a, b) => a.members - b.members) }));
  }, [clubs, q]);

  // Excel like the popup (user 2026-10-30): title, then one coloured band row per colour with its club
  // count, the clubs under it, bordered and print-ready.
  function download() {
    const border = { style: "thin", color: { rgb: "D5DCE8" } };
    const box = { top: border, bottom: border, left: border, right: border };
    const cells: { v: string | number; s: object }[][] = [];
    const merges: XLSX.Range[] = [];
    const total = groups.reduce((t, g) => t + g.clubs.length, 0);
    cells.push([{ v: `RAG Analysis: ${title} · ${total} clubs`, s: { font: { bold: true, sz: 15, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0B2A5E" } }, alignment: { horizontal: "center", vertical: "center" } } }, { v: "", s: {} }]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } });
    cells.push([{ v: `Member count from Rotary.org · Generated ${new Date().toLocaleString(appLocale())}`, s: { font: { sz: 10, color: { rgb: "475569" } }, alignment: { horizontal: "center" } } }, { v: "", s: {} }]);
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
    cells.push([{ v: "", s: {} }, { v: "", s: {} }]);
    for (const g of groups) {
      const hex = g.band.color.replace("#", "").toUpperCase();
      const ink = g.band.key.endsWith("yellow") ? "3A2E00" : "FFFFFF";
      const band = { font: { bold: true, color: { rgb: ink } }, fill: { fgColor: { rgb: hex } }, border: box };
      cells.push([{ v: g.band.label, s: band }, { v: `${g.clubs.length} clubs`, s: { ...band, alignment: { horizontal: "right" } } }]);
      cells.push([{ v: "Club", s: { font: { bold: true, color: { rgb: "0B2A5E" } }, fill: { fgColor: { rgb: "E8EEF8" } }, border: box } },
                  { v: "Members", s: { font: { bold: true, color: { rgb: "0B2A5E" } }, fill: { fgColor: { rgb: "E8EEF8" } }, border: box, alignment: { horizontal: "right" } } }]);
      for (const c of g.clubs) cells.push([{ v: c.clubName, s: { border: box } }, { v: c.members, s: { border: box, font: { bold: true }, alignment: { horizontal: "right" } } }]);
      cells.push([{ v: "", s: {} }, { v: "", s: {} }]);
    }
    const ws = XLSX.utils.aoa_to_sheet(cells.map((r) => r.map((x) => x.v)));
    cells.forEach((r, ri) => r.forEach((x, ci) => { const ref = XLSX.utils.encode_cell({ r: ri, c: ci }); if (ws[ref]) ws[ref].s = x.s; }));
    ws["!cols"] = [{ wch: 52 }, { wch: 14 }];
    ws["!rows"] = [{ hpt: 28 }];
    ws["!merges"] = merges;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RAG Analysis");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `RAG_Analysis_${fileTimestamp()}.xlsx`);
  }

  const total = clubs?.length ?? 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl w-[96vw] h-[86vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>RAG Analysis: {title}{clubs ? ` · ${total} clubs` : ""}</DialogTitle>
        </DialogHeader>
        <div className="shrink-0 flex flex-wrap items-center gap-2 pr-8">
          <label className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-go-text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search club…"
              className="bg-go-surface pl-9 pr-3 text-go-body" />
          </label>
          <span className="text-go-meta text-go-text-secondary">Member count from Rotary.org</span>
          <span className="flex-1" />
          <Button type="button" onClick={download} disabled={!clubs || clubs.length === 0}
            variant="outline" size="sm">
            <Download size={14} /> Download
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pt-2">
          {error && <p className="text-go-body text-go-danger-600">{error}</p>}
          {!clubs && !error && <div className="flex items-center gap-2 text-go-body text-go-text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
          {clubs && clubs.length === 0 && <p className="text-go-body text-go-text-muted">No Rotary.org member counts for this district / year yet.</p>}
          {clubs && clubs.length > 0 && groups.map((g) => (
            <div key={g.band.key} className="rounded-go-lg border border-go-border overflow-hidden" style={{ borderTop: `5px solid ${g.band.color}` }}>
              <div className="flex items-center justify-between px-4 py-2.5 bg-go-sunken">
                <span className="text-go-body font-bold text-go-navy-900">{g.band.label}</span>
                <span className="text-go-body font-bold" style={{ color: g.band.color }}>{g.clubs.length} clubs</span>
              </div>
              {g.clubs.length > 0 && (
                <Table className="w-full text-go-body">
                  <TableBody>
                    {g.clubs.map((c) => (
                      <TableRow key={c.clubId} className="border-t border-go-border">
                        <TableCell className="px-4 py-1.5 text-go-text-primary">{c.clubName}</TableCell>
                        <TableCell className="px-4 py-1.5 text-right font-bold text-go-navy-900 tabular-nums w-28">{c.members}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
