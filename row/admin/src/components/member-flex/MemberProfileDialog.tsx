"use client";

// A member's club tags and custom profile field answers (member flexibility). Club admins edit both here.

import { useEffect, useState } from "react";
import {
  getMemberProfileFields, saveMemberProfileFields, setMemberTags,
  type ClubTag, type ProfileFieldValue, type SmartListMember,
} from "@/services/api";
import { errorText } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "@/components/icons";
import TagChip from "./TagChip";

const SELECT = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

type Props = {
  clubId: number;
  member: SmartListMember | null;
  tags: ClubTag[];
  onClose: () => void;
  onSaved: (message: string) => void;
};

export default function MemberProfileDialog({ clubId, member, tags, onClose, onSaved }: Props) {
  const [fields, setFields] = useState<ProfileFieldValue[] | null>(null);
  const [values, setValues] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<number[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!member) return;
    setFields(null); setLoadError(null); setError(null); setPicked(member.tagIds);
    getMemberProfileFields(clubId, member.memberId)
      .then((f) => { setFields(f); setValues(Object.fromEntries(f.map((x) => [x.id, x.value ?? ""]))); })
      .catch((e) => { setFields([]); setLoadError(errorText(e, "Could not load the profile fields.")); });
  }, [clubId, member]);

  const save = async () => {
    if (!member) return;
    setBusy(true); setError(null);
    try {
      await setMemberTags(clubId, member.memberId, picked);
      if (fields && fields.length > 0)
        await saveMemberProfileFields(clubId, member.memberId, fields.map((f) => ({ fieldId: f.id, value: values[f.id]?.trim() || null })));
      onSaved(`${member.name} saved.`);
    } catch (e) { setError(errorText(e, "Could not save.")); } finally { setBusy(false); }
  };

  const input = (f: ProfileFieldValue) => {
    const v = values[f.id] ?? "";
    const set = (x: string) => setValues((p) => ({ ...p, [f.id]: x }));
    const id = `pfv-${f.id}`;
    if (f.fieldType === "choice" || f.fieldType === "yesno") {
      const options = f.fieldType === "yesno" ? ["yes", "no"] : f.options;
      return (
        <select id={id} className={SELECT} value={v} onChange={(e) => set(e.target.value)}>
          <option value="">Not set</option>
          {options.map((o) => <option key={o} value={o}>{f.fieldType === "yesno" ? (o === "yes" ? "Yes" : "No") : o}</option>)}
        </select>
      );
    }
    return <Input id={id} value={v} onChange={(e) => set(e.target.value)} maxLength={1000}
      type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : "text"} />;
  };

  return (
    <Dialog open={!!member} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{member?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">Tags</p>
            {tags.length === 0 ? <p className="text-sm text-slate-500">No tags yet. Add tags under Settings.</p> : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={picked.includes(t.id)} onCheckedChange={(on) => setPicked((p) => (on ? [...p, t.id] : p.filter((x) => x !== t.id)))} />
                    <TagChip tag={t} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Profile fields</p>
            {fields === null ? <><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></>
              : loadError ? <p className="text-sm text-rose-700">{loadError}</p>
              : fields.length === 0 ? <p className="text-sm text-slate-500">No profile fields yet. Add them under Settings.</p>
              : fields.map((f) => (
                <div key={f.id} className="space-y-1">
                  <Label htmlFor={`pfv-${f.id}`}>{f.label} <span className="text-xs font-normal text-slate-400">{f.visibility === "members" ? "(members can see)" : "(admins only)"}</span></Label>
                  {input(f)}
                </div>
              ))}
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-azure text-white hover:bg-mint-ink" disabled={busy || fields === null} onClick={save}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
