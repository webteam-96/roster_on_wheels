"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * Settings → Year-wise Admin Rights.
 *
 * Switch the year rule ON or OFF per district and per club, over a platform-wide
 * default. OFF means that scope behaves as the platform did before Year-wise Admin
 * Rights: an admin of that club/district adds, edits and deletes in ANY Rotary year.
 * It never makes anyone an admin who was not one already.
 *
 * Resolution, most specific wins:
 *   a club   → its own setting → its district's setting → the platform default
 *   a district → its own setting → the platform default
 *
 * ⚠️ Switching a scope ON can take every edit button away from admins who hold no
 * years, so every flip to ON goes through the preflight dialog first. Switching OFF
 * only ever widens access and needs a plain confirm.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import SearchableCombo from "@/components/SearchableCombo";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { PageHeader, Panel, SkeletonRows, rowTable } from "@/components/row/AppKit";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Plus, Trash2, Loader2, AlertTriangle, ShieldCheck, ShieldOff, Eye, RotateCcw } from "@/components/icons";
import {
  getYearRuleSettings, setYearRuleGlobal,
  setYearRuleDistrict, clearYearRuleDistrict,
  setYearRuleClub, clearYearRuleClub,
  getYearRulePreflight,
  getYearRuleMessageSettings, setYearRuleMessage,
  getDistricts, getClubs,
  YearRuleSettings, YearRuleScopeOverride, YearRulePreflight,
  YearRuleMessagesSettings,
} from "@/services/api";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_YEAR_RULE_MESSAGES, renderYearRuleMessage } from "@/lib/yearRuleMessages";

// What each message is for, in the SuperAdmin's terms rather than the key's.
// `example` drives the live preview, so what is previewed is a real render of the
// real template — not a mock-up that could quietly disagree with the badge.
const MESSAGE_LABELS: Record<string, { title: string; help: string }> = {
  current_year_only: {
    title: "Pages with no Rotary year",
    help: "Announcements, upcoming events, documents, web links, greetings and mass email. There is one live list, so only an admin for the CURRENT year can ever change it, this wording must not promise another year.",
  },
  wrong_year_with_years: {
    title: "A year they cannot edit, and they hold others",
    help: "Shown when the admin is looking at a year outside their rights but does hold other years, which are named so there is somewhere to go.",
  },
  wrong_year_no_years: {
    title: "A year they cannot edit, and they hold none",
    help: "Shown when the admin holds no editable years here at all, so there is nothing to point them to.",
  },
  default_actions: {
    title: "What is being withheld",
    help: "The phrase {actions} falls back to, written to follow \"can\". A screen whose blocked action is different, Remove Admin, for one, passes its own instead.",
  },
};

type DistrictOption = { id: number; districtNumber: string };
type ClubOption = { id: number; clubName: string };

// The flip waiting on confirmation. `enable` is the value being moved TO.
type Pending =
  | { kind: "global"; enable: boolean }
  | { kind: "district"; id: number; label: string; enable: boolean }
  | { kind: "club"; id: number; label: string; enable: boolean };

export default function YearWiseAdminRightsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [settings, setSettings] = useState<YearRuleSettings | null>(null);

  // Pick lists. Districts load once; clubs reload when the district picker changes.
  const [districtOptions, setDistrictOptions] = useState<DistrictOption[]>([]);
  const [clubOptions, setClubOptions] = useState<ClubOption[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(false);

  const [addDistrictId, setAddDistrictId] = useState<string>("");
  const [clubPickerDistrictId, setClubPickerDistrictId] = useState<string>("");
  const [addClubId, setAddClubId] = useState<string>("");

  // Confirm / preflight dialog
  const [pending, setPending] = useState<Pending | null>(null);
  const [preflight, setPreflight] = useState<YearRulePreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // ── The "View only" wording ───────────────────────────────────────────────
  // Platform-wide, unlike the switches above. `drafts` holds what is in the boxes
  // so the preview updates as it is typed; `messageSettings` stays as the server
  // last confirmed it, which is what Reset and the "edited by" line read.
  const [messageSettings, setMessageSettings] = useState<YearRuleMessagesSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    try {
      const s = await getYearRuleSettings();
      setSettings(s);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load Year-wise Admin Rights settings");
    } finally {
      setLoading(false);
    }
  };

  // Separate from load() on purpose: the switches are the page's job and a wording
  // fetch that fails must not leave the page looking broken. Worst case this card
  // does not render and every switch still works.
  const loadMessages = async () => {
    try {
      const m = await getYearRuleMessageSettings();
      setMessageSettings(m);
      setDrafts(Object.fromEntries(m.messages.map((x) => [x.key, x.template])));
    } catch {
      setMessageSettings(null);
    }
  };

  const saveMessage = async (key: string, template?: string) => {
    setSavingKey(key);
    setError(null);
    setSuccess(null);
    try {
      const res = await setYearRuleMessage(key, template);
      setSuccess(res.message);
      // Re-read rather than patch state: the server trims, and on a reset it sends
      // back the default, so what it holds is the only thing worth showing.
      await loadMessages();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to save the message");
    } finally {
      setSavingKey(null);
    }
  };

  useEffect(() => {
    load();
    loadMessages();
    // pageSize is deliberately large: this is a picker, not a browsable list, and
    // paging it would hide districts behind a control nobody expects here.
    getDistricts(1, 1000)
      .then((r) => setDistrictOptions(
        (r.items ?? []).map((d: any) => ({ id: d.id, districtNumber: d.districtNumber }))
          .sort((a: DistrictOption, b: DistrictOption) => a.districtNumber.localeCompare(b.districtNumber))))
      .catch(() => setError("Failed to load the district list"));
  }, []);

  useEffect(() => {
    if (!clubPickerDistrictId) { setClubOptions([]); setAddClubId(""); return; }
    setLoadingClubs(true);
    setAddClubId("");
    getClubs(1, 1000, undefined, Number(clubPickerDistrictId))
      .then((r) => setClubOptions(
        (r.items ?? []).map((c: any) => ({ id: c.id, clubName: c.clubName }))
          .sort((a: ClubOption, b: ClubOption) => a.clubName.localeCompare(b.clubName))))
      .catch(() => setError("Failed to load clubs for that district"))
      .finally(() => setLoadingClubs(false));
  }, [clubPickerDistrictId]);

  // Districts that do not already have an override, so the Add picker cannot
  // produce a duplicate row.
  const addableDistricts = useMemo(() => {
    const taken = new Set((settings?.districts ?? []).map((d) => d.districtId));
    return districtOptions.filter((d) => !taken.has(d.id));
  }, [districtOptions, settings]);

  const addableClubs = useMemo(() => {
    const taken = new Set((settings?.clubs ?? []).map((c) => c.clubId));
    return clubOptions.filter((c) => !taken.has(c.id));
  }, [clubOptions, settings]);

  // ── Opening the dialog ──────────────────────────────────────────────────────
  // Only a flip to ON needs the preflight; OFF only ever widens access.
  const ask = async (p: Pending) => {
    setPending(p);
    setPreflight(null);
    setAcknowledged(false);
    setError(null);

    if (!p.enable || p.kind === "global") return;

    setPreflightLoading(true);
    try {
      setPreflight(await getYearRulePreflight(
        p.kind === "club" ? { clubId: p.id } : { districtId: p.id }));
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not check who is affected");
    } finally {
      setPreflightLoading(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      const res =
        pending.kind === "global" ? await setYearRuleGlobal(pending.enable)
        : pending.kind === "district" ? await setYearRuleDistrict(pending.id, pending.enable)
        : await setYearRuleClub(pending.id, pending.enable);
      setSuccess(res.message);
      setPending(null);
      setAddDistrictId("");
      setAddClubId("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Confirmed in the app's own dialog (was the browser's window confirm box).
  const [clearing, setClearing] = useState<YearRuleScopeOverride | null>(null);
  const describe = (row: YearRuleScopeOverride) => {
    const isClub = row.clubId > 0;
    const label = isClub ? (row.clubName ?? `Club ${row.clubId}`) : `District ${row.districtNumber ?? row.districtId}`;
    return `Remove the setting for ${label}? It will follow ${isClub ? "its district" : "the platform default"} from now on.`;
  };
  const clearOverride = async (row: YearRuleScopeOverride) => {
    const isClub = row.clubId > 0;
    setSaving(true);
    try {
      const res = isClub ? await clearYearRuleClub(row.clubId) : await clearYearRuleDistrict(row.districtId);
      setSuccess(res.message);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to remove the setting");
    } finally {
      setSaving(false);
    }
  };

  const StateBadge = ({ on }: { on: boolean }) =>
    on ? (
      <Badge className="bg-emerald-100 text-emerald-800 gap-1">
        <ShieldCheck className="h-3 w-3" /> Year rule ON
      </Badge>
    ) : (
      <Badge className="bg-amber-100 text-amber-800 gap-1">
        <ShieldOff className="h-3 w-3" /> Year rule OFF
      </Badge>
    );

  const globalOn = settings?.globalEnabled ?? true;
  // What a new setting starts as: the opposite of what it would follow anyway. Offering the same value again (ON
  // under a platform that is ON) changed nothing.
  const districtStart = !globalOn;
  const clubFollows =
    settings?.districts.find((d) => String(d.districtId) === clubPickerDistrictId)?.isEnabled ?? globalOn;

  const overrideTable = (rows: YearRuleScopeOverride[], kind: "district" | "club") => (
    rows.length === 0 ? (
      <p className="rounded-md bg-muted px-4 py-3 text-[14px] text-muted-foreground">
        No {kind === "club" ? "club" : "district"} has its own setting. Each one follows{" "}
        {kind === "club" ? "its district" : "the platform default"}.
      </p>
    ) : (
    <div className={`${rowTable.wrap} relative rounded-md border border-[color:var(--row-line)]`}>
      <Table className={`${rowTable.table} w-full min-w-[640px]`}>
        <TableHeader className={rowTable.head}>
          <TableRow>
            <TableHead className={rowTable.th}>{kind === "club" ? "Club" : "District"}</TableHead>
            {kind === "club" && <TableHead className={rowTable.th}>District</TableHead>}
            <TableHead className={rowTable.th}>Year rule</TableHead>
            <TableHead className={rowTable.th}>Last changed</TableHead>
            <TableHead className={`${rowTable.th} text-right`}><span className="sr-only">Remove</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className={rowTable.body}>
          {rows.map((r) => {
            const id = kind === "club" ? r.clubId : r.districtId;
            const label = kind === "club" ? (r.clubName ?? `Club ${r.clubId}`) : `District ${r.districtNumber ?? r.districtId}`;
            return (
              <TableRow key={`${kind}-${id}`} className={rowTable.tr}>
                <TableCell className={`${rowTable.td} font-semibold`}>{label}</TableCell>
                {kind === "club" && <TableCell className={rowTable.tdMuted}>{r.districtNumber ?? "–"}</TableCell>}
                <TableCell className={rowTable.td}>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={r.isEnabled}
                      aria-label={`Year rule for ${label}`}
                      disabled={saving}
                      onCheckedChange={(v) => ask({ kind, id, label, enable: v })}
                    />
                    <StateBadge on={r.isEnabled} />
                  </div>
                </TableCell>
                <TableCell className={rowTable.tdMuted}>
                  {r.modifiedDate ?? "–"}
                  {r.modifiedByName ? <div className="text-[13px]">by {r.modifiedByName}</div> : null}
                </TableCell>
                <TableCell className={`${rowTable.td} text-right`}>
                  <Button variant="ghost" size="sm" disabled={saving} onClick={() => setClearing(r)} aria-label={`Remove the setting for ${label}`}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
    )
  );

  return (
    <ProtectedRoute requireSuperAdmin>
      <div className="space-y-6">
        <PageHeader
          back="/settings"
          title="Year-wise Admin Rights"
          description="With the year rule on, an admin edits only the Rotary years they hold. With it off, they edit any year. Viewing is never restricted, and nobody becomes an admin."
        />

        <SuccessAlert open={!!success} title="Saved" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Something went wrong" description={error ?? ""} onOk={() => setError(null)} />
        <AlertModal open={!!clearing} onOpenChange={(o) => { if (!o) setClearing(null); }} icon={AlertTriangle} iconClassName="text-amber-600"
          title="Remove setting" description={clearing ? describe(clearing) : ""} confirmLabel="Remove" cancelLabel="Cancel"
          onConfirm={() => { const r = clearing; setClearing(null); if (r) clearOverride(r); }} />

        {loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <>
        {/* ── Platform default ───────────────────────────────────────────── */}
        <Panel
          title="Whole platform"
          headerRight={
            <div className="flex shrink-0 items-center gap-3">
              <StateBadge on={globalOn} />
              <Switch
                checked={globalOn}
                disabled={saving}
                aria-label="Year rule for the whole platform"
                onCheckedChange={(v) => ask({ kind: "global", enable: v })}
              />
            </div>
          }
        >
          <p className="max-w-[64ch] text-[15px] text-foreground">
            {globalOn
              ? "Every district and club follows the year rule, except the ones switched off below."
              : "No district or club follows the year rule, except the ones switched on below."}
          </p>
          {settings?.globalModifiedDate && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Changed {settings.globalModifiedDate}
              {settings.globalModifiedByName ? ` by ${settings.globalModifiedByName}` : ""}
            </p>
          )}
        </Panel>

        {/* ── Districts ──────────────────────────────────────────────────── */}
        <Panel title="Districts" subtitle="Covers every club in the district, except clubs with their own setting.">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-[360px]">
                <Label>District</Label>
                <SearchableCombo
                  value={addDistrictId}
                  onChange={setAddDistrictId}
                  options={addableDistricts.map((d) => ({ value: String(d.id), label: `District ${d.districtNumber}` }))}
                  placeholder="Choose a district"
                  searchPlaceholder="District number"
                  emptyText="No district matches."
                />
              </div>
              <Button
                disabled={!addDistrictId || saving}
                onClick={() => {
                  const d = districtOptions.find((x) => String(x.id) === addDistrictId);
                  if (d) ask({ kind: "district", id: d.id, label: `District ${d.districtNumber}`, enable: districtStart });
                }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Switch {districtStart ? "on" : "off"} for this district
              </Button>
            </div>
            {overrideTable(settings?.districts ?? [], "district")}
          </div>
        </Panel>

        {/* ── Clubs ──────────────────────────────────────────────────────── */}
        <Panel title="Clubs" subtitle="A club's own setting beats its district's.">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="min-w-0 space-y-1.5 lg:w-[260px]">
                <Label>District</Label>
                <SearchableCombo
                  value={clubPickerDistrictId}
                  onChange={setClubPickerDistrictId}
                  options={districtOptions.map((d) => ({ value: String(d.id), label: `District ${d.districtNumber}` }))}
                  placeholder="Choose a district"
                  searchPlaceholder="District number"
                  emptyText="No district matches."
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 lg:max-w-[360px]">
                <Label>Club</Label>
                <SearchableCombo
                  value={addClubId}
                  onChange={setAddClubId}
                  options={addableClubs.map((c) => ({ value: String(c.id), label: c.clubName }))}
                  placeholder={loadingClubs ? "Loading clubs" : clubPickerDistrictId ? "Choose a club" : "Choose a district first"}
                  searchPlaceholder="Club name"
                  emptyText="No club matches."
                  disabled={!clubPickerDistrictId || loadingClubs}
                />
              </div>
              <Button
                disabled={!addClubId || saving}
                onClick={() => {
                  const c = clubOptions.find((x) => String(x.id) === addClubId);
                  if (c) ask({ kind: "club", id: c.id, label: c.clubName, enable: !clubFollows });
                }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Switch {clubFollows ? "off" : "on"} for this club
              </Button>
            </div>
            {overrideTable(settings?.clubs ?? [], "club")}
          </div>
        </Panel>

        {/* ── The "View only" wording ────────────────────────────────────── */}
        {messageSettings && (
          <Panel
            title="View only wording"
            subtitle="What an admin reads where the year rule takes Add, Edit and Delete away. Web and app show it from the next sign-in."
          >
            <div className="space-y-6">

              {/* The tokens, before the boxes: nobody should have to discover them by
                  having a save refused. */}
              <div className="rounded-md bg-muted p-4">
                <p className="mb-2 text-[13px] font-semibold text-foreground">
                  Placeholders: type them exactly, they are filled in for each reader
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {messageSettings.tokens.map((t) => (
                    <div key={t.token} className="text-[13px] text-muted-foreground">
                      <code className="rounded bg-card px-1 py-0.5 font-mono text-[11px] text-amber-700 border border-[color:var(--row-line)]">
                        {t.token}
                      </code>{" "}
                      {t.describes}
                      <span className="text-muted-foreground">, otherwise &ldquo;{t.fallback}&rdquo;</span>
                    </div>
                  ))}
                </div>
              </div>

              {messageSettings.messages.map((m) => {
                const label = MESSAGE_LABELS[m.key] ?? { title: m.key, help: "" };
                const draft = drafts[m.key] ?? "";
                const dirty = draft.trim() !== m.template.trim();
                const busy = savingKey === m.key;

                // Previewed with the OTHER boxes as they stand, so editing the
                // actions phrase updates the sentence above it as you type.
                const previewMessages = {
                  ...DEFAULT_YEAR_RULE_MESSAGES,
                  defaultActions:
                    (drafts.default_actions ?? "").trim() || DEFAULT_YEAR_RULE_MESSAGES.defaultActions,
                };
                const preview =
                  m.key === "default_actions"
                    ? renderYearRuleMessage(
                        drafts.current_year_only ?? DEFAULT_YEAR_RULE_MESSAGES.currentYearOnly,
                        { currentYear: "2026-27" },
                        { ...previewMessages, defaultActions: draft.trim() || DEFAULT_YEAR_RULE_MESSAGES.defaultActions },
                      )
                    : renderYearRuleMessage(
                        draft,
                        m.key === "current_year_only"
                          ? { currentYear: "2026-27" }
                          : m.key === "wrong_year_with_years"
                          ? { year: "2024-25", years: ["2025-26", "2026-27"] }
                          : { year: "2024-25" },
                        previewMessages,
                      );

                return (
                  <div key={m.key} className="space-y-3 border-t border-[color:var(--row-line)] pt-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-foreground">{label.title}</span>
                      {m.isCustom ? (
                        <Badge variant="secondary">Edited</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Default</Badge>
                      )}
                      {m.isCustom && m.modifiedDate && (
                        <span className="text-[13px] text-muted-foreground">
                          {m.modifiedDate}
                          {m.modifiedByName ? ` by ${m.modifiedByName}` : ""}
                        </span>
                      )}
                    </div>
                    {label.help && <p className="text-[13px] text-muted-foreground">{label.help}</p>}

                    <Textarea
                      value={draft}
                      rows={m.key === "default_actions" ? 1 : 2}
                      disabled={busy}
                      onChange={(e) => setDrafts((d) => ({ ...d, [m.key]: e.target.value }))}
                     
                    />

                    {/* A real render, not a mock-up — the same function the badge uses. */}
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <Eye className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{preview || <span className="text-amber-700/60">Nothing to show, this will fall back to the default.</span>}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button size="sm" disabled={!dirty || busy} onClick={() => saveMessage(m.key, draft)}>
                        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        Save
                      </Button>
                      {dirty && (
                        <Button
                          size="sm" variant="ghost" disabled={busy}
                          onClick={() => setDrafts((d) => ({ ...d, [m.key]: m.template }))}
                        >
                          Cancel
                        </Button>
                      )}
                      {/* Only offered once there is an edit to undo. Sends a blank
                          template, which the server treats as "back to default". */}
                      {m.isCustom && (
                        <Button
                          size="sm" variant="outline" disabled={busy}
                          onClick={() => saveMessage(m.key, "")}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Reset to default
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
        </>
        )}

        {/* ── Confirm / preflight ────────────────────────────────────────── */}
        <Dialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {pending?.enable ? "Switch the year rule ON" : "Switch the year rule OFF"}
                {pending && pending.kind !== "global" ? `: ${pending.label}` : ": whole platform"}
              </DialogTitle>
            </DialogHeader>

            {/* Turning OFF only widens access, so there is nothing to warn about. */}
            {pending && !pending.enable && (
              <p className="text-sm text-muted-foreground">
                Admins of {pending.kind === "global" ? "every district and club without its own setting" : pending.label}{" "}
                will be able to add, edit and delete in <strong>any Rotary year</strong>. Nobody loses access, and
                nobody becomes an admin who was not one already.
              </p>
            )}

            {pending?.enable && pending.kind === "global" && (
              <p className="text-sm text-muted-foreground">
                Every district and club without its own setting will start enforcing the year rule. Admins
                who hold no Rotary years will lose their edit buttons there. Because this covers the whole
                platform it is not checked district by district, switch districts on one at a time if you
                want to see who is affected first.
              </p>
            )}

            {pending?.enable && pending.kind !== "global" && (
              <div className="space-y-3">
                {preflightLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking who is affected…
                  </div>
                )}

                {preflight && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-[color:var(--row-line)] p-3">
                        <div className="text-lg font-semibold text-foreground">{preflight.allYearsCount}</div>
                        <div className="text-[13px] text-muted-foreground">hold all years, unaffected</div>
                      </div>
                      <div className="rounded-lg border border-[color:var(--row-line)] p-3">
                        <div className="text-lg font-semibold text-foreground">{preflight.someYearsCount}</div>
                        <div className="text-[13px] text-muted-foreground">will be limited to their own years</div>
                      </div>
                      <div className={`rounded-lg border p-3 ${preflight.noYearsCount > 0 ? "border-red-300 bg-red-50" : "border-[color:var(--row-line)]"}`}>
                        <div className={`text-lg font-semibold ${preflight.noYearsCount > 0 ? "text-red-700" : "text-foreground"}`}>
                          {preflight.noYearsCount}
                        </div>
                        <div className="text-[13px] text-muted-foreground">hold no years, lose every edit button</div>
                      </div>
                    </div>

                    {preflight.noYearsCount > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-red-800">
                          <AlertTriangle className="h-4 w-4" /> These admins will not be able to edit anything here
                        </div>
                        <ul className="mt-2 space-y-1 text-sm text-red-900">
                          {preflight.admins.filter((a) => a.wouldLoseAccess).map((a) => (
                            <li key={a.memberId}>• {a.memberName}</li>
                          ))}
                        </ul>
                        <p className="mt-2 text-xs text-red-800">
                          Grant them the Rotary years they need first, then switch this on.
                        </p>
                      </div>
                    )}

                    {preflight.admins.some((a) => !a.wouldLoseAccess && !a.allYears) && (
                      <div className="rounded-lg border border-[color:var(--row-line)] p-3">
                        <div className="text-sm font-medium text-foreground">Will be limited to:</div>
                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {preflight.admins.filter((a) => !a.wouldLoseAccess && !a.allYears).map((a) => (
                            <li key={a.memberId}>• {a.memberName}: {a.years.join(", ")}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {pending.kind === "district" && preflight.cascadeClubCount > 0 && (
                      <p className="text-[13px] text-muted-foreground">
                        This also switches the rule on for <strong>{preflight.cascadeClubCount}</strong> club
                        {preflight.cascadeClubCount === 1 ? "" : "s"} in the district that have no setting of their
                        own, where <strong>{preflight.cascadeAdminsWithNoYears}</strong> club admin
                        {preflight.cascadeAdminsWithNoYears === 1 ? "" : "s"} currently hold no Rotary years.
                      </p>
                    )}

                    {(preflight.noYearsCount > 0 || preflight.cascadeAdminsWithNoYears > 0) && (
                      <label className="flex items-start gap-2 text-sm text-foreground">
                        <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(!!v)} className="mt-0.5" />
                        <span>
                          I understand these admins will lose edit access until they are granted Rotary years.
                        </span>
                      </label>
                    )}
                  </>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>Cancel</Button>
              <Button
                onClick={confirm}
                disabled={
                  saving || preflightLoading ||
                  // A flip to ON must not be confirmable until the check has run, and
                  // not at all while a real lockout is unacknowledged.
                  (!!pending?.enable && pending.kind !== "global" && !preflight) ||
                  (!!preflight && (preflight.noYearsCount > 0 || preflight.cascadeAdminsWithNoYears > 0) && !acknowledged)
                }
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {pending?.enable ? "Switch ON" : "Switch OFF"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
