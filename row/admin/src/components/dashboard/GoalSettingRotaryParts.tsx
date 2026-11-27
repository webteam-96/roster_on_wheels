"use client";

import { Table } from "@/components/ui/table";
import { LinkButton, ToggleButton } from "@/components/ui/text-buttons";
import { IconButton } from "@/components/ui/icon-button";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Info, Plus, Trash2, ExternalLink, Globe, Link2 } from "@/components/icons";
import { getClubWebsiteStatus, getClubSocialLinks } from "@/services/api";
import type { ClubSocialLink } from "@/types/socialLink";
import type { GoalFieldWithValueDto } from "@/types/goalSetting";
import { RAG_BANDS, plainLabel, dayLabel } from "@/lib/goalRotaryLayout";
import { appLocale } from "@/lib/appFormat";
import { FieldBuffer, isFieldEditable, ragFill, PlainLabelsContext } from "./goalSettingRotaryLogic";


// New design (user 2026-10-29): each group is a card; its boxes sit side by side in a grid. The
// "(Rotary.org)" goals have only two boxes, so their cards share a row.
export const TILE_GRID = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]";
// "Updated from Rotary.org on 28 Oct 2026, 07:20 pm" under a Rotary.org goal (user 2026-10-29).
export function RotaryOrgNote({ at }: { at?: string | null }) {
  if (!at) return null;
  const when = dayLabel(at);
  if (!when) return null;
  return <span className="text-go-meta font-semibold text-go-text-secondary">Updated from Rotary.org on {when}</span>;
}

// The 5 RAG bands as one coloured bar above their boxes.
export function RagBar({ fields }: { fields: GoalFieldWithValueDto[] }) {
  const parts = RAG_BANDS.map((b) => ({ ...b, n: Number(fields.find((f) => f.fieldKey === b.key)?.numericValue ?? 0) }));
  if (parts.every((p) => p.n === 0)) return null;
  return (
    <div className="flex h-3.5 rounded-full overflow-hidden mb-3.5" role="img"
      aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
      {parts.map((p) => <div key={p.key} style={{ flex: `${p.n} 1 0`, background: p.color }} />)}
    </div>
  );
}

// Club Foundation (MCR) table: each of the 5 contribution metrics on its own row, with the SHARED
// Annual Fund Goal Amount (Target) and Goal % Achieved shown on every row. The Goal Amount / %
// inputs across the rows all bind to the SAME field id, so they hold one value and edit together.
export function ClubFoundationTable({
  fields, buffers, onText, editable,
}: {
  fields: GoalFieldWithValueDto[];
  buffers: Record<number, FieldBuffer>;
  onText: (fieldId: number, v: string) => void;
  editable: boolean;
}) {
  const plainLabels = useContext(PlainLabelsContext);
  const byKey = (k: string) => fields.find((f) => f.fieldKey === k);
  const goalAmount = byKey("club_af_goal_amount");
  const pct = byKey("club_goal_pct_achieved");
  const metrics = ["club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd", "club_other_funds_ytd", "club_endowment_ytd", "club_total_ytd"]
    .map(byKey).filter(Boolean) as GoalFieldWithValueDto[];
  if (!goalAmount || !pct) return null;

  const goalEditable = editable && isFieldEditable(goalAmount);
  const pctEditable = editable && isFieldEditable(pct);

  const numCell = (value: string, disabled: boolean, prefix: string | null, suffix: string | null, onChange?: (v: string) => void) => (
    <div className="relative">
      {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-go-text-muted text-go-body">{prefix}</span>}
      <input
        type="text" inputMode="decimal" value={value} disabled={disabled}
        onChange={(e) => {
          if (!onChange) return;
          const raw = e.target.value.replace(/[^\d.]/g, "");
          const parts = raw.split(".");
          onChange(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw);
        }}
        className={`w-full ${prefix ? "pl-6" : "pl-2.5"} ${suffix ? "pr-7" : "pr-2.5"} py-1.5 text-go-body border border-go-border rounded-go-md focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1 disabled:bg-go-sunken disabled:text-go-text-secondary`}
        placeholder={disabled ? "–" : "0"}
      />
      {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-go-text-muted text-go-body">{suffix}</span>}
    </div>
  );

  const goalVal = buffers[goalAmount.fieldId]?.text ?? "";
  const pctVal = buffers[pct.fieldId]?.text ?? "";

  return (
    <div className="overflow-x-auto">
      <h4 className="row-h3 text-go-meta text-go-text-secondary mb-2">Annual Fund &amp; Contributions</h4>
      <Table bare className="w-full min-w-[560px] border-separate border-spacing-y-2">
        <thead>
          <tr>
            <th className="text-left px-2 w-1/3">Annual Fund Goal Amount <span className="normal-case text-go-text-muted">(Target)</span></th>
            <th className="text-left px-2 w-1/3">Contribution</th>
            <th className="text-left px-2 w-1/3">Goal % Achieved</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const mPrefix = m.dataType === "Currency" ? (m.unit || "$") : null;
            const mSuffix = m.dataType === "Percentage" ? "%" : null;
            return (
              <tr key={m.fieldId} className="align-top">
                <td className="px-2">{numCell(goalVal, !goalEditable, "$", null, (v) => onText(goalAmount.fieldId, v))}</td>
                <td className="px-2">
                  <div className="text-go-meta font-medium text-go-text-secondary mb-1">{plainLabels ? plainLabel(m.fieldLabel) : m.fieldLabel}</div>
                  {numCell(buffers[m.fieldId]?.text ?? "", true, mPrefix, mSuffix)}
                </td>
                <td className="px-2">{numCell(pctVal, !pctEditable, null, "%", (v) => onText(pct.fieldId, v))}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

// Summary "how is this calculated?": an (i) icon that toggles a plain-language breakdown of the
// Summary formulas, using the current field values so the numbers are concrete.
export function SummaryInfo({ fields }: { fields: GoalFieldWithValueDto[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // Close when clicking anywhere outside the icon/popover (or pressing Escape).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const val = (k: string) => {
    const f = fields.find((x) => x.fieldKey === k);
    return f?.numericValue != null ? Number(f.numericValue) : 0;
  };
  const clubsBaseline = val("total_clubs");
  const clubsAchieved = val("new_clubs_achieved");
  const membersBaseline = val("total_members");
  const membersAchieved = val("new_members_achieved");
  const womenBaseline = val("existing_women_members");
  const womenAchieved = val("new_women_members_achieved");
  const newClubs = Math.max(0, clubsAchieved - clubsBaseline);
  const netGrowth = Math.max(0, membersAchieved - membersBaseline);
  const newWomen = Math.max(0, womenAchieved - womenBaseline);
  // Only explain the rows this page shows (the club page has no Total New Clubs).
  const has = (k: string) => fields.some((x) => x.fieldKey === k);
  return (
    <span ref={ref} className="relative inline-flex">
      <IconButton aria-label="How is this calculated?"
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="How is this calculated?"
>
        <Info size={15} />
      </IconButton>
      {open && (
        <div className="absolute left-5 top-0 z-20 w-72 rounded-go-md border border-go-border bg-go-surface p-3 text-go-meta text-go-text-secondary shadow-lg">
          <div className="font-semibold text-go-text-primary mb-1.5">How the Summary is calculated</div>
          <div className="space-y-1.5">
            {has("total_new_clubs") && (
            <div><span className="font-medium">Total New Clubs</span> = Clubs Achieved − Clubs as on July 1st<br />
              <span className="text-go-text-muted">= {clubsAchieved} − {clubsBaseline} = {newClubs}</span></div>
            )}
            {has("total_membership_net_growth") && (
            <div><span className="font-medium">Total Membership Net Growth</span> = Members Achieved − Members as on July 1st<br />
              <span className="text-go-text-muted">= {membersAchieved} − {membersBaseline} = {netGrowth}</span></div>
            )}
            {has("new_club_members_computed") && (
            <div><span className="font-medium">Total New women members</span> = Women Achieved − Women as on July 1st<br />
              <span className="text-go-text-muted">= {womenAchieved} − {womenBaseline} = {newWomen}</span></div>
            )}
          </div>
          <div className="mt-2 text-go-meta text-go-text-muted">Actual added from July 1st to date (Achieved − July 1st count).</div>
        </div>
      )}
    </span>
  );
}

// Public Image "Suggestions": a dynamic Add/Delete list backed by the 10 pi_suggestion_* slots.
// Shows one textarea per used slot (min 1 when editable), an Add button up to 10, and a Delete
// per row that clears it and compacts the rest up. Read-only view lists the filled ones only.
export function SuggestionsList({
  fields, buffers, onText, onManyText, editable, markEmpty = false,
}: {
  fields: GoalFieldWithValueDto[];
  buffers: Record<number, FieldBuffer>;
  onText: (fieldId: number, v: string) => void;
  onManyText: (updates: Record<number, string>) => void;
  editable: boolean;
  markEmpty?: boolean;
}) {
  // fields arrive in SortOrder (slot 1..10). Value per slot from the buffer.
  const slots = fields;
  const valueAt = (i: number) => buffers[slots[i].fieldId]?.text ?? "";
  // Show every box up to the LAST filled one (not just "how many are filled"), so a suggestion saved
  // after a blank box is never hidden on reload.
  const filledCount = slots.reduce((n, s, i) => ((buffers[s.fieldId]?.text ?? "").trim() !== "" ? i + 1 : n), 0);

  const [visible, setVisible] = useState(Math.max(1, filledCount));
  useEffect(() => {
    // Never show fewer rows than are actually filled; never exceed the slot count.
    setVisible((v) => Math.min(slots.length, Math.max(v, filledCount, 1)));
  }, [filledCount, slots.length]);

  // Read-only: just list the non-empty suggestions.
  if (!editable) {
    const filled = slots.map((s, i) => ({ s, v: valueAt(i) })).filter((x) => x.v.trim() !== "");
    if (filled.length === 0) return <div className={`my-2 py-2 px-2.5 text-go-body text-go-text-muted rounded-go-sm ${markEmpty ? "border-2 border-go-danger-600" : ""}`}>–</div>;
    return (
      <ol className="list-decimal pl-5 py-2 space-y-1.5">
        {filled.map(({ s, v }) => <li key={s.fieldId} className="text-go-body text-go-text-primary leading-snug">{v}</li>)}
      </ol>
    );
  }

  const shownCount = Math.min(slots.length, Math.max(visible, filledCount, 1));

  function handleDelete(idx: number) {
    // Shift every value after idx up one slot; clear the last.
    const updates: Record<number, string> = {};
    for (let i = idx; i < slots.length; i++) {
      updates[slots[i].fieldId] = i + 1 < slots.length ? (buffers[slots[i + 1].fieldId]?.text ?? "") : "";
    }
    onManyText(updates);
    setVisible((v) => Math.max(1, v - 1));
  }

  return (
    <div className="py-2 space-y-2">
      {Array.from({ length: shownCount }).map((_, i) => (
        <div key={slots[i].fieldId} className="flex items-start gap-2">
          <span className="text-go-meta text-go-text-muted pt-2 w-5 shrink-0">{i + 1}.</span>
          <textarea
            rows={2}
            value={valueAt(i)}
            onChange={(e) => onText(slots[i].fieldId, e.target.value)}
            placeholder="Enter a Public Image activity suggestion..."
            className={`flex-1 px-2.5 py-1.5 text-go-body rounded-go-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1 resize-y ${
              markEmpty && valueAt(i).trim() === "" ? "border-2 border-go-danger-600" : "border border-go-border-strong"}`}
          />
          <IconButton
            type="button"
            onClick={() => handleDelete(i)}
            title="Remove this suggestion"
            className="mt-1"
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      ))}
      {shownCount < slots.length && (() => {
        // A new box can be added only once the last one is filled: no blank gaps between suggestions.
        const lastEmpty = valueAt(shownCount - 1).trim() === "";
        return (
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <LinkButton size="sm"
              type="button"
              onClick={() => setVisible((v) => Math.min(slots.length, v + 1))}
              disabled={lastEmpty}
>
              <Plus size={14} /> Add suggestion
            </LinkButton>
            {lastEmpty && <span className="text-go-meta text-go-text-muted">Fill suggestion {shownCount} before adding another.</span>}
          </div>
        );
      })()}
      <div className="text-go-meta text-go-text-muted">Up to {slots.length} suggestions.</div>
    </div>
  );
}

// Public Image "Other Points": when Club Website / Club Social Media is set to YES, list the club's
// actual saved website URL / social-media links (clickable, read-only) from the club-website tables –
// one source of truth. Listing only for now (no add/edit here).
export function ClubPublicImageLinks({ clubId, kind }: { clubId: number; kind: "website" | "social" }) {
  const [loading, setLoading] = useState(true);
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [links, setLinks] = useState<ClubSocialLink[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = kind === "website"
      ? getClubWebsiteStatus(clubId).then((s) => { if (alive) setWebsiteUrl(s.visitUrl ?? null); })
      : getClubSocialLinks(clubId).then((rows) => { if (alive) setLinks((rows || []).filter((r) => r.isActive && (r.linkUrl || "").trim() !== "")); });
    p.catch(() => { /* leave empty */ }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clubId, kind]);

  const norm = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

  return (
    <div className="mt-1 mb-3 ml-1 pl-3 border-l-2 border-go-border">
      {loading ? (
        <span className="inline-flex items-center gap-1.5 text-go-meta text-go-text-muted"><Loader2 size={12} className="animate-spin" /> Loading…</span>
      ) : kind === "website" ? (
        websiteUrl ? (
          <a href={norm(websiteUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-go-meta font-medium text-go-navy-700 hover:underline break-all">
            <Globe size={13} /> {websiteUrl} <ExternalLink size={11} />
          </a>
        ) : <span className="text-go-meta text-go-text-muted">No club website saved yet.</span>
      ) : (
        links.length > 0 ? (
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <a key={l.id} href={norm(l.linkUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-go-meta font-medium text-go-navy-700 hover:underline break-all">
                <Link2 size={13} /> <span className="font-semibold text-go-text-secondary">{l.platform}:</span> {l.linkUrl} <ExternalLink size={11} />
              </a>
            ))}
          </div>
        ) : <span className="text-go-meta text-go-text-muted">No social media links saved yet.</span>
      )}
    </div>
  );
}

// One box of the new design (user 2026-10-29): label on top, value or input below. The RAG bands
// get their colour as a top edge.
export function FieldRow({ label, accent, children }: { label: string; alignTop?: boolean; accent?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 min-w-0 rounded-go-lg border border-go-border bg-go-sunken p-3.5"
      style={accent ? { borderTop: `5px solid ${accent}` } : undefined}>
      <span className="text-go-label font-semibold text-go-text-secondary leading-snug">{useContext(PlainLabelsContext) ? plainLabel(label) : label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function GoalFieldInput({
  field, buffer, disabled, onText, onBool, warn, asOn, markEmpty = false,
}: {
  field: GoalFieldWithValueDto;
  buffer: FieldBuffer | undefined;
  disabled: boolean;
  onText: (v: string) => void;
  onBool: (v: boolean) => void;
  achieved?: number | null;
  warn?: string;
  asOn?: string;   // "31 Aug 2026": appended to an "Achieved" field's label when month-wise data exists
  markEmpty?: boolean;
}) {
  const buf = buffer ?? { text: "", bool: false };
  // Red border on a District Admin input field left blank or 0 (user 2026-10-16) - locked or not;
  // read-only fields (July 1st, imported Achieved, %) are never marked. YES/NO always has one side
  // chosen, so it is never marked.
  const isEmpty = markEmpty && (buf.text.trim() === "" || Number(buf.text) === 0);
  // Show the month-wise "as on" date in brackets on the Achieved row(s): "Achieved (as on 31 Aug 2026)".
  const isAchievedRow = field.fieldLabel.replace(/^[^A-Za-z]+/, "").trim().toLowerCase() === "achieved" || field.fieldKey.endsWith("_achieved");
  const label = asOn && isAchievedRow ? `${field.fieldLabel} (as on ${asOn})` : field.fieldLabel;

  // Boolean → YES / NO toggle on the right (selected = blue, other = grey).
  if (field.dataType === "Boolean") {
    return (
      <FieldRow label={label}>
        <div className="flex gap-1.5">
          <ToggleButton pressed={buf.bool}
            type="button"
            disabled={disabled}
            onClick={() => onBool(true)}
>{buf.bool && <Check size={14} />}YES</ToggleButton>
          <ToggleButton pressed={!buf.bool}
            type="button"
            disabled={disabled}
            onClick={() => onBool(false)}
>{!buf.bool && <Check size={14} />}NO</ToggleButton>
        </div>
      </FieldRow>
    );
  }

  // Text → textarea on the right.
  if (field.dataType === "Text") {
    return (
      <FieldRow label={label} alignTop>
        <textarea
          rows={2}
          value={buf.text}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          placeholder={disabled ? "" : "Enter text..."}
          className={`w-full px-3 py-2 text-go-body rounded-go-md bg-go-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1 disabled:bg-go-sunken disabled:text-go-text-secondary resize-y ${
            markEmpty && buf.text.trim() === "" ? "border-2 border-go-danger-600" : "border border-go-border-strong"}`}
        />
      </FieldRow>
    );
  }

  // Integer / Decimal / Percentage / Currency: a right-aligned box; grey when read-only.
  const isCurrency = field.dataType === "Currency";
  const isPercentage = field.dataType === "Percentage";
  const rag = RAG_BANDS.find((b) => b.key === field.fieldKey);
  // Read-only boxes show the figure itself (with commas); a box you type in stays a plain input.
  if (disabled && !warn && !isEmpty) {
    const n = buf.text.trim() === "" ? null : Number(buf.text);
    const shown = n == null || !Number.isFinite(n) ? buf.text
      : n.toLocaleString(appLocale(), { maximumFractionDigits: 2 });
    return (
      <FieldRow label={label} accent={rag?.color}>
        <div className="text-go-kpi font-bold text-go-navy-900 min-h-8 break-words">
          {shown !== "" && <>{isCurrency && "$"}{shown}{isPercentage && "%"}</>}
        </div>
        {isPercentage && <PctBar value={n} />}
      </FieldRow>
    );
  }
  return (
    <FieldRow label={label} accent={rag?.color}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {isCurrency && <span className="text-go-text-secondary text-go-title">$</span>}
          <input
            type="text"
            inputMode="decimal"
            value={buf.text}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d.]/g, "");
              const parts = raw.split(".");
              const cleaned = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw;
              onText(cleaned);
            }}
            className={`w-full min-w-0 h-11 text-right px-3 text-go-heading font-bold text-go-navy-900 rounded-go-md bg-go-surface focus:outline-none ${
              warn || isEmpty
                ? `border-2 border-go-danger-600 focus:ring-2 focus:ring-go-danger-600${disabled ? " bg-go-sunken text-go-text-secondary" : ""}`
                : disabled
                ? "bg-go-sunken border border-go-border text-go-text-secondary"
                : "border border-go-border-strong focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1"
            }`}
            placeholder={disabled ? "" : "0"}
          />
          {isPercentage && <span className="text-go-text-secondary text-go-title">%</span>}
        </div>
        {warn && <span className="text-go-meta text-go-danger-600 leading-tight">{warn}</span>}
      </div>
    </FieldRow>
  );
}

// Progress bar under a "Percentage Achieved" box (no 100% cap on the figure; the bar stops at full).
export function PctBar({ value }: { value: number | null }) {
  const v = value != null && Number.isFinite(value) ? Math.max(0, value) : 0;
  return (
    <div className="h-2 rounded-full bg-go-border overflow-hidden">
      <div className="row-grow h-full rounded-full" style={{ width: `${Math.min(v, 100)}%`, background: ragFill(v) }} />
    </div>
  );
}
