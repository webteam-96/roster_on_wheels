"use client";

/**
 * Youth programs (flagged module "youth_programs", gap #12) for a club or a district: who may see youth records
 * (the appointed youth officer or district youth chair), RYLA and RLI participants per program year, and the Youth
 * Protection clearance register. Admins appoint; only appointees see the records (the API enforces it).
 */

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useMemo, useState } from "react";
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

const SELECT = "row-field";
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
        <Button type="button" variant="outline" onClick={search} disabled={busy}>
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

export default function YouthPrograms({ scope: scopeProp }: { scope: YouthScope }) {
  // Pages pass a fresh object literal each render; key the loaders on the values or every parent render refetches (ROW2-1).
  const scope = useMemo(() => ({ kind: scopeProp.kind, id: scopeProp.id }), [scopeProp.kind, scopeProp.id]);
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
    <div className="space-y-6">
      <PageHeader title="Youth Programs" description={<>RYLA and RLI participants by program year, and Youth Protection clearances for volunteers. Youth data is sensitive: only the appointed {role} sees these records.</>} />

      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="row-h2">{isDistrict ? "District youth chair" : "Club youth officer"}</h3>
          {officers.error && !officers.data ? <p className="text-sm text-destructive">{officers.error}</p>
            : !officers.data ? <div aria-busy="true"><TableSkeleton rows={2} /></div>
            : officers.data.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is appointed yet.</p>
            : (
              <ul className="divide-y rounded-md border text-sm">
                {officers.data.map((o) => (
                  <li key={o.memberId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>{o.memberName}{o.clubName && isDistrict ? <span className="text-muted-foreground">, {o.clubName}</span> : null}</span>
                    <Button type="button" size="sm" variant="outline" disabled={busy}
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
          <Button variant={tab === t ? "default" : "ghost"} size="sm" key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
           >
            {t === "participants" ? "RYLA and RLI" : "Youth Protection"}
          </Button>
        ))}
      </div>

      {tab === "participants" ? (
        people.denied ? deniedCard : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="youth-year">Program year</Label>
                <NativeSelect id="youth-year" className="w-auto" value={yearId ?? ""} onChange={(e) => setYearId(Number(e.target.value))}>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="youth-program">Program</Label>
                <NativeSelect id="youth-program" className="w-auto" value={program} onChange={(e) => setProgram(e.target.value as YouthProgram | "")}>
                  <option value="">RYLA and RLI</option>
                  <option value="ryla">RYLA</option>
                  <option value="rli">RLI</option>
                </NativeSelect>
              </div>
              {!isDistrict && !draft && (
                <Button type="button" onClick={() => setDraft({ program: "ryla", fullName: "", contactEmail: "" })}>
                  <Plus className="h-4 w-4" /> Add participant
                </Button>
              )}
            </div>

            {draft && yearId && (
              <Card><CardContent className="grid gap-3 p-5 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="p-program">Program</Label>
                  <NativeSelect id="p-program"  value={draft.program} onChange={(e) => setDraft({ ...draft, program: e.target.value as YouthProgram })}>
                    <option value="ryla">RYLA</option><option value="rli">RLI</option>
                  </NativeSelect>
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
                  <Button type="button" disabled={busy}
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
                  <Table className="w-full min-w-[760px] text-sm">
                    <TableHeader>
                      <TableRow className="border-b">
                        <TableHead className="p-3">Participant</TableHead>
                        <TableHead className="p-3">Program</TableHead>
                        <TableHead className="p-3">Sponsoring club</TableHead>
                        <TableHead className="p-3">Added</TableHead>
                        <TableHead className="p-3">Status</TableHead>
                        <TableHead className="p-3">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {people.data.map((p) => (
                        <TableRow key={p.id} className="border-b last:border-0">
                          <TableCell className="p-3"><div className="font-medium">{p.fullName}</div>{p.contactEmail && <div className="text-muted-foreground">{p.contactEmail}</div>}</TableCell>
                          <TableCell className="p-3">{PROGRAM_LABEL[p.program]}</TableCell>
                          <TableCell className="p-3">{p.sponsorClubName}</TableCell>
                          <TableCell className="p-3">{fmt.date(p.createdDate)}</TableCell>
                          <TableCell className="p-3">{STATUS_LABEL[p.status]}</TableCell>
                          <TableCell className="p-3">
                            <div className="flex flex-wrap gap-1.5">
                              {nextStatuses(p.status, isDistrict).map((s) => (
                                <Button key={s} type="button" size="sm" variant="outline" disabled={busy}
                                  onClick={() => act(() => setYouthParticipantStatus(scope, p.id, s), loadPeople, "Could not change the status.")}>
                                  {ACTION_LABEL[s]}
                                </Button>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
                <Button type="button" disabled={busy}
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
                <Table className="w-full min-w-[760px] text-sm">
                  <TableHeader>
                    <TableRow className="border-b">
                      <TableHead className="p-3">Volunteer</TableHead>
                      <TableHead className="p-3">Training</TableHead>
                      <TableHead className="p-3">Background check</TableHead>
                      <TableHead className="p-3">Expires</TableHead>
                      <TableHead className="p-3">State</TableHead>
                      <TableHead className="p-3"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clearances.data.map((c) => (
                      <TableRow key={c.memberId} className="border-b last:border-0">
                        <TableCell className="p-3"><div className="font-medium">{c.memberName}</div>{isDistrict && c.clubName && <div className="text-muted-foreground">{c.clubName}</div>}</TableCell>
                        <TableCell className="p-3">{c.trainingDate ? fmt.date(c.trainingDate) : ""}</TableCell>
                        <TableCell className="p-3">{c.checkDate ? fmt.date(c.checkDate) : ""}</TableCell>
                        <TableCell className="p-3">{c.expiryDate ? fmt.date(c.expiryDate) : ""}</TableCell>
                        <TableCell className={`p-3 ${c.state === "expired" ? "text-destructive" : c.state === "expiring" ? "font-medium" : ""}`}>{CLEARANCE_LABEL[c.state]}</TableCell>
                        <TableCell className="p-3">
                          <Button type="button" size="sm" variant="outline" onClick={() => setEditing({
                            memberId: c.memberId, name: c.memberName, trainingDate: dayInput(c.trainingDate), checkDate: dayInput(c.checkDate), expiryDate: dayInput(c.expiryDate),
                          })}>Edit</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
        </div>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
