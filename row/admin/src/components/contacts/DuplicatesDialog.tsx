"use client";

/**
 * Possible duplicate contacts (same email, phone or name) and a field-by-field merge. The kept contact keeps its
 * history and links; group memberships and records that point at the others move to it, and a snapshot of each
 * merged contact is kept (see the merge history in the contact form).
 */

import { useCallback, useEffect, useState } from "react";
import {
  getContactDuplicates, mergeContacts,
  type Contact, type ContactDuplicateGroup, type ContactMergeField, type ContactScope,
} from "@/services/api";
import { errorText, label } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "@/components/icons";

const FIELDS: { key: ContactMergeField; title: string }[] = [
  { key: "name", title: "Name" }, { key: "email", title: "Email" }, { key: "mobile", title: "Phone" },
  { key: "contactType", title: "Type" }, { key: "organisation", title: "Organisation" }, { key: "notes", title: "Notes" },
];

const value = (c: Contact, f: ContactMergeField) => (f === "contactType" ? label(c.contactType) : (c[f] as string | null) || "");

/** Default pick: the kept contact's value, else the first contact that has one. */
export function defaultSources(contacts: Contact[], keepId: number): Record<ContactMergeField, number> {
  const ordered = [...contacts.filter((c) => c.id === keepId), ...contacts.filter((c) => c.id !== keepId)];
  return Object.fromEntries(FIELDS.map(({ key }) => [key, (ordered.find((c) => value(c, key)) ?? ordered[0]).id])) as Record<ContactMergeField, number>;
}

function MergeCard({ group, scope, ownerId, onMerged, onError }: {
  group: ContactDuplicateGroup; scope: ContactScope; ownerId: number; onMerged: (name: string) => void; onError: (m: string) => void;
}) {
  const [keepId, setKeepId] = useState(group.contacts[0].id);
  const [sources, setSources] = useState(() => defaultSources(group.contacts, group.contacts[0].id));
  const [busy, setBusy] = useState(false);

  const keep = (id: number) => { setKeepId(id); setSources(defaultSources(group.contacts, id)); };
  const merge = async () => {
    setBusy(true);
    try {
      const kept = await mergeContacts(scope, ownerId, keepId, group.contacts.map((c) => c.id).filter((id) => id !== keepId), sources);
      onMerged(kept.name);
    } catch (e) { onError(errorText(e, "Could not merge the contacts.")); }
    setBusy(false);
  };

  return (
    <section className="rounded-[16px] border border-slate-200 bg-white p-3">
      <p className="mb-2 text-xs text-slate-500">{group.reasons.join(", ")}</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-[13px] text-slate-500">
              <th className="w-28 px-2 py-1.5 font-medium">Keep</th>
              {group.contacts.map((c) => (
                <th key={c.id} className="px-2 py-1.5 font-medium">
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`keep-${group.contacts[0].id}`} checked={keepId === c.id} onChange={() => keep(c.id)} />
                    <span className="text-slate-700">Added {new Date(c.createdDate).toLocaleDateString()}</span>
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {FIELDS.map(({ key, title }) => (
              <tr key={key}>
                <th scope="row" className="px-2 py-1.5 text-left text-[13px] font-medium text-slate-500">{title}</th>
                {group.contacts.map((c) => (
                  <td key={c.id} className="px-2 py-1.5 align-top">
                    <label className="flex items-start gap-2">
                      <input type="radio" name={`${key}-${group.contacts[0].id}`} aria-label={`${title} from ${c.name}`}
                        checked={sources[key] === c.id} onChange={() => setSources((s) => ({ ...s, [key]: c.id }))} className="mt-1" />
                      <span className={value(c, key) ? "text-slate-800" : "text-slate-400"}>{value(c, key) || "(blank)"}</span>
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end">
        <Button size="sm" className="bg-azure text-white hover:bg-mint-ink" disabled={busy} onClick={merge}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Merge into one contact
        </Button>
      </div>
    </section>
  );
}

export default function DuplicatesDialog({ open, onClose, scope, ownerId, onMerged }: {
  open: boolean; onClose: () => void; scope: ContactScope; ownerId: number; onMerged: (message: string) => void;
}) {
  const [groups, setGroups] = useState<ContactDuplicateGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setGroups(null); setError(null);
    getContactDuplicates(scope, ownerId).then(setGroups).catch((e) => { setGroups([]); setError(errorText(e, "Could not look for duplicates.")); });
  }, [scope, ownerId]);
  useEffect(() => { if (open) load(); }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Possible duplicates</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-500">
          Contacts with the same email, phone number or name. Pick the contact to keep and, for each field, the value to keep.
          The others are folded into it: their groups and links move over and a copy of what they held is kept in its history.
        </p>
        {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {groups === null ? (
          <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}</div>
        ) : groups.length === 0 && !error ? (
          <p className="py-8 text-center text-sm text-slate-400">No possible duplicates found.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <MergeCard key={g.contacts.map((c) => c.id).join("-")} group={g} scope={scope} ownerId={ownerId}
                onMerged={(name) => { onMerged(`Contacts merged into ${name}.`); load(); }} onError={setError} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
