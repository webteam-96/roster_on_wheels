"use client";

/**
 * Member lists for a club (member flexibility): filter members by tags, profile fields, member type, join date and
 * committee; save a filter as a smart list; export a list as CSV or start a mass email draft to it. Tags and profile
 * fields are managed on the Settings tab. Every filter is checked and run on the server.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getClubTags, getProfileFields, getClubCommittees, getSmartLists, previewSmartList, createSmartList, updateSmartList,
  deleteSmartList, exportSmartList, smartListMassEmail,
  type ClubTag, type FieldCondition, type ProfileField, type SmartList, type SmartListFilter, type SmartListMember,
} from "@/services/api";
import type { PagedResult } from "@/types/member";
import { errorText } from "@/lib/contacts";
import { fmtDate } from "@/components/dashboard/formatters";
import { ErrorState, PageHeader, Panel, SkeletonRows, rowTable as t } from "@/components/row/AppKit";
import Pagination from "@/components/Pagination";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Download, Filter, Loader2, Mail, Pencil, Plus, Save, Trash2, X } from "@/components/icons";
import TagChip from "./TagChip";
import MemberProfileDialog from "./MemberProfileDialog";
import TagsAndFieldsSettings from "./TagsAndFieldsSettings";

const PAGE_SIZE = 25;
const SELECT = "h-9 rounded-md border border-input bg-background px-3 text-sm";
const OPS: Record<string, { value: string; label: string }[]> = {
  text: [{ value: "eq", label: "is" }, { value: "contains", label: "contains" }],
  number: [{ value: "eq", label: "=" }, { value: "gt", label: "more than" }, { value: "lt", label: "less than" }],
  date: [{ value: "eq", label: "on" }, { value: "before", label: "before" }, { value: "after", label: "after" }],
  choice: [{ value: "eq", label: "is" }],
  yesno: [{ value: "eq", label: "is" }],
};
const ANY_VALUE_OPS = [{ value: "set", label: "has an answer" }, { value: "notset", label: "has no answer" }];

const toggle = (list: number[] | undefined, id: number) => (list ?? []).includes(id) ? (list ?? []).filter((x) => x !== id) : [...(list ?? []), id];

export default function MemberListsManager({ clubId }: { clubId: number }) {
  const [tab, setTab] = useState<"lists" | "settings">("lists");
  const [tags, setTags] = useState<ClubTag[] | null>(null);
  const [fields, setFields] = useState<ProfileField[] | null>(null);
  const [committees, setCommittees] = useState<{ id: number; name: string }[]>([]);
  const [lists, setLists] = useState<SmartList[] | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [draft, setDraft] = useState<SmartListFilter>({});
  const [applied, setApplied] = useState<SmartListFilter>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PagedResult<SmartListMember> | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [current, setCurrent] = useState<SmartList | null>(null);

  const [editing, setEditing] = useState<SmartListMember | null>(null);
  const [nameDialog, setNameDialog] = useState<string | null>(null);
  const [emailDialog, setEmailDialog] = useState<{ subject: string; draftId: number | null } | null>(null);
  const [listToDelete, setListToDelete] = useState<SmartList | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSetup = useCallback(() => {
    setSetupError(null);
    Promise.all([getClubTags(clubId), getProfileFields(clubId), getSmartLists(clubId), getClubCommittees(clubId)])
      .then(([tg, fl, sl, cm]) => { setTags(tg); setFields(fl); setLists(sl); setCommittees(cm); })
      .catch((e) => { setTags([]); setFields([]); setLists([]); setSetupError(errorText(e, "Could not load tags, fields and lists.")); });
  }, [clubId]);
  useEffect(() => { loadSetup(); }, [loadSetup]);

  const loadMembers = useCallback(() => {
    setData(null); setDataError(null);
    previewSmartList(clubId, applied, page, PAGE_SIZE)
      .then(setData)
      .catch((e) => { setData({ items: [], totalCount: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 }); setDataError(errorText(e, "Could not load the members.")); });
  }, [clubId, applied, page]);
  useEffect(() => { loadMembers(); }, [loadMembers]);

  const apply = (f: SmartListFilter) => { setPage(1); setApplied(f); };
  const setD = (patch: Partial<SmartListFilter>) => setDraft((d) => ({ ...d, ...patch }));
  const setCond = (i: number, patch: Partial<FieldCondition>) =>
    setD({ fields: (draft.fields ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const done = (message: string) => { setSuccess(message); loadSetup(); loadMembers(); };
  const run = async (work: () => Promise<unknown>, ok: string, failed: string) => {
    setBusy(true);
    try { await work(); done(ok); return true; } catch (e) { setError(errorText(e, failed)); return false; } finally { setBusy(false); }
  };

  const openList = (l: SmartList) => { setCurrent(l); setDraft(l.filter); apply(l.filter); };
  const clear = () => { setCurrent(null); setDraft({}); apply({}); };

  const saveAsNew = async (name: string) => {
    let id = 0;
    const ok = await run(async () => { id = (await createSmartList(clubId, { name, filter: draft })).id; }, "List saved.", "Could not save the list.");
    if (ok) { setNameDialog(null); setCurrent({ id, name, filter: draft, createdDate: "", modifiedDate: null }); apply(draft); }
  };
  const saveCurrent = () => current && run(() => updateSmartList(clubId, current.id, { name: current.name, filter: draft }).then(() => apply(draft)),
    "List updated.", "Could not update the list.");

  const download = async (l: SmartList) => {
    try {
      const blob = await exportSmartList(clubId, l.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${l.name.replace(/[^\w -]/g, "").trim() || "list"}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(errorText(e, "Could not export the list.")); }
  };

  const createDraft = async () => {
    if (!current || !emailDialog) return;
    setBusy(true);
    try {
      const r = await smartListMassEmail(clubId, current.id, { subject: emailDialog.subject.trim() || undefined });
      setEmailDialog({ ...emailDialog, draftId: r.massEmailId });
    } catch (e) { setError(errorText(e, "Could not create the email draft.")); } finally { setBusy(false); }
  };

  const tagById = (id: number) => tags?.find((x) => x.id === id);
  const fieldById = (id: number) => fields?.find((x) => x.id === id);
  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE)) : 1;
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  const tabButton = (key: "lists" | "settings", text: string) => (
    <button type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
      className={`h-9 rounded-full px-4 text-sm font-medium ${tab === key ? "bg-azure text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
      {text}
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Member Lists" description="Tags, profile fields and saved member lists for email and exports."
        actions={<div className="flex gap-2">{tabButton("lists", "Lists")}{tabButton("settings", "Settings")}</div>} />

      {setupError && <ErrorState message={setupError} onRetry={loadSetup} retryLabel="Try again" />}

      {tab === "settings" ? (
        <TagsAndFieldsSettings clubId={clubId} tags={tags} fields={fields} onChanged={done} onError={setError} />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <aside className="space-y-4 xl:col-span-1">
            <Panel title="Saved lists" subtitle="Click a list to load its filter.">
              {lists === null ? <SkeletonRows rows={3} /> : lists.length === 0 ? (
                <p className="py-3 text-sm text-slate-500">No saved lists yet. Build a filter and save it.</p>
              ) : (
                <ul className="space-y-1">
                  {lists.map((l) => (
                    <li key={l.id} className="flex items-center gap-1">
                      <button type="button" onClick={() => openList(l)}
                        className={`flex-1 truncate rounded px-2 py-1.5 text-left text-sm ${current?.id === l.id ? "bg-[#EDF4FB] font-semibold text-azure" : "text-slate-700 hover:bg-slate-50"}`}>
                        {l.name}
                      </button>
                      <button type="button" aria-label={`Delete ${l.name}`} className="p-1 text-slate-400 hover:text-rose-700" onClick={() => setListToDelete(l)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </aside>

          <div className="space-y-4 xl:col-span-3">
            <Panel title={current ? current.name : "Filter members"} subtitle="All parts of the filter must match."
              headerRight={(current || Object.keys(applied).length > 0) ? <Button size="sm" variant="outline" onClick={clear}><X className="mr-1.5 h-4 w-4" />Clear</Button> : undefined}>
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1"><Label htmlFor="f-search">Name or email</Label>
                    <Input id="f-search" className="h-9 w-56" value={draft.search ?? ""} maxLength={100} onChange={(e) => setD({ search: e.target.value || undefined })} /></div>
                  <div className="space-y-1"><Label htmlFor="f-type">Member type</Label>
                    <select id="f-type" className={SELECT} value={draft.memberType ?? ""} onChange={(e) => setD({ memberType: (e.target.value || undefined) as SmartListFilter["memberType"] })}>
                      <option value="">All</option><option value="active">Active</option><option value="honorary">Honorary</option>
                    </select></div>
                  <div className="space-y-1"><Label htmlFor="f-from">Joined from</Label>
                    <Input id="f-from" type="date" className="h-9" value={draft.joinedFrom ?? ""} onChange={(e) => setD({ joinedFrom: e.target.value || undefined })} /></div>
                  <div className="space-y-1"><Label htmlFor="f-to">Joined to</Label>
                    <Input id="f-to" type="date" className="h-9" value={draft.joinedTo ?? ""} onChange={(e) => setD({ joinedTo: e.target.value || undefined })} /></div>
                </div>

                {!!tags?.length && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-medium text-slate-700">Tags</p>
                      <select aria-label="Tag match" className="h-7 rounded border border-input bg-background px-2 text-xs" value={draft.tagMode ?? "any"}
                        onChange={(e) => setD({ tagMode: e.target.value as "any" | "all" })}>
                        <option value="any">any of these</option><option value="all">all of these</option>
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tg) => (
                        <button key={tg.id} type="button" aria-pressed={draft.tagIds?.includes(tg.id) ?? false}
                          onClick={() => setD({ tagIds: toggle(draft.tagIds, tg.id) })}
                          className={`rounded-sm p-0.5 ${draft.tagIds?.includes(tg.id) ? "ring-2 ring-azure" : "opacity-70 hover:opacity-100"}`}>
                          <TagChip tag={tg} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {committees.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-700">Committees (any of)</p>
                    <div className="flex flex-wrap gap-2">
                      {committees.map((c) => (
                        <button key={c.id} type="button" aria-pressed={draft.subGroupIds?.includes(c.id) ?? false}
                          onClick={() => setD({ subGroupIds: toggle(draft.subGroupIds, c.id) })}
                          className={`rounded-full border px-3 py-1 text-xs ${draft.subGroupIds?.includes(c.id) ? "border-azure bg-[#EDF4FB] text-azure" : "border-slate-200 text-slate-600"}`}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!!fields?.length && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">Profile fields</p>
                    {(draft.fields ?? []).map((c, i) => {
                      const f = fieldById(c.fieldId);
                      const ops = [...(f ? OPS[f.fieldType] : []), ...ANY_VALUE_OPS];
                      const needsValue = c.op !== "set" && c.op !== "notset";
                      return (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <select aria-label="Field" className={SELECT} value={c.fieldId}
                            onChange={(e) => setCond(i, { fieldId: Number(e.target.value), op: "eq", value: "" })}>
                            {!f && <option value={c.fieldId}>Deleted field</option>}
                            {fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                          </select>
                          <select aria-label="Condition" className={SELECT} value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>
                            {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          {needsValue && f && (f.fieldType === "choice" || f.fieldType === "yesno" ? (
                            <select aria-label="Value" className={SELECT} value={c.value ?? ""} onChange={(e) => setCond(i, { value: e.target.value })}>
                              <option value="">Pick</option>
                              {(f.fieldType === "yesno" ? ["yes", "no"] : f.options).map((o) => <option key={o} value={o}>{f.fieldType === "yesno" ? (o === "yes" ? "Yes" : "No") : o}</option>)}
                            </select>
                          ) : (
                            <Input aria-label="Value" className="h-9 w-48" value={c.value ?? ""} onChange={(e) => setCond(i, { value: e.target.value })}
                              type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : "text"} />
                          ))}
                          <button type="button" aria-label="Remove condition" className="p-1 text-slate-400 hover:text-rose-700"
                            onClick={() => setD({ fields: (draft.fields ?? []).filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>
                        </div>
                      );
                    })}
                    <Button size="sm" variant="outline" onClick={() => setD({ fields: [...(draft.fields ?? []), { fieldId: fields[0].id, op: "eq", value: "" }] })}>
                      <Plus className="mr-1.5 h-4 w-4" />Add field condition
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Button size="sm" className="bg-azure text-white hover:bg-mint-ink" onClick={() => apply(draft)} disabled={!dirty}>
                    <Filter className="mr-1.5 h-4 w-4" />Apply filter
                  </Button>
                  {current && <Button size="sm" variant="outline" disabled={busy} onClick={saveCurrent}><Save className="mr-1.5 h-4 w-4" />Update list</Button>}
                  <Button size="sm" variant="outline" onClick={() => setNameDialog("")}><Save className="mr-1.5 h-4 w-4" />Save as new list</Button>
                  {current && <Button size="sm" variant="outline" onClick={() => download(current)}><Download className="mr-1.5 h-4 w-4" />Export CSV</Button>}
                  {current && <Button size="sm" variant="outline" onClick={() => setEmailDialog({ subject: current.name, draftId: null })}><Mail className="mr-1.5 h-4 w-4" />Email this list</Button>}
                </div>
              </div>
            </Panel>

            <Panel title="Members" subtitle={data ? `${data.totalCount} match` : "Loading"}>
              {dataError ? <ErrorState message={dataError} onRetry={loadMembers} retryLabel="Try again" />
                : data === null ? <SkeletonRows rows={6} /> : (
                <>
                  <div className={`-mx-6 ${t.wrap}`}>
                    <table className={t.table}>
                      <thead className={t.head}>
                        <tr>
                          <th className={t.th}>Name</th>
                          <th className={t.th}>Email</th>
                          <th className={t.th}>Joined</th>
                          <th className={t.th}>Tags</th>
                          <th className={t.th}><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody className={t.body}>
                        {data.items.map((m) => (
                          <tr key={m.memberId} className={t.tr}>
                            <td className={`${t.td} font-semibold`}>{m.name}{m.isHonorary && <span className="ml-2 text-xs font-normal text-slate-500">Honorary</span>}</td>
                            <td className={t.tdMuted}>{m.email ?? "-"}</td>
                            <td className={t.tdMuted}>{m.joinedDate ? fmtDate(m.joinedDate) : "-"}</td>
                            <td className={t.td}>
                              <div className="flex flex-wrap gap-1">
                                {m.tagIds.map(tagById).filter((x): x is ClubTag => !!x).map((x) => <TagChip key={x.id} tag={x} />)}
                              </div>
                            </td>
                            <td className={`${t.td} text-right`}>
                              <button type="button" aria-label={`Edit tags and fields of ${m.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                                onClick={() => setEditing(m)}><Pencil className="h-3.5 w-3.5" /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.items.length === 0 && <p className="py-10 text-center text-[15px] text-[#64748B]">No members match this filter.</p>}
                  {totalPages > 1 && <div className="pt-3"><Pagination page={page} totalPages={totalPages} totalCount={data.totalCount} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>}
                </>
              )}
            </Panel>
          </div>
        </div>
      )}

      <MemberProfileDialog clubId={clubId} member={editing} tags={tags ?? []} onClose={() => setEditing(null)}
        onSaved={(message) => { setEditing(null); done(message); }} />

      <Dialog open={nameDialog !== null} onOpenChange={(o) => { if (!o) setNameDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Save as a list</DialogTitle></DialogHeader>
          <div className="space-y-1"><Label htmlFor="list-name">List name</Label>
            <Input id="list-name" value={nameDialog ?? ""} maxLength={100} onChange={(e) => setNameDialog(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button className="bg-azure text-white hover:bg-mint-ink" disabled={busy || !nameDialog?.trim()} onClick={() => saveAsNew(nameDialog!.trim())}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!emailDialog} onOpenChange={(o) => { if (!o) setEmailDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Email this list</DialogTitle></DialogHeader>
          {emailDialog?.draftId ? (
            <div className="space-y-3 text-sm text-slate-700">
              <p>A mass email draft addressed to the list&apos;s current members is ready. Write the message and send it from Mass Email.</p>
              <Link href="/club-admin-dashboard/communication?tab=massemail" className="inline-flex h-9 items-center rounded-full bg-azure px-4 font-medium text-white hover:bg-mint-ink">
                Open Mass Email
              </Link>
            </div>
          ) : (
            <div className="space-y-1"><Label htmlFor="email-subject">Subject</Label>
              <Input id="email-subject" value={emailDialog?.subject ?? ""} maxLength={200}
                onChange={(e) => emailDialog && setEmailDialog({ ...emailDialog, subject: e.target.value })} />
              <p className="text-xs text-slate-500">Recipients are the members on the list right now. Nothing is sent yet.</p>
            </div>
          )}
          <DialogFooter>
            {emailDialog?.draftId ? <Button variant="outline" onClick={() => setEmailDialog(null)}>Close</Button> : (
              <>
                <Button variant="outline" onClick={() => setEmailDialog(null)}>Cancel</Button>
                <Button className="bg-azure text-white hover:bg-mint-ink" disabled={busy} onClick={createDraft}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create draft
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertModal open={!!listToDelete} onOpenChange={(o) => { if (!o) setListToDelete(null); }} icon={AlertTriangle} iconClassName="text-destructive"
        title="Delete list" description={<>Delete the list <span className="font-semibold text-foreground">{listToDelete?.name}</span>? Members are not changed.</>}
        confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={() => {
          const l = listToDelete; setListToDelete(null);
          if (l) run(() => deleteSmartList(clubId, l.id).then(() => { if (current?.id === l.id) clear(); }), "List deleted.", "Could not delete the list.");
        }}
        cancelLabel="Cancel" onCancel={() => setListToDelete(null)} />
      <SuccessAlert open={!!success} title="Done" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
