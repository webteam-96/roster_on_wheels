"use client";

/**
 * N5 Communication: templates per language for one club or district. A template key has one version per language;
 * greetings, the meeting reminder and campaigns send each member the version in their language (else the club or
 * district language). "Machine translate" fills a new version from an existing one; it stays beta until reviewed.
 */

import { useCallback, useEffect, useState } from "react";
import RichTextEditor from "@/components/RichTextEditor";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import {
  deleteCommTemplate, getCommTemplates, machineTranslate, saveCommTemplate,
  type CommTemplate, type CommsScope,
} from "@/services/api";
import { CAMPAIGN_PLACEHOLDERS, SYSTEM_TEMPLATES, isLanguageCode, isTemplateKey } from "@/lib/comms";
import { btnPrimary, btnSecondary, card, errorOf, input } from "./ui";

interface Draft { templateKey: string; language: string; subject: string; bodyHtml: string; reviewed: boolean; }
const EMPTY: Draft = { templateKey: "", language: "", subject: "", bodyHtml: "", reviewed: true };

export default function TemplatesSection({ scope, id, defaultLanguage }: { scope: CommsScope; id: number; defaultLanguage: string }) {
  const [rows, setRows] = useState<CommTemplate[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [translateFrom, setTranslateFrom] = useState<CommTemplate | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await getCommTemplates(scope, id));
    } catch (e) {
      setError(errorOf(e, "Templates could not be loaded."));
    }
  }, [scope, id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    const key = draft.templateKey.trim().toLowerCase();
    if (!isTemplateKey(key)) return setError("Key: lower-case letters, digits, '-' or '_'.");
    if (!isLanguageCode(draft.language.trim())) return setError("Language must be a code such as en, es or pt-BR.");
    setBusy(true); setError(null); setNotice(null);
    try {
      await saveCommTemplate(scope, id, { ...draft, templateKey: key, language: draft.language.trim() });
      setNotice("Template saved.");
      setDraft(null);
      await load();
    } catch (e) {
      setError(errorOf(e, "The template could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: CommTemplate) => {
    if (!window.confirm(`Delete the ${t.language} version of "${t.templateKey}"?`)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await deleteCommTemplate(scope, id, t.id);
      setNotice("Template deleted.");
      await load();
    } catch (e) {
      setError(errorOf(e, "The template could not be deleted."));
    } finally {
      setBusy(false);
    }
  };

  const translate = async () => {
    if (!translateFrom || !isLanguageCode(target.trim())) return setError("Enter the language code to translate into, such as es.");
    setBusy(true); setError(null); setNotice(null);
    try {
      const [subject, bodyHtml] = await machineTranslate(target.trim(), [translateFrom.subject, translateFrom.bodyHtml]);
      setDraft({ templateKey: translateFrom.templateKey, language: target.trim(), subject, bodyHtml, reviewed: false });
      setTranslateFrom(null);
      setNotice("Machine translation ready below. Check it, then save. It stays marked beta until you tick Reviewed.");
    } catch {
      setError("Machine translation is not available right now.");
    } finally {
      setBusy(false);
    }
  };

  const hint = SYSTEM_TEMPLATES.find((s) => s.key === draft?.templateKey.trim())?.placeholders ?? CAMPAIGN_PLACEHOLDERS;

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Templates</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              One version per language. Each member gets the version in their own language, else the {defaultLanguage} version.
              The keys birthday, anniversary and meeting_reminder are used by greetings and the meeting reminder; any other key
              can be picked when you compose a mass email.
            </p>
          </div>
          <button type="button" className={btnPrimary} onClick={() => { setDraft({ ...EMPTY, language: defaultLanguage }); setError(null); }}>
            New template
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
      </div>

      {translateFrom && (
        <div className={card}>
          <p className="text-sm text-slate-700">
            Machine translate <strong>{translateFrom.templateKey}</strong> ({translateFrom.language}) into:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input aria-label="Target language code" className={`${input} w-28`} placeholder="es" value={target} onChange={(e) => setTarget(e.target.value)} />
            <button type="button" className={btnPrimary} disabled={busy} onClick={translate}>Translate</button>
            <button type="button" className={btnSecondary} onClick={() => setTranslateFrom(null)}>Cancel</button>
          </div>
        </div>
      )}

      {draft && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-slate-800">{rows?.some((r) => r.templateKey === draft.templateKey && r.language === draft.language) ? "Edit template" : "New template"}</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_8rem]">
            <label className="text-sm text-slate-700">
              Key
              <input list="comms-template-keys" className={`${input} mt-1 w-full`} value={draft.templateKey}
                onChange={(e) => setDraft({ ...draft, templateKey: e.target.value })} placeholder="birthday or newsletter-october" />
              <datalist id="comms-template-keys">
                {SYSTEM_TEMPLATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </datalist>
            </label>
            <label className="text-sm text-slate-700">
              Language
              <input className={`${input} mt-1 w-full`} value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} placeholder="en" />
            </label>
          </div>
          <label className="mt-3 block text-sm text-slate-700">
            Subject
            <input className={`${input} mt-1 w-full`} value={draft.subject} maxLength={300} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </label>
          <div className="mt-3 text-sm text-slate-700">
            <span className="mb-1 block">Body</span>
            <RichTextEditor value={draft.bodyHtml} onChange={(v) => setDraft({ ...draft, bodyHtml: v })} height={220} />
            <p className="mt-1 text-xs text-slate-500">Placeholders: {hint}</p>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={draft.reviewed} onChange={(e) => setDraft({ ...draft, reviewed: e.target.checked })} />
            Reviewed by a person (unticked versions are shown as beta)
          </label>
          <div className="mt-4 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={save}>Save template</button>
            <button type="button" className={btnSecondary} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className={card}>
        {rows === null ? (
          <TableSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No templates yet. Greetings and reminders use their standard text until you add one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Key</th>
                  <th className="py-2 pr-3 font-medium">Language</th>
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 font-medium text-slate-800">{t.templateKey}</td>
                    <td className="py-2 pr-3">{t.language}</td>
                    <td className="py-2 pr-3 text-slate-700">{t.subject}</td>
                    <td className="py-2 pr-3">
                      {t.reviewed
                        ? <span className="text-emerald-700">Reviewed</span>
                        : <span className="rounded border border-amber-300 px-1.5 py-0.5 text-xs text-amber-800">Beta: machine translated</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" className="text-sm text-azure hover:underline" onClick={() => { setDraft({ ...t }); setError(null); }}>Edit</button>
                      <button type="button" className="ml-3 text-sm text-azure hover:underline" onClick={() => { setTranslateFrom(t); setTarget(""); }}>Translate</button>
                      <button type="button" className="ml-3 text-sm text-red-700 hover:underline" disabled={busy} onClick={() => remove(t)}>Delete</button>
                    </td>
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
