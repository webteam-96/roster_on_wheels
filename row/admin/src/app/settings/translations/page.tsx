"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { deleteI18nOverride, getI18nOverrides, saveI18nOverride } from "@/services/api";
import type { Messages, Override } from "@/i18n/messages";
import { WORLD_LANGUAGE_CODES } from "@/i18n/worldLanguages";
import { nativeLanguageName } from "@/i18n/config";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";
import common from "../../../../messages/en/common.json";
import errors from "../../../../messages/en/errors.json";
import payments from "../../../../messages/en/payments.json";
import privacy from "../../../../messages/en/privacy.json";

// Super Admin > Translations (ROW Wave 1, build spec item 3). The bundled English is the source; an override
// replaces one string for one locale. A key with no override shows English (or the machine translation).
// shortcut: namespaces listed by hand, add a line here when a messages/en/*.json file is added.
const ENGLISH: Record<string, Messages> = { common, errors, payments, privacy };
const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

function flatten(m: Messages, prefix = ""): [string, string][] {
  return Object.entries(m).flatMap(([k, v]) =>
    typeof v === "string" ? [[prefix + k, v] as [string, string]] : flatten(v, `${prefix}${k}.`));
}

type Filter = "all" | "missing" | "unreviewed";

export default function TranslationsPage() {
  const { isSuperAdmin } = useAuth();
  const [locale, setLocale] = useState("fr");
  const [namespace, setNamespace] = useState("privacy");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<Override[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    setOverrides(null);
    setDrafts({});
    getI18nOverrides(locale).then(setOverrides).catch(() => setErrorMessage("Could not load translations."));
  }, [isSuperAdmin, locale]);

  const rows = useMemo(() => {
    const byKey = new Map((overrides ?? []).filter((o) => o.namespace === namespace).map((o) => [o.key, o]));
    const q = search.trim().toLowerCase();
    return flatten(ENGLISH[namespace])
      .map(([key, english]) => ({ key, english, override: byKey.get(key) }))
      .filter((r) => filter !== "missing" || !r.override)
      .filter((r) => filter !== "unreviewed" || (r.override && !r.override.reviewed))
      .filter((r) => !q || r.key.toLowerCase().includes(q) || r.english.toLowerCase().includes(q) || r.override?.text.toLowerCase().includes(q));
  }, [overrides, namespace, filter, search]);

  function replace(key: string, next: Override | null) {
    setOverrides((list) => [...(list ?? []).filter((o) => !(o.namespace === namespace && o.key === key)), ...(next ? [next] : [])]);
    setDrafts(({ [key]: _, ...rest }) => rest);
  }

  async function save(key: string, text: string, reviewed: boolean) {
    setBusyKey(key);
    try {
      replace(key, await saveI18nOverride(locale, namespace, key, text, reviewed));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Could not save the translation.");
    } finally {
      setBusyKey(null);
    }
  }

  async function reset(key: string) {
    setBusyKey(key);
    try {
      await deleteI18nOverride(locale, namespace, key);
      replace(key, null);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Could not remove the translation.");
    } finally {
      setBusyKey(null);
    }
  }

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings" aria-label="Back to settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Translations</h2>
            <p className="text-muted-foreground text-base">Override any interface string for one language. Empty keys show English.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="locale">Language</Label>
            <select id="locale" className={SELECT} value={locale} onChange={(e) => setLocale(e.target.value)}>
              {WORLD_LANGUAGE_CODES.map((c) => <option key={c} value={c}>{nativeLanguageName(c)} ({c})</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="namespace">Area</Label>
            <select id="namespace" className={SELECT} value={namespace} onChange={(e) => setNamespace(e.target.value)}>
              {Object.keys(ENGLISH).map((ns) => <option key={ns} value={ns}>{ns}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter">Show</Label>
            <select id="filter" className={SELECT} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">All strings</option>
              <option value="missing">No override yet</option>
              <option value="unreviewed">Not reviewed</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="search">Search</Label>
            <Input id="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Key or text" />
          </div>
        </div>

        {overrides == null ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 w-full animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No strings match.</p>}
              {rows.map(({ key, english, override }) => {
                const draft = drafts[key] ?? override?.text ?? "";
                const changed = draft.trim() !== (override?.text ?? "");
                return (
                  <div key={key} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-xs text-muted-foreground">{key}</p>
                      <p className="mt-1 text-sm">{english}</p>
                    </div>
                    <textarea
                      aria-label={`${key} in ${locale}`}
                      className="min-h-[2.5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={draft}
                      placeholder="Uses English"
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {override && (
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox checked={override.reviewed} disabled={busyKey === key}
                            onCheckedChange={(v) => save(key, override.text, v === true)} />
                          Reviewed
                        </label>
                      )}
                      <Button size="sm" disabled={busyKey === key || !changed || !draft.trim()} onClick={() => save(key, draft.trim(), false)}>Save</Button>
                      {override && <Button size="sm" variant="outline" disabled={busyKey === key} onClick={() => reset(key)}>Use English</Button>}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
