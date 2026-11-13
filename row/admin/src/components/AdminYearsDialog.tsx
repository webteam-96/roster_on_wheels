"use client";

/**
 * Year picker for "Make Admin" — Year-wise Admin Rights.
 *
 * Admin rights are per Rotary year. This dialog stands between the Make Admin
 * click and the assign call, so whoever promotes someone has to say WHICH years
 * they are handing over.
 *
 * Serves clubs and districts from one component: both endpoints return the same
 * shape on purpose, so only the URL differs.
 *
 * ⚠️ Nothing here is a security control. The server clamps the years to what the
 * caller actually holds and refuses the rest. Greying a checkbox is a courtesy
 * so people do not pick something that will be rejected — it is not the reason
 * they cannot pick it.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getAdminYearOptions } from "@/services/api";
import type { AdminYearOptions } from "@/types/auth";
import { Loader2, Lock, ShieldCheck } from "@/components/icons";

export type AdminYearsScope =
  | { kind: "club"; clubId: number }
  | { kind: "district"; districtId: number };

interface Props {
  open: boolean;
  scope: AdminYearsScope;
  memberId: number;
  memberName: string;
  /** Where the rights are being granted, e.g. a club or district name. */
  scopeName?: string;
  /** Verb for the confirm button — "Make Admin" when promoting, "Save" when editing. */
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (picked: { yearIds: number[]; allYears: boolean }) => Promise<void> | void;
}

export default function AdminYearsDialog({
  open, scope, memberId, memberName, scopeName,
  confirmLabel = "Make Admin", onCancel, onConfirm,
}: Props) {
  const [options, setOptions] = useState<AdminYearOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allYears, setAllYears] = useState(false);

  const scopeKey = scope.kind === "club" ? scope.clubId : scope.districtId;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOptions(null);

    getAdminYearOptions(scope, memberId)
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setAllYears(data.heldAllYears);

        // Pre-tick what they already hold. For someone who holds nothing yet,
        // fall back to the current year — that is the common case and the same
        // default the server applies when no years are sent.
        const held = new Set(data.heldYearIds);
        if (held.size === 0 && !data.heldAllYears) {
          const current = data.years.find((y) => y.isCurrent);
          if (current) held.add(current.id);
        }
        setSelected(held);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } | string } };
        const msg = typeof err?.response?.data === "string"
          ? err.response.data
          : err?.response?.data?.message;
        setError(msg || "Could not load the Rotary years.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [open, scope.kind, scopeKey, memberId]);

  const canGrant = useCallback(
    (yearId: number) =>
      !!options && (options.grantableYearIds === null || options.grantableYearIds.includes(yearId)),
    [options],
  );

  const toggle = (yearId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(yearId)) next.delete(yearId); else next.add(yearId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!allYears && selected.size === 0) {
      setError("Pick at least one Rotary year, or the new admin will not be able to open anything.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm({ yearIds: allYears ? [] : [...selected], allYears });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } | string } };
      const msg = typeof err?.response?.data === "string"
        ? err.response.data
        : err?.response?.data?.message;
      setError(msg || "Could not save the Rotary years.");
    } finally {
      setSaving(false);
    }
  };

  const scopeWord = scope.kind === "club" ? "club" : "district";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Admin years for {memberName}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Choose which Rotary years {memberName} may manage
          {scopeName ? <> in <span className="font-medium">{scopeName}</span></> : <> in this {scopeWord}</>}.
          They will only be able to add, edit or delete data belonging to those years.
        </p>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Rotary years…
          </div>
        )}

        {!loading && options && (
          <>
            {/* Rights that come from an office held, not from a grant. They cannot
                be unticked here, taking them away means changing the board. */}
            {options.heldSources.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Already an admin through {options.heldSources.join(", ")}. Those years
                  stay even if you untick them here, change the Board of Directors to
                  alter that.
                </span>
              </div>
            )}

            {options.canGrantAllYears && (
              <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
                <Checkbox
                  checked={allYears}
                  onCheckedChange={(v) => setAllYears(v === true)}
                  disabled={saving}
                />
                <span className="font-medium">All years</span>
                <span className="text-muted-foreground">(past, present and future)</span>
              </label>
            )}

            <ScrollArea className="max-h-64 pr-3">
              <div className="space-y-1">
                {options.years.map((y) => {
                  const grantable = canGrant(y.id);
                  const disabled = allYears || saving || !grantable;
                  return (
                    <label
                      key={y.id}
                      className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm ${
                        disabled ? "opacity-50" : "hover:bg-muted cursor-pointer"
                      }`}
                      title={!grantable ? "You do not hold this year yourself, so you cannot grant it." : undefined}
                    >
                      <Checkbox
                        checked={allYears || selected.has(y.id)}
                        onCheckedChange={() => toggle(y.id)}
                        disabled={disabled}
                      />
                      <span className={y.isCurrent ? "font-medium" : ""}>{y.label}</span>
                      {y.isCurrent && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                          Current
                        </span>
                      )}
                      {!grantable && <Lock className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
                    </label>
                  );
                })}
              </div>
            </ScrollArea>

            {options.grantableYearIds !== null && (
              <p className="text-xs text-muted-foreground">
                You can only grant years you hold yourself.
              </p>
            )}
          </>
        )}

        {error && (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={saving || loading || !options}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
