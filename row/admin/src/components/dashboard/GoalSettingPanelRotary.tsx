"use client";

// COPY of GoalSettingPanel for the new Goal Setting with Rotary.org names (user 2026-10-23) - shown
// to Super Admin only until go-live; the original panel is not changed.
//
// Tabs = All Goals + the 4 Rotary.org sections (user 2026-10-30, option 2): Enhance Participant
// Engagement, Increase our Impact, Expand Our Reach, Increase Our Ability to Adapt. Each question sits in
// its Rotary.org section, whatever our category; inside a tab the questions come category by category
// (Membership, Youth Service, Foundation, Public Image), because Save, Lock, Messages and Month-wise
// still work per category on the existing APIs. Every tab, All Goals too, is editable while the
// category is open; Save Goals saves each category that was changed. See src/lib/goalRotaryLayout.ts.
//
// Generic Goal Setting form: driven entirely by goal_fields metadata (DataType/FieldRole), used for
// the Club Admin's own goals, the District Admin's own goals and, read-only, oversight roles.

import { ToggleButton, TileButton } from "@/components/ui/text-buttons";
import { Fragment, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, Save, Lock, LockOpen } from "@/components/icons";
import LoadingButton from "@/components/v2/LoadingButton";
import { getGoalCategories, getGoalSourceDates, type GoalSourceDates } from "@/services/api";
import type {
  GoalCategoryDto,
  GoalCategoryFormDto,
  GoalFieldWithValueDto,
  GoalEntrySaveDto,
  SaveGoalEntriesRequest,
  GoalLockStatusDto,
} from "@/types/goalSetting";
import SuccessAlert from "@/components/SuccessAlert";
import RagClubsDialog from "@/components/dashboard/RagClubsDialog";
import {
  withRotaryFields,
  SOURCE_LEGEND,
  withRag,
  buildSections,
  SECTION_TABS,
  categoryShortName,
  homeSectionOf,
  CATEGORY_TAGS,
  cardSourceNote,
  sectionHeading,
  sectionLockForms,
  isClubFoundationForm,
  isSuggestionCard,
  isRotaryOnlyCard,
  type SectionCard,
  type SectionView,
} from "@/lib/goalRotaryLayout";
import { appLocale } from "@/lib/appFormat";
import { FieldBuffer, GoalTab, isFieldEditable, livePercentages, fromFields, FormTransform, loadOne, rccMissing, skipField, PlainLabelsContext } from "./goalSettingRotaryLogic";
import { TILE_GRID, RotaryOrgNote, RagBar, ClubFoundationTable, SummaryInfo, SuggestionsList, ClubPublicImageLinks, GoalFieldInput } from "./GoalSettingRotaryParts";


export default function GoalSettingPanelRotary({
  fetchForm,
  saveForm,
  lockToggle,
  title = "Goal Setting",
  readOnly = false,
  subtitle,
  initialTab = "all",
  onFormsLoaded,
  onTabChange,
  reloadKey,
  toolbar,
  categoryExtras,
  highlightEmpty = false,
  headerActions,
  transformForm,
}: {
  fetchForm: (categoryId: number) => Promise<GoalCategoryFormDto>;
  saveForm?: (categoryId: number, body: SaveGoalEntriesRequest) => Promise<GoalCategoryFormDto>;
  lockToggle?: (categoryId: number, yearId: number, locked: boolean) => Promise<GoalLockStatusDto>;
  title?: string;
  readOnly?: boolean;
  subtitle?: string;
  initialTab?: GoalTab;
  // Every category's form, once loaded and after each Save / Lock (the page's Report and Messages use them).
  onFormsLoaded?: (forms: GoalCategoryFormDto[]) => void;
  // The tab shown, with the categories that have questions in it (Messages opens on the first one).
  onTabChange?: (tab: GoalTab, categoryIds: number[]) => void;
  // Changing this re-fetches every category (e.g. the selected rotary year changed).
  reloadKey?: string | number | null;
  // Shown under the tabs on every tab - the page's Messages / Report buttons.
  toolbar?: ReactNode;
  // Shown under a category's questions in its own section (e.g. Membership's Quarterly / Month-wise).
  categoryExtras?: (form: GoalCategoryFormDto) => ReactNode;
  // An editable box that is blank or 0 gets a red border (visual only - Save is never blocked).
  highlightEmpty?: boolean;
  // Buttons at the top right of the panel header (e.g. a club's Report).
  headerActions?: ReactNode;
  // New RCC tab only (user 2026-11-16): changes each loaded form (hidden questions, Rotary.org goals locked).
  transformForm?: FormTransform;
}) {
  const [categories, setCategories] = useState<GoalCategoryDto[] | null>(null);
  const [tab, setTab] = useState<GoalTab>(initialTab);
  const plainLabels = useContext(PlainLabelsContext);
  const [forms, setForms] = useState<GoalCategoryFormDto[] | null>(null);
  const [buffers, setBuffers] = useState<Record<number, FieldBuffer>>({});
  const [saved, setSaved] = useState<Record<number, FieldBuffer>>({});   // what is stored, to see what changed
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingForms, setLoadingForms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [ragOpen, setRagOpen] = useState<GoalCategoryFormDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGoalCategories()
      .then((cats) => { if (!cancelled) setCategories(cats); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load categories."); })
      .finally(() => { if (!cancelled) setLoadingCategories(false); });
    return () => { cancelled = true; };
  }, []);

  // Every category's form, in category order; one that fails is left out.
  useEffect(() => {
    if (!categories) return;
    let cancelled = false;
    setLoadingForms(true); setError(null); setSuccess(null);
    Promise.allSettled(categories.map((c) => loadOne(fetchForm, c.id, transformForm)))
      .then((res) => {
        if (cancelled) return;
        const ok = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        const b = fromFields(ok.flatMap((f) => f.fields));
        setForms(ok); setBuffers(b); setSaved(b);
        onFormsLoaded?.(ok);
        if (ok.length === 0) setError("Failed to load goals.");
      })
      .finally(() => { if (!cancelled) setLoadingForms(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, reloadKey]);

  const sections = useMemo(() => (forms ? buildSections(forms, skipField) : []), [forms]);

  // "Updated from Rotary.org / RISAO on …", "Entered by … · last saved …" on each card (user 2026-10-30).
  const [dates, setDates] = useState<GoalSourceDates | null>(null);
  const first0 = forms?.[0];
  useEffect(() => {
    if (!first0 || (!first0.districtId && !first0.clubId)) { setDates(null); return; }
    let cancelled = false;
    getGoalSourceDates(first0.yearId, first0.clubId ? null : first0.districtId, first0.clubId)
      .then((d) => { if (!cancelled) setDates(d); }).catch(() => { if (!cancelled) setDates(null); });
    return () => { cancelled = true; };
  }, [first0?.yearId, first0?.districtId, first0?.clubId, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceNote = (c: SectionCard): string | null => cardSourceNote(c, dates);
  useEffect(() => {
    const ids = tab === "all" ? (forms ?? []).map((f) => f.categoryId)
      : (sections.find((s) => s.key === tab)?.owners ?? []).map((f) => f.categoryId);
    onTabChange?.(tab, ids);
  }, [tab, sections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Percentage Achievement, recalculated on every keystroke (see PCT_RULES) instead of only after Save.
  const livePct = useMemo(() => Object.assign({}, ...(forms ?? []).map((f) => livePercentages(f.fields, buffers))) as Record<number, string>,
    [forms, buffers]);

  const canSave = (form: GoalCategoryFormDto) => !readOnly && !!saveForm && form.isEditable;
  const isDistrictForm = (form: GoalCategoryFormDto) => !form.clubId;

  function setText(fieldId: number, text: string) {
    setBuffers((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? { text: "", bool: false }), text } }));
    setSuccess(null);
  }
  function setBool(fieldId: number, bool: boolean) {
    setBuffers((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? { text: "", bool: false }), bool } }));
    setSuccess(null);
  }
  function setManyTexts(updates: Record<number, string>) {
    setBuffers((prev) => {
      const next = { ...prev };
      for (const [id, text] of Object.entries(updates)) {
        const fid = Number(id);
        next[fid] = { ...(next[fid] ?? { text: "", bool: false }), text };
      }
      return next;
    });
    setSuccess(null);
  }

  // "Target for the Current year" is a YEAR-END TOTAL, so it can never go below what the club or
  // district already has (minValue from the server - the same rule the API applies).
  function targetFloor(f: GoalFieldWithValueDto): number {
    const m = f.minValue;
    return m != null && Number(m) > 0 ? Number(m) : 0;
  }
  function targetWarn(f: GoalFieldWithValueDto): string | undefined {
    const floor = targetFloor(f);
    if (floor <= 0) return undefined;
    const t = (buffers[f.fieldId]?.text ?? "").trim();
    if (t === "") return undefined;
    const tgt = Number(t);
    if (Number.isNaN(tgt) || tgt >= floor) return undefined;
    return `Cannot be less than ${floor.toLocaleString(appLocale())}: you already have that much`;
  }

  const savable = (form: GoalCategoryFormDto) => form.fields.filter((f) => f.fieldRole !== "Computed" && f.fieldId > 0);
  const changed = (f: GoalFieldWithValueDto) => {
    const a = buffers[f.fieldId] ?? { text: "", bool: false }, b = saved[f.fieldId] ?? { text: "", bool: false };
    return f.dataType === "Boolean" ? a.bool !== b.bool : a.text !== b.text;
  };
  const dirtyForms = (forms ?? []).filter((form) => canSave(form) && savable(form).some(changed));

  async function handleSave() {
    if (!saveForm || dirtyForms.length === 0) return;
    const tooLow = dirtyForms.flatMap((form) => form.fields)
      .map((f) => {
        const floor = targetFloor(f);
        if (floor <= 0) return null;
        const t = (buffers[f.fieldId]?.text ?? "").trim();
        if (t === "") return null;
        const tgt = Number(t);
        return !Number.isNaN(tgt) && tgt < floor ? { f, tgt, floor } : null;
      })
      .filter((x): x is { f: GoalFieldWithValueDto; tgt: number; floor: number } => x !== null);
    if (tooLow.length > 0) {
      setError(tooLow.map((x) => `${x.f.groupName}: target ${x.tgt.toLocaleString(appLocale())} cannot be less than the ${x.floor.toLocaleString(appLocale())} you already have.`).join(" "));
      return;
    }
    setSaving(true); setError(null); setSuccess(null);
    let next = forms ?? [];
    const names: string[] = [];
    try {
      for (const form of dirtyForms) {
        const entries: GoalEntrySaveDto[] = savable(form).map((f) => {
          const buf = buffers[f.fieldId] ?? { text: "", bool: false };
          if (f.dataType === "Boolean") return { fieldId: f.fieldId, numericValue: null, textValue: null, boolValue: buf.bool };
          if (f.dataType === "Text") return { fieldId: f.fieldId, numericValue: null, textValue: buf.text.trim() === "" ? null : buf.text, boolValue: null };
          const n = buf.text.trim() === "" ? null : Number(buf.text);
          return { fieldId: f.fieldId, numericValue: n != null && isFinite(n) ? n : null, textValue: null, boolValue: null };
        });
        const raw = await withRag(withRotaryFields(await saveForm(form.categoryId, { yearId: form.yearId, entries })));
        const fresh = transformForm ? await transformForm(raw) : raw;
        next = next.map((x) => (x.categoryId === fresh.categoryId ? fresh : x));
        names.push(categoryShortName(form.categoryId, form.categoryName));
        const b = fromFields(fresh.fields);
        setBuffers((prev) => ({ ...prev, ...b }));
        setSaved((prev) => ({ ...prev, ...b }));
      }
      setSuccess(`Goals saved successfully (${names.join(", ")}).`);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError((names.length ? `Saved ${names.join(", ")}. ` : "") + (err?.response?.data?.message || "Failed to save goals."));
    } finally {
      setForms(next);
      onFormsLoaded?.(next);
      setSaving(false);
    }
  }

  async function handleLockToggle(form: GoalCategoryFormDto) {
    if (!lockToggle) return;
    setLocking(form.categoryId); setError(null); setSuccess(null);
    try {
      await lockToggle(form.categoryId, form.yearId, !form.isLocked);
      const fresh = await loadOne(fetchForm, form.categoryId, transformForm);
      const next = (forms ?? []).map((x) => (x.categoryId === fresh.categoryId ? fresh : x));
      setForms(next);
      onFormsLoaded?.(next);
      const b = fromFields(fresh.fields);
      setBuffers((prev) => ({ ...prev, ...b }));
      setSaved((prev) => ({ ...prev, ...b }));
      setSuccess(`${categoryShortName(form.categoryId, form.categoryName)} ${fresh.isLocked ? "locked" : "unlocked"}.`);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to update lock.");
    } finally {
      setLocking(null);
    }
  }

  if (loadingCategories) {
    return (
      <div className="bg-go-surface rounded-go-lg border border-go-border p-6 flex items-center justify-center text-go-text-secondary">
        <Loader2 className="animate-spin mr-2" size={16} /> Loading Goal Setting…
      </div>
    );
  }
  if (!categories || categories.length === 0) return null;

  const first = forms?.[0] ?? null;
  const shown = tab === "all" ? sections : sections.filter((s) => s.key === tab);
  const anySavable = (forms ?? []).some(canSave);
  const tabCls = (on: boolean) => `min-h-14 px-3.5 py-2.5 text-go-body font-bold text-left leading-snug rounded-go-lg border transition ${
    on ? "bg-go-navy-900 border-go-navy-900 text-white border-b-[3px] border-b-go-gold-500" : "bg-go-surface border-go-border-strong text-go-navy-700 hover:bg-go-sunken"}`;

  // One card = one Rotary.org field (sheet "New", user 2026-10-30) with its boxes. Club Foundation
  // (MCR) keeps its own table.
  const renderCard = (c: SectionCard) => {
    const form = c.form;
    const editable = canSave(form) && !saving;
    const rotary = isRotaryOnlyCard(c);
    const suggestions = isSuggestionCard(c);
    return (
      <div key={c.name} className={`bg-go-surface rounded-go-lg border border-go-border px-4 sm:px-5 py-4 min-w-0 ${rotary ? "flex-[1_1_380px]" : "basis-full"}`}>
        <h4 className="row-h3 text-go-title text-go-navy-700 pb-2.5 mb-3.5 border-b border-go-border flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="max-w-full truncate" title={c.name}>{c.name}</span>
          {c.name === "Summary" && <SummaryInfo fields={c.fields} />}
          {sourceNote(c) && <span className="text-go-meta font-semibold text-go-text-secondary">{sourceNote(c)}</span>}
          {c.fields.some((f) => f.fieldKey.startsWith("rotary_")) && <RotaryOrgNote at={form.rotaryOrgUpdatedAt} />}
        </h4>
        {c.name === "RAG Analysis" && (() => {
          // Total = the 5 bands added up (= the district's clubs on Rotary.org); click for the club list.
          const total = c.fields.filter((f) => f.fieldKey.startsWith("rag5_")).reduce((t, f) => t + Number(f.numericValue ?? 0), 0);
          return (
            <TileButton onClick={() => setRagOpen(form)} className="mb-1 p-3" title="Click to see the clubs and their member count">
              <div className="flex items-center justify-between mb-2 text-go-body">
                <span className="font-bold text-go-navy-900">Total clubs: {total.toLocaleString(appLocale())}</span>
                <span className="font-bold text-go-navy-700 underline">View clubs</span>
              </div>
              <RagBar fields={c.fields} />
            </TileButton>
          );
        })()}
        {isClubFoundationForm(form) && !rotary ? (
          <ClubFoundationTable fields={c.fields} buffers={buffers} onText={setText} editable={editable} />
        ) : suggestions ? (
          <SuggestionsList key={`sugg-${form.yearId}`} fields={c.fields} buffers={buffers} onText={setText}
            onManyText={setManyTexts} editable={editable} markEmpty={highlightEmpty} />
        ) : (
          <div className={TILE_GRID}>
            {c.fields.map((f) => (
              <Fragment key={f.fieldId}>
                <GoalFieldInput
                  field={f}
                  buffer={f.fieldId in livePct ? { text: livePct[f.fieldId], bool: false } : buffers[f.fieldId]}
                  disabled={!editable || !isFieldEditable(f, isDistrictForm(form))}
                  onText={(v) => setText(f.fieldId, v)}
                  onBool={(v) => setBool(f.fieldId, v)}
                  warn={rccMissing(f) ? "Not set on Rotary.org" : targetWarn(f)}
                  markEmpty={highlightEmpty && isFieldEditable(f, isDistrictForm(form))}
                />
                {form.clubId && buffers[f.fieldId]?.bool && (f.fieldKey === "club_website" || f.fieldKey === "club_social_media") && (
                  <ClubPublicImageLinks clubId={form.clubId} kind={f.fieldKey === "club_website" ? "website" : "social"} />
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    );
  };

  // One section: a row with each category's tag, lock state and Lock button, then every box of the
  // section, then the categories' own extras (Membership / Foundation Quarterly / Month-wise).
  // Each category's Locked / Unlocked (+ Lock button where allowed). A tab shows its own category; All
  // Goals shows all four once, above the first section (user 2026-10-30).
  const lockRow = (forms: GoalCategoryFormDto[]) => forms.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-2.5">
            {forms.map((form) => {
              const tag = CATEGORY_TAGS[form.categoryId];
              return (
                <span key={form.categoryId} className="inline-flex flex-wrap items-center gap-2 rounded-go-lg border border-go-border bg-go-surface px-3 py-1.5">
                  <span className="text-go-body font-bold text-go-navy-900">{categoryShortName(form.categoryId, form.categoryName)}</span>
                  {tag && <span className="rounded bg-go-sunken px-2 py-0.5 text-go-meta font-bold text-go-text-secondary">{tag.zone} / {tag.district}</span>}
                  {form.isLocked && (
                    <span className="inline-flex items-center gap-1 text-go-meta font-medium text-go-text-secondary" title={`${form.lockedByName ?? ""} ${form.lockedDate ?? ""}`.trim()}>
                      <Lock size={11} /> Locked
                    </span>
                  )}
                  {!form.isLocked && !form.isEditable && (
                    <span className="inline-flex items-center gap-1 text-go-meta font-medium text-go-text-secondary"><Lock size={11} /> {readOnly ? "Read only" : "Past year · read only"}</span>
                  )}
                  {!form.isLocked && form.isEditable && (
                    <span className="inline-flex items-center gap-1 rounded border border-go-border-strong px-2 py-0.5 text-go-meta font-medium text-go-text-secondary"><LockOpen size={11} /> Unlocked</span>
                  )}
                  {lockToggle && form.canLock && (
                    <LoadingButton
                      onAction={() => handleLockToggle(form)}
                      forcePending={locking === form.categoryId}
                      spinnerSize={12}
                      className="row-btn row-btn-secondary row-btn-sm"
                    >
                      {locking !== form.categoryId && (form.isLocked ? <LockOpen size={12} /> : <Lock size={12} />)}
                      {form.isLocked ? "Unlock" : "Lock"}
                    </LoadingButton>
                  )}
                </span>
              );
            })}
          </div>
  );

  // The tab's own category extras (Membership / Foundation Quarterly + Month-wise), shown at the TOP next
  // to the lock status or the section heading - at the bottom they were not seen (user 2026-10-30).
  const extrasOf = (s: SectionView) => !categoryExtras ? null : sectionLockForms(s)
    .filter((form) => homeSectionOf(form.categoryId) === s.key)
    .map((form) => { const x = categoryExtras(form); return x ? <div key={form.categoryId} className="ml-auto">{x}</div> : null; });

  const renderSection = (s: SectionView) => {
    return (
      <>
        {tab !== "all" && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            {lockRow(sectionLockForms(s))}
            {extrasOf(s)}
          </div>
        )}
        <div className="flex flex-wrap gap-4">{s.cards.map(renderCard)}</div>
      </>
    );
  };

  return (
    <div className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card overflow-clip">
      <SuccessAlert open={!!success} title="Saved" description={success ?? ""} onOk={() => setSuccess(null)} />
      {ragOpen?.districtId && (
        <RagClubsDialog open={!!ragOpen} onClose={() => setRagOpen(null)} yearId={ragOpen.yearId}
          districtId={ragOpen.districtId} title={`${ragOpen.entityName} · RY ${ragOpen.yearLabel}`} />
      )}
      <div className="px-6 py-5 border-b border-go-border flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="row-h3 text-go-heading text-go-navy-900">{title}</h3>
          <p className="text-go-body text-go-text-secondary">{subtitle || (first ? `${first.entityName} · RY ${first.yearLabel}` : "")}</p>
        </div>
        {headerActions && <div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
      </div>

      {!plainLabels && <div className="px-6 pt-4 flex flex-wrap gap-2 text-go-body text-go-text-primary">
        {SOURCE_LEGEND.map((l) => (
          <span key={l.symbol} className="inline-flex items-center gap-1.5 rounded bg-go-sunken px-3 py-1.5"><span>{l.symbol}</span>{l.text}</span>
        ))}
      </div>}
      <div className="px-6 py-4 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))] border-b border-go-border">
        <ToggleButton pressed={tab === "all"} type="button" onClick={() => setTab("all")} className="h-auto min-h-14 py-2.5 text-left leading-snug">All Goals</ToggleButton>
        {SECTION_TABS.map((s, i) => (
          <ToggleButton pressed={tab === s.key} key={s.key} type="button" onClick={() => setTab(s.key)} className="h-auto min-h-14 py-2.5 text-left leading-snug">
            {sections[i] ? sectionHeading(sections[i]) : `${i + 1}. ${s.title}`}
          </ToggleButton>
        ))}
      </div>

      {toolbar && <div className="px-6 py-3.5 border-b border-go-border bg-go-sunken">{toolbar}</div>}

      {loadingForms && (
        <div className="p-8 flex items-center justify-center text-go-text-secondary">
          <Loader2 className="animate-spin mr-2" size={16} /> Loading…
        </div>
      )}

      {!loadingForms && forms && (
        <div className="p-4 sm:p-6 space-y-8 bg-go-sunken">
          {tab === "all" && lockRow(sections.flatMap(sectionLockForms))}
          {shown.map((s) => (
            <section key={s.key} className="space-y-5">
              {tab === "all" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h3 className="row-h3 text-go-heading text-go-navy-900 border-l-[3px] border-go-gold-500 pl-3">{sectionHeading(s)}</h3>
                  {extrasOf(s)}
                </div>
              )}
              {s.cards.length === 0
                ? <p className="text-go-body text-go-text-muted">No goals in this section.</p>
                : renderSection(s)}
            </section>
          ))}
        </div>
      )}

      <div className={`sticky bottom-0 z-20 px-6 py-3.5 border-t border-go-border shadow-go-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-go-surface${loadingForms || !anySavable ? (error ? "" : " hidden") : ""}`}>
        <div className="text-go-body text-go-text-secondary">
          {dirtyForms.length > 0 ? `Not saved yet: ${dirtyForms.map((f) => categoryShortName(f.categoryId, f.categoryName)).join(", ")}` : ""}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-go-meta text-go-danger-600">{error}</span>}
          {anySavable && (
            <LoadingButton
              onAction={handleSave}
              forcePending={saving}
              disabled={dirtyForms.length === 0}
              loadingLabel="Saving…"
              spinnerSize={13}
              className="inline-flex items-center gap-2 text-go-body font-bold h-9 px-7 rounded-go-sm bg-go-navy-700 text-white hover:bg-go-navy-900 disabled:opacity-50"
            >
              {!saving && <Save size={13} />} Save Goals
            </LoadingButton>
          )}
        </div>
      </div>
    </div>
  );
}
