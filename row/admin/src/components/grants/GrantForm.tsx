"use client";

/**
 * The club's grant application form (plain form: the form builder waits on decision C8). The server re-checks
 * everything on save and again on submit (cycle rules, budget, qualified members).
 */
// shortcut: a plain form, move it to the shared form builder once decision C8 settles which builder that is.

import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Section } from "@/components/grants/GrantParts";
import { useFormat } from "@/hooks/useFormat";
import { getClubMembersForAttendance } from "@/services/api";
import { budgetTotals, dayInput, orNull } from "@/lib/grants";
import type { ClubMemberSimple } from "@/types/attendance";
import type { GrantApplication, GrantLine, SaveGrantApplication } from "@/types/grants";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function toSaveBody(app: GrantApplication): SaveGrantApplication {
  return {
    cycleId: app.cycleId,
    title: app.title,
    description: app.description,
    location: app.location,
    startDate: dayInput(app.startDate) || null,
    endDate: dayInput(app.endDate) || null,
    beneficiaries: app.beneficiaries,
    amountRequested: app.amountRequested,
    rulesAccepted: app.rulesAccepted,
    lines: app.lines,
    members: app.members.map(({ memberId, memberName, note }) => ({ memberId, memberName, note })),
  };
}

export default function GrantForm({ app, clubId, busy, onChange, onSave }: {
  app: GrantApplication;
  clubId: number;
  busy: boolean;
  /** Called with the form as it stands, so a submit can save it first. */
  onChange: (body: SaveGrantApplication) => void;
  onSave: (body: SaveGrantApplication) => void;
}) {
  const fmt = useFormat();
  const [form, setForm] = useState<SaveGrantApplication>(() => toSaveBody(app));
  const [roster, setRoster] = useState<ClubMemberSimple[] | null>(null);
  const [pick, setPick] = useState("");

  useEffect(() => {
    getClubMembersForAttendance(clubId).then(setRoster).catch(() => setRoster([]));
  }, [clubId]);
  useEffect(() => onChange(form), [form, onChange]);

  const set = <K extends keyof SaveGrantApplication>(k: K, v: SaveGrantApplication[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<GrantLine>) => set("lines", form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = (kind: GrantLine["kind"]) => set("lines", [...form.lines, { kind, description: "", detail: null, amount: kind === "partner" ? null : 0 }]);
  const totals = budgetTotals(form.lines);
  const cycle = app.cycle;

  const lineGroup = (kind: GrantLine["kind"], title: string, hint: string) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => addLine(kind)}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {form.lines.map((l, i) => l.kind !== kind ? null : (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto]">
          <Input aria-label={`${title} description`} maxLength={300} value={l.description} placeholder={kind === "partner" ? "Organisation" : "Description"}
            onChange={(e) => setLine(i, { description: e.target.value })} />
          <Input aria-label={`${title} detail`} maxLength={300} value={l.detail ?? ""} placeholder={kind === "partner" ? "Role in the project" : "Note (optional)"}
            onChange={(e) => setLine(i, { detail: orNull(e.target.value) })} />
          <Input aria-label={`${title} amount`} type="number" min={0} step="0.01" value={l.amount ?? ""} placeholder={kind === "partner" ? "Contribution" : "Amount"}
            onChange={(e) => setLine(i, { amount: e.target.value === "" ? null : Number(e.target.value) })} />
          <Button type="button" variant="ghost" aria-label="Remove line" onClick={() => set("lines", form.lines.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );

  const available = (roster ?? []).filter((m) => !form.members.some((x) => x.memberId === m.id));

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Section title="Project">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="g-title">Project title</Label>
            <Input id="g-title" maxLength={200} required value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="g-desc">Project details</Label>
            <Textarea id="g-desc" rows={5} maxLength={8000} value={form.description ?? ""} onChange={(e) => set("description", orNull(e.target.value))}
              placeholder="The need, what the club will do, who benefits, how it lasts." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-loc">Location</Label>
            <Input id="g-loc" maxLength={200} value={form.location ?? ""} onChange={(e) => set("location", orNull(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-ben">Beneficiaries</Label>
            <Input id="g-ben" type="number" min={0} value={form.beneficiaries ?? ""} onChange={(e) => set("beneficiaries", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-start">Starts</Label>
            <Input id="g-start" type="date" value={form.startDate ?? ""} onChange={(e) => set("startDate", orNull(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-end">Ends</Label>
            <Input id="g-end" type="date" value={form.endDate ?? ""} onChange={(e) => set("endDate", orNull(e.target.value))} />
          </div>
        </div>
      </Section>

      <Section title="Budget and partners">
        {lineGroup("expense", "Expenses", "Everything the project will cost.")}
        {lineGroup("income", "Other income", "Club funds, partner money and anything else besides this grant.")}
        {lineGroup("partner", "Partners", "Organisations working with the club; a contribution is optional.")}
        <div className="grid gap-4 border-t pt-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="g-amount">Amount requested from the district</Label>
            <Input id="g-amount" type="number" min={0} step="0.01" value={form.amountRequested}
              onChange={(e) => set("amountRequested", Number(e.target.value) || 0)} />
          </div>
          <p className="self-end text-sm text-muted-foreground">
            Expenses {fmt.money(totals.expense)} minus other income {fmt.money(totals.income)} leaves {fmt.money(totals.gap)} to fund
            {cycle.maxRequest != null ? `. This cycle funds up to ${fmt.money(cycle.maxRequest)}.` : "."}
          </p>
        </div>
      </Section>

      <Section title="Qualified members">
        <p className="text-sm text-muted-foreground">
          Members who meet the district&apos;s qualification (for example a grant management seminar).
          {cycle.minQualifiedMembers > 0 ? ` This cycle needs at least ${cycle.minQualifiedMembers}.` : ""}
        </p>
        {form.members.map((m, i) => (
          <div key={m.memberId} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <p className="self-center text-sm">{m.memberName ?? roster?.find((r) => r.id === m.memberId)?.memberName ?? `Member ${m.memberId}`}</p>
            <Input aria-label="Qualification note" maxLength={200} value={m.note ?? ""} placeholder="Qualification, for example seminar date"
              onChange={(e) => set("members", form.members.map((x, j) => (j === i ? { ...x, note: orNull(e.target.value) } : x)))} />
            <Button type="button" variant="ghost" aria-label="Remove member" onClick={() => set("members", form.members.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {roster === null ? (
          <div className="h-10 w-full max-w-md animate-pulse rounded-md bg-muted" aria-busy="true" />
        ) : (
          <div className="flex max-w-md gap-2">
            <select aria-label="Club member" className={SELECT} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a club member</option>
              {available.map((m) => <option key={m.id} value={m.id}>{m.memberName}</option>)}
            </select>
            <Button type="button" variant="outline" disabled={!pick} onClick={() => {
              const m = roster.find((r) => r.id === Number(pick));
              if (m) set("members", [...form.members, { memberId: m.id, memberName: m.memberName, note: null }]);
              setPick("");
            }}>Add</Button>
          </div>
        )}
      </Section>

      <Section title="Qualification rules">
        {cycle.rules ? <p className="whitespace-pre-line text-sm">{cycle.rules}</p> : <p className="text-sm text-muted-foreground">The district has not written extra rules.</p>}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.rulesAccepted} onCheckedChange={(v) => set("rulesAccepted", v === true)} />
          The club meets these qualification rules.
        </label>
      </Section>

      <Button type="submit" disabled={busy} className="gap-1.5">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save application
      </Button>
    </form>
  );
}
