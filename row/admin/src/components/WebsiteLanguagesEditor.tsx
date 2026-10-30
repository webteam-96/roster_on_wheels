"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  deleteWebsiteTranslation, getWebsiteLanguages, getWebsiteTranslations, saveWebsiteLanguages, saveWebsiteTranslation,
  type WebsiteLanguageSettings, type WebsiteScope, type WebsiteTranslationFields, type WebsiteTranslationItem,
} from "@/services/api";
import { WORLD_LANGUAGE_CODES } from "@/i18n/worldLanguages";
import { nativeLanguageName } from "@/i18n/config";
import { postTranslate } from "@/i18n/postTranslate";
import { translateHtml, translateText, type Translator } from "@/lib/translateHtml";
import RichTextEditor from "@/components/RichTextEditor";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Languages, Plus, X } from "@/components/icons";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const EMPTY: WebsiteTranslationFields = { title: null, body: null, seoTitle: null, seoDescription: null };
const langName = (code: string) => `${nativeLanguageName(code)} (${code})`;
const keyOf = (i: WebsiteTranslationItem) => `${i.type}:${i.id}`;
const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

/** The admin's translate route; `seen.changed` stays false when the provider only echoed the text back. */
function routeTranslator(target: string, source: string, seen: { changed: boolean }): Translator {
  return async (q) => {
    const res = await postTranslate({ target, source, q });
    if (!res.ok) throw new Error("translate failed");
    const out = ((await res.json()) as { translations?: string[] }).translations ?? q;
    if (out.some((t, i) => t !== q[i])) seen.changed = true;
    return out;
  };
}

function itemName(i: WebsiteTranslationItem): string {
  if (i.type === "site") return "Home page and whole site";
  if (i.type === "about") return "About page";
  return i.sourceTitle || "Untitled";
}

function itemKind(i: WebsiteTranslationItem): string | null {
  if (i.type === "page") return i.hasBody ? "Page" : "Menu";
  return i.type === "submenu" ? "Sub-menu" : null;
}

interface Props {
  scope: WebsiteScope;
  ownerId: number;
  /** The back arrow's target when the page was not opened with a ?returnTo= path. */
  fallbackBack: string;
}

/**
 * Website languages (build spec 3.11): the languages the public site offers, and its About page, custom pages,
 * menu labels and search texts in each. The default language's pages stay in About and Menu List; here the default
 * language only gets its search title and description.
 */
export default function WebsiteLanguagesEditor({ scope, ownerId, fallbackBack }: Props) {
  const returnTo = useSearchParams().get("returnTo");
  const back = returnTo && /^\/(?!\/)/.test(returnTo) ? returnTo : fallbackBack;

  const [saved, setSaved] = useState<WebsiteLanguageSettings | null>(null);
  const [draft, setDraft] = useState<WebsiteLanguageSettings | null>(null);
  const [adding, setAdding] = useState("");
  const [language, setLanguage] = useState("");
  const [reload, setReload] = useState(0);
  const [items, setItems] = useState<WebsiteTranslationItem[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [fields, setFields] = useState<WebsiteTranslationFields>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const firstToEdit = (s: WebsiteLanguageSettings) => s.languages.find((l) => l !== s.defaultLanguage) ?? s.defaultLanguage;

  useEffect(() => {
    getWebsiteLanguages(scope, ownerId)
      .then((s) => { setSaved(s); setDraft(s); setLanguage(firstToEdit(s)); })
      .catch((err) => setErrorMessage(apiMessage(err, "Could not load the website languages.")));
  }, [scope, ownerId]);

  useEffect(() => {
    if (!language) return;
    setItems(null);
    setOpenKey(null);
    getWebsiteTranslations(scope, ownerId, language)
      .then(setItems)
      .catch((err) => setErrorMessage(apiMessage(err, "Could not load the texts.")));
  }, [scope, ownerId, language, reload]);

  const isDefault = !!saved && language.toLowerCase() === saved.defaultLanguage.toLowerCase();
  const settingsChanged = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  // Which fields an item has in the language being edited (the server applies the same rules).
  function fieldsFor(i: WebsiteTranslationItem) {
    // shortcut: club themes write their own About heading, so only the district site takes an About title; pass it
    // to the themes' About components if clubs ask for it.
    const title = !isDefault && i.type !== "site" && !(i.type === "about" && scope === "clubs");
    const body = !isDefault && i.hasBody;
    const seo = i.type === "site" || i.type === "about" || (i.type === "page" && i.hasBody);
    return { title, body, seo, any: title || body || seo };
  }

  async function saveSettings() {
    if (!draft) return;
    setBusy("settings");
    try {
      const s = await saveWebsiteLanguages(scope, ownerId, draft);
      setSaved(s);
      setDraft(s);
      if (s.languages.includes(language)) setReload((n) => n + 1);
      else setLanguage(firstToEdit(s));
      setNotice("Languages saved.");
    } catch (err) {
      setErrorMessage(apiMessage(err, "Could not save the languages."));
    } finally {
      setBusy(null);
    }
  }

  function open(i: WebsiteTranslationItem) {
    setOpenKey(keyOf(i));
    setFields({ title: i.title, body: i.body, seoTitle: i.seoTitle, seoDescription: i.seoDescription });
    setNotice(null);
  }

  function replaceItem(i: WebsiteTranslationItem, next: WebsiteTranslationFields) {
    setItems((list) => list?.map((x) => (keyOf(x) === keyOf(i) ? { ...x, ...next } : x)) ?? null);
    setOpenKey(null);
  }

  async function saveItem(i: WebsiteTranslationItem) {
    setBusy(keyOf(i));
    try {
      await saveWebsiteTranslation(scope, ownerId, language, i.type, i.id, fields);
      replaceItem(i, fields);
      setNotice(`${itemName(i)} saved.`);
    } catch (err) {
      setErrorMessage(apiMessage(err, "Could not save the translation."));
    } finally {
      setBusy(null);
    }
  }

  async function removeItem(i: WebsiteTranslationItem) {
    setBusy(keyOf(i));
    try {
      await deleteWebsiteTranslation(scope, ownerId, language, i.type, i.id);
      replaceItem(i, EMPTY);
      setNotice(`${itemName(i)}: translation removed. The site shows the default text.`);
    } catch (err) {
      setErrorMessage(apiMessage(err, "Could not remove the translation."));
    } finally {
      setBusy(null);
    }
  }

  async function machineTranslate(i: WebsiteTranslationItem) {
    if (!saved) return;
    const f = fieldsFor(i);
    const seen = { changed: false };
    const t = routeTranslator(language, saved.defaultLanguage.split("-")[0], seen);
    setBusy(keyOf(i));
    try {
      const [title, body, seoTitle, seoDescription] = await Promise.all([
        f.title && i.sourceTitle ? translateText(i.sourceTitle, t) : fields.title,
        f.body && i.sourceBody ? translateHtml(i.sourceBody, t) : fields.body,
        f.seo && i.sourceSeoTitle ? translateText(i.sourceSeoTitle, t) : fields.seoTitle,
        f.seo && i.sourceSeoDescription ? translateText(i.sourceSeoDescription, t) : fields.seoDescription,
      ]);
      setFields({ title, body, seoTitle, seoDescription });
      setNotice(seen.changed
        ? "Machine translated. Read it through and correct it, then save."
        : "The translation service sent the text back unchanged. Try again later or type the translation.");
    } catch {
      setErrorMessage("The translation service did not answer. Try again later or type the translation.");
    } finally {
      setBusy(null);
    }
  }

  const visible = (items ?? []).filter((i) => fieldsFor(i).any);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" asChild>
          <Link href={back} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Website languages</h2>
          <p className="text-muted-foreground text-base">
            Visitors pick a language on the public site. Pages without a translation show the default language.
          </p>
        </div>
      </div>

      {notice && <p role="status" className="rounded-md border bg-muted/40 px-4 py-2 text-sm">{notice}</p>}

      <Card>
        <CardContent className="space-y-4 p-6">
          <h3 className="text-base font-semibold">Languages</h3>
          {!draft ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1].map((n) => <div key={n} className="h-10 w-full animate-pulse rounded-md bg-muted" />)}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="default-language">Default language</Label>
                  <select id="default-language" className={SELECT} value={draft.defaultLanguage}
                    onChange={(e) => setDraft({ ...draft, defaultLanguage: e.target.value })}>
                    {draft.languages.map((c) => <option key={c} value={c}>{langName(c)}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground">The language your About page and pages are written in.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-language">Add a language</Label>
                  <div className="flex flex-wrap gap-2">
                    <select id="add-language" className={SELECT} value={adding} onChange={(e) => setAdding(e.target.value)}>
                      <option value="">Choose a language</option>
                      {WORLD_LANGUAGE_CODES.filter((c) => !draft.languages.includes(c)).map((c) => (
                        <option key={c} value={c}>{langName(c)}</option>
                      ))}
                    </select>
                    <Button type="button" variant="outline" disabled={!adding}
                      onClick={() => { setDraft({ ...draft, languages: [...draft.languages, adding] }); setAdding(""); }}>
                      <Plus className="mr-1 h-4 w-4" /> Add
                    </Button>
                  </div>
                </div>
              </div>
              <ul className="flex flex-wrap gap-2" aria-label="Languages on the website">
                {draft.languages.map((c) => (
                  <li key={c} className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm">
                    {langName(c)}
                    {c === draft.defaultLanguage ? (
                      <span className="text-xs text-muted-foreground">default</span>
                    ) : (
                      <button type="button" className="ml-1 rounded p-0.5 hover:bg-muted" aria-label={`Remove ${langName(c)}`}
                        onClick={() => setDraft({ ...draft, languages: draft.languages.filter((l) => l !== c) })}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <Button disabled={!settingsChanged || busy === "settings"} onClick={saveSettings}>
                {busy === "settings" ? "Saving" : "Save languages"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h3 className="text-base font-semibold">Texts</h3>
            {saved && (
              <div className="w-full space-y-2 sm:w-72">
                <Label htmlFor="edit-language">Language to edit</Label>
                <select id="edit-language" className={SELECT} value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {saved.languages.map((c) => (
                    <option key={c} value={c}>{langName(c)}{c === saved.defaultLanguage ? ", default" : ""}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {saved && saved.languages.length < 2 && (
            <p className="text-sm text-muted-foreground">Add a second language above to translate the site.</p>
          )}
          {isDefault && (
            <p className="text-sm text-muted-foreground">
              In the default language you set the search title and description. Edit the pages themselves in About and Menu List.
            </p>
          )}

          {items == null ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3].map((n) => <div key={n} className="h-14 w-full animate-pulse rounded-md bg-muted" />)}
            </div>
          ) : (
            <ul className="divide-y rounded-md border">
              {visible.map((i) => {
                const f = fieldsFor(i);
                const isOpen = openKey === keyOf(i);
                const done = !!(i.title || i.body || i.seoTitle || i.seoDescription);
                const hasSource = !!((f.title && i.sourceTitle) || (f.body && i.sourceBody) || (f.seo && (i.sourceSeoTitle || i.sourceSeoDescription)));
                return (
                  <li key={keyOf(i)} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium" data-no-translate>{itemName(i)}</p>
                        <p className="text-xs text-muted-foreground">
                          {[itemKind(i), done ? "Translated" : isDefault ? "No search text yet" : "Not translated, shows the default"].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {!isOpen && <Button size="sm" variant="outline" onClick={() => open(i)}>Edit</Button>}
                    </div>

                    {isOpen && (
                      <div className="mt-4 space-y-4">
                        {!isDefault && (
                          <div data-no-translate className="rounded-md border bg-muted/40 p-3 text-sm">
                            <p className="text-xs font-medium text-muted-foreground">Default language: {langName(saved?.defaultLanguage ?? "")}</p>
                            {f.title && i.sourceTitle && <p className="mt-1 font-medium">{i.sourceTitle}</p>}
                            {f.body && (i.sourceBody
                              // sanitised by the API (PublicHtml.Clean)
                              ? <div className="mt-2 max-h-48 space-y-2 overflow-y-auto" dangerouslySetInnerHTML={{ __html: i.sourceBody }} />
                              : <p className="mt-1 text-muted-foreground">No text in the default language yet.</p>)}
                          </div>
                        )}
                        {f.title && (
                          <div className="space-y-2">
                            <Label htmlFor={`title-${keyOf(i)}`}>{i.type === "about" ? "Page heading" : i.type === "page" && i.hasBody ? "Menu label and page title" : "Menu label"}</Label>
                            <Input id={`title-${keyOf(i)}`} maxLength={200} value={fields.title ?? ""}
                              onChange={(e) => setFields({ ...fields, title: e.target.value })} />
                          </div>
                        )}
                        {f.body && (
                          <div className="space-y-2">
                            <Label>Page text</Label>
                            <RichTextEditor value={fields.body ?? ""} onChange={(v) => setFields({ ...fields, body: v })} />
                          </div>
                        )}
                        {f.seo && (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`seo-title-${keyOf(i)}`}>Search title</Label>
                              <Input id={`seo-title-${keyOf(i)}`} maxLength={200} value={fields.seoTitle ?? ""}
                                onChange={(e) => setFields({ ...fields, seoTitle: e.target.value })} />
                              <p className="text-xs text-muted-foreground">{(fields.seoTitle ?? "").length}/200. Search engines show about 60 characters.</p>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`seo-desc-${keyOf(i)}`}>Search description</Label>
                              <Textarea id={`seo-desc-${keyOf(i)}`} maxLength={500} rows={3} value={fields.seoDescription ?? ""}
                                onChange={(e) => setFields({ ...fields, seoDescription: e.target.value })} />
                              <p className="text-xs text-muted-foreground">{(fields.seoDescription ?? "").length}/500. Search engines show about 160 characters.</p>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {!isDefault && (
                            <Button variant="outline" disabled={!hasSource || busy === keyOf(i)} onClick={() => machineTranslate(i)}>
                              <Languages className="mr-1 h-4 w-4" /> Machine translate this page
                            </Button>
                          )}
                          <Button disabled={busy === keyOf(i)} onClick={() => saveItem(i)}>Save</Button>
                          {done && (
                            <Button variant="outline" disabled={busy === keyOf(i)} onClick={() => removeItem(i)}>Remove translation</Button>
                          )}
                          <Button variant="ghost" disabled={busy === keyOf(i)} onClick={() => setOpenKey(null)}>Close</Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}
