"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { ArrowLeft, Plus, Trash2 } from "@/components/icons";
import { deleteRiCode, getRiCodes, saveRiCode, type RiCode, type RiCodeKind } from "@/services/api";

// RI fields for the outbound sync (build spec 3.12): the lists a membership's codes come from. Enter RI's own codes.
const LISTS: { kind: RiCodeKind; title: string; help: string }[] = [
  { kind: "member_type", title: "Member types", help: "RI member types, for example active and honorary." },
  { kind: "join_reason", title: "Join reasons", help: "Why a member joined, as RI codes it." },
  { kind: "termination_reason", title: "Termination reasons", help: "Why a member left, as RI codes it. Picked when a member is removed." },
];

export default function RiCodesPage() {
  const { isSuperAdmin } = useAuth();
  const [codes, setCodes] = useState<RiCode[] | null>(null);
  const [draft, setDraft] = useState<Record<string, { code: string; label: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCodes(await getRiCodes());
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not load the RI lists.");
      setCodes([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (kind: RiCodeKind) => {
    const d = draft[kind] ?? { code: "", label: "" };
    if (!d.code.trim() || !d.label.trim()) return;
    setBusy(true);
    try {
      const max = Math.max(0, ...(codes ?? []).filter((c) => c.kind === kind).map((c) => c.sortOrder));
      await saveRiCode({ kind, code: d.code.trim(), label: d.label.trim(), sortOrder: max + 1 });
      setDraft((x) => ({ ...x, [kind]: { code: "", label: "" } }));
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not add the code.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: RiCode) => {
    setBusy(true);
    try {
      await deleteRiCode(c.id);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not remove the code.");
    } finally {
      setBusy(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="py-20 text-center">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="mt-2 text-muted-foreground">Only Super Admin can manage the RI lists.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Back to settings">
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">RI codes</h2>
            <p className="text-base text-muted-foreground">
              Member types and join / termination reasons for the Rotary.org sync. RI officer titles are set on each designation.
            </p>
          </div>
        </div>

        {codes === null ? <TableSkeleton rows={6} /> : LISTS.map(({ kind, title, help }) => {
          const rows = codes.filter((c) => c.kind === kind);
          const d = draft[kind] ?? { code: "", label: "" };
          return (
            <Card key={kind}>
              <CardHeader>
                <CardTitle className="text-lg">{title}</CardTitle>
                <p className="text-sm text-muted-foreground">{help}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {rows.length === 0 && <p className="text-sm text-muted-foreground">No codes yet.</p>}
                <ul className="divide-y rounded-md border">
                  {rows.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span><span className="font-mono">{c.code}</span> <span className="text-muted-foreground">{c.label}</span></span>
                      <Button variant="ghost" size="icon" disabled={busy} onClick={() => remove(c)} aria-label={`Remove ${c.code}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="space-y-1 sm:w-40">
                    <Label htmlFor={`${kind}-code`}>Code</Label>
                    <Input id={`${kind}-code`} maxLength={40} value={d.code}
                      onChange={(e) => setDraft((x) => ({ ...x, [kind]: { ...d, code: e.target.value } }))} />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`${kind}-label`}>Label</Label>
                    <Input id={`${kind}-label`} maxLength={150} value={d.label}
                      onChange={(e) => setDraft((x) => ({ ...x, [kind]: { ...d, label: e.target.value } }))} />
                  </div>
                  <Button onClick={() => add(kind)} disabled={busy || !d.code.trim() || !d.label.trim()}>
                    <Plus className="mr-2 h-4 w-4" /> Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}
