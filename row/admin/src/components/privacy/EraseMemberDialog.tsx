"use client";

/**
 * GDPR erasure with a preview and a typed confirmation. Loads what the erasure
 * would change (nothing is written), then asks for a reason and the person's
 * name typed out. The server checks the name again and decides who may erase.
 */

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/errors";
import { getErasePreview, requestMemberErasure } from "@/services/api";
import type { ErasePreview, PrivacyRequest } from "@/types/privacy";

/** Same rule as the server: case and extra spaces do not matter. */
export function confirmMatches(expected: string, typed: string): boolean {
  const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
  return typed.trim() !== "" && norm(typed) === norm(expected);
}

export default function EraseMemberDialog({
  memberId,
  onOpenChange,
  onDone,
}: {
  /** The person to erase; null closes the dialog. */
  memberId: number | null;
  onOpenChange: (open: boolean) => void;
  onDone: (r: PrivacyRequest) => void;
}) {
  const t = useTranslations("privacy.erase");
  const tRoot = useTranslations();
  const [preview, setPreview] = useState<ErasePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setLoadError(null);
    setReason("");
    setTyped("");
    setError(null);
    if (memberId == null) return;
    let live = true;
    getErasePreview(memberId)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setLoadError(getErrorMessage(e, tRoot)));
    return () => {
      live = false;
    };
  }, [memberId, tRoot]);

  const canSubmit =
    !!preview && !preview.alreadyErased && !submitting && reason.trim() !== "" && confirmMatches(preview.confirmText, typed);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await requestMemberErasure(preview.memberId, reason.trim(), typed);
      if (r.status === "failed") {
        setError(t("failed"));
        return;
      }
      onDone(r);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err, tRoot));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={memberId != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{preview ? t("intro", { name: preview.memberName || preview.confirmText }) : t("loading")}</DialogDescription>
          </DialogHeader>

          {loadError ? (
            <p className="text-sm text-red-600" role="alert">{loadError}</p>
          ) : !preview ? (
            <div className="space-y-2" aria-busy="true" aria-label={t("loading")}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-7 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : preview.alreadyErased ? (
            <p className="rounded-md border bg-slate-50 p-3 text-sm text-slate-700">{t("alreadyErased")}</p>
          ) : (
            <>
              {preview.needsApproval && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("needsApproval")}</p>}
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-slate-900">{t("changesTitle")}</h3>
                {preview.changes.length === 0 ? (
                  <p className="text-sm text-slate-600">{t("noChanges")}</p>
                ) : (
                  <Card className="max-h-56 overflow-y-auto">
                    <Table className="w-full text-sm">
                      <TableHeader className="text-left">
                        <TableRow>
                          <TableHead className="px-3">{t("columns.table")}</TableHead>
                          <TableHead className="px-3">{t("columns.action")}</TableHead>
                          <TableHead className="px-3 text-right">{t("columns.rows")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.changes.map((c) => (
                          <TableRow key={`${c.table}-${c.action}`} className="border-t">
                            <TableCell className="px-3 py-1.5 font-mono text-xs text-slate-700">{c.table}</TableCell>
                            <TableCell className={`px-3 py-1.5 ${c.action === "keep" ? "text-slate-500" : "text-slate-900"}`}>{t(`action.${c.action}`)}</TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">{c.rows}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                )}
                <p className="text-sm text-slate-700">{preview.files > 0 ? t("files", { count: preview.files }) : t("noFiles")}</p>
              </section>

              <div className="space-y-1.5">
                <Label htmlFor="erase-reason">{t("reason")}</Label>
                <Textarea id="erase-reason" rows={2} maxLength={500} value={reason} placeholder={t("reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="erase-confirm">{t("typeToConfirm", { name: preview.confirmText })}</Label>
                <Input id="erase-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={!canSubmit}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
