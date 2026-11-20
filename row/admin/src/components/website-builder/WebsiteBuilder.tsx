"use client";

// Website builder for club and district sites: custom pages and the home layout, each a list of sections
// (rich text, picture, video or map, live ROW data widgets, contact form) with drag to reorder, draft and publish,
// and the site's media library. Published custom pages show up in the menu builder's "Page" options as /p/<address>.

import { useCallback, useEffect, useState } from "react";
import {
  createWebsitePage, deleteWebsiteMedia, deleteWebsitePage, getPhotoUrl, getWebsiteMedia, getWebsiteMediaLink, getWebsitePage,
  getWebsitePages, publishWebsitePage, saveWebsitePage, uploadWebsiteMedia,
  type WebsiteMedia, type WebsitePageDetail, type WebsitePageSummary, type WebsiteScope, type WebsiteSection,
  type WebsiteSectionType,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import RichTextEditor from "@/components/RichTextEditor";
import { ErrorState, PageHeader, Panel, SkeletonRows } from "@/components/row/AppKit";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, Upload } from "@/components/icons";
import {
  DATA_WIDGETS, HOME_SLUG, SECTION_TYPES, isImageMedia, isValidSlug, moveItem, newSection, pagePath, pickable, sectionLabel, slugify,
} from "@/lib/websiteBuilder";

type PickInto = "image" | "richtext" | "file";

function errMessage(e: unknown, fallback: string): string {
  const r = e as { response?: { data?: { message?: string } } };
  return r?.response?.data?.message || fallback;
}

interface Props {
  scope: WebsiteScope;
  ownerId: number;
  /** "Rotary Club of X" or "District 3141", shown above the title. */
  ownerName?: string;
  /** Public site address (no trailing slash) for "View on site" links, when known. */
  siteUrl?: string | null;
}

export default function WebsiteBuilder({ scope, ownerId, ownerName, siteUrl }: Props) {
  const [pages, setPages] = useState<WebsitePageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WebsitePageDetail | "new" | "home" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setPages(await getWebsitePages(scope, ownerId)); }
    catch (e) { setError(errMessage(e, "Could not load the website pages.")); }
  }, [scope, ownerId]);

  useEffect(() => { if (ownerId > 0) load(); }, [load, ownerId]);

  const open = async (id: number) => {
    setBusyId(id);
    try { setEditing(await getWebsitePage(scope, ownerId, id)); }
    catch (e) { setNotice(errMessage(e, "Could not open the page.")); }
    finally { setBusyId(null); }
  };

  const togglePublish = async (p: WebsitePageSummary) => {
    setBusyId(p.id);
    try {
      await publishWebsitePage(scope, ownerId, p.id, !p.isPublished);
      setNotice(p.isPublished ? `"${p.title}" is no longer on the website.` : `"${p.title}" is published.`);
      await load();
    } catch (e) { setNotice(errMessage(e, "Could not change the page.")); }
    finally { setBusyId(null); }
  };

  const remove = async (p: WebsitePageSummary) => {
    if (!window.confirm(`Delete "${p.title}"? Menu items that link to it will lead nowhere.`)) return;
    setBusyId(p.id);
    try { await deleteWebsitePage(scope, ownerId, p.id); setNotice(`"${p.title}" was deleted.`); await load(); }
    catch (e) { setNotice(errMessage(e, "Could not delete the page.")); }
    finally { setBusyId(null); }
  };

  if (editing) {
    return (
      <PageEditor
        scope={scope}
        ownerId={ownerId}
        initial={editing === "new" ? null : editing === "home" ? { slug: HOME_SLUG, title: "Home", sections: [], membersOnly: false } : editing}
        pageId={typeof editing === "object" ? editing.id : null}
        onClose={async (msg) => { setEditing(null); if (msg) setNotice(msg); await load(); }}
      />
    );
  }

  const home = pages?.find((p) => p.slug === HOME_SLUG);
  const custom = pages?.filter((p) => p.slug !== HOME_SLUG) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ownerName}
        title="Pages and layout"
        description="Build custom pages and arrange the home page from sections. Changes stay in draft until you publish."
        actions={<Button onClick={() => setEditing("new")}><Plus /> New page</Button>}
      />
      {notice && <p role="status" className="rounded-[12px] bg-[#EDF4FB] px-4 py-3 text-[14px] text-[#1B2C42]">{notice}</p>}
      {error && <ErrorState message={error} onRetry={load} retryLabel="Try again" />}
      {!error && pages === null && <SkeletonRows rows={4} />}
      {!error && pages && (
        <>
          <Panel title="Home page layout" subtitle="When published, these sections replace the theme's home page content. The theme's header, footer and colours stay.">
            {home ? (
              <PageRow page={home} busy={busyId === home.id} siteUrl={siteUrl} onEdit={() => open(home.id)}
                onPublish={() => togglePublish(home)} onDelete={() => remove(home)} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 py-2">
                <p className="text-[14px] text-[#64748B]">The site uses its theme's home page. Build your own layout to choose what it shows.</p>
                <Button variant="outline" onClick={() => setEditing("home")}>Build home layout</Button>
              </div>
            )}
          </Panel>
          <Panel title="Custom pages" subtitle="Link a published page from the Menu List: pick it under link type Page.">
            {custom.length === 0 ? (
              <p className="py-4 text-[14px] text-[#64748B]">No custom pages yet. Use New page to write one, for example your club history or a fundraiser.</p>
            ) : (
              <ul className="divide-y divide-[color:var(--row-line)]">
                {custom.map((p) => (
                  <li key={p.id}>
                    <PageRow page={p} busy={busyId === p.id} siteUrl={siteUrl} onEdit={() => open(p.id)}
                      onPublish={() => togglePublish(p)} onDelete={() => remove(p)} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <MediaLibrary scope={scope} ownerId={ownerId} />
        </>
      )}
    </div>
  );
}

function Status({ page }: { page: WebsitePageSummary }) {
  const text = !page.isPublished ? "Draft" : page.hasUnpublishedChanges ? "Published, with unpublished changes" : "Published";
  const tone = !page.isPublished ? "bg-[#EDF4FB] text-[#1B2C42]" : page.hasUnpublishedChanges ? "bg-[#FFC65C] text-[#1B2C42]" : "bg-[#CFE2F6] text-[#0B3F7A]";
  return (
    <>
      <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`}>{text}</span>
      {page.membersOnly && <span className="rounded-full bg-[#17458F] px-3 py-1 text-[12px] font-semibold text-[#F7F9FC]">Members only</span>}
    </>
  );
}

function PageRow({ page, busy, siteUrl, onEdit, onPublish, onDelete }: {
  page: WebsitePageSummary; busy: boolean; siteUrl?: string | null;
  onEdit: () => void; onPublish: () => void; onDelete: () => void;
}) {
  const path = page.slug === HOME_SLUG ? "/" : pagePath(page.slug);
  return (
    <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-[#1B2C42]">{page.title}</p>
        <p className="text-[13px] text-[#64748B]">
          {siteUrl && page.isPublished
            ? <a className="underline" href={siteUrl + path} target="_blank" rel="noreferrer">{path}</a>
            : path}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Status page={page} />
        <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>Edit</Button>
        <Button size="sm" variant={page.isPublished ? "ghost" : "default"} disabled={busy} onClick={onPublish}>
          {page.isPublished ? "Unpublish" : "Publish"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete} aria-label={`Delete ${page.title}`}><Trash2 /></Button>
      </div>
    </div>
  );
}

// ── Page editor ────────────────────────────────────────────────────────────────────────────────────────────

function PageEditor({ scope, ownerId, initial, pageId, onClose }: {
  scope: WebsiteScope; ownerId: number; pageId: number | null;
  initial: { slug: string; title: string; sections: WebsiteSection[]; membersOnly: boolean } | null;
  onClose: (message?: string) => void;
}) {
  const isHome = initial?.slug === HOME_SLUG;
  const [membersOnly, setMembersOnly] = useState(initial?.membersOnly ?? false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [sections, setSections] = useState<WebsiteSection[]>(initial?.sections ?? []);
  const [id, setId] = useState<number | null>(pageId);
  const [addType, setAddType] = useState<WebsiteSectionType>("richtext");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ index: number; into: PickInto } | null>(null);

  const update = (i: number, patch: Partial<WebsiteSection>) =>
    setSections((list) => list.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const save = async (): Promise<number | null> => {
    setError(null); setSaved(null);
    if (!title.trim()) { setError("Give the page a title."); return null; }
    if (!isValidSlug(slug)) { setError("The page address may use lower-case letters, digits and single hyphens."); return null; }
    setSaving(true);
    try {
      const body = { slug, title: title.trim(), sections, membersOnly: isHome ? false : membersOnly };
      let pid = id;
      if (pid == null) { pid = (await createWebsitePage(scope, ownerId, body)).id; setId(pid); }
      else await saveWebsitePage(scope, ownerId, pid, body);
      setSaved("Draft saved.");
      return pid;
    } catch (e) { setError(errMessage(e, "Could not save the page.")); return null; }
    finally { setSaving(false); }
  };

  const saveAndPublish = async () => {
    const pid = await save();
    if (pid == null) return;
    setSaving(true);
    try { await publishWebsitePage(scope, ownerId, pid, true); onClose(`"${title.trim()}" is published.`); }
    catch (e) { setError(errMessage(e, "Saved as draft, but publishing failed.")); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isHome ? "Home page layout" : "Custom page"}
        title={title.trim() || "New page"}
        actions={<>
          <Button variant="ghost" onClick={() => onClose(id && !pageId ? "Draft saved." : undefined)}>Back to pages</Button>
          <Button variant="outline" disabled={saving} onClick={save}>{saving ? "Saving" : "Save draft"}</Button>
          <Button disabled={saving} onClick={saveAndPublish}>Publish</Button>
        </>}
      />
      {error && <p role="alert" className="rounded-[12px] bg-red-50 px-4 py-3 text-[14px] text-red-800">{error}</p>}
      {saved && <p role="status" className="rounded-[12px] bg-[#EDF4FB] px-4 py-3 text-[14px] text-[#1B2C42]">{saved}</p>}

      <Panel title="Page details">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="wb-title">Title</Label>
            <Input id="wb-title" value={title} maxLength={200}
              onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
          </div>
          <div>
            <Label htmlFor="wb-slug">Address on the site</Label>
            <Input id="wb-slug" value={slug} maxLength={60} disabled={isHome}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} />
            <p className="mt-1 text-[12px] text-[#64748B]">{isHome ? "The home page of the site." : `The page opens at ${pagePath(slug || "address")}`}</p>
          </div>
          {!isHome && (
            <div className="md:col-span-2">
              <Label htmlFor="wb-vis">Who can see it</Label>
              <select id="wb-vis" value={membersOnly ? "members" : "public"} onChange={(e) => setMembersOnly(e.target.value === "members")}
                className="h-11 rounded-[12px] border border-[color:var(--row-line)] bg-[#FCFDFE] px-3 text-[14px]">
                <option value="public">Everyone</option>
                <option value="members">Members of the club only (they sign in on the website)</option>
              </select>
              <p className="mt-1 text-[12px] text-[#64748B]">This applies as soon as you save, also to the published page.</p>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Sections" subtitle="Drag a section by its handle, or use the arrows, to change the order.">
        {sections.length === 0 && <p className="py-3 text-[14px] text-[#64748B]">No sections yet. Add the first one below.</p>}
        <ol className="space-y-3">
          {sections.map((s, i) => (
            <li key={s.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragFrom !== null) setSections((l) => moveItem(l, dragFrom, i)); setDragFrom(null); }}
              className={`rounded-[16px] border border-[color:var(--row-line)] bg-[#FCFDFE] ${dragFrom === i ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 border-b border-[color:var(--row-line)] px-3 py-2">
                <span draggable onDragStart={() => setDragFrom(i)} onDragEnd={() => setDragFrom(null)}
                  className="cursor-grab text-[#64748B]" aria-hidden="true"><GripVertical /></span>
                <span className="text-[13px] font-semibold text-[#1B2C42]">{i + 1}. {sectionLabel(s.type)}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" disabled={i === 0} aria-label="Move up" onClick={() => setSections((l) => moveItem(l, i, i - 1))}><ArrowUp /></Button>
                  <Button size="sm" variant="ghost" disabled={i === sections.length - 1} aria-label="Move down" onClick={() => setSections((l) => moveItem(l, i, i + 1))}><ArrowDown /></Button>
                  <Button size="sm" variant="ghost" aria-label="Remove section" onClick={() => setSections((l) => l.filter((_, k) => k !== i))}><Trash2 /></Button>
                </span>
              </div>
              <div className="space-y-3 p-4">
                <div>
                  <Label htmlFor={`wb-h-${s.id}`}>Heading (optional)</Label>
                  <Input id={`wb-h-${s.id}`} value={s.title ?? ""} maxLength={120} onChange={(e) => update(i, { title: e.target.value })} />
                </div>
                <SectionFields section={s} onChange={(p) => update(i, p)} onPick={(into) => setPicker({ index: i, into })} />
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="wb-add">Add a section</Label>
            <select id="wb-add" value={addType} onChange={(e) => setAddType(e.target.value as WebsiteSectionType)}
              className="h-11 rounded-[12px] border border-[color:var(--row-line)] bg-[#FCFDFE] px-3 text-[14px]">
              {SECTION_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}: {t.hint}</option>)}
            </select>
          </div>
          <Button variant="outline" onClick={() => setSections((l) => [...l, newSection(addType)])}><Plus /> Add</Button>
        </div>
      </Panel>

      <Dialog open={picker !== null} onOpenChange={(o) => { if (!o) setPicker(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Media library</DialogTitle></DialogHeader>
          <MediaLibrary scope={scope} ownerId={ownerId} embedded pickInto={picker?.into} onPick={(m) => {
            if (!picker) return;
            if (picker.into === "image") update(picker.index, { url: m.url });
            else if (picker.into === "file") update(picker.index, { url: m.url, caption: sections[picker.index]?.caption || m.fileName });
            else {
              const cur = sections[picker.index]?.html ?? "";
              update(picker.index, { html: `${cur}<p><img src="${getPhotoUrl(m.url)}" alt=""></p>` });
            }
            setPicker(null);
          }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionFields({ section: s, onChange, onPick }: {
  section: WebsiteSection; onChange: (p: Partial<WebsiteSection>) => void; onPick: (into: PickInto) => void;
}) {
  const isRef = (s.url ?? "").startsWith("media:");
  if (s.type === "file") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[14px] text-[#64748B]">
            {s.url ? (isRef ? "Members-only file chosen." : `File: ${s.url.split("/").pop()}`) : "No file chosen."}
          </span>
          <Button size="sm" variant="outline" onClick={() => onPick("file")}>{s.url ? "Change file" : "Choose file"}</Button>
        </div>
        <div><Label htmlFor={`wb-ft-${s.id}`}>Link text</Label>
          <Input id={`wb-ft-${s.id}`} value={s.caption ?? ""} maxLength={300} onChange={(e) => onChange({ caption: e.target.value })} /></div>
      </div>
    );
  }
  if (s.type === "richtext") {
    return (
      <div className="space-y-2">
        <RichTextEditor value={s.html ?? ""} onChange={(html) => onChange({ html })} height={220} />
        <Button size="sm" variant="outline" onClick={() => onPick("richtext")}>Insert picture from media library</Button>
      </div>
    );
  }
  if (s.type === "image") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {s.url && !isRef && <img src={getPhotoUrl(s.url)} alt="" className="h-24 w-36 rounded-[12px] object-cover" />}
          {isRef && <span className="text-[14px] text-[#64748B]">Members-only picture chosen. Visitors who are not signed in do not see this section.</span>}
          {!s.url && <span className="text-[14px] text-[#64748B]">No picture chosen.</span>}
          <Button size="sm" variant="outline" onClick={() => onPick("image")}>{s.url ? "Change picture" : "Choose picture"}</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label htmlFor={`wb-c-${s.id}`}>Caption</Label>
            <Input id={`wb-c-${s.id}`} value={s.caption ?? ""} maxLength={300} onChange={(e) => onChange({ caption: e.target.value })} /></div>
          <div><Label htmlFor={`wb-l-${s.id}`}>Link when clicked (optional)</Label>
            <Input id={`wb-l-${s.id}`} value={s.linkUrl ?? ""} placeholder="https://... or /events" onChange={(e) => onChange({ linkUrl: e.target.value })} /></div>
        </div>
      </div>
    );
  }
  if (s.type === "embed") {
    return (
      <div><Label htmlFor={`wb-e-${s.id}`}>Link to the video or map</Label>
        <Input id={`wb-e-${s.id}`} value={s.url ?? ""} placeholder="https://www.youtube.com/watch?v=..." onChange={(e) => onChange({ url: e.target.value })} />
        <p className="mt-1 text-[12px] text-[#64748B]">YouTube or Vimeo video link, or the Google Maps link from Share, Embed a map.</p></div>
    );
  }
  if (DATA_WIDGETS.includes(s.type)) {
    return (
      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor={`wb-n-${s.id}`}>Items to show</Label>
          <Input id={`wb-n-${s.id}`} type="number" min={1} max={24} className="w-28" value={s.limit ?? 6}
            onChange={(e) => onChange({ limit: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })} /></div>
        <p className="pb-3 text-[13px] text-[#64748B]">Filled from ROW data when a visitor opens the page.</p>
      </div>
    );
  }
  return <p className="text-[13px] text-[#64748B]">Visitors can send their name, email and a message. Enquiries arrive in the prospects list.</p>;
}

// ── Media library ──────────────────────────────────────────────────────────────────────────────────────────

function MediaLibrary({ scope, ownerId, embedded, onPick, pickInto }: {
  scope: WebsiteScope; ownerId: number; embedded?: boolean; onPick?: (m: WebsiteMedia) => void; pickInto?: PickInto;
}) {
  const [all, setItems] = useState<WebsiteMedia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [privateUpload, setPrivateUpload] = useState(false);
  const items = all && pickInto ? pickable(all, pickInto) : all;

  const openFile = async (m: WebsiteMedia) => {
    try { window.open((m.membersOnly ? (await getWebsiteMediaLink(scope, ownerId, m.id)).url : "") || getPhotoUrl(m.url), "_blank", "noopener"); }
    catch (e) { setError(errMessage(e, "Could not open the file.")); }
  };

  const load = useCallback(async () => {
    setError(null);
    try { setItems(await getWebsiteMedia(scope, ownerId)); }
    catch (e) { setError(errMessage(e, "Could not load the media library.")); }
  }, [scope, ownerId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null);
    try { const m = await uploadWebsiteMedia(scope, ownerId, file, privateUpload); setItems((l) => [m, ...(l ?? [])]); }
    catch (e) { setError(errMessage(e, "Upload failed.")); }
    finally { setBusy(false); }
  };

  const remove = async (m: WebsiteMedia) => {
    if (!window.confirm(`Delete ${m.fileName}? Pages that show it will lose the picture.`)) return;
    try { await deleteWebsiteMedia(scope, ownerId, m.id); setItems((l) => (l ?? []).filter((x) => x.id !== m.id)); }
    catch (e) { setError(errMessage(e, "Could not delete the picture.")); }
  };

  // A members-only file has no public URL, so it shows as a named tile; public pictures show as thumbnails.
  const preview = (m: WebsiteMedia) => !m.membersOnly && isImageMedia(m)
    ? <img src={getPhotoUrl(m.url)} alt={m.fileName} className="h-24 w-full object-cover" />
    : <span className="flex h-24 w-full items-center justify-center bg-[#EDF4FB] px-2 text-center text-[12px] font-semibold text-[#1B2C42]">
        {(m.fileName.split(".").pop() ?? "").toUpperCase()} file</span>;

  const body = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-[#1B2C42] px-5 text-[14px] font-semibold text-[#1B2C42]">
          <Upload /> {busy ? "Uploading" : "Upload file"}
          <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.docx,.xlsx,.pptx" className="sr-only" disabled={busy}
            onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <label className="flex items-center gap-2 text-[14px] text-[#1B2C42]">
          <input type="checkbox" checked={privateUpload} onChange={(e) => setPrivateUpload(e.target.checked)} />
          Members only (signed-in members of the club can open it)
        </label>
      </div>
      {error && <p role="alert" className="text-[14px] text-red-800">{error}</p>}
      {items === null && !error && <SkeletonRows rows={2} />}
      {items && items.length === 0 && <p className="text-[14px] text-[#64748B]">Nothing here yet. Upload pictures (JPG, PNG, GIF, WEBP) or documents (PDF, Word, Excel, PowerPoint) up to 10 MB.</p>}
      {items && items.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-[12px] border border-[color:var(--row-line)]">
              {onPick ? (
                <button type="button" className="block w-full" onClick={() => onPick(m)} aria-label={`Use ${m.fileName}`}>{preview(m)}</button>
              ) : <button type="button" className="block w-full" onClick={() => openFile(m)} aria-label={`Open ${m.fileName}`}>{preview(m)}</button>}
              <div className="flex items-center justify-between gap-1 px-2 py-1">
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-[#64748B]" title={m.fileName}>{m.fileName}</span>
                  {m.membersOnly && <span className="text-[11px] font-semibold text-[#0B3F7A]">Members only</span>}
                </span>
                <Button size="sm" variant="ghost" aria-label={`Delete ${m.fileName}`} onClick={() => remove(m)}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return embedded ? body : <Panel title="Media library" subtitle="Pictures and documents for your pages.">{body}</Panel>;
}
