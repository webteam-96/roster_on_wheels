"use client";

// Settings > Help centre (competitor gap 2026-11-19): Super Admin writes the public help articles shown on the ROW
// website (/help), in the app's Help screen and behind the admin's contextual Help link.

import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { AlertTriangle, Plus, Pencil, Trash2 } from "@/components/icons";
import { useFormat } from "@/hooks/useFormat";
import {
  deleteHelpArticle, deleteHelpCategory, getHelpArticles, getHelpCategories, saveHelpCategory,
  type HelpArticleRow, type HelpCategory,
} from "@/services/api";
import { helpArticleUrl } from "@/lib/helpCentre";

const message = (e: unknown, fallback: string): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

interface CategoryDraft { id: number | null; name: string; slug: string; description: string; sortOrder: number }
const EMPTY_CATEGORY: CategoryDraft = { id: null, name: "", slug: "", description: "", sortOrder: 0 };

export default function HelpCentreSettingsPage() {
  const { isSuperAdmin } = useAuth();
  const fmt = useFormat();
  const [articles, setArticles] = useState<HelpArticleRow[] | null>(null);
  const [categories, setCategories] = useState<HelpCategory[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  // The app's own confirm dialog, like every other delete (was the browser's window.confirm).
  const [deleting, setDeleting] = useState<HelpArticleRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadArticles = useCallback(() => {
    getHelpArticles(q, status).then(setArticles).catch((e) => { setError(message(e, "Could not load articles.")); setArticles([]); });
  }, [q, status]);
  const loadCategories = useCallback(() => {
    getHelpCategories().then(setCategories).catch((e) => { setError(message(e, "Could not load categories.")); setCategories([]); });
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const t = setTimeout(loadArticles, 250);
    return () => clearTimeout(t);
  }, [isSuperAdmin, loadArticles]);
  useEffect(() => { if (isSuperAdmin) loadCategories(); }, [isSuperAdmin, loadCategories]);

  const act = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    try { await fn(); after(); } catch (e) { setError(message(e, "That did not work.")); } finally { setBusy(false); }
  };

  if (!isSuperAdmin) {
    return <ProtectedRoute><p className="py-20 text-center">Only Super Admin can edit the help centre.</p></ProtectedRoute>;
  }

  return (
    <ProtectedRoute>
      <div className="space-y-8">
        <PageHeader title="Help centre" description={<>Articles for the public help pages, the app&apos;s Help screen and the Help link on admin pages. Only published articles are shown.</>} back="/settings" />

        <section className="space-y-3" aria-labelledby="help-articles">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 id="help-articles" className="row-h2">Articles</h3>
            <Button asChild><Link href="/settings/help-centre/new"><Plus className="mr-2 h-4 w-4" />New article</Link></Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Search articles" placeholder="Search by title, address or keyword" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} />
            <NativeSelect aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="published">Published</option>
              <option value="draft">Drafts</option>
            </NativeSelect>
          </div>
          {articles === null ? <TableSkeleton rows={6} /> : articles.length === 0 ? (
            <p className="rounded-lg border p-6 text-muted-foreground">{q || status ? "No articles match." : "No articles yet. Write the first one."}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {articles.map((a) => (
                <li key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {a.title}
                      <span className={`ml-2 rounded border px-1.5 py-0.5 text-xs ${a.status === "published" ? "border-primary text-primary" : "text-muted-foreground"}`}>
                        {a.status === "published" ? "Published" : "Draft"}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {a.categoryName} · /help/{a.slug}{a.contextPath && ` · Help link on ${a.contextPath}`} · Helpful {a.helpfulYes}, not helpful {a.helpfulNo} · Updated {fmt.date(a.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {a.status === "published" && (
                      <Button variant="outline" size="sm" asChild><a href={helpArticleUrl(a.slug)} target="_blank" rel="noreferrer">View</a></Button>
                    )}
                    <Button variant="outline" size="sm" asChild><Link href={`/settings/help-centre/${a.id}`}><Pencil className="mr-1 h-4 w-4" />Edit</Link></Button>
                    <Button variant="outline" size="sm" disabled={busy} aria-label={`Delete ${a.title}`}
                      onClick={() => setDeleting(a)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="help-categories">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 id="help-categories" className="row-h2">Categories</h3>
            <Button variant="outline" onClick={() => setDraft(EMPTY_CATEGORY)}><Plus className="mr-2 h-4 w-4" />New category</Button>
          </div>
          {draft && (
            <form className="grid gap-2 rounded-lg border p-4 sm:grid-cols-2"
              onSubmit={(e) => { e.preventDefault(); act(() => saveHelpCategory(draft.id, draft), () => { setDraft(null); loadCategories(); }); }}>
              <Input aria-label="Category name" placeholder="Name" required maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input aria-label="Web address" placeholder="Web address (made from the name if empty)" maxLength={80} value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
              <Input aria-label="Description" placeholder="Description" maxLength={300} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <Input aria-label="Order" type="number" placeholder="Order" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })} />
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>Save category</Button>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              </div>
            </form>
          )}
          {categories === null ? <TableSkeleton rows={3} /> : categories.length === 0 ? (
            <p className="rounded-lg border p-6 text-muted-foreground">No categories yet. Add one before writing articles.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {categories.map((k) => (
                <li key={k.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{k.name}</p>
                    <p className="text-sm text-muted-foreground">{k.description || "No description"} · {k.articles} articles · order {k.sortOrder}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm"
                      onClick={() => setDraft({ id: k.id, name: k.name, slug: k.slug, description: k.description ?? "", sortOrder: k.sortOrder })}>
                      <Pencil className="mr-1 h-4 w-4" />Edit
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy || k.articles > 0} aria-label={`Delete ${k.name}`}
                      title={k.articles > 0 ? "Move or delete its articles first" : undefined}
                      onClick={() => act(() => deleteHelpCategory(k.id), loadCategories)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
        <AlertModal open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} icon={AlertTriangle} iconClassName="text-destructive"
          title="Delete article" description={`Delete "${deleting?.title ?? ""}"? This cannot be undone.`} confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" cancelLabel="Cancel"
          onConfirm={() => { const a = deleting; setDeleting(null); if (a) act(() => deleteHelpArticle(a.id), loadArticles); }} />
      </div>
    </ProtectedRoute>
  );
}
