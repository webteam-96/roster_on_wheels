"use client";

/**
 * Club tags and custom profile fields (member flexibility). Tags label members and contacts; profile fields add
 * club-defined questions to every member's profile, visible to admins only or to the club's members too.
 */

import { useState } from "react";
import {
  createClubTag, updateClubTag, deleteClubTag, createProfileField, updateProfileField, deleteProfileField,
  type ClubTag, type ProfileField, type ProfileFieldType, type SaveProfileField,
} from "@/services/api";
import { errorText } from "@/lib/contacts";
import { Panel, SkeletonRows } from "@/components/row/AppKit";
import AlertModal from "@/components/AlertModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Pencil, Plus, Trash2 } from "@/components/icons";
import TagChip from "./TagChip";

const SELECT = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
export const FIELD_TYPE_LABEL: Record<ProfileFieldType, string> = {
  text: "Text", number: "Number", date: "Date", choice: "Choice", yesno: "Yes / No",
};
const EMPTY_FIELD: SaveProfileField = { label: "", fieldType: "text", options: [], visibility: "admins", sortOrder: 0 };

type Props = {
  clubId: number;
  tags: ClubTag[] | null;
  fields: ProfileField[] | null;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
};

export default function TagsAndFieldsSettings({ clubId, tags, fields, onChanged, onError }: Props) {
  const [tagEdit, setTagEdit] = useState<{ id: number | null; name: string; color: string } | null>(null);
  const [fieldEdit, setFieldEdit] = useState<{ id: number | null; form: SaveProfileField; optionsText: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<ClubTag | null>(null);
  const [fieldToDelete, setFieldToDelete] = useState<ProfileField | null>(null);

  const run = async (work: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(true);
    try { await work(); onChanged(done); return true; } catch (e) { onError(errorText(e, failed)); return false; } finally { setBusy(false); }
  };

  const saveTag = async () => {
    if (!tagEdit) return;
    const body = { name: tagEdit.name.trim(), color: tagEdit.color };
    if (!body.name) { onError("Please enter a tag name."); return; }
    const ok = await run(() => (tagEdit.id ? updateClubTag(clubId, tagEdit.id, body) : createClubTag(clubId, body)),
      tagEdit.id ? "Tag saved." : "Tag added.", "Could not save the tag.");
    if (ok) setTagEdit(null);
  };

  const saveField = async () => {
    if (!fieldEdit) return;
    const form = { ...fieldEdit.form, label: fieldEdit.form.label.trim(),
      options: fieldEdit.optionsText.split("\n").map((o) => o.trim()).filter(Boolean) };
    if (!form.label) { onError("Please enter a field name."); return; }
    const ok = await run(() => (fieldEdit.id ? updateProfileField(clubId, fieldEdit.id, form) : createProfileField(clubId, form)),
      fieldEdit.id ? "Field saved." : "Field added.", "Could not save the field.");
    if (ok) setFieldEdit(null);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="Tags" subtitle="Labels for members and contacts, such as Golf, Major donor or New this year."
        headerRight={<Button size="sm" variant="outline" onClick={() => setTagEdit({ id: null, name: "", color: "#17458F" })}><Plus className="mr-1.5 h-4 w-4" />Add tag</Button>}>
        {tags === null ? <SkeletonRows rows={3} /> : tags.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No tags yet. Add one to start labelling members and contacts.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <TagChip tag={t} />
                <span className="flex-1 text-xs text-slate-500">{t.memberCount} members, {t.contactCount} contacts</span>
                <button type="button" aria-label={`Edit ${t.name}`} className="p-1 text-slate-400 hover:text-slate-700"
                  onClick={() => setTagEdit({ id: t.id, name: t.name, color: t.color })}><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label={`Delete ${t.name}`} className="p-1 text-slate-400 hover:text-rose-700"
                  onClick={() => setTagToDelete(t)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Profile fields" subtitle="Extra questions on every member's profile in this club."
        headerRight={<Button size="sm" variant="outline" onClick={() => setFieldEdit({ id: null, form: { ...EMPTY_FIELD }, optionsText: "" })}><Plus className="mr-1.5 h-4 w-4" />Add field</Button>}>
        {fields === null ? <SkeletonRows rows={3} /> : fields.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No profile fields yet. Add one, for example Spouse name or Shirt size.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800">{f.label}</p>
                  <p className="text-xs text-slate-500">
                    {FIELD_TYPE_LABEL[f.fieldType]}{f.fieldType === "choice" ? `: ${f.options.join(", ")}` : ""} · {f.visibility === "members" ? "Members can see it" : "Admins only"}
                  </p>
                </div>
                <button type="button" aria-label={`Edit ${f.label}`} className="p-1 text-slate-400 hover:text-slate-700"
                  onClick={() => setFieldEdit({ id: f.id, form: { label: f.label, fieldType: f.fieldType, options: f.options, visibility: f.visibility, sortOrder: f.sortOrder }, optionsText: f.options.join("\n") })}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label={`Delete ${f.label}`} className="p-1 text-slate-400 hover:text-rose-700"
                  onClick={() => setFieldToDelete(f)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog open={!!tagEdit} onOpenChange={(o) => { if (!o) setTagEdit(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{tagEdit?.id ? "Edit tag" : "Add tag"}</DialogTitle></DialogHeader>
          {tagEdit && (
            <div className="space-y-3">
              <div className="space-y-1"><Label htmlFor="tag-name">Name</Label>
                <Input id="tag-name" value={tagEdit.name} maxLength={50} onChange={(e) => setTagEdit({ ...tagEdit, name: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="tag-color">Colour</Label>
                <div className="flex items-center gap-3">
                  <input id="tag-color" type="color" value={tagEdit.color} onChange={(e) => setTagEdit({ ...tagEdit, color: e.target.value })}
                    className="h-9 w-14 cursor-pointer rounded border border-input bg-background" />
                  <TagChip tag={{ name: tagEdit.name || "Preview", color: tagEdit.color }} />
                </div></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagEdit(null)}>Cancel</Button>
            <Button className="bg-azure text-white hover:bg-mint-ink" disabled={busy} onClick={saveTag}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fieldEdit} onOpenChange={(o) => { if (!o) setFieldEdit(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{fieldEdit?.id ? "Edit profile field" : "Add profile field"}</DialogTitle></DialogHeader>
          {fieldEdit && (
            <div className="space-y-3">
              <div className="space-y-1"><Label htmlFor="pf-label">Name</Label>
                <Input id="pf-label" value={fieldEdit.form.label} maxLength={100}
                  onChange={(e) => setFieldEdit({ ...fieldEdit, form: { ...fieldEdit.form, label: e.target.value } })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="pf-type">Type</Label>
                  <select id="pf-type" className={SELECT} value={fieldEdit.form.fieldType} disabled={!!fieldEdit.id}
                    onChange={(e) => setFieldEdit({ ...fieldEdit, form: { ...fieldEdit.form, fieldType: e.target.value as ProfileFieldType } })}>
                    {(Object.keys(FIELD_TYPE_LABEL) as ProfileFieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
                  </select></div>
                <div className="space-y-1"><Label htmlFor="pf-vis">Who can see it</Label>
                  <select id="pf-vis" className={SELECT} value={fieldEdit.form.visibility}
                    onChange={(e) => setFieldEdit({ ...fieldEdit, form: { ...fieldEdit.form, visibility: e.target.value as "admins" | "members" } })}>
                    <option value="admins">Admins only</option>
                    <option value="members">Club members</option>
                  </select></div>
              </div>
              {fieldEdit.id && <p className="text-xs text-slate-500">The type cannot change once the field exists.</p>}
              {fieldEdit.form.fieldType === "choice" && (
                <div className="space-y-1"><Label htmlFor="pf-options">Options, one per line</Label>
                  <textarea id="pf-options" rows={4} value={fieldEdit.optionsText}
                    onChange={(e) => setFieldEdit({ ...fieldEdit, optionsText: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
              )}
              <div className="space-y-1"><Label htmlFor="pf-order">Order</Label>
                <Input id="pf-order" type="number" value={fieldEdit.form.sortOrder}
                  onChange={(e) => setFieldEdit({ ...fieldEdit, form: { ...fieldEdit.form, sortOrder: Number(e.target.value) || 0 } })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFieldEdit(null)}>Cancel</Button>
            <Button className="bg-azure text-white hover:bg-mint-ink" disabled={busy} onClick={saveField}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertModal open={!!tagToDelete} onOpenChange={(o) => { if (!o) setTagToDelete(null); }} icon={AlertTriangle} iconClassName="text-destructive"
        title="Delete tag" description={<>Delete <span className="font-semibold text-foreground">{tagToDelete?.name}</span>? It is removed from every member and contact.</>}
        confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={() => { const t = tagToDelete; setTagToDelete(null); if (t) run(() => deleteClubTag(clubId, t.id), "Tag deleted.", "Could not delete the tag."); }}
        cancelLabel="Cancel" onCancel={() => setTagToDelete(null)} />
      <AlertModal open={!!fieldToDelete} onOpenChange={(o) => { if (!o) setFieldToDelete(null); }} icon={AlertTriangle} iconClassName="text-destructive"
        title="Delete profile field" description={<>Delete <span className="font-semibold text-foreground">{fieldToDelete?.label}</span>? Every member's answer to it is deleted too.</>}
        confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={() => { const f = fieldToDelete; setFieldToDelete(null); if (f) run(() => deleteProfileField(clubId, f.id), "Field deleted.", "Could not delete the field."); }}
        cancelLabel="Cancel" onCancel={() => setFieldToDelete(null)} />
    </div>
  );
}
