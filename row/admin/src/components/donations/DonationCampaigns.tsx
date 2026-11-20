"use client";

/**
 * Donation campaigns of one club or district (api/Controllers/DonationsController.cs): the list with progress, and
 * the create / edit dialog. Used by the club and the district admin dashboards.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Edit, FileText, Loader2, Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import {
  deleteDonationCampaign, donationImageUrl, getDonationCampaigns, saveDonationCampaign, uploadDonationImage,
} from "@/services/api";
import type { DonationCampaign, DonationScope, SaveDonationCampaign } from "@/types/donations";

const EMPTY: SaveDonationCampaign = {
  title: "", description: null, imageUrl: null, goalAmount: 0, tiers: [], allowCustom: true, minAmount: 1,
  startDate: null, endDate: null, isActive: true,
};

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

export function campaignStatus(c: DonationCampaign): string {
  if (c.isOpen) return "Open";
  if (!c.isActive) return "Closed";
  return c.startDate && c.startDate > new Date().toISOString().slice(0, 10) ? "Starts later" : "Ended";
}

export default function DonationCampaigns({ scope, scopeId, basePath }: { scope: DonationScope; scopeId: number; basePath: string }) {
  const fmt = useFormat();
  const [data, setData] = useState<{ currency: string; campaigns: DonationCampaign[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: number; form: SaveDonationCampaign; tiersText: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setData(null);
    getDonationCampaigns(scope, scopeId)
      .then(setData)
      .catch((err) => setError(err?.response?.data?.message || "Could not load the campaigns."));
  }, [scope, scopeId]);
  useEffect(load, [load]);

  const open = (c?: DonationCampaign) => {
    setFormError(null);
    setEditing(c
      ? {
          id: c.id, tiersText: c.tiers.join(", "),
          form: {
            title: c.title, description: c.description, imageUrl: c.imageUrl, goalAmount: c.goalAmount, tiers: c.tiers,
            allowCustom: c.allowCustom, minAmount: c.minAmount, startDate: c.startDate, endDate: c.endDate, isActive: c.isActive,
          },
        }
      : { form: { ...EMPTY }, tiersText: "25, 50, 100" });
  };
  const set = (patch: Partial<SaveDonationCampaign>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const tiers = editing.tiersText.split(",").map((t) => Number(t.trim())).filter((n) => Number.isFinite(n) && n > 0);
    setBusy(true);
    setFormError(null);
    try {
      await saveDonationCampaign(scope, scopeId, { ...editing.form, tiers }, editing.id);
      setEditing(null);
      load();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || "Could not save the campaign.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFormError(null);
    try {
      set({ imageUrl: await uploadDonationImage(scope, scopeId, file) });
    } catch (err: any) {
      setFormError(err?.response?.data?.message || "Could not upload the image.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: DonationCampaign) => {
    if (!window.confirm(`Delete "${c.title}"? Donations already received stay in the records.`)) return;
    try {
      await deleteDonationCampaign(scope, scopeId, c.id);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not delete the campaign.");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Donations</h2>
          <p className="text-base text-muted-foreground">
            Fundraising campaigns with a goal and dates. Each has a public giving page and a QR code. Donors get a
            receipt letter by email.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="gap-1.5">
            <Link href={`${basePath}/receipt-letter`}><FileText className="h-4 w-4" /> Receipt letter</Link>
          </Button>
          <Button className="gap-1.5" onClick={() => open()}><Plus className="h-4 w-4" /> New campaign</Button>
        </div>
      </div>

      {!data ? (
        <div aria-busy="true"><TableSkeleton rows={4} /></div>
      ) : data.campaigns.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No campaigns yet. Start one with New campaign.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                <tr className="border-b text-left">
                  <th className="p-3 font-medium">Campaign</th>
                  <th className="p-3 font-medium">Dates</th>
                  <th className="w-56 p-3 font-medium">Raised</th>
                  <th className="p-3 text-right font-medium">Donors</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="p-3">
                      <Link href={`${basePath}/${c.id}`} className="font-medium text-primary hover:underline">{c.title}</Link>
                    </td>
                    <td className="p-3">{[c.startDate && fmt.date(c.startDate), c.endDate && fmt.date(c.endDate)].filter(Boolean).join(" to ") || "No end date"}</td>
                    <td className="space-y-1 p-3">
                      <span className="block tabular-nums">
                        {fmt.money(c.progress.raised, c.currency)}{c.goalAmount > 0 ? ` of ${fmt.money(c.goalAmount, c.currency)}` : ""}
                      </span>
                      {c.goalAmount > 0 && <ProgressBar percent={c.progress.percent} />}
                    </td>
                    <td className="p-3 text-right tabular-nums">{fmt.number(c.progress.donors)}</td>
                    <td className="p-3">{campaignStatus(c)}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" aria-label={`Edit ${c.title}`} onClick={() => open(c)}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" aria-label={`Delete ${c.title}`} onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit campaign" : "New campaign"}</DialogTitle></DialogHeader>
          {editing && (
            <form className="space-y-4" onSubmit={save}>
              <div className="space-y-1.5">
                <Label htmlFor="dc-title">Title</Label>
                <Input id="dc-title" required maxLength={200} value={editing.form.title} onChange={(e) => set({ title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dc-desc">Description</Label>
                <Textarea id="dc-desc" rows={4} maxLength={5000} value={editing.form.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dc-image">Image</Label>
                {editing.form.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={donationImageUrl(editing.form.imageUrl)!} alt="" className="h-28 w-auto rounded-sm border object-cover" />
                )}
                <div className="flex items-center gap-2">
                  <Input id="dc-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} />
                  {editing.form.imageUrl && <Button type="button" variant="outline" size="sm" onClick={() => set({ imageUrl: null })}>Remove</Button>}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dc-goal">Goal ({data?.currency})</Label>
                  <Input id="dc-goal" type="number" min={0} step="0.01" value={editing.form.goalAmount} onChange={(e) => set({ goalAmount: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dc-tiers">Suggested amounts</Label>
                  <Input id="dc-tiers" placeholder="25, 50, 100" value={editing.tiersText}
                    onChange={(e) => setEditing({ ...editing, tiersText: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dc-start">Start date</Label>
                  <Input id="dc-start" type="date" value={editing.form.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dc-end">End date</Label>
                  <Input id="dc-end" type="date" value={editing.form.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={editing.form.allowCustom} onCheckedChange={(v) => set({ allowCustom: v === true })} />
                Donors may type their own amount
              </label>
              {editing.form.allowCustom && (
                <div className="space-y-1.5 sm:w-1/2">
                  <Label htmlFor="dc-min">Smallest amount ({data?.currency})</Label>
                  <Input id="dc-min" type="number" min={0.01} step="0.01" value={editing.form.minAmount} onChange={(e) => set({ minAmount: Number(e.target.value) })} />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={editing.form.isActive} onCheckedChange={(v) => set({ isActive: v === true })} />
                Taking donations (between the dates)
              </label>
              {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="submit" disabled={busy} className="gap-1.5">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
