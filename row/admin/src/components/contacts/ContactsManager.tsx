"use client";

/**
 * Contacts of a club or a district (feature contacts_growth): non-members such as guests, speakers, sponsors,
 * partners and volunteers. Groups are the recipient lists for mass email and event invites; they do not need the
 * Sub Groups module.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getContacts, createContact, updateContact, deleteContact, getContactGroups, createContactGroup,
  renameContactGroup, deleteContactGroup,
  type Contact, type ContactGroup, type ContactScope, type SaveContact,
} from "@/services/api";
import type { PagedResult } from "@/types/member";
import { CONTACT_TYPES, errorText, label } from "@/lib/contacts";
import SectionHeader from "@/components/dashboard/SectionHeader";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import Pagination from "@/components/Pagination";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, BookUser, Check, Loader2, Pencil, Plus, Search, Send, Trash2, Upload, UserPlus, X } from "@/components/icons";
import ContactImportDialog from "./ContactImportDialog";
import EventInviteDialog from "./EventInviteDialog";
import InvitePromptsPanel from "./InvitePromptsPanel";

const PAGE_SIZE = 25;
const SELECT = "h-9 rounded-md border border-input bg-background px-3 text-sm";
const EMPTY: SaveContact = { name: "", email: "", mobile: "", contactType: "guest", organisation: "", notes: "", groupIds: [] };

export default function ContactsManager({ scope, ownerId }: { scope: ContactScope; ownerId: number }) {
  const [data, setData] = useState<PagedResult<Contact> | null>(null);
  const [groups, setGroups] = useState<ContactGroup[] | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [groupId, setGroupId] = useState(0);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ id: number | null; form: SaveContact } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Contact | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<ContactGroup | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadContacts = useCallback(() => {
    setData(null);
    getContacts(scope, ownerId, { search: search || undefined, type: type || undefined, groupId: groupId || undefined, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch((e) => {
        setData({ items: [], totalCount: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
        setError(errorText(e, "Could not load the contacts."));
      });
  }, [scope, ownerId, search, type, groupId, page]);
  const loadGroups = useCallback(() => {
    getContactGroups(scope, ownerId).then(setGroups).catch(() => setGroups([]));
  }, [scope, ownerId]);
  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const refresh = (message: string) => { setSuccess(message); loadContacts(); loadGroups(); };
  const set = (patch: Partial<SaveContact>) => setEditing((e) => e && { ...e, form: { ...e.form, ...patch } });
  const run = async (work: () => Promise<unknown>, done: string, failed: string) => {
    try { await work(); refresh(done); } catch (e) { setError(errorText(e, failed)); }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.form.name.trim()) { setError("Please enter a name."); return; }
    setSaving(true);
    const { id, form } = editing;
    await run(async () => {
      if (id) await updateContact(scope, ownerId, id, form);
      else await createContact(scope, ownerId, form);
      setEditing(null);
    }, id ? "Contact updated." : "Contact added.", "Could not save the contact.");
    setSaving(false);
  };

  const groupName = (id: number) => groups?.find((g) => g.id === id)?.name;
  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <SectionHeader
          title="Contacts"
          subtitle="Guests, speakers, sponsors, partners and volunteers who are not members. Groups work as email and event invite lists."
          icon={BookUser}
        />
        <div className="flex flex-wrap gap-2">
          {scope === "clubs" && (
            <Link href={`/clubs/${ownerId}/rotary-network/potential-members/v2`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <UserPlus className="h-4 w-4" /> Prospects
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}><Send className="mr-1.5 h-4 w-4" />Invite to an event</Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="mr-1.5 h-4 w-4" />Import</Button>
          <Button size="sm" className="bg-azure text-white hover:bg-mint-ink" onClick={() => setEditing({ id: null, form: { ...EMPTY } })}>
            <Plus className="mr-1.5 h-4 w-4" />Add contact
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="space-y-3 xl:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name, email, phone, organisation"
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); setSearch(searchInput.trim()); } }} className="h-9 w-72 pl-8" />
            </div>
            <select aria-label="Type" value={type} onChange={(e) => { setPage(1); setType(e.target.value); }} className={SELECT}>
              <option value="">All types</option>
              {CONTACT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
            <select aria-label="Group" value={groupId} onChange={(e) => { setPage(1); setGroupId(Number(e.target.value)); }} className={SELECT}>
              <option value={0}>All groups</option>
              {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>

          {data === null ? <TableSkeleton rows={8} /> : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Name</th>
                      <th className="px-3 py-2.5 text-left">Type</th>
                      <th className="px-3 py-2.5 text-left">Email</th>
                      <th className="px-3 py-2.5 text-left">Phone</th>
                      <th className="px-3 py-2.5 text-left">Groups</th>
                      <th className="w-20 px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-800">{c.name}</p>
                          {c.organisation && <p className="text-xs text-slate-500">{c.organisation}</p>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{label(c.contactType)}</td>
                        <td className="px-3 py-2 text-slate-600">{c.email || "-"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{c.mobile || "-"}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{c.groupIds.map(groupName).filter(Boolean).join(", ") || "-"}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" aria-label={`Edit ${c.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                            onClick={() => setEditing({ id: c.id, form: { name: c.name, email: c.email ?? "", mobile: c.mobile ?? "",
                              contactType: c.contactType, organisation: c.organisation ?? "", notes: c.notes ?? "", groupIds: c.groupIds } })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" aria-label={`Delete ${c.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setToDelete(c)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {data.items.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                        {search || type || groupId ? "No contacts match these filters." : "No contacts yet. Add one or import a spreadsheet."}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="border-t border-slate-100 px-3 py-2">
                  <Pagination page={page} totalPages={totalPages} totalCount={data.totalCount} pageSize={PAGE_SIZE} onPageChange={setPage} />
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="h-fit rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Groups</h3>
          <p className="mt-0.5 text-xs text-slate-500">Pick a group as the recipients of a mass email or an event invite.</p>
          <div className="mt-3 space-y-1">
            {groups === null ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />) : groups.map((g) => (
              <div key={g.id} className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-slate-50">
                {renaming?.id === g.id ? (
                  <>
                    <Input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: g.id, name: e.target.value })} className="h-7 flex-1 text-sm" />
                    <button type="button" aria-label="Save name" className="p-1 text-emerald-700"
                      onClick={() => run(() => renameContactGroup(scope, ownerId, g.id, renaming.name).then(() => setRenaming(null)), "Group renamed.", "Could not rename the group.")}>
                      <Check className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Cancel" className="p-1 text-slate-400" onClick={() => setRenaming(null)}><X className="h-4 w-4" /></button>
                  </>
                ) : (
                  <>
                    <button type="button" className={`flex-1 truncate text-left text-sm ${groupId === g.id ? "font-semibold text-azure" : "text-slate-700"}`}
                      onClick={() => { setPage(1); setGroupId(groupId === g.id ? 0 : g.id); }}>
                      {g.name} <span className="text-xs text-slate-400">({g.contactCount})</span>
                    </button>
                    <button type="button" aria-label={`Rename ${g.name}`} className="p-1 text-slate-400 hover:text-slate-700" onClick={() => setRenaming({ id: g.id, name: g.name })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label={`Delete ${g.name}`} className="p-1 text-slate-400 hover:text-rose-700" onClick={() => setGroupToDelete(g)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
            {groups?.length === 0 && <p className="py-2 text-xs text-slate-400">No groups yet.</p>}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (newGroup.trim()) run(() => createContactGroup(scope, ownerId, newGroup.trim()).then(() => setNewGroup("")), "Group added.", "Could not add the group.");
          }}>
            <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New group" maxLength={100} className="h-8 text-sm" />
            <Button type="submit" size="sm" variant="outline" disabled={!newGroup.trim()}><Plus className="h-4 w-4" /></Button>
          </form>
        </aside>
      </div>

      {scope === "clubs" && <InvitePromptsPanel clubId={ownerId} />}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit contact" : "Add contact"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="c-name">Name *</Label>
                <Input id="c-name" value={editing.form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="c-email">Email</Label>
                <Input id="c-email" type="email" value={editing.form.email ?? ""} maxLength={200} onChange={(e) => set({ email: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="c-mobile">Phone</Label>
                <Input id="c-mobile" value={editing.form.mobile ?? ""} maxLength={30} onChange={(e) => set({ mobile: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="c-type">Type</Label>
                <select id="c-type" value={editing.form.contactType} onChange={(e) => set({ contactType: e.target.value })} className={`${SELECT} w-full`}>
                  {CONTACT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </select></div>
              <div className="space-y-1"><Label htmlFor="c-org">Organisation</Label>
                <Input id="c-org" value={editing.form.organisation ?? ""} maxLength={200} onChange={(e) => set({ organisation: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="c-notes">Notes</Label>
                <textarea id="c-notes" rows={3} maxLength={1000} value={editing.form.notes ?? ""} onChange={(e) => set({ notes: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
              {!!groups?.length && (
                <div className="space-y-1 sm:col-span-2">
                  <Label>Groups</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {groups.map((g) => (
                      <label key={g.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={editing.form.groupIds?.includes(g.id) ?? false} onCheckedChange={(on) => set({
                          groupIds: on ? [...(editing.form.groupIds ?? []), g.id] : (editing.form.groupIds ?? []).filter((x) => x !== g.id) })} />
                        {g.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="bg-azure text-white hover:bg-mint-ink" disabled={saving} onClick={save}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ContactImportDialog open={importOpen} onClose={() => setImportOpen(false)} scope={scope} ownerId={ownerId} groups={groups ?? []}
        onDone={(message) => { setImportOpen(false); refresh(message); }} />
      <EventInviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} scope={scope} ownerId={ownerId} groups={groups ?? []}
        onDone={(message) => { setInviteOpen(false); setSuccess(message); }} />

      <AlertModal open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }} icon={AlertTriangle} iconClassName="text-destructive"
        title="Delete contact" description={<>Delete <span className="font-semibold text-foreground">{toDelete?.name}</span>? This removes their details.</>}
        confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={() => { const c = toDelete; setToDelete(null); if (c) run(() => deleteContact(scope, ownerId, c.id), "Contact deleted.", "Could not delete the contact."); }}
        cancelLabel="Cancel" onCancel={() => setToDelete(null)} />
      <AlertModal open={!!groupToDelete} onOpenChange={(o) => { if (!o) setGroupToDelete(null); }} icon={AlertTriangle} iconClassName="text-destructive"
        title="Delete group" description={<>Delete the group <span className="font-semibold text-foreground">{groupToDelete?.name}</span>? Its contacts stay.</>}
        confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={() => {
          const g = groupToDelete; setGroupToDelete(null);
          if (g) run(() => deleteContactGroup(scope, ownerId, g.id).then(() => { if (groupId === g.id) setGroupId(0); }), "Group deleted.", "Could not delete the group.");
        }}
        cancelLabel="Cancel" onCancel={() => setGroupToDelete(null)} />
      <SuccessAlert open={!!success} title="Done" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
