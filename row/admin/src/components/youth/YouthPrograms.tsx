"use client";

/**
 * Youth programs (flagged module "youth_programs", gap #12) for a club or a district: who may see youth records
 * (the appointed youth officer or district youth chair), RYLA and RLI participants per program year, and the Youth
 * Protection clearance register. Admins appoint; only appointees see the records (the API enforces it).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Save, Search, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import {
  addYouthOfficer, addYouthParticipant, getYouthClearances, getYouthOfficers, getYouthParticipants, getYouthYears,
  removeYouthOfficer, saveYouthClearance, searchYouthMembers, setYouthParticipantStatus,
  type YouthClearance, type YouthMemberPick, type YouthOfficer, type YouthParticipant, type YouthProgram, type YouthScope, type YouthYear,
} from "@/services/api";
import { ACTION_LABEL, CLEARANCE_LABEL, PROGRAM_LABEL, STATUS_LABEL, dayInput, nextStatuses } from "@/lib/youth";

const SELECT = "h-10 rounded-md border border-input bg-background px-3 text-sm";
const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;
const forbidden = (err: any) => err?.response?.status === 403;

type Load<T> = { data: T | null; error: string | null; denied: boolean };
const loading = <T,>(): Load<T> => ({ data: null, error: null, denied: false });

function MemberPicker({ scope, label, onPick }: { scope: YouthScope; label: string; onPick: (m: YouthMemberPick) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<YouthMemberPick[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = async () => {
    setBusy(true);
    try { setHits(await searchYouthMembers(scope, q)); } catch (err) { setError(message(err, "Could not search the members.")); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={`pick-${label}`}>{label}</Label>
      <div className="flex gap-2">
        <Input id={`pick-${label}`} value={q} placeholder="Member name" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
        <Button type="button" variant="outline" onClick={search} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
        </Button>
      </div>
      {hits && (hits.length === 0 ? <p className="text-sm text-muted-foreground">No active member matches.</p> : (
        <ul className="max-h-56 overflow-y-auto rounded-md border text-sm">
          {hits.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-0">
              <span>{m.name}{m.clubName ? <span className="text-muted-foreground">, {m.clubName}</span> : null}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => { onPick(m); setHits(null); setQ(""); }}>Choose</Button>
            </li>
          ))}
        </ul>
      ))}
      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

export default function YouthPrograms({ scope }: { scope: YouthScope }) {
  const fmt = useFormat();
  const isDistrict = scope.kind === "districts";
  const role = isDistrict ? "district youth chair" : "club youth officer";
  const [officers, setOfficers] = useState<Load<YouthOfficer[]>>(loading);
  const [years, setYears] = useState<YouthYear[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [program, setProgram] = useState<YouthProgram | "">("");
  const [tab, setTab] = useState<"participants" | "clearances">("participants");
  const [people, setPeople] = useState<Load<YouthParticipant[]>>(loading);
  const [clearances, setClearances] = useState<Load<YouthClearance[]>>(loading);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ program: YouthProgram; fullName: string; contactEmail: string } | null>(null);
  const [editing, setEditing] = useState<{ memberId: number; name: string; trainingDate: string; checkDate: string; expiryDate: string } | null>(null);

  const loadOfficers = useCallback(() => {
    setOfficers(loading());
    getYouthOfficers(scope).then((data) => setOfficers({ data, error: null, denied: false }))
      .catch((err) => setOfficers({ data: null, error: message(err, "Could not load the appointments."), denied: forbidden(err) }));
  }, [scope]);

  const loadPeople = useCallback(() => {
    if (!yearId) return;
    setPeople(loading());
    getYouthParticipants(scope, yearId, program).then((data) => setPeople({ data, error: null, denied: false }))
      .catch((err) => setPeople({ data: null, error: message(err, "Could not load the participants."), denied: forbidden(err) }));
  }, [scope, yearId, program]);

  const loadClearances = useCallback(() => {
    setClearances(loading());
    getYouthClearances(scope).then((data) => setClearances({ data, error: null, denied: false }))
      .catch((err) => setClearances({ data: null, error: message(err, "Could not load the clearances."), denied: forbidden(err) }));
  }, [scope]);

  useEffect(() => { loadOfficers(); loadClearances(); }, [loadOfficers, loadClearances]);
  useEffect(() => {
    getYouthYears().then((ys) => { setYears(ys); setYearId((ys.find((y) => y.isCurrent) ?? ys[0])?.id ?? null); })
      .catch((err) => setError(message(err, "Could not load the program years.")));
  }, []);
  useEffect(() => { loadPeople(); }, [loadPeople]);

  const act = async (work: () => Promise<unknown>, after: () => void, fallback: string) => {
    setBusy(true);
    try { await work(); after(); } catch (err) { setError(message(err, fallback)); } finally { setBusy(false); }
  };

  const deniedCard = (
    <Card><CardContent className="p-5 text-sm text-muted-foreground">
      Youth records are visible only to the appointed {role}. If you hold this role, appoint yourself above.
    </CardContent></Card>
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Youth Programs</h2>
        <p className="text-base text-muted-foreground">
          RYLA and RLI participants by program year, and Youth Protection clearances for volunteers. Youth data is
          sensitive: only the appointed {role} sees these records.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="text-lg font-semibold">{isDistrict ? "District youth chair" : "Club youth officer"}</h3>
          {officers.error && !officers.data ? <p className="text-sm text-destructive">{officers.error}</p>
            : !officers.data ? <div aria-busy="true"><TableSkeleton rows={2} /></div>
            : officers.data.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is appointed yet.</p>
            : (
              <ul className="divide-y rounded-md border text-sm">
                {officers.data.map((o) => (
                  <li key={o.memberId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>{o.memberName}{o.clubName && isDistrict ? <span className="text-muted-foreground">, {o.clubName}</span> : null}</span>
                    <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy}
                      onClick={() => act(() => removeYouthOfficer(scope, o.memberId), () => { loadOfficers(); loadPeople(); loadClearances(); }, "Could not remove the appointment.")}>
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          <MemberPicker scope={scope} label={`Appoint a ${role}`}
            onPick={(m) => act(() => addYouthOfficer(scope, m.id), () => { loadOfficers(); loadPeople(); loadClearances(); }, "Could not appoint this member.")} />
        </CardContent>
      </Card>

      <div className="flex gap-2 border-b" role="tablist">
        {(["participants", "clearances"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
            {t === "participants" ? "RYLA and RLI" : "Youth Protection"}
          </button>
        ))}
      </div>

      {tab === "participants" ? (
        people.denied ? deniedCard : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="youth-year">Program year</Label>
                <select id="youth-year" className={SELECT} value={yearId ?? ""} onChange={(e) => setYearId(Number(e.target.value))}>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="youth-program">Program</Label>
                <select id="youth-program" className={SELECT} value={program} onChange={(e) => setProgram(e.target.value as YouthProgram | "")}>
                  <option value="">RYLA and RLI</option>
                  <option value="ryla">RYLA</option>
                  <option value="rli">RLI</option>
                </select>
              </div>
              {!isDistrict && !draft && (
                <Button type="button" className="gap-1.5" onClick={() => setDraft({ program: "ryla", fullName: "", contactEmail: "" })}>
                  <Plus className="h-4 w-4" /> Add participant
                </Button>
              )}
            </div>

            {draft && yearId && (
              <Card><CardContent className="grid gap-3 p-5 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="p-program">Program</Label>
                  <select id="p-program" className={`${SELECT} w-full`} value={draft.program} onChange={(e) => setDraft({ ...draft, program: e.target.value as YouthProgram })}>
                    <option value="ryla">RYLA</option><option value="rli">RLI</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="p-name">Full name</Label>
                  <Input id="p-name" maxLength={150} value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="p-email">Contact email (optional)</Label>
                  <Input id="p-email" type="email" maxLength={254} value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} />
                </div>
                <div className="flex items-end gap-2">
                  <Button type="button" disabled={busy} className="gap-1.5"
                    onClick={() => act(() => addYouthParticipant(scope.id, { program: draft.program, yearId, fullName: draft.fullName, contactEmail: draft.contactEmail || null }),
                      () => { setDraft(null); loadPeople(); }, "Could not add the participant.")}>
                    <Save className="h-4 w-4" /> Save
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
                </div>
              </CardContent></Card>
            )}

            {people.error ? <p className="text-sm text-destructive">{people.error}</p>
              : !people.data ? <div aria-busy="true"><TableSkeleton rows={4} /></div>
              : people.data.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">No participants for this program year yet.</CardContent></Card>
              : (
                <Card><CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                      <tr className="border-b text-left">
                        <th className="p-3 font-medium">Participant</th>
                        <th className="p-3 font-medium">Program</th>
                        <th className="p-3 font-medium">Sponsoring club</th>
                        <th className="p-3 font-medium">Added</th>
                        <th className="p-3 font-medium">Status</th>
                        <th className="p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.data.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="p-3"><div className="font-medium">{p.fullName}</div>{p.contactEmail && <div className="text-muted-foreground">{p.contactEmail}</div>}</td>
                          <td className="p-3">{PROGRAM_LABEL[p.program]}</td>
                          <td className="p-3">{p.sponsorClubName}</td>
                          <td className="p-3">{fmt.date(p.createdDate)}</td>
                          <td className="p-3">{STATUS_LABEL[p.status]}</td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1.5">
                              {nextStatuses(p.status, isDistrict).map((s) => (
                                <Button key={s} type="button" size="sm" variant="outline" disabled={busy}
                                  onClick={() => act(() => setYouthParticipantStatus(scope, p.id, s), loadPeople, "Could not change the status.")}>
                                  {ACTION_LABEL[s]}
                                </Button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent></Card>
              )}
          </div>
        )
      ) : clearances.denied ? deniedCard : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Record each volunteer&apos;s Youth Protection training and background check. Volunteers get an email reminder
            when their clearance expires within 60 days.
          </p>
          {isDistrict && !editing && (
            <MemberPicker scope={scope} label="Record a volunteer"
              onPick={(m) => setEditing({ memberId: m.id, name: m.name, trainingDate: "", checkDate: "", expiryDate: "" })} />
          )}
          {editing && (
            <Card><CardContent className="grid gap-3 p-5 sm:grid-cols-4">
              <p className="font-medium sm:col-span-4">{editing.name}</p>
              {([["trainingDate", "Training date"], ["checkDate", "Background check date"], ["expiryDate", "Expiry date"]] as const).map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`c-${k}`}>{label}</Label>
                  <Input id={`c-${k}`} type="date" value={editing[k]} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
                </div>
              ))}
              <div className="flex items-end gap-2">
                <Button type="button" disabled={busy} className="gap-1.5"
                  onClick={() => act(() => saveYouthClearance(scope, editing.memberId, {
                    trainingDate: editing.trainingDate || null, checkDate: editing.checkDate || null, expiryDate: editing.expiryDate || null,
                  }), () => { setEditing(null); loadClearances(); }, "Could not save the clearance.")}>
                  <Save className="h-4 w-4" /> Save
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </CardContent></Card>
          )}
          {clearances.error ? <p className="text-sm text-destructive">{clearances.error}</p>
            : !clearances.data ? <div aria-busy="true"><TableSkeleton rows={4} /></div>
            : clearances.data.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">No clearances recorded yet.</CardContent></Card>
            : (
              <Card><CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                    <tr className="border-b text-left">
                      <th className="p-3 font-medium">Volunteer</th>
                      <th className="p-3 font-medium">Training</th>
                      <th className="p-3 font-medium">Background check</th>
                      <th className="p-3 font-medium">Expires</th>
                      <th className="p-3 font-medium">State</th>
                      <th className="p-3 font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {clearances.data.map((c) => (
                      <tr key={c.memberId} className="border-b last:border-0">
                        <td className="p-3"><div className="font-medium">{c.memberName}</div>{isDistrict && c.clubName && <div className="text-muted-foreground">{c.clubName}</div>}</td>
                        <td className="p-3">{c.trainingDate ? fmt.date(c.trainingDate) : ""}</td>
                        <td className="p-3">{c.checkDate ? fmt.date(c.checkDate) : ""}</td>
                        <td className="p-3">{c.expiryDate ? fmt.date(c.expiryDate) : ""}</td>
                        <td className={`p-3 ${c.state === "expired" ? "text-destructive" : c.state === "expiring" ? "font-medium" : ""}`}>{CLEARANCE_LABEL[c.state]}</td>
                        <td className="p-3">
                          <Button type="button" size="sm" variant="outline" onClick={() => setEditing({
                            memberId: c.memberId, name: c.memberName, trainingDate: dayInput(c.trainingDate), checkDate: dayInput(c.checkDate), expiryDate: dayInput(c.expiryDate),
                          })}>Edit</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent></Card>
            )}
        </div>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
