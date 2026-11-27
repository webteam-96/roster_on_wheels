"use client";

// Who hears about a new prospect and how (feature contacts_growth). The same channels carry the follow-up task
// notices to the assigned member.

import { LinkButton } from "@/components/ui/text-buttons"
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import {
  getClubMembers, getProspectNotifySettings, saveProspectNotifySettings, type ProspectNotifySettings,
} from "@/services/api";
import { errorText } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Bell, Search } from "@/components/icons";

type Props = { clubId: number; canManage: boolean };

export default function ProspectNotifySettingsCard({ clubId, canManage }: Props) {
  const [s, setS] = useState<ProspectNotifySettings | null>(null);
  const [members, setMembers] = useState<{ id: number; memberName: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    Promise.all([getProspectNotifySettings(clubId), getClubMembers(clubId, 1, 500)])
      .then(([settings, list]) => {
        if (cancelled) return;
        setS(settings);
        setMembers(list.items);
      })
      .catch((e) => { if (!cancelled) setLoadError(errorText(e, "Could not load the notification settings.")); });
    return () => { cancelled = true; };
  }, [clubId, attempt]);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    setMessage(null);
    try {
      setS(await saveProspectNotifySettings(clubId, {
        toPresident: s.toPresident, toMembershipChair: s.toMembershipChair, memberIds: s.memberIds, inApp: s.inApp, email: s.email,
      }));
      setMessage({ ok: true, text: "Notification settings saved." });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e, "Could not save the settings.") });
    } finally {
      setSaving(false);
    }
  };

  const toggleMember = (id: number) =>
    s && setS({ ...s, memberIds: s.memberIds.includes(id) ? s.memberIds.filter((m) => m !== id) : [...s.memberIds, id] });

  const shown = members.filter((m) => m.memberName.toLowerCase().includes(filter.trim().toLowerCase()));
  const holders = (names: string[]) => (names.length ? names.join(", ") : "nobody holds this role this year");

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <Bell className="h-4 w-4 text-slate-500" />
        <h3 className="row-h3">New prospect notifications</h3>
      </div>
      {loadError ? (
        <div className="px-4 py-6 text-sm text-rose-700">
          {loadError}{" "}
          <LinkButton type="button" onClick={() => setAttempt((a) => a + 1)}>Try again</LinkButton>
        </div>
      ) : !s ? (
        <div className="space-y-3 p-4" aria-label="Loading settings">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
      ) : (
        <fieldset disabled={!canManage || saving} className="grid grid-cols-1 gap-5 p-4 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-700">Who is told</p>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={s.toPresident} onChange={(e) => setS({ ...s, toPresident: e.target.checked })} />
              <span>Club President <span className="block text-xs text-slate-500">{holders(s.presidents)}</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={s.toMembershipChair} onChange={(e) => setS({ ...s, toMembershipChair: e.target.checked })} />
              <span>Membership Chair <span className="block text-xs text-slate-500">{holders(s.membershipChairs)}</span></span>
            </label>
            <p className="pt-2 text-xs font-semibold text-slate-700">How</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={s.inApp} onChange={(e) => setS({ ...s, inApp: e.target.checked })} /> In the app (notifications)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={s.email} onChange={(e) => setS({ ...s, email: e.target.checked })} /> Email
            </label>
            {!s.inApp && !s.email && <p className="text-xs text-amber-700">With both off, nobody is told, including about follow-up tasks.</p>}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Also tell these members <span className="font-normal text-slate-400">({s.memberIds.length} chosen)</span></p>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a member"
                aria-label="Find a member" className="pl-7 pr-2" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-100">
              {shown.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-slate-400">No members match.</p>
              ) : shown.map((m) => (
                <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  <input type="checkbox" checked={s.memberIds.includes(m.id)} onChange={() => toggleMember(m.id)} /> {m.memberName}
                </label>
              ))}
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="button" onClick={save}
                >
                {saving ? "Saving" : "Save settings"}
              </Button>
              {message && <p role="status" className={`text-xs ${message.ok ? "text-emerald-700" : "text-rose-700"}`}>{message.text}</p>}
            </div>
          )}
        </fieldset>
      )}
    </Card>
  );
}
