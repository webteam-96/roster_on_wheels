"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  searchProjectSyncClubs, getProjectSyncRows, getProjectSyncHistory,
  type ProjectSyncClub, type ProjectSyncRow, type ProjectSyncEvent,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, RefreshCw, Search, Filter, X } from "lucide-react";

import { appLocale } from "@/lib/appFormat";
function formatDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "—";
  return dt.toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDay(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "—";
  return dt.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

function statusBadge(status: string) {
  const cls =
    status === "Published" ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    status === "Published (before log)" ? "bg-teal-100 text-teal-700 border-teal-200" :
    status === "Reset" ? "bg-slate-200 text-slate-700 border-slate-300" :
    "bg-amber-100 text-amber-700 border-amber-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${cls}`}>
      {status}
    </span>
  );
}

const ACTION_LABEL: Record<string, string> = {
  sync_clicked: "Sync clicked (pending for publish)",
  published: "Published on Rotary.org",
  reset: "Reset by SuperAdmin",
};

export default function ProjectSyncPage() {
  const { isSuperAdmin } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Smart club-name search
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ProjectSyncClub[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchSeq = useRef(0);

  // Selected club + its projects
  const [club, setClub] = useState<{ id: number; name: string; districtNumber: string | null } | null>(null);
  const [rows, setRows] = useState<ProjectSyncRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  // History dialog
  const [historyFor, setHistoryFor] = useState<ProjectSyncRow | null>(null);
  const [history, setHistory] = useState<ProjectSyncEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Debounced club search; a stale reply never overwrites a newer one.
  useEffect(() => {
    const q = query.trim();
    if (q.replace(/\s/g, "").length < 2) { setSuggestions([]); return; }
    const seq = ++searchSeq.current;
    const t = setTimeout(() => {
      searchProjectSyncClubs(q)
        .then((list) => { if (seq === searchSeq.current) setSuggestions(list); })
        .catch(() => { if (seq === searchSeq.current) setSuggestions([]); });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setRows([]);
    if (!club) return;
    setRowsLoading(true);
    getProjectSyncRows(club.id)
      .then(setRows)
      .catch(() => setErrorMessage("Failed to load the sync log for this club."))
      .finally(() => setRowsLoading(false));
  }, [club]);

  const pickClub = (id: number, name: string, districtNumber: string | null) => {
    setClub({ id, name, districtNumber });
  };

  const openHistory = (row: ProjectSyncRow) => {
    if (!club) return;
    setHistoryFor(row);
    setHistory([]);
    setHistoryLoading(true);
    getProjectSyncHistory(club.id, row.projectId, row.yearId)
      .then(setHistory)
      .catch(() => setErrorMessage("Failed to load this project's history."))
      .finally(() => setHistoryLoading(false));
  };

  const clearAll = () => {
    setQuery("");
    setSuggestions([]);
    setClub(null);
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute requireSuperAdmin>
        <div />
      </ProtectedRoute>
    );
  }

  const pendingCount = rows.filter((r) => r.status === "Pending for publish").length;
  const publishedCount = rows.filter((r) => r.status.startsWith("Published")).length;

  return (
    <ProtectedRoute requireSuperAdmin>
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><RefreshCw className="h-6 w-6" /> Project Sync</h1>
            <p className="text-sm text-slate-500">
              Rotary.org project sync log. Search a club by name, then click a project for its full history.
            </p>
          </div>
          <Link href="/settings"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Settings</Button></Link>
        </div>

        <ErrorAlert open={!!errorMessage} title="Project Sync" description={errorMessage ?? ""} onOk={() => setErrorMessage(null)} />

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Select club</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-10 relative">
                <Label className="text-xs">Search club name</Label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-8"
                    placeholder="Type at least 2 letters…"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  />
                </div>
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border bg-white shadow-lg">
                    {suggestions.map((s) => (
                      <button
                        key={s.clubId}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQuery(s.clubName);
                          setShowSuggestions(false);
                          pickClub(s.clubId, s.clubName, s.districtNumber);
                        }}
                      >
                        <div className="font-medium">{s.clubName}</div>
                        <div className="text-xs text-slate-500">District {s.districtNumber ?? "—"}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="md:col-span-2">
                <Button variant="outline" className="w-full" onClick={clearAll}><X className="h-4 w-4 mr-1" /> Clear</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {!club ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-slate-500">
              Search a club by name to see its project sync log.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex flex-wrap items-center gap-3">
                <span>{club.name}</span>
                {club.districtNumber && <span className="text-xs font-normal text-slate-500">District {club.districtNumber}</span>}
                {!rowsLoading && (
                  <span className="text-xs font-normal text-slate-500">
                    {rows.length} project{rows.length === 1 ? "" : "s"} · {publishedCount} published · {pendingCount} pending for publish
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rowsLoading ? (
                <div className="py-10 flex justify-center"><RotaryLoader /></div>
              ) : rows.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">No project of this club has been synced to Rotary.org yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead>Area of Focus</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Sync clicked</TableHead>
                        <TableHead>Clicked by</TableHead>
                        <TableHead>Published</TableHead>
                        <TableHead className="text-right">Sync clicks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r, i) => (
                        <TableRow key={`${r.yearId}-${r.projectId}`} className="cursor-pointer hover:bg-slate-50" onClick={() => openHistory(r)}>
                          <TableCell className="text-slate-500">{i + 1}</TableCell>
                          <TableCell>
                            <div className="font-medium">{r.title || `Project #${r.projectId}`}</div>
                            <div className="text-xs text-slate-500">{formatDay(r.projectDate)}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{r.yearLabel ?? "—"}</TableCell>
                          <TableCell>{r.areaOfFocus ?? "—"}</TableCell>
                          <TableCell>{statusBadge(r.status)}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(r.lastSyncClickedAt)}</TableCell>
                          <TableCell>{r.lastSyncClickedBy ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(r.publishedAt)}</TableCell>
                          <TableCell className="text-right">{r.syncClicks}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={!!historyFor} onOpenChange={(o) => { if (!o) setHistoryFor(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{historyFor?.title || `Project #${historyFor?.projectId}`}</DialogTitle>
            </DialogHeader>
            {historyFor && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {statusBadge(historyFor.status)}
                  <span className="text-slate-500">{historyFor.yearLabel}</span>
                  {historyFor.status === "Published (before log)" && (
                    <span className="text-xs text-slate-500">
                      Marked synced on {formatDate(historyFor.publishedAt)}, before the sync log started.
                    </span>
                  )}
                </div>
                {historyLoading ? (
                  <div className="py-8 flex justify-center"><RotaryLoader /></div>
                ) : history.length === 0 ? (
                  <div className="py-6 text-center text-sm text-slate-500">No logged events for this project.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="whitespace-nowrap">{formatDate(h.createdDate)}</TableCell>
                          <TableCell>{ACTION_LABEL[h.action] ?? h.action}</TableCell>
                          <TableCell>{h.memberName ?? (h.action === "published" ? "Extension" : "—")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
