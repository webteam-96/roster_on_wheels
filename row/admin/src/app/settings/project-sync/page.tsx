"use client";
import { MenuItemButton, LinkButton } from "@/components/ui/text-buttons";

import { useEffect, useRef, useState } from "react";
import {
  searchProjectSyncClubs, getProjectSyncRows, getProjectSyncHistory,
  type ProjectSyncClub, type ProjectSyncRow, type ProjectSyncEvent,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ErrorAlert from "@/components/ErrorAlert";
import { KpiTile, PageHeader, Panel, SkeletonRows } from "@/components/row/AppKit";
import ProtectedRoute from "@/components/ProtectedRoute";
import { RefreshCw, Search, X } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
function formatDate(d: string | null) {
  if (!d) return "–";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "–";
  return dt.toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDay(d: string | null) {
  if (!d) return "–";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "–";
  return dt.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

function statusBadge(status: string) {
  const cls =
    status === "Published" ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    status === "Published (before log)" ? "bg-sky-100 text-sky-800 border-sky-200" :
    status === "Reset" ? "bg-slate-200 text-slate-700 border-slate-300" :
    "bg-amber-100 text-amber-700 border-amber-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[12px] font-medium whitespace-nowrap ${cls}`}>
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
      <div className="space-y-6">
        <PageHeader
          back="/settings"
          title="Project Sync"
          description="Which projects a club has sent to Rotary.org, and where each one stands."
        />

        <ErrorAlert open={!!errorMessage} title="Project Sync" description={errorMessage ?? ""} onOk={() => setErrorMessage(null)} />

        <Panel title="Club">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="relative min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="sync-club">Club name</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="sync-club"
                    className="pl-9"
                    autoComplete="off"
                    placeholder="Type at least 2 letters"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  />
                </div>
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border border-[color:var(--row-line)] bg-card">
                    {suggestions.map((s) => (
                      <MenuItemButton
                        key={s.clubId}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQuery(s.clubName);
                          setShowSuggestions(false);
                          pickClub(s.clubId, s.clubName, s.districtNumber);
                        }}
                      >
                        <div className="font-medium">{s.clubName}</div>
                        <div className="text-[13px] text-muted-foreground">District {s.districtNumber ?? "–"}</div>
                      </MenuItemButton>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="outline" onClick={clearAll} disabled={!query && !club}>
                <X className="mr-2 h-4 w-4" aria-hidden /> Clear
              </Button>
            </div>
        </Panel>

        {!club ? (
          <EmptyPanel title="Pick a club" text="Its projects that were sent to Rotary.org show here." />
        ) : (
          <>
          {!rowsLoading && rows.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <KpiTile label="Projects sent" value={rows.length} />
              <KpiTile label="Published" value={publishedCount} note="On Rotary.org" />
              <KpiTile label="Pending" value={pendingCount} note="Sync clicked, not published yet" />
            </div>
          )}
          <Panel title={club.name} subtitle={club.districtNumber ? `District ${club.districtNumber}` : undefined}>
              {rowsLoading ? (
                <SkeletonRows rows={5} />
              ) : rows.length === 0 ? (
                <div className="space-y-2 pb-2 text-[15px] text-muted-foreground">
                  <p className="font-semibold text-foreground">No project of this club has been sent to Rotary.org yet.</p>
                  <p>
                    A project is listed here after someone opens it under Projects / Events in the club dashboard and clicks
                    Sync to Rotary.org. Until then there is nothing to show.
                  </p>
                </div>
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
                        <TableRow key={`${r.yearId}-${r.projectId}`} className="cursor-pointer hover:bg-muted/70" onClick={() => openHistory(r)}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell>
                            <LinkButton onClick={(e) => { e.stopPropagation(); openHistory(r); }}>{r.title || `Project #${r.projectId}`}</LinkButton>
                            <div className="text-xs text-muted-foreground">{formatDay(r.projectDate)}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{r.yearLabel ?? "–"}</TableCell>
                          <TableCell>{r.areaOfFocus ?? "–"}</TableCell>
                          <TableCell>{statusBadge(r.status)}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(r.lastSyncClickedAt)}</TableCell>
                          <TableCell>{r.lastSyncClickedBy ?? "–"}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(r.publishedAt)}</TableCell>
                          <TableCell className="text-right">{r.syncClicks}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
          </Panel>
          </>
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
                  <span className="text-muted-foreground">{historyFor.yearLabel}</span>
                  {historyFor.status === "Published (before log)" && (
                    <span className="text-xs text-muted-foreground">
                      Marked synced on {formatDate(historyFor.publishedAt)}, before the sync log started.
                    </span>
                  )}
                </div>
                {historyLoading ? (
                  <SkeletonRows rows={3} />
                ) : history.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No logged events for this project.</div>
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
                          <TableCell>{h.memberName ?? (h.action === "published" ? "Extension" : "–")}</TableCell>
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

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <section className="row-card row-rise flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-muted text-primary">
        <RefreshCw className="h-8 w-8" aria-hidden />
      </span>
      <h2 className="row-h2 mt-4">{title}</h2>
      <p className="mt-1 max-w-[42ch] text-[15px] text-muted-foreground">{text}</p>
    </section>
  );
}
