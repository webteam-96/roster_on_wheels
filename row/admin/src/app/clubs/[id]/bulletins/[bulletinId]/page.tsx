"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, PageHeader, Panel, SkeletonRows } from "@/components/row/AppKit";
import { ArrowDown, ArrowLeft, ArrowUp, Eye, Loader2, Save, Send, Trash2 } from "@/components/icons";
import {
  createBulletin, deleteBulletin, getBulletin, getBulletinOptions, getClubSubGroupAvailableYears, getSubGroups, previewBulletin,
  sendBulletin, updateBulletin, type BulletinDetail, type BulletinDraft, type BulletinOptions,
  type BulletinOption,
} from "@/services/api";
import { appLocale } from "@/lib/appFormat";

const EMPTY: BulletinDraft = {
  title: "", intro: "", presidentMessage: "", layout: "classic",
  announcementIds: [], eventIds: [], storyIds: [], includeBirthdays: true, includeSpeakers: true,
};

interface Group { id: number; groupName: string; memberCount: number }

/** Everyone, or the sub groups of one Rotary year. Sub groups load only when that option is chosen. */
function Recipients({ clubId, toGroups, setToGroups, picked, setPicked }: {
  clubId: number; toGroups: boolean; setToGroups: (v: boolean) => void; picked: number[]; setPicked: (ids: number[]) => void;
}) {
  const [years, setYears] = useState<{ id: number; yearLabel: string }[] | null>(null);
  const [yearId, setYearId] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!toGroups || years) return;
    getClubSubGroupAvailableYears(clubId)
      .then((ys: { id: number; yearLabel: string }[]) => { setYears(ys); if (ys.length > 0) setYearId(String(ys[0].id)); })
      .catch(() => setFailed(true));
  }, [toGroups, years, clubId]);

  useEffect(() => {
    if (!yearId) return;
    setGroups(null);
    getSubGroups(clubId, Number(yearId)).then((g) => setGroups(g)).catch(() => setFailed(true));
  }, [clubId, yearId]);

  return (
    <fieldset className="space-y-3">
      <legend className="text-[15px] font-semibold text-[#1B2C42]">Send to</legend>
      <div className="flex flex-wrap gap-6 text-[14px]">
        <label className="flex items-center gap-2">
          <input type="radio" name="b-recipients" checked={!toGroups} onChange={() => setToGroups(false)} /> All members
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="b-recipients" checked={toGroups} onChange={() => setToGroups(true)} /> Sub groups
        </label>
      </div>
      {toGroups && (failed ? (
        <p className="text-[13px] text-red-700">The sub groups could not be loaded.</p>
      ) : years === null ? <SkeletonRows rows={2} /> : years.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">The club has no sub groups yet.</p>
      ) : (
        <div className="space-y-2">
          <div className="max-w-[220px]">
            <Select value={yearId} onValueChange={(v) => { setYearId(v); setPicked([]); }}>
              <SelectTrigger aria-label="Rotary year"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {groups === null ? <SkeletonRows rows={2} /> : groups.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No sub groups in this year.</p>
          ) : (
            <ul className="grid gap-1 md:grid-cols-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <label className="flex items-center gap-2 text-[14px]">
                    <Checkbox checked={picked.includes(g.id)}
                      onCheckedChange={() => setPicked(picked.includes(g.id) ? picked.filter((p) => p !== g.id) : [...picked, g.id])} />
                    {g.groupName} <span className="text-muted-foreground">({g.memberCount})</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </fieldset>
  );
}

const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;

/** Pick items from a list and put them in order; the order here is the order in the email. */
function OrderedPicker({ label, options, picked, onChange, emptyText }: {
  label: string; options: BulletinOption[]; picked: number[]; onChange: (ids: number[]) => void; emptyText: string;
}) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const toggle = (id: number) => onChange(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
  const move = (i: number, by: number) => {
    const next = [...picked];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(appLocale(), { day: "numeric", month: "short" }) : "");

  return (
    <fieldset className="space-y-3">
      <legend className="text-[15px] font-semibold text-[#1B2C42]">{label}</legend>
      {options.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <ul className="max-h-64 space-y-1 overflow-auto rounded-md border border-[color:var(--row-line)] p-2">
            {options.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                  <Checkbox checked={picked.includes(o.id)} onCheckedChange={() => toggle(o.id)} className="mt-0.5" />
                  <span className="text-[14px]">{o.title} <span className="text-muted-foreground">{day(o.date)}</span></span>
                </label>
              </li>
            ))}
          </ul>
          <ol className="space-y-1" aria-label={`${label}, in order`}>
            {picked.length === 0 && <li className="text-[13px] text-muted-foreground">Nothing picked. Tick items to add them.</li>}
            {picked.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-md border border-[color:var(--row-line)] px-2 py-1">
                <span className="w-5 text-[13px] text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{byId.get(id)?.title ?? "Removed item"}</span>
                <Button type="button" variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" disabled={i === picked.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </fieldset>
  );
}

export default function BulletinEditorPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const isNew = params.bulletinId === "new";
  const bulletinId = isNew ? 0 : Number(params.bulletinId);

  const [draft, setDraft] = useState<BulletinDraft>(EMPTY);
  const [sentCopy, setSentCopy] = useState<BulletinDetail | null>(null);
  const [options, setOptions] = useState<BulletinOptions | null>(null);
  const [toGroups, setToGroups] = useState(false);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "preview" | "send" | "delete">("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setOptions(null);
    try {
      const [opts, b] = await Promise.all([getBulletinOptions(clubId), isNew ? null : getBulletin(clubId, bulletinId)]);
      if (b?.status === "Sent") setSentCopy(b);
      else if (b) {
        setDraft({
          title: b.title, intro: b.intro ?? "", presidentMessage: b.presidentMessage ?? "", layout: b.layout,
          announcementIds: b.announcementIds, eventIds: b.eventIds, storyIds: b.storyIds, includeBirthdays: b.includeBirthdays, includeSpeakers: b.includeSpeakers,
        });
        setPreview(b.html);
      }
      setOptions(opts);
    } catch (err: any) {
      setLoadError(message(err, "The bulletin could not be loaded."));
    }
  }, [clubId, bulletinId, isNew]);

  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof BulletinDraft>(key: K, value: BulletinDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Saves the draft and returns its id (creating it on the first save).
  const save = async (): Promise<number> => {
    if (isNew) {
      const { id } = await createBulletin(clubId, draft);
      router.replace(`/clubs/${clubId}/bulletins/${id}`);
      return id;
    }
    await updateBulletin(clubId, bulletinId, draft);
    return bulletinId;
  };

  const run = async (kind: typeof busy, action: () => Promise<void>, fallback: string) => {
    setBusy(kind);
    try { await action(); } catch (err: any) { setError(message(err, fallback)); }
    setBusy("");
  };

  const onSave = () => run("save", async () => { await save(); setSuccess("Draft saved."); }, "The draft could not be saved.");
  const onPreview = () => run("preview", async () => setPreview((await previewBulletin(clubId, draft)).html), "The preview could not be built.");
  const onSend = () => {
    setConfirmSend(false);
    return run("send", async () => {
      const id = await save();
      const res = await sendBulletin(clubId, id, toGroups ? 2 : 1, toGroups ? groupIds : []);
      setSuccess(res.message);
      router.push(`/clubs/${clubId}/mass-emails/${res.massEmailId}`);
    }, "The bulletin could not be sent.");
  };
  const onDelete = () => {
    setConfirmDelete(false);
    return run("delete", async () => {
      await deleteBulletin(clubId, bulletinId);
      router.push(`/clubs/${clubId}/bulletins`);
    }, "The draft could not be deleted.");
  };

  const previewFrame = (html: string) => (
    <iframe sandbox="" srcDoc={html} title="Bulletin preview" className="h-[70vh] w-full rounded-md border border-[color:var(--row-line)] bg-card" />
  );

  if (loadError) return <ProtectedRoute><div className="space-y-4"><PageHeader title="Bulletin" back={`/clubs/${clubId}/bulletins`} /><ErrorState message={loadError} onRetry={load} retryLabel="Try again" /></div></ProtectedRoute>;
  if (!options) return <ProtectedRoute><div className="space-y-4"><PageHeader title="Bulletin" back={`/clubs/${clubId}/bulletins`} /><Panel title="Bulletin"><SkeletonRows rows={8} /></Panel></div></ProtectedRoute>;

  if (sentCopy) {
    return (
      <ProtectedRoute>
        <div className="space-y-6">
          <PageHeader
          back={`/clubs/${clubId}/bulletins`}
          title={sentCopy.title}
          description={sentCopy.sentDate ? `Sent ${new Date(sentCopy.sentDate).toLocaleString(appLocale())}. Sent bulletins do not change.` : undefined}
          actions={sentCopy.massEmailId ? (
                <Button variant="outline" asChild>
                  <Link href={`/clubs/${clubId}/mass-emails/${sentCopy.massEmailId}`}>Opens, clicks and resend</Link>
                </Button>
              ) : undefined}
        />
          {previewFrame(sentCopy.html ?? "")}
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          back={`/clubs/${clubId}/bulletins`}
          title={isNew ? "New bulletin" : "Edit bulletin"}
          description="Pick the club news and events to include and put them in order. Birthdays, speakers and meeting duties are filled in from the club's records."
        />

        <Panel title="Content">
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[1fr_200px]">
              <div className="space-y-1.5">
                <Label htmlFor="b-title">Heading (also the email subject)</Label>
                <Input id="b-title" maxLength={200} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Weekly bulletin, 20 November" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-layout">Layout</Label>
                <Select value={draft.layout} onValueChange={(v) => set("layout", v as BulletinDraft["layout"])}>
                  <SelectTrigger id="b-layout"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="classic">Classic</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                    <SelectItem value="spotlight">President first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-intro">Opening note</Label>
              <Textarea id="b-intro" maxLength={5000} rows={3} value={draft.intro ?? ""} onChange={(e) => set("intro", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-president">From the President</Label>
              <Textarea id="b-president" maxLength={5000} rows={4} value={draft.presidentMessage ?? ""} onChange={(e) => set("presidentMessage", e.target.value)} />
            </div>
            <OrderedPicker label="Club news" options={options.announcements} picked={draft.announcementIds}
              onChange={(ids) => set("announcementIds", ids)} emptyText="The club has no current announcements." />
            <OrderedPicker label="Upcoming events" options={options.events} picked={draft.eventIds}
              onChange={(ids) => set("eventIds", ids)} emptyText="The club has no upcoming events." />
            <OrderedPicker label="Member stories" options={options.stories} picked={draft.storyIds}
              onChange={(ids) => set("storyIds", ids)} emptyText="No approved stories. Members send stories from the app; editors approve them under Stories." />
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-[14px]">
                <Checkbox checked={draft.includeBirthdays} onCheckedChange={(v) => set("includeBirthdays", v === true)} />
                Birthdays in the coming week
              </label>
              <label className="flex items-center gap-2 text-[14px]">
                <Checkbox checked={draft.includeSpeakers} onCheckedChange={(v) => set("includeSpeakers", v === true)} />
                Next speakers and meeting duties
              </label>
            </div>
          </div>
        </Panel>

        <Panel title="Recipients" subtitle={options.confirmedSubscribers > 0
          ? `Also goes to ${options.confirmedSubscribers} confirmed subscribers who are not members.`
          : "Subscribers who are not members sign up on the club website."}>
          <Recipients clubId={clubId} toGroups={toGroups} setToGroups={setToGroups} picked={groupIds} setPicked={setGroupIds} />
        </Panel>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onPreview} disabled={!!busy || !draft.title.trim()}>
            {busy === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}Preview
          </Button>
          <Button variant="outline" onClick={onSave} disabled={!!busy || !draft.title.trim()}>
            {busy === "save" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save draft
          </Button>
          <Button onClick={() => setConfirmSend(true)} disabled={!!busy || !draft.title.trim() || (toGroups && groupIds.length === 0)}>
            {busy === "send" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Send
          </Button>
          {!isNew && (
            <Button variant="ghost" className="text-red-700" onClick={() => setConfirmDelete(true)} disabled={!!busy}>
              <Trash2 className="h-4 w-4 mr-2" />Delete draft
            </Button>
          )}
        </div>

        <Panel title="Preview" subtitle="What members will receive. Build it again after changes.">
          {busy === "preview" ? <SkeletonRows rows={6} />
            : preview ? previewFrame(preview)
            : <p className="text-[15px] text-muted-foreground">Press Preview to see the email.</p>}
        </Panel>
      </div>

      <AlertModal
        open={confirmSend} icon={Send} iconClassName="text-primary" title="Send this bulletin?"
        description={`It goes to ${toGroups ? "the members of the chosen sub groups" : "every active member of the club"} with an email address, through Mass Email, and to the confirmed subscribers. Credits are used as for any mass email.`}
        confirmLabel="Send" cancelLabel="Cancel" onConfirm={onSend} onCancel={() => setConfirmSend(false)}
      />
      <AlertModal
        open={confirmDelete} icon={Trash2} iconClassName="text-red-700" title="Delete this draft?"
        description="The draft is removed. Sent bulletins are not affected."
        confirmLabel="Delete" cancelLabel="Cancel" onConfirm={onDelete} onCancel={() => setConfirmDelete(false)}
      />
      <SuccessAlert open={!!success} title="Done" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </ProtectedRoute>
  );
}
