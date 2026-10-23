"use client";

/**
 * Privacy requests for a district (master plan WS7-02, WS7-03): export a
 * member's data, or erase it. Erasure asked for by a District Admin waits for a
 * second District Admin's approval; the server enforces who may approve.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, Plus, RefreshCw, Search, ShieldAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import AlertModal from "@/components/AlertModal";
import { useFormat } from "@/hooks/useFormat";
import { getErrorMessage } from "@/lib/errors";
import {
  approvePrivacyRequest,
  getPrivacyRequests,
  rejectPrivacyRequest,
  requestMemberErasure,
  requestMemberExport,
  searchDistrictCommitteeMembers,
} from "@/services/api";
import type { PrivacyRequest, PrivacyRequestKind, PrivacyRequestStatus } from "@/types/privacy";

interface MemberHit {
  memberId: number;
  name: string;
  clubName?: string;
  mobile?: string;
}

const STATUS_STYLE: Record<PrivacyRequestStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  awaiting_approval: "bg-amber-100 text-amber-800",
  processing: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  rejected: "bg-slate-200 text-slate-600",
  failed: "bg-red-100 text-red-700",
};

function NewRequestDialog({
  open,
  onOpenChange,
  districtId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  districtId: number;
  onCreated: (r: PrivacyRequest) => void;
}) {
  const t = useTranslations("privacy.create");
  const tKind = useTranslations("privacy.requests.kind");
  const tRoot = useTranslations();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState<MemberHit | null>(null);
  const [kind, setKind] = useState<PrivacyRequestKind>("export");
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits(null);
    setMember(null);
    setKind("export");
    setReason("");
    setUnderstood(false);
    setError(null);
  }, [open]);

  const search = (value: string) => {
    setQuery(value);
    setMember(null);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setHits(null);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        setHits(await searchDistrictCommitteeMembers(districtId, value.trim()));
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    if (kind === "erase" && !reason.trim()) {
      setError(t("reasonRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created =
        kind === "export" ? await requestMemberExport(member.memberId) : await requestMemberErasure(member.memberId, reason.trim());
      onCreated(created);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err, tRoot));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!member && !submitting && (kind === "export" || (reason.trim() !== "" && understood));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription className="sr-only">{t("title")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="pr-search">{t("searchLabel")}</Label>
            {member ? (
              <div className="flex items-center justify-between rounded-md border bg-slate-50 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-900">{member.name}</span>
                  {member.clubName && <span className="text-slate-500"> · {member.clubName}</span>}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMember(null)}>
                  {t("cancel")}
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input id="pr-search" className="pl-9" value={query} placeholder={t("searchPlaceholder")} onChange={(e) => search(e.target.value)} />
                </div>
                {searching && <p className="text-xs text-slate-500">{t("searching")}</p>}
                {hits && !searching && (
                  <ul className="max-h-56 overflow-y-auto rounded-md border bg-white">
                    {hits.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{t("noResults")}</li>}
                    {hits.map((h) => (
                      <li key={h.memberId}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                          onClick={() => setMember(h)}
                        >
                          <span className="font-medium text-slate-900">{h.name}</span>
                          {h.clubName && <span className="block text-xs text-slate-500">{h.clubName}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("kindLabel")}</legend>
            {(["export", "erase"] as const).map((k) => (
              <label key={k} className="flex cursor-pointer gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="radio" name="pr-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">{tKind(k)}</span>
                  <span className="block text-xs text-slate-600">{k === "export" ? t("exportHelp") : t("eraseHelp")}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {kind === "erase" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pr-reason">{t("reason")}</Label>
                <Textarea id="pr-reason" rows={3} maxLength={500} value={reason} placeholder={t("reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} />
                {t("eraseConfirm")}
              </label>
            </>
          )}

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit} variant={kind === "erase" ? "destructive" : "default"} className="gap-1.5">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PrivacyRequestsPanel({ districtId }: { districtId: number | null }) {
  const t = useTranslations("privacy.requests");
  const tCreate = useTranslations("privacy.create");
  const tRoot = useTranslations();
  const fmt = useFormat();
  const [rows, setRows] = useState<PrivacyRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<PrivacyRequest | null>(null);

  const load = useCallback(async () => {
    if (!districtId) return;
    setRows(null);
    setError(null);
    try {
      setRows(await getPrivacyRequests(districtId));
    } catch (e) {
      setRows([]);
      setError(getErrorMessage(e, tRoot));
    }
  }, [districtId, tRoot]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (row: PrivacyRequest, call: (id: number) => Promise<PrivacyRequest>) => {
    setBusyId(row.id);
    setError(null);
    try {
      const updated = await call(row.id);
      setRows((list) => (list ?? []).map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      setError(getErrorMessage(e, tRoot));
    } finally {
      setBusyId(null);
    }
  };

  if (!districtId) return <div className="p-6 text-sm text-slate-500">{t("selectDistrict")}</div>;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-900">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("intro")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            {t("refresh")}
          </Button>
          <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t("new")}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

      {rows === null ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      ) : rows.length === 0 ? (
        !error && <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-600">{t("empty")}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.member")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.requested")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-medium text-slate-900">{r.memberName}</span>
                    {r.clubName && <span className="block text-xs text-slate-500">{r.clubName}</span>}
                  </TableCell>
                  <TableCell>
                    {t(`kind.${r.kind}`)}
                    {r.reason && <span className="block max-w-[16rem] truncate text-xs text-slate-500" title={r.reason}>{r.reason}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`border-transparent ${STATUS_STYLE[r.status]}`}>{t(`status.${r.status}`)}</Badge>
                    {r.approvedBy && <span className="block text-xs text-slate-500">{t("approvedBy", { name: r.approvedBy })}</span>}
                  </TableCell>
                  <TableCell>
                    {fmt.dateTime(r.requestedAt)}
                    <span className="block text-xs text-slate-500">{t("requestedBy", { name: r.requestedBy })}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {r.kind === "export" && r.status === "completed" && r.downloadUrl && (
                        <Button asChild size="sm" variant="outline" className="gap-1.5">
                          <a href={r.downloadUrl} title={r.downloadExpiresAt ? t("downloadUntil", { date: fmt.date(r.downloadExpiresAt) }) : undefined}>
                            <Download className="h-3.5 w-3.5" />
                            {t("download")}
                          </a>
                        </Button>
                      )}
                      {r.status === "awaiting_approval" && (
                        <>
                          <Button size="sm" variant="destructive" disabled={busyId === r.id} onClick={() => setConfirming(r)}>
                            {t("approve")}
                          </Button>
                          <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r, rejectPrivacyRequest)}>
                            {t("reject")}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NewRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        districtId={districtId}
        onCreated={(r) => {
          setRows((list) => [r, ...(list ?? [])]);
          setNotice(tCreate("created"));
        }}
      />

      <AlertModal
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        icon={ShieldAlert}
        iconClassName="text-red-600"
        title={t("approve")}
        description={confirming ? t("approveConfirm", { name: confirming.memberName }) : ""}
        confirmLabel={t("approve")}
        confirmClassName="bg-red-600 hover:bg-red-700"
        cancelLabel={tCreate("cancel")}
        onConfirm={() => {
          if (confirming) act(confirming, approvePrivacyRequest);
          setConfirming(null);
        }}
      />
    </div>
  );
}
