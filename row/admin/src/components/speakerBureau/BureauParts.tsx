"use client";

/**
 * Shared parts of the district speaker bureau pages (district admin and club admin dashboards): the speaker form,
 * the search filters, the speaker list and a speaker's profile with its ratings.
 */

import type { ReactNode } from "react";
import { Loader2, Plus, Save } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import { modeText, ratingText, tagList } from "@/lib/speakerBureau";
import type { BureauEntry, BureauProfile, BureauSearch, SaveBureauEntry } from "@/types/speakerBureau";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
export const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function EntryForm({ form, onChange, onSubmit, onCancel, busy, editing, submitLabel, extra }: {
  form: SaveBureauEntry; onChange: (f: SaveBureauEntry) => void; onSubmit: () => void; onCancel?: () => void;
  busy: boolean; editing: boolean; submitLabel: string; extra?: ReactNode;
}) {
  const set = (patch: Partial<SaveBureauEntry>) => onChange({ ...form, ...patch });
  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <div className="space-y-1.5">
        <Label htmlFor="sb-name">Name</Label>
        <Input id="sb-name" required maxLength={150} value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sb-city">City or area</Label>
        <Input id="sb-city" maxLength={150} value={form.city ?? ""} onChange={(e) => set({ city: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sb-topics">Topics (separate with commas)</Label>
        <Input id="sb-topics" required maxLength={800} placeholder="Polio, Water and sanitation" value={form.topics}
          onChange={(e) => set({ topics: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sb-languages">Languages (separate with commas)</Label>
        <Input id="sb-languages" maxLength={300} placeholder="English, Sinhala" value={form.languages}
          onChange={(e) => set({ languages: e.target.value })} />
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="sb-bio">Bio</Label>
        <Textarea id="sb-bio" rows={3} maxLength={1500} value={form.bio ?? ""} onChange={(e) => set({ bio: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sb-email">Email (members of the district only)</Label>
        <Input id="sb-email" type="email" maxLength={254} value={form.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sb-phone">Phone (members of the district only)</Label>
        <Input id="sb-phone" type="tel" maxLength={40} value={form.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-6 md:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.availableInPerson} onCheckedChange={(v) => set({ availableInPerson: v === true })} /> Talks in person
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.availableOnline} onCheckedChange={(v) => set({ availableOnline: v === true })} /> Talks online
        </label>
      </div>
      {extra}
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <Button type="submit" disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {submitLabel}
        </Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

export function SearchFilters({ value, onChange, withStatus }: {
  value: BureauSearch; onChange: (s: BureauSearch) => void; withStatus?: boolean;
}) {
  const set = (patch: Partial<BureauSearch>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-1.5">
        <Label htmlFor="sb-f-topic">Topic</Label>
        <Input id="sb-f-topic" value={value.topic ?? ""} onChange={(e) => set({ topic: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sb-f-language">Language</Label>
        <Input id="sb-f-language" value={value.language ?? ""} onChange={(e) => set({ language: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sb-f-mode">How</Label>
        <select id="sb-f-mode" className={SELECT} value={value.mode ?? ""} onChange={(e) => set({ mode: e.target.value as BureauSearch["mode"] })}>
          <option value="">Online or in person</option>
          <option value="online">Online</option>
          <option value="in_person">In person</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sb-f-rating">Rating</Label>
        <select id="sb-f-rating" className={SELECT} value={value.minRating ?? ""}
          onChange={(e) => set({ minRating: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Any rating</option>
          <option value="3">3 or more</option>
          <option value="4">4 or more</option>
          <option value="4.5">4.5 or more</option>
        </select>
      </div>
      {withStatus && (
        <div className="space-y-1.5">
          <Label htmlFor="sb-f-status">Status</Label>
          <select id="sb-f-status" className={SELECT} value={value.status ?? ""}
            onChange={(e) => set({ status: e.target.value as BureauSearch["status"] })}>
            <option value="">All</option>
            <option value="pending">Waiting for approval</option>
            <option value="approved">Listed</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      )}
    </div>
  );
}

export const STATUS_TEXT: Record<BureauEntry["status"], string> = {
  pending: "Waiting for approval", approved: "Listed", rejected: "Rejected",
};

/** The speakers as a table; `actions` renders the buttons of one row. */
export function EntryTable({ list, empty, actions, showStatus }: {
  list: BureauEntry[] | null; empty: string; actions: (e: BureauEntry) => ReactNode; showStatus?: boolean;
}) {
  if (!list) return <div aria-busy="true"><TableSkeleton rows={4} /></div>;
  if (list.length === 0) return <Card><CardContent className="p-5 text-sm text-muted-foreground">{empty}</CardContent></Card>;
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-[13px]">
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3 font-medium">Speaker</th>
              <th className="p-3 font-medium">Topics</th>
              <th className="p-3 font-medium">Languages and area</th>
              <th className="p-3 font-medium">Rating</th>
              {showStatus && <th className="p-3 font-medium">Status</th>}
              <th className="p-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className="border-b last:border-0 align-top">
                <td className="p-3">
                  <div className="flex items-start gap-3">
                    {e.photoPath && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${API}${e.photoPath}`} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                    )}
                    <div>
                      <p className="font-medium">{e.name}</p>
                      <p className="text-muted-foreground">{modeText(e)}</p>
                      {e.proposedByClubName && <p className="text-xs text-muted-foreground">Proposed by {e.proposedByClubName}</p>}
                    </div>
                  </div>
                </td>
                <td className="p-3">{tagList(e.topics).join(", ")}</td>
                <td className="p-3">{[tagList(e.languages).join(", "), e.city].filter(Boolean).join(". ")}</td>
                <td className="p-3 whitespace-nowrap">
                  {ratingText(e)}
                  <p className="text-xs text-muted-foreground">{e.talkCount} {e.talkCount === 1 ? "talk" : "talks"} booked</p>
                </td>
                {showStatus && <td className="p-3">{STATUS_TEXT[e.status]}</td>}
                <td className="p-3 whitespace-nowrap text-right">{actions(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** A speaker's details, contact and ratings. `onHide` (district admins) hides or shows a comment. */
export function ProfilePanel({ profile, onClose, onHide }: {
  profile: BureauProfile | null; onClose: () => void; onHide?: (ratingId: number, hidden: boolean) => void;
}) {
  const fmt = useFormat();
  if (!profile) return <div aria-busy="true"><TableSkeleton rows={2} /></div>;
  const e = profile.entry;
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold">{e.name}</h4>
            <p className="text-sm text-muted-foreground">{ratingText(e)}. {modeText(e)}.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        {e.bio && <p className="whitespace-pre-line text-sm">{e.bio}</p>}
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Topics</dt><dd>{tagList(e.topics).join(", ")}</dd></div>
          <div><dt className="text-muted-foreground">Languages</dt><dd>{tagList(e.languages).join(", ") || "Not given"}</dd></div>
          <div><dt className="text-muted-foreground">City or area</dt><dd>{e.city || "Not given"}</dd></div>
          <div><dt className="text-muted-foreground">Contact</dt><dd>{[e.email, e.phone].filter(Boolean).join(", ") || "Not given"}</dd></div>
        </dl>
        <div>
          <h5 className="mb-2 font-medium">Ratings from clubs</h5>
          {profile.ratings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No club has rated this speaker yet.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {profile.ratings.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                  <div>
                    <p className="font-medium">{r.rating} of 5. {r.clubName ?? "A club"}, {fmt.date(r.talkDate.slice(0, 10))}</p>
                    {r.comment && <p className={r.commentHidden ? "text-muted-foreground line-through" : ""}>{r.comment}</p>}
                    {r.commentHidden && <p className="text-xs text-muted-foreground">Comment hidden from members</p>}
                  </div>
                  {onHide && r.comment && (
                    <Button variant="ghost" size="sm" onClick={() => onHide(r.id, !r.commentHidden)}>
                      {r.commentHidden ? "Show comment" : "Hide comment"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
