"use client";

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
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, CalendarClock, Plus, Trash2, Loader2, AlertTriangle, ShieldCheck, ShieldOff, Eye, RotateCcw } from "@/components/icons";
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

  const clearOverride = async (row: YearRuleScopeOverride) => {
    const isClub = row.clubId > 0;
    const label = isClub ? (row.clubName ?? `Club ${row.clubId}`) : `District ${row.districtNumber ?? row.districtId}`;
    const falls = isClub ? "its district" : "the platform default";
    if (!window.confirm(`Remove the setting for ${label}? It will follow ${falls} from now on.`)) return;
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
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1">
        <ShieldCheck className="h-3 w-3" /> Year rule ON
      </Badge>
    ) : (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 gap-1">
        <ShieldOff className="h-3 w-3" /> Year rule OFF
      </Badge>
    );

  if (loading) return <ProtectedRoute requireSuperAdmin><div className="p-8"><RotaryLoader /></div></ProtectedRoute>;

  const globalOn = settings?.globalEnabled ?? true;

  const overrideTable = (rows: YearRuleScopeOverride[], kind: "district" | "club") => (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3 text-left">{kind === "club" ? "Club" : "District"}</th>
            {kind === "club" && <th className="px-4 py-3 text-left">District</th>}
            <th className="px-4 py-3 text-left">Setting</th>
            <th className="px-4 py-3 text-left">Last changed</th>
            <th className="px-4 py-3 text-right">Remove</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={kind === "club" ? 5 : 4} className="px-4 py-6 text-center text-slate-500">
                No {kind === "club" ? "club" : "district"} has its own setting, every one follows{" "}
                {kind === "club" ? "its district" : "the platform default"}.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const id = kind === "club" ? r.clubId : r.districtId;
            const label = kind === "club" ? (r.clubName ?? `Club ${r.clubId}`) : `District ${r.districtNumber ?? r.districtId}`;
            return (
              <tr key={`${kind}-${id}`} className="hover:bg-slate-50/70">
                <td className="px-4 py-3 font-medium text-slate-800">{label}</td>
                {kind === "club" && <td className="px-4 py-3 text-slate-600">{r.districtNumber ?? "-"}</td>}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={r.isEnabled}
                      disabled={saving}
                      onCheckedChange={(v) => ask({ kind, id, label, enable: v })}
                    />
                    <StateBadge on={r.isEnabled} />
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {r.modifiedDate ?? "-"}
                  {r.modifiedByName ? <div className="text-xs text-slate-400">by {r.modifiedByName}</div> : null}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" disabled={saving} onClick={() => clearOverride(r)}>
                    <Trash2 className="h-4 w-4 text-slate-500" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <ProtectedRoute requireSuperAdmin>
      <div className="p-4 md:p-8 space-y-6 max-w-6xl">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Settings</Button>
          </Link>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Year-wise Admin Rights</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Choose which districts and clubs the Rotary-year rule applies to. Where it is OFF,
              an admin of that club or district can add, edit and delete in any year, exactly as
              the platform worked before this rule existed. It never gives anyone admin access
              they did not already have, and viewing is never restricted either way.
            </p>
          </div>
        </div>

        <SuccessAlert open={!!success} title="Saved" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Something went wrong" description={error ?? ""} onOk={() => setError(null)} />

        {/* ── Platform default ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Default for the whole platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4">
              <Switch checked={globalOn} disabled={saving} onCheckedChange={(v) => ask({ kind: "global", enable: v })} />
              <StateBadge on={globalOn} />
              {settings?.globalModifiedDate && (
                <span className="text-xs text-slate-400">
                  changed {settings.globalModifiedDate}
                  {settings.globalModifiedByName ? ` by ${settings.globalModifiedByName}` : ""}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600">
              {globalOn
                ? "Every district and club follows the year rule unless it is switched off below."
                : "The year rule is off everywhere by default. Only the districts and clubs switched on below enforce it."}
            </p>
          </CardContent>
        </Card>

        {/* ── Districts ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Districts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={addDistrictId} onValueChange={setAddDistrictId}>
                <SelectTrigger className="w-[260px]"><SelectValue placeholder="Choose a district…" /></SelectTrigger>
                <SelectContent>
                  {addableDistricts.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>District {d.districtNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!addDistrictId || saving}
                onClick={() => {
                  const d = districtOptions.find((x) => String(x.id) === addDistrictId);
                  if (d) ask({ kind: "district", id: d.id, label: `District ${d.districtNumber}`, enable: true });
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Switch rule ON for this district
              </Button>
            </div>
            {overrideTable(settings?.districts ?? [], "district")}
            <p className="text-xs text-slate-500">
              A district setting also covers every club in it, except clubs with a setting of their own below.
            </p>
          </CardContent>
        </Card>

        {/* ── Clubs ──────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Clubs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={clubPickerDistrictId} onValueChange={setClubPickerDistrictId}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="District…" /></SelectTrigger>
                <SelectContent>
                  {districtOptions.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>District {d.districtNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={addClubId} onValueChange={setAddClubId} disabled={!clubPickerDistrictId || loadingClubs}>
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder={loadingClubs ? "Loading clubs…" : "Choose a club…"} />
                </SelectTrigger>
                <SelectContent>
                  {addableClubs.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!addClubId || saving}
                onClick={() => {
                  const c = clubOptions.find((x) => String(x.id) === addClubId);
                  if (c) ask({ kind: "club", id: c.id, label: c.clubName, enable: true });
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Switch rule ON for this club
              </Button>
            </div>
            {overrideTable(settings?.clubs ?? [], "club")}
            <p className="text-xs text-slate-500">
              A club setting beats its district&apos;s, so one club can enforce the rule inside a district
              that does not, or be exempted from a district that does.
            </p>
          </CardContent>
        </Card>

        {/* ── The "View only" wording ────────────────────────────────────── */}
        {messageSettings && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-4 w-4 text-amber-600" />
                The &quot;View only&quot; wording
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm text-slate-600">
                What an admin reads where the year rule has taken Add, Edit and Delete away.
                One wording for the whole platform, the web and the mobile app both show it,
                from the next sign-in or app open.
              </p>

              {/* The tokens, before the boxes: nobody should have to discover them by
                  having a save refused. */}
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-700 mb-2">
                  Placeholders, type them exactly, and they are filled in for each reader
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {messageSettings.tokens.map((t) => (
                    <div key={t.token} className="text-xs text-slate-600">
                      <code className="rounded bg-card px-1 py-0.5 font-mono text-[11px] text-amber-700 border border-slate-200">
                        {t.token}
                      </code>{" "}
                      {t.describes}
                      <span className="text-slate-400">, otherwise &ldquo;{t.fallback}&rdquo;</span>
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
                  <div key={m.key} className="space-y-2 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{label.title}</span>
                      {m.isCustom ? (
                        <Badge variant="secondary" className="text-[10px]">Edited</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-slate-500">Default</Badge>
                      )}
                      {m.isCustom && m.modifiedDate && (
                        <span className="text-xs text-slate-400">
                          {m.modifiedDate}
                          {m.modifiedByName ? ` by ${m.modifiedByName}` : ""}
                        </span>
                      )}
                    </div>
                    {label.help && <p className="text-xs text-slate-500">{label.help}</p>}

                    <Textarea
                      value={draft}
                      rows={m.key === "default_actions" ? 1 : 2}
                      disabled={busy}
                      onChange={(e) => setDrafts((d) => ({ ...d, [m.key]: e.target.value }))}
                      className="text-sm"
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
            </CardContent>
          </Card>
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
              <p className="text-sm text-slate-600">
                Admins of {pending.kind === "global" ? "every district and club without its own setting" : pending.label}{" "}
                will be able to add, edit and delete in <strong>any Rotary year</strong>. Nobody loses access, and
                nobody becomes an admin who was not one already.
              </p>
            )}

            {pending?.enable && pending.kind === "global" && (
              <p className="text-sm text-slate-600">
                Every district and club without its own setting will start enforcing the year rule. Admins
                who hold no Rotary years will lose their edit buttons there. Because this covers the whole
                platform it is not checked district by district, switch districts on one at a time if you
                want to see who is affected first.
              </p>
            )}

            {pending?.enable && pending.kind !== "global" && (
              <div className="space-y-3">
                {preflightLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking who is affected…
                  </div>
                )}

                {preflight && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="text-lg font-semibold text-slate-800">{preflight.allYearsCount}</div>
                        <div className="text-xs text-slate-500">hold all years, unaffected</div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="text-lg font-semibold text-slate-800">{preflight.someYearsCount}</div>
                        <div className="text-xs text-slate-500">will be limited to their own years</div>
                      </div>
                      <div className={`rounded-lg border p-3 ${preflight.noYearsCount > 0 ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
                        <div className={`text-lg font-semibold ${preflight.noYearsCount > 0 ? "text-red-700" : "text-slate-800"}`}>
                          {preflight.noYearsCount}
                        </div>
                        <div className="text-xs text-slate-500">hold no years, lose every edit button</div>
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
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="text-sm font-medium text-slate-700">Will be limited to:</div>
                        <ul className="mt-2 space-y-1 text-sm text-slate-600">
                          {preflight.admins.filter((a) => !a.wouldLoseAccess && !a.allYears).map((a) => (
                            <li key={a.memberId}>• {a.memberName}: {a.years.join(", ")}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {pending.kind === "district" && preflight.cascadeClubCount > 0 && (
                      <p className="text-xs text-slate-500">
                        This also switches the rule on for <strong>{preflight.cascadeClubCount}</strong> club
                        {preflight.cascadeClubCount === 1 ? "" : "s"} in the district that have no setting of their
                        own, where <strong>{preflight.cascadeAdminsWithNoYears}</strong> club admin
                        {preflight.cascadeAdminsWithNoYears === 1 ? "" : "s"} currently hold no Rotary years.
                      </p>
                    )}

                    {(preflight.noYearsCount > 0 || preflight.cascadeAdminsWithNoYears > 0) && (
                      <label className="flex items-start gap-2 text-sm text-slate-700">
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
