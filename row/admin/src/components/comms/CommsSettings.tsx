"use client";

/**
 * N5 Communication settings for one club or district (build spec 3.10, B.1 #24-25): monthly email allowance and
 * campaign results, templates per language, sender profile and domains, bounces and opt-outs, the club or district
 * language and, for a district, the Governor's note on club greetings. Off until Settings > Features turns on
 * "communication"; managers of the club or district only (the API checks it too).
 */

import { useCallback, useEffect, useState } from "react";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { KpiTileSkeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import {
  deleteCommSuppression, getCommOptOuts, getCommSettings, getCommSuppressions, getCommUsage, saveCommSettings,
  uploadMassEmailImage, type CommOptOut, type CommSettings, type CommSuppression, type CommUsage, type CommsScope,
} from "@/services/api";
import { appLocale } from "@/lib/appFormat";
import { currentMonth, isGivingUrl, isLanguageCode, rate } from "@/lib/comms";
import TemplatesSection from "./TemplatesSection";
import SenderSection from "./SenderSection";
import { btnPrimary, btnSecondary, card, errorOf, input } from "./ui";

type Tab = "usage" | "templates" | "sender" | "bounces" | "language";
const TABS: { key: Tab; label: string }[] = [
  { key: "usage", label: "Usage" },
  { key: "templates", label: "Templates" },
  { key: "sender", label: "Sender" },
  { key: "bounces", label: "Bounces and opt-outs" },
  { key: "language", label: "Language and greetings" },
];

const date = (s: string | null) => (s ? new Date(s).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "-");

export default function CommsSettings({ scope, id }: { scope: CommsScope; id: number }) {
  const on = useFeatureLoadedOn("communication");
  const [tab, setTab] = useState<Tab>("usage");
  const [settings, setSettings] = useState<CommSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!on || !id) return;
    getCommSettings(scope, id).then(setSettings).catch((e) => setError(errorOf(e, "Settings could not be loaded.")));
  }, [on, scope, id]);

  if (!id) return null;

  return (
    <div className="space-y-4">
      <div className={card}>
        <h1 className="text-lg font-semibold text-slate-800">Email settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Allowance, templates in each language, your sender address, bounces and opt-outs for this {scope === "clubs" ? "club" : "district"}.
        </p>
        <div role="tablist" className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={tab === t.key ? "rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-cream" : btnSecondary}>
              {t.label}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div>

      {!settings ? (
        <div className={card}><TableSkeleton rows={4} /></div>
      ) : tab === "usage" ? (
        <UsageSection scope={scope} id={id} />
      ) : tab === "templates" ? (
        <TemplatesSection scope={scope} id={id} defaultLanguage={settings.effectiveLanguage} />
      ) : tab === "sender" ? (
        <SenderSection scope={scope} id={id} settings={settings} onSaved={setSettings} />
      ) : tab === "bounces" ? (
        <BouncesSection scope={scope} id={id} />
      ) : (
        <LanguageSection scope={scope} id={id} settings={settings} onSaved={setSettings} />
      )}
    </div>
  );
}

function UsageSection({ scope, id }: { scope: CommsScope; id: number }) {
  const [month, setMonth] = useState(currentMonth);
  const [usage, setUsage] = useState<CommUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUsage(null);
    setError(null);
    if (month) getCommUsage(scope, id, month).then(setUsage).catch((e) => setError(errorOf(e, "Usage could not be loaded.")));
  }, [scope, id, month]);

  const tiles: [string, string][] = usage ? [
    ["Monthly allowance", usage.allowance === null ? "Not limited" : usage.allowance.toLocaleString(appLocale())],
    ["Sent this month", usage.used.toLocaleString(appLocale())],
    ["Left", usage.remaining === null ? "Not limited" : usage.remaining.toLocaleString(appLocale())],
  ] : [];

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Email allowance</h2>
            <p className="mt-1 text-sm text-slate-500">
              {usage?.perMember
                ? `${usage.perMember} emails per member per month (${usage.members} members, edition ${usage.edition}). A mass email that needs more than what is left is not sent.`
                : "Mass emails sent this month and how they did."}
            </p>
          </div>
          <label className="text-sm text-slate-700">
            Month
            <input type="month" className={`${input} mt-1 block`} value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {usage
            ? tiles.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
              </div>
            ))
            : [0, 1, 2].map((i) => <KpiTileSkeleton key={i} />)}
        </div>
      </div>

      <div className={card}>
        <h2 className="text-base font-semibold text-slate-800">Mass emails this month</h2>
        {!usage ? (
          <TableSkeleton rows={3} />
        ) : usage.campaigns.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No mass email was sent in this month.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium">Sent on</th>
                  <th className="py-2 pr-3 text-right font-medium">Sent</th>
                  <th className="py-2 pr-3 text-right font-medium">Delivered</th>
                  <th className="py-2 pr-3 text-right font-medium">Opened</th>
                  <th className="py-2 pr-3 text-right font-medium">Clicked</th>
                  <th className="py-2 pr-3 text-right font-medium">Bounced</th>
                  <th className="py-2 text-right font-medium">Skipped</th>
                </tr>
              </thead>
              <tbody>
                {usage.campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 text-slate-800">{c.subject}</td>
                    <td className="py-2 pr-3">{date(c.sentDate)}</td>
                    <td className="py-2 pr-3 text-right">{c.sent}</td>
                    <td className="py-2 pr-3 text-right">{c.delivered}</td>
                    <td className="py-2 pr-3 text-right">{c.opened} ({rate(c.opened, c.sent)})</td>
                    <td className="py-2 pr-3 text-right">{c.clicked} ({rate(c.clicked, c.sent)})</td>
                    <td className="py-2 pr-3 text-right">{c.bounced + c.complaints}</td>
                    <td className="py-2 text-right">{c.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BouncesSection({ scope, id }: { scope: CommsScope; id: number }) {
  const [suppressions, setSuppressions] = useState<CommSuppression[] | null>(null);
  const [optOuts, setOptOuts] = useState<CommOptOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    getCommSuppressions(scope, id).then(setSuppressions).catch((e) => setError(errorOf(e, "Bounces could not be loaded.")));
    getCommOptOuts(scope, id).then(setOptOuts).catch((e) => setError(errorOf(e, "Opt-outs could not be loaded.")));
  }, [scope, id]);

  useEffect(() => { load(); }, [load]);

  const lift = async (s: CommSuppression) => {
    if (!window.confirm(`Send to ${s.email} again? Only do this when the address works again.`)) return;
    setError(null); setNotice(null);
    try {
      await deleteCommSuppression(scope, id, s.id);
      setNotice("The address will receive mass emails again.");
      load();
    } catch (e) {
      setError(errorOf(e, "The address could not be released."));
    }
  };

  const reasons: Record<string, string> = {
    hard_bounce: "Bounced", invalid: "Invalid address", blocked: "Blocked by the provider", complaint: "Marked as spam", unsubscribed: "Unsubscribed at the provider",
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="text-base font-semibold text-slate-800">Suppressed addresses</h2>
        <p className="mt-1 text-sm text-slate-500">Addresses that bounced or reported spam. Mass emails skip them automatically.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
        {!suppressions ? (
          <TableSkeleton rows={3} />
        ) : suppressions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No suppressed addresses.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {suppressions.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 text-slate-800">{s.email}</td>
                  <td className="py-2 pr-3">{reasons[s.reason] ?? s.reason}</td>
                  <td className="py-2 pr-3">{date(s.createdDate)}</td>
                  <td className="py-2 text-right">
                    <button type="button" className="text-sm text-azure hover:underline" onClick={() => lift(s)}>Send again</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={card}>
        <h2 className="text-base font-semibold text-slate-800">Members who opted out</h2>
        <p className="mt-1 text-sm text-slate-500">Members choose this themselves, from the unsubscribe link or in the app.</p>
        {!optOuts ? (
          <TableSkeleton rows={3} />
        ) : optOuts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nobody has opted out.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {optOuts.map((o) => (
                <tr key={`${o.memberId}-${o.channel}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 text-slate-800">{o.memberName ?? `Member ${o.memberId}`}</td>
                  <td className="py-2 pr-3">{o.channel === "email" ? "Email" : "App notifications"}</td>
                  <td className="py-2 pr-3">{date(o.changedAtUtc)}</td>
                  <td className="py-2 text-slate-500">{o.source === "unsubscribe_link" ? "Unsubscribe link" : "App"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LanguageSection({ scope, id, settings, onSaved }: {
  scope: CommsScope; id: number; settings: CommSettings; onSaved: (s: CommSettings) => void;
}) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const district = scope === "districts";

  const save = async () => {
    const lang = form.defaultLanguage?.trim() || null;
    if (lang && !isLanguageCode(lang)) return setError("Language must be a code such as en, es or pt-BR.");
    const giving = form.foundationGivingUrl?.trim() || null;
    if (giving && !isGivingUrl(giving)) return setError("The Foundation giving link must be a full https:// address.");
    setBusy(true); setError(null); setNotice(null);
    try {
      const saved = await saveCommSettings(scope, id, { ...form, defaultLanguage: lang, foundationGivingUrl: giving });
      onSaved(saved);
      setForm(saved);
      setNotice("Saved.");
    } catch (e) {
      setError(errorOf(e, "The settings could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const { url } = await uploadMassEmailImage(file, file.name);
      setForm((f) => ({ ...f, governorPhotoUrl: url }));
    } catch (e) {
      setError(errorOf(e, "The photo could not be uploaded."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <h2 className="text-base font-semibold text-slate-800">Language</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Members get templates in the language on their profile. Members without one get this language
        {district ? "" : " (blank: the district's language)"}. Now: {settings.effectiveLanguage}.
      </p>
      <input aria-label="Language code" className={`${input} mt-3 w-32`} placeholder="en" value={form.defaultLanguage ?? ""}
        onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value })} />

      {district && (
        <div className="mt-6 border-t border-slate-200 pt-5">
          <h2 className="text-base font-semibold text-slate-800">Governor&apos;s note on club greetings</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            When on, every club birthday and anniversary email in the district ends with this note, the Governor&apos;s
            name and photo. The club president&apos;s signature stays.
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.governorNoteEnabled} onChange={(e) => setForm({ ...form, governorNoteEnabled: e.target.checked })} />
            Add the Governor&apos;s note to club greetings
          </label>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Governor&apos;s name
              <input className={`${input} mt-1 w-full`} maxLength={150} value={form.governorName ?? ""}
                onChange={(e) => setForm({ ...form, governorName: e.target.value })} />
            </label>
            <div className="text-sm text-slate-700">
              Photo
              <div className="mt-1 flex items-center gap-3">
                {form.governorPhotoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.governorPhotoUrl} alt="Governor" className="h-12 w-12 rounded-full border border-slate-200 object-cover" />
                )}
                <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Governor photo"
                  onChange={(e) => upload(e.target.files?.[0])} className="text-sm" />
                {form.governorPhotoUrl && (
                  <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => setForm({ ...form, governorPhotoUrl: null })}>Remove</button>
                )}
              </div>
            </div>
          </div>
          <label className="mt-3 block text-sm text-slate-700">
            Note
            <textarea className={`${input} mt-1 w-full`} rows={4} maxLength={1000} value={form.governorMessage ?? ""}
              onChange={(e) => setForm({ ...form, governorMessage: e.target.value })} />
          </label>

          <h2 className="mt-6 text-base font-semibold text-slate-800">Foundation giving link</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Birthday and anniversary templates show it where they contain {"{{foundation_link}}"}, and membership milestone
            messages add it. Clubs use their district&apos;s link. Leave it empty for no link.
          </p>
          <input aria-label="Foundation giving link" className={`${input} mt-3 w-full max-w-xl`} placeholder="https://" maxLength={500}
            value={form.foundationGivingUrl ?? ""} onChange={(e) => setForm({ ...form, foundationGivingUrl: e.target.value })} />
        </div>
      )}

      <button type="button" className={`${btnPrimary} mt-4`} disabled={busy} onClick={save}>Save</button>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
    </div>
  );
}
