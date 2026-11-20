"use client";

// Settings > Help centre > article editor. "new" creates; a number edits. The body uses the shared rich editor; the
// API sanitizes it on save.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import RichTextEditor from "@/components/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft } from "@/components/icons";
import { getHelpArticle, getHelpCategories, saveHelpArticle, type HelpArticleInput, type HelpCategory } from "@/services/api";
import { helpArticleUrl } from "@/lib/helpCentre";

const message = (e: unknown, fallback: string): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

const EMPTY: HelpArticleInput = { categoryId: 0, title: "", slug: "", summary: "", body: "", keywords: "", contextPath: "", status: "draft", sortOrder: 0 };

export default function HelpArticleEditorPage() {
  const { isSuperAdmin } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id === "new" ? null : Number(params.id);
  const [form, setForm] = useState<HelpArticleInput | null>(id ? null : EMPTY);
  const [categories, setCategories] = useState<HelpCategory[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    getHelpCategories()
      .then((cats) => { setCategories(cats); if (!id) setForm((f) => (f && !f.categoryId && cats[0] ? { ...f, categoryId: cats[0].id } : f)); })
      .catch((e) => setLoadError(message(e, "Could not load categories.")));
    if (id) {
      getHelpArticle(id)
        .then((a) => setForm({
          categoryId: a.categoryId, title: a.title, slug: a.slug, summary: a.summary ?? "", body: a.body, keywords: a.keywords ?? "",
          contextPath: a.contextPath ?? "", status: a.status, sortOrder: a.sortOrder,
        }))
        .catch((e) => setLoadError(message(e, "Could not load the article.")));
    }
  }, [isSuperAdmin, id]);

  const save = async (status: HelpArticleInput["status"]) => {
    if (!form) return;
    setBusy(true);
    try {
      await saveHelpArticle(id, { ...form, status });
      router.push("/settings/help-centre");
    } catch (e) {
      setError(message(e, "Could not save the article."));
    } finally {
      setBusy(false);
    }
  };

  if (!isSuperAdmin) {
    return <ProtectedRoute><p className="py-20 text-center">Only Super Admin can edit the help centre.</p></ProtectedRoute>;
  }
  const set = <K extends keyof HelpArticleInput>(k: K, v: HelpArticleInput[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <ProtectedRoute>
      <div className="max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Back to the help centre"><Link href="/settings/help-centre"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <h2 className="text-2xl font-bold tracking-tight text-primary">{id ? "Edit help article" : "New help article"}</h2>
        </div>
        {loadError ? (
          <p className="rounded-lg border p-6 text-destructive">{loadError}</p>
        ) : !form || categories === null ? (
          <TableSkeleton rows={5} />
        ) : categories.length === 0 ? (
          <p className="rounded-lg border p-6 text-muted-foreground">
            Add a category first, on the <Link className="underline" href="/settings/help-centre">help centre page</Link>.
          </p>
        ) : (
          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(form.status); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" required maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="category">Category</Label>
                <select id="category" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={form.categoryId} onChange={(e) => set("categoryId", Number(e.target.value))}>
                  {categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="slug">Web address</Label>
                <Input id="slug" maxLength={120} placeholder="Made from the title if empty" value={form.slug} onChange={(e) => set("slug", e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="summary">Summary (shown in lists and search)</Label>
                <Textarea id="summary" rows={2} maxLength={400} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Article</Label>
              <RichTextEditor value={form.body} onChange={(html) => set("body", html)} height={360} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="keywords">Keywords (comma separated)</Label>
                <Input id="keywords" maxLength={400} value={form.keywords} onChange={(e) => set("keywords", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="context">Help link on admin page</Label>
                <Input id="context" maxLength={200} placeholder="/club-admin-dashboard/grants" value={form.contextPath} onChange={(e) => set("contextPath", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="order">Order in category</Label>
                <Input id="order" type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value) || 0)} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Status: {form.status === "published" ? "published" : "draft (not shown to anyone)"}.
              {form.status === "published" && form.slug && (
                <> <a className="underline" href={helpArticleUrl(form.slug)} target="_blank" rel="noopener noreferrer">View on the website</a></>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => save("published")}>{form.status === "published" ? "Save and keep published" : "Publish"}</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => save("draft")}>
                {form.status === "published" ? "Unpublish and save as draft" : "Save draft"}
              </Button>
            </div>
          </form>
        )}
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}
