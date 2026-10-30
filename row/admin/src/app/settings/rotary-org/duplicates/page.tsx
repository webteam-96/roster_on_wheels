"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, Loader2, Smartphone, Mail, Search, X, Download, StickyNote, Pencil } from "@/components/icons";
import { getDuplicateList, getAllDuplicates, saveDuplicateRemark, getMergeHistory, revertMerge, type DupPair, type MergeHistoryRow } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import MergeDialog from "./MergeDialog";

import { appLocale } from "@/lib/appFormat";
import Pagination from "@/components/Pagination";
const PAGE_SIZE = 20;
type FilterType = "all" | "mobile" | "email" | "both";

function TypeBadge({ matchTypes }: { matchTypes: string }) {
  const hasMobile = matchTypes.includes("Mobile");
  const hasEmail = matchTypes.includes("Email");
  return (
    <div className="flex flex-wrap gap-1">
      {hasMobile && (
        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 gap-1">
          <Smartphone className="h-3 w-3" /> Mobile
        </Badge>
      )}
      {hasEmail && (
        <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700 gap-1">
          <Mail className="h-3 w-3" /> Email
        </Badge>
      )}
    </div>
  );
}

function MemberCell({ rid, name, club }: { rid: string | null; name: string | null; club: string | null }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-slate-800 truncate">{name || "–"}</div>
      <div className="text-xs text-muted-foreground">RID {rid || "–"}{club ? ` · ${club}` : ""}</div>
    </div>
  );
}

export default function DuplicatesPage() {
  const { isSuperAdmin } = useAuth();
  const [items, setItems] = useState<DupPair[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");        // committed term (used for the query)
  const [searchInput, setSearchInput] = useState(""); // what's typed in the box
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<DupPair | null>(null);
  const [exporting, setExporting] = useState(false);
  // Remark popup state.
  const [remarkTarget, setRemarkTarget] = useState<DupPair | null>(null);
  const [remarkText, setRemarkText] = useState("");
  const [remarkSaving, setRemarkSaving] = useState(false);
  // "Merged (Undo)" view — recent merges that can be reverted.
  const [merged, setMerged] = useState(false);
  const [history, setHistory] = useState<MergeHistoryRow[]>([]);
  const [reverting, setReverting] = useState<number | null>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await getAllDuplicates(filter === "all" ? undefined : filter, search.trim() || undefined);
      exportToCSV(rows, "rotary_org_duplicates", [
        { key: "matchTypes", label: "Type" },
        { key: "nameA", label: "Member A" }, { key: "ridA", label: "RID A" }, { key: "clubA", label: "Club A" },
        { key: "nameB", label: "Member B" }, { key: "ridB", label: "RID B" }, { key: "clubB", label: "Club B" },
        { key: "sharedMobile", label: "Shared Mobile" }, { key: "sharedEmail", label: "Shared Email" },
        { key: "remark", label: "Remark" },
      ], { title: "Duplicate Mobile / Email", subtitle: `${rows.length} pair(s)` });
    } catch {
      window.alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const openRemark = (p: DupPair) => { setRemarkTarget(p); setRemarkText(p.remark || ""); };
  const handleSaveRemark = async () => {
    if (!remarkTarget) return;
    setRemarkSaving(true);
    try {
      const saved = await saveDuplicateRemark(remarkTarget.memberAId, remarkTarget.memberBId, remarkText);
      // Reflect the new remark locally without a full reload.
      setItems((prev) => prev.map((x) =>
        x.memberAId === remarkTarget.memberAId && x.memberBId === remarkTarget.memberBId
          ? { ...x, remark: saved.remark } : x));
      setRemarkTarget(null);
    } catch {
      window.alert("Failed to save remark. Please try again.");
    } finally {
      setRemarkSaving(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (merged) {
        setHistory(await getMergeHistory(100));
      } else {
        const res = await getDuplicateList(page, PAGE_SIZE, filter === "all" ? undefined : filter, search.trim() || undefined);
        setItems(res.items);
        setTotal(res.total);
      }
    } catch {
      setItems([]); setTotal(0); setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [page, filter, search, merged]);

  const handleRevert = async (h: MergeHistoryRow) => {
    if (!window.confirm(
      `Revert this merge?\n\nRestore "${h.deletedName || "–"}" (RID ${h.deletedRid || "–"}) as a separate member. ` +
      `Its profile, clubs and family are restored from the backup. Continue?`
    )) return;
    setReverting(h.id);
    try {
      const r = await revertMerge(h.keptId, h.deletedId);
      await load();
      window.alert(r.rolesNote ? `Reverted: member restored.\n\nNote: ${r.rolesNote}` : "Reverted: member restored.");
    } catch {
      window.alert("Revert failed. Please try again.");
    } finally {
      setReverting(null);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin, load]);

  // Debounce typing → commit the search term (and reset to page 1).
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access this page.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "mobile", label: "Mobile" },
    { key: "email", label: "Email" },
    { key: "both", label: "Both" },
  ];

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings/rotary-org"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Duplicate Mobile / Email</h2>
            <p className="text-muted-foreground text-base">
              Members sharing a mobile or email: one holds it as primary, the other as secondary. Review each pair, then merge or keep both.
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, mobile, email, club, district or Rotary ID…"
            className="pl-9 pr-9"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
              title="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <Button
              key={f.key}
              variant={filter === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => { setFilter(f.key); setPage(1); }}
            >
              {f.label}
            </Button>
          ))}
          {/* Toggle: active list · Merged (Undo). */}
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <Button
            variant={merged ? "default" : "outline"}
            size="sm"
            onClick={() => { setMerged((m) => !m); setPage(1); }}
            title="Recent merges: undo an accidental merge"
          >
            {merged ? "Back to duplicates" : "Merged (Undo)"}
          </Button>
          <div className="ml-auto flex items-center gap-3">
            {!merged && (
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || loading || total === 0} title="Export the full listing to Excel">
                {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                Export Excel
              </Button>
            )}
            <span className="text-sm text-muted-foreground">
              {loading ? "Loading…" : merged ? `${history.length} merge${history.length === 1 ? "" : "s"}` : `${total.toLocaleString(appLocale())} pair${total === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>

        {/* ── Merged (Undo) view — recent merges with a Revert button ── */}
        {merged && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                    <tr className="border-b bg-slate-50 text-left text-muted-foreground">
                      <th className="py-3 px-4 font-medium">Merged on</th>
                      <th className="py-3 px-4 font-medium">Kept</th>
                      <th className="py-3 px-4 font-medium">Deleted (restore this)</th>
                      <th className="py-3 px-4 font-medium w-28">Status</th>
                      <th className="py-3 px-4 font-medium text-right w-28">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={5} className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
                    ) : history.length === 0 ? (
                      <tr><td colSpan={5} className="py-16 text-center text-muted-foreground">No merges recorded.</td></tr>
                    ) : (
                      history.map((h) => (
                        <tr key={h.id} className="border-b hover:bg-slate-50/60">
                          <td className="py-3 px-4 align-top text-slate-600">{h.mergedOn ? new Date(h.mergedOn).toLocaleString(appLocale()) : "–"}</td>
                          <td className="py-3 px-4 align-top"><MemberCell rid={h.keptRid} name={h.keptName} club={null} /></td>
                          <td className="py-3 px-4 align-top">
                            <MemberCell rid={h.deletedRid} name={h.deletedName} club={h.deletedMobile ? h.deletedMobile : null} />
                          </td>
                          <td className="py-3 px-4 align-top">
                            {h.deletedStillGone ? (
                              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">Deleted</Badge>
                            ) : (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Restored</Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 align-top text-right">
                            <Button
                              size="sm"
                              disabled={reverting === h.id || !h.deletedStillGone}
                              onClick={() => handleRevert(h)}
                              title={h.deletedStillGone ? "Undo this merge and restore the deleted member" : "Already restored"}
                            >
                              {reverting === h.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revert"}
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {!merged && (
        <>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                  <tr className="border-b bg-slate-50 text-left text-muted-foreground">
                    <th className="py-3 px-4 font-medium w-28">Type</th>
                    <th className="py-3 px-4 font-medium">Member A</th>
                    <th className="py-3 px-4 font-medium">Member B</th>
                    <th className="py-3 px-4 font-medium">Shared value</th>
                    <th className="py-3 px-4 font-medium w-64">Remark</th>
                    <th className="py-3 px-4 font-medium text-right w-28">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center text-muted-foreground">No duplicate pairs found.</td></tr>
                  ) : (
                    items.map((p) => (
                      <tr key={`${p.memberAId}-${p.memberBId}`} className="border-b hover:bg-slate-50/60">
                        <td className="py-3 px-4 align-top"><TypeBadge matchTypes={p.matchTypes} /></td>
                        <td className="py-3 px-4 align-top"><MemberCell rid={p.ridA} name={p.nameA} club={p.clubA} /></td>
                        <td className="py-3 px-4 align-top"><MemberCell rid={p.ridB} name={p.nameB} club={p.clubB} /></td>
                        <td className="py-3 px-4 align-top">
                          {p.sharedMobile && <div className="flex items-center gap-1.5 text-slate-700"><Smartphone className="h-3.5 w-3.5 text-blue-500" />{p.sharedMobile}</div>}
                          {p.sharedEmail && <div className="flex items-center gap-1.5 text-slate-700 break-all"><Mail className="h-3.5 w-3.5 text-purple-500" />{p.sharedEmail}</div>}
                        </td>
                        <td className="py-3 px-4 align-top">
                          {p.remark ? (
                            <div className="flex items-start gap-1.5 max-w-[15rem]">
                              <span className="line-clamp-2 whitespace-pre-wrap text-slate-700">{p.remark}</span>
                              <button
                                type="button"
                                onClick={() => openRemark(p)}
                                title="Edit remark"
                                aria-label="Edit remark"
                                className="mt-0.5 shrink-0 text-slate-400 hover:text-primary"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" className="gap-1" onClick={() => openRemark(p)}>
                              <StickyNote className="h-3.5 w-3.5" /> Add remark
                            </Button>
                          )}
                        </td>
                        <td className="py-3 px-4 align-top text-right">
                          <Button size="sm" onClick={() => setActive(p)}>Review</Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <Pagination page={page} totalPages={totalPages} totalCount={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        )}
        </>
        )}
      </div>

      {active && (
        <MergeDialog
          pair={active}
          onClose={() => setActive(null)}
          onResolved={() => { setActive(null); load(); }}
        />
      )}

      {/* Remark popup */}
      <Dialog open={!!remarkTarget} onOpenChange={(o) => { if (!o) setRemarkTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remark</DialogTitle>
          </DialogHeader>
          {remarkTarget && (
            <div className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground">
                {remarkTarget.nameA || "–"} (RID {remarkTarget.ridA || "–"}) &amp; {remarkTarget.nameB || "–"} (RID {remarkTarget.ridB || "–"})
              </p>
              <textarea
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                rows={4}
                maxLength={1000}
                autoFocus
                placeholder="Add a remark for this duplicate pair…"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground">Leave blank and save to clear the remark. Max 1000 characters.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemarkTarget(null)} disabled={remarkSaving}>Cancel</Button>
            <Button onClick={handleSaveRemark} disabled={remarkSaving}>
              {remarkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  );
}
