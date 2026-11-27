"use client";

/**
 * Contacts of a club or a district (feature contacts_growth): non-members such as guests, speakers, sponsors,
 * partners and volunteers. Groups are the recipient lists for mass email and event invites; they do not need the
 * Sub Groups module.
 */

import { MenuItemButton } from "@/components/ui/text-buttons"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getContacts, createContact, updateContact, deleteContact, getContactGroups, createContactGroup,
  renameContactGroup, deleteContactGroup, exportContacts, getClubTags, setContactTags,
  type ClubTag, type Contact, type ContactGroup, type ContactScope, type SaveContact,
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
import { AlertTriangle, BookUser, Check, Copy, Download, HandHeart, Loader2, Pencil, Plus, Search, Send, Trash2, Upload, UserPlus, X } from "@/components/icons";
import ContactImportDialog from "./ContactImportDialog";
import DuplicatesDialog from "./DuplicatesDialog";
import EventInviteDialog from "./EventInviteDialog";
import InvitePromptsPanel from "./InvitePromptsPanel";
import MergeHistory from "./MergeHistory";
import TagChip from "@/components/member-flex/TagChip";

const PAGE_SIZE = 25;
const SELECT = "row-field";
const EMPTY: SaveContact = { name: "", email: "", mobile: "", contactType: "guest", organisation: "", notes: "", groupIds: [] };
const LINK = "inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50";

/** friendsOnly: the separate Friends of the club list (contacts of type friend). */
export default function ContactsManager({ scope, ownerId, friendsOnly = false }: { scope: ContactScope; ownerId: number; friendsOnly?: boolean }) {
  const base = scope === "clubs" ? "/club-admin-dashboard/contacts" : "/district-admin-dashboard/contacts";
  const [data, setData] = useState<PagedResult<Contact> | null>(null);
  const [groups, setGroups] = useState<ContactGroup[] | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState(friendsOnly ? "friend" : "");
  const [dupesOpen, setDupesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [groupId, setGroupId] = useState(0);
  // Club tags (member flexibility). Districts have no tags.
  const [tags, setTags] = useState<ClubTag[]>([]);
  const [tagId, setTagId] = useState(0);
  const [editTags, setEditTags] = useState<number[]>([]);
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
    getContacts(scope, ownerId, { search: search || undefined, type: type || undefined, groupId: groupId || undefined, tagId: tagId || undefined, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch((e) => {
        setData({ items: [], totalCount: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
        setError(errorText(e, "Could not load the contacts."));
      });
  }, [scope, ownerId, search, type, groupId, tagId, page]);
  const loadGroups = useCallback(() => {
    getContactGroups(scope, ownerId).then(setGroups).catch(() => setGroups([]));
  }, [scope, ownerId]);
  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => {
    if (scope === "clubs") getClubTags(ownerId).then(setTags).catch(() => setTags([]));
  }, [scope, ownerId]);

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
      const savedId = id ?? (await createContact(scope, ownerId, form)).id;
      if (id) await updateContact(scope, ownerId, id, form);
      if (scope === "clubs" && tags.length > 0) await setContactTags(ownerId, savedId, editTags);
      setEditing(null);
    }, id ? "Contact updated." : "Contact added.", "Could not save the contact.");
    setSaving(false);
  };

  const download = async (format: "xlsx" | "csv") => {
    setExporting(true);
    try { await exportContacts(scope, ownerId, format, { search: search || undefined, type: type || undefined, groupId: groupId || undefined }); }
    catch (e) { setError(errorText(e, "Could not export the contacts.")); }
    setExporting(false);
  };
  const newContact = () => { setEditTags([]); setEditing({ id: null, form: { ...EMPTY, contactType: friendsOnly ? "friend" : "guest" } }); };

  const groupName = (id: number) => groups?.find((g) => g.id === id)?.name;
  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {friendsOnly ? (
          <SectionHeader
            title={scope === "clubs" ? "Friends of the club" : "Friends of the district"}
            subtitle="People who are not members but get your emails and event invites. They are never counted as members, in attendance or in the Rotary.org sync. Pick the Friends list as the recipients in Mass Email or an event invite."
            icon={HandHeart}
          />
        ) : (
          <SectionHeader
            title="Contacts"
            subtitle="Guests, speakers, sponsors, partners, volunteers and friends who are not members. Groups work as email and event invite lists."
            icon={BookUser}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {friendsOnly ? (
            <Link href={base} className={LINK}><BookUser className="h-4 w-4" /> All contacts</Link>
          ) : (
            <>
              <Link href={`${base}/friends`} className={LINK}><HandHeart className="h-4 w-4" /> Friends of the {scope === "clubs" ? "club" : "district"}</Link>
              {scope === "clubs" && (
                <Link href={`/clubs/${ownerId}/rotary-network/potential-members/v2`} className={LINK}>
                  <UserPlus className="h-4 w-4" /> Prospects
                </Link>
              )}
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}><Send className="mr-1.5 h-4 w-4" />Invite to an event</Button>
          {!friendsOnly && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="mr-1.5 h-4 w-4" />Import</Button>}
          <Button variant="outline" size="sm" disabled={exporting} onClick={() => download("xlsx")}><Download className="mr-1.5 h-4 w-4" />Excel</Button>
          <Button variant="outline" size="sm" disabled={exporting} onClick={() => download("csv")}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
          <Button variant="outline" size="sm" onClick={() => setDupesOpen(true)}><Copy className="mr-1.5 h-4 w-4" />Find duplicates</Button>
          <Button size="sm" onClick={newContact}>
            <Plus className="mr-1.5 h-4 w-4" />{friendsOnly ? "Add friend" : "Add contact"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="space-y-3 xl:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name, email, phone, organisation"
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); setSearch(searchInput.trim()); } }} className="w-72 pl-8" />
            </div>
            {!friendsOnly && (
              <NativeSelect aria-label="Type" value={type} onChange={(e) => { setPage(1); setType(e.target.value); }} className="w-auto">
                <option value="">All types</option>
                {CONTACT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </NativeSelect>
            )}
            <NativeSelect aria-label="Group" value={groupId} onChange={(e) => { setPage(1); setGroupId(Number(e.target.value)); }} className="w-auto">
              <option value={0}>All groups</option>
              {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </NativeSelect>
            {tags.length > 0 && (
              <NativeSelect aria-label="Tag" value={tagId} onChange={(e) => { setPage(1); setTagId(Number(e.target.value)); }} className="w-auto">
                <option value={0}>All tags</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            )}
          </div>

          {data === null ? <TableSkeleton rows={8} /> : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table className="min-w-full text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 text-left">Name</TableHead>
                      <TableHead className="px-3 text-left">Type</TableHead>
                      <TableHead className="px-3 text-left">Email</TableHead>
                      <TableHead className="px-3 text-left">Phone</TableHead>
                      <TableHead className="px-3 text-left">Groups</TableHead>
                      <TableHead className="w-20 px-3 text-right"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100">
                    {data.items.map((c) => (
                      <TableRow key={c.id} className="hover:bg-slate-50">
                        <TableCell className="px-3 py-2">
                          <p className="font-medium text-slate-800">{c.name}</p>
                          {c.organisation && <p className="text-xs text-slate-500">{c.organisation}</p>}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-slate-600">{label(c.contactType)}</TableCell>
                        <TableCell className="px-3 py-2 text-slate-600">{c.email || "-"}</TableCell>
                        <TableCell className="whitespace-nowrap px-3 py-2 text-slate-600">{c.mobile || "-"}</TableCell>
                        <TableCell className="px-3 py-2 text-xs text-slate-600">
                          {c.groupIds.map(groupName).filter(Boolean).join(", ") || "-"}
                          {!!c.tagIds?.length && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {c.tagIds.map((t) => tags.find((x) => x.id === t)).filter((t): t is ClubTag => !!t).map((t) => <TagChip key={t.id} tag={t} />)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right">
                          <IconButton type="button" aria-label={`Edit ${c.name}`} 
                            onClick={() => { setEditTags(c.tagIds ?? []); setEditing({ id: c.id, form: { name: c.name, email: c.email ?? "", mobile: c.mobile ?? "",
                              contactType: c.contactType, organisation: c.organisation ?? "", notes: c.notes ?? "", groupIds: c.groupIds } }); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton type="button" aria-label={`Delete ${c.name}`} className="hover:text-red-700"
                            onClick={() => setToDelete(c)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.items.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="px-4 py-10 text-center text-slate-400">
                        {friendsOnly
                          ? (search || groupId || tagId ? "No friends match these filters." : "No friends of the club yet. Add one, or set a contact's type to Friend of the club.")
                          : search || type || groupId || tagId ? "No contacts match these filters." : "No contacts yet. Add one or import a spreadsheet."}
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="border-t border-slate-100 px-3 py-2">
                  <Pagination page={page} totalPages={totalPages} totalCount={data.totalCount} pageSize={PAGE_SIZE} onPageChange={setPage} />
                </div>
              )}
            </Card>
          )}
        </div>

        <aside className="row-card row-rise h-fit p-5">
          <h3 className="row-h3">Groups</h3>
          <p className="mt-0.5 text-xs text-slate-500">Pick a group as the recipients of a mass email or an event invite.</p>
          <div className="mt-3 space-y-1">
            {groups === null ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />) : groups.map((g) => (
              <div key={g.id} className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-slate-50">
                {renaming?.id === g.id ? (
                  <>
                    <Input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: g.id, name: e.target.value })} className="row-field-sm flex-1" />
                    <IconButton type="button" aria-label="Save name" 
                      onClick={() => run(() => renameContactGroup(scope, ownerId, g.id, renaming.name).then(() => setRenaming(null)), "Group renamed.", "Could not rename the group.")}>
                      <Check className="h-4 w-4" />
                    </IconButton>
                    <IconButton type="button" aria-label="Cancel"  onClick={() => setRenaming(null)}><X className="h-4 w-4" /></IconButton>
                  </>
                ) : (
                  <>
                    <MenuItemButton selected={groupId === g.id} className="flex-1 truncate" type="button"
                      onClick={() => { setPage(1); setGroupId(groupId === g.id ? 0 : g.id); }}>
                      {g.name} <span className="text-xs text-slate-400">({g.contactCount})</span>
                    </MenuItemButton>
                    <IconButton type="button" aria-label={`Rename ${g.name}`}  onClick={() => setRenaming({ id: g.id, name: g.name })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    {/* the friends list follows the contacts' type, so it is not deleted by hand */}
                    {!g.systemKey && (
                      <IconButton type="button" aria-label={`Delete ${g.name}`} className="hover:text-red-700" onClick={() => setGroupToDelete(g)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
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
            <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New group" maxLength={100} className="row-field-sm" />
            <Button type="submit" size="sm" variant="outline" aria-label="Add group" disabled={!newGroup.trim()}><Plus className="h-4 w-4" /></Button>
          </form>
        </aside>
      </div>

      {scope === "clubs" && !friendsOnly && <InvitePromptsPanel clubId={ownerId} />}

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
                <NativeSelect id="c-type" value={editing.form.contactType} onChange={(e) => set({ contactType: e.target.value })} >
                  {CONTACT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </NativeSelect></div>
              <div className="space-y-1"><Label htmlFor="c-org">Organisation</Label>
                <Input id="c-org" value={editing.form.organisation ?? ""} maxLength={200} onChange={(e) => set({ organisation: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="c-notes">Notes</Label>
                <Textarea id="c-notes" rows={3} maxLength={1000} value={editing.form.notes ?? ""} onChange={(e) => set({ notes: e.target.value })}
                   /></div>
              {!!groups?.some((g) => !g.systemKey) && (
                <div className="space-y-1 sm:col-span-2">
                  <Label>Groups</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {groups.filter((g) => !g.systemKey).map((g) => (
                      <label key={g.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={editing.form.groupIds?.includes(g.id) ?? false} onCheckedChange={(on) => set({
                          groupIds: on ? [...(editing.form.groupIds ?? []), g.id] : (editing.form.groupIds ?? []).filter((x) => x !== g.id) })} />
                        {g.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {editing.id && <MergeHistory scope={scope} ownerId={ownerId} contactId={editing.id} />}
              {scope === "clubs" && tags.length > 0 && (
                <div className="space-y-1 sm:col-span-2">
                  <Label>Tags</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {tags.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={editTags.includes(t.id)}
                          onCheckedChange={(on) => setEditTags((p) => (on ? [...p, t.id] : p.filter((x) => x !== t.id)))} />
                        <TagChip tag={t} />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={saving} onClick={save}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ContactImportDialog open={importOpen} onClose={() => setImportOpen(false)} scope={scope} ownerId={ownerId} groups={groups ?? []}
        onDone={(message) => { setImportOpen(false); refresh(message); }} />
      <EventInviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} scope={scope} ownerId={ownerId} groups={groups ?? []}
        onDone={(message) => { setInviteOpen(false); setSuccess(message); }} />
      <DuplicatesDialog open={dupesOpen} onClose={() => setDupesOpen(false)} scope={scope} ownerId={ownerId}
        onMerged={() => { loadContacts(); loadGroups(); }} />

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
