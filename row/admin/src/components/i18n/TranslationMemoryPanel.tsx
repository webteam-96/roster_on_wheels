"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import Pagination from "@/components/Pagination";
import { getErrorMessage } from "@/lib/errors";
import { useTranslations } from "next-intl";
import {
  deleteTranslationMemory,
  getTranslationMemory,
  saveTranslationCorrection,
  type TranslationMemoryPage,
  type TranslationMemoryRow,
} from "@/services/api";

const PAGE_SIZE = 25;

/**
 * Super Admin > Translations: machine translations stored by the localization service. A correction replaces the
 * machine text on web, app and server messages; removing a row sends the text back to machine translation.
 */
export default function TranslationMemoryPanel({ locale }: { locale: string }) {
  const tRoot = useTranslations();
  const [data, setData] = useState<TranslationMemoryPage | null>(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [correctionsOnly, setCorrectionsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getTranslationMemory({ locale, search: applied || undefined, correctionsOnly, page, pageSize: PAGE_SIZE }));
    } catch (e) {
      setError(getErrorMessage(e, tRoot));
    }
  }, [locale, applied, correctionsOnly, page, tRoot]);

  useEffect(() => { void load(); }, [load]);

  const run = async (row: TranslationMemoryRow, call: () => Promise<void>) => {
    setBusy(row.hash);
    setError(null);
    try {
      await call();
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== row.hash)));
      await load();
    } catch (e) {
      setError(getErrorMessage(e, tRoot));
    } finally {
      setBusy(null);
    }
  };

  const usage = data && (data.monthlyLimit > 0
    ? `${data.monthChars.toLocaleString()} of ${data.monthlyLimit.toLocaleString()} characters used this month`
    : `${data.monthChars.toLocaleString()} characters used this month`);

  return (
    <section className="space-y-4" aria-labelledby="translation-memory-title">
      <div>
        <h3 id="translation-memory-title" className="text-xl font-semibold text-primary">Machine translations</h3>
        <p className="text-sm text-muted-foreground">
          Text translated for web and app. Correct a translation here and every screen uses your wording.
        </p>
        {data && (
          <p className="mt-1 text-sm text-foreground" role="status">
            {data.configured ? `Provider: ${data.provider}. ${usage}.` : "No translation provider is set, so new text stays in English."}
          </p>
        )}
      </div>

      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(search.trim()); }}
      >
        <Input
          aria-label="Search translations"
          placeholder="Search English or translated text"
          className="h-10 w-full sm:max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit" variant="outline">Search</Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={correctionsOnly}
            onChange={(e) => { setPage(1); setCorrectionsOnly(e.target.checked); }}
          />
          Corrections only
        </label>
      </form>

      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}

      {!data ? (
        !error && (
          <div className="space-y-3" aria-busy="true">
            <div className="h-16 animate-pulse rounded-xl bg-[color:var(--row-cream-2)]" />
            <div className="h-16 animate-pulse rounded-xl bg-[color:var(--row-cream-2)]" />
          </div>
        )
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {data.rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No translations yet for this language.</p>}
            {data.rows.map((row) => {
              const draft = drafts[row.hash] ?? row.text;
              const changed = draft.trim() !== row.text;
              return (
                <div key={row.hash} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" data-no-translate>
                  <div className="min-w-0">
                    <p className="text-sm">{row.source}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{row.isOverride ? "Your correction" : `Machine: ${row.provider ?? "unknown"}`}</p>
                  </div>
                  <textarea
                    aria-label={`Translation of ${row.source}`}
                    className="min-h-[2.5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.hash]: e.target.value }))}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={busy === row.hash || !changed || !draft.trim()}
                      onClick={() => run(row, () => saveTranslationCorrection(locale, row.source, draft.trim()))}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === row.hash}
                      onClick={() => run(row, () => deleteTranslationMemory(locale, row.hash))}
                    >
                      Translate again
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {data && data.total > PAGE_SIZE && (
        <Pagination page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} totalCount={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}
    </section>
  );
}
