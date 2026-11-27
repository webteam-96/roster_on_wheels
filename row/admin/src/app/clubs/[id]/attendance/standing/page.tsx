"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYear } from "@/lib/adminYears";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import { PageHeader, ErrorState, KpiTile, ListPageSkeleton, Panel, rowTable } from "@/components/row/AppKit";
import {
  getAttendanceYears, getAttendanceStanding, getAttendanceMakeups, addAttendanceMakeup, reviewAttendanceMakeup,
  deleteAttendanceMakeup, getAttendanceLeaves, addAttendanceLeave, deleteAttendanceLeave, getAttendanceExemptions,
  saveAttendanceExemption, deleteAttendanceExemption, getAttendanceSettings, saveAttendanceSettings,
  getAttendanceMeetings, setAttendanceMeetingClosed, downloadAttendanceSignInSheet, getAttendanceRule85,
  downloadAttendanceRule85, getAttendanceMemberTypeRules, saveAttendanceMemberTypeRule,
  type AttendanceStanding, type AttendanceMakeup, type AttendanceLeave, type AttendanceExemption,
  type AttendanceMeeting, type AttendanceMemberTypeRule, type AttendanceRule85Row, type AttendanceCountRule,
} from "@/services/api";

const MAKEUP_TYPES: { value: string; label: string }[] = [
  { value: "other_club", label: "Another club's meeting" },
  { value: "district_event", label: "District event" },
  { value: "service_project", label: "Service project" },
  { value: "online", label: "Online meeting" },
  { value: "other", label: "Other" },
];
const typeLabel = (v: string) => MAKEUP_TYPES.find((t) => t.value === v)?.label ?? v;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const RULE85 = "Rule of 85";

function message(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof m === "string" && m ? m : fallback;
}
const pct = (v: number | null) => (v == null ? "No meetings" : `${v}%`);
const COUNT_RULES: { value: AttendanceCountRule; label: string }[] = [
  { value: "counted", label: "Counted" },
  { value: "own_only", label: "Own figure only, not in the club total" },
  { value: "excluded", label: "Not counted" },
];

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function AttendanceStandingPage() {
  const clubId = Number(useParams().id);
  const { isSuperAdmin, isAdmin, user } = useAuth();
  const yearRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);

  const [years, setYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [standing, setStanding] = useState<AttendanceStanding | null>(null);
  const [makeups, setMakeups] = useState<AttendanceMakeup[]>([]);
  const [leaves, setLeaves] = useState<AttendanceLeave[]>([]);
  const [exemptions, setExemptions] = useState<AttendanceExemption[]>([]);
  const [windowDays, setWindowDays] = useState("14");
  const [meetings, setMeetings] = useState<AttendanceMeeting[]>([]);
  const [typeRules, setTypeRules] = useState<AttendanceMemberTypeRule[]>([]);
  const [rule85, setRule85] = useState<AttendanceRule85Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOfficer = isSuperAdmin || isAdmin;
  const canManage = isOfficer && canEditYear(yearRights, yearId, isSuperAdmin);

  useEffect(() => {
    getAttendanceYears(clubId)
      .then((ys) => { setYears(ys); setYearId((ys.find((y) => y.isCurrent) ?? ys[0])?.id ?? null); if (!ys.length) setLoading(false); })
      .catch((e) => { setLoadError(message(e, "Could not load the Rotary years.")); setLoading(false); });
  }, [clubId]);

  const load = useCallback(async () => {
    if (!yearId) return;
    setLoading(true); setLoadError(null);
    try {
      const [s, k, l, e, w, mt, tr, r85] = await Promise.all([
        getAttendanceStanding(clubId, yearId, month), getAttendanceMakeups(clubId, yearId), getAttendanceLeaves(clubId, yearId),
        getAttendanceExemptions(clubId), getAttendanceSettings(clubId), getAttendanceMeetings(clubId, yearId),
        getAttendanceMemberTypeRules(clubId), isOfficer ? getAttendanceRule85(clubId) : Promise.resolve([]),
      ]);
      setStanding(s); setMakeups(k); setLeaves(l); setExemptions(e); setWindowDays(String(w.makeupWindowDays));
      setMeetings(mt); setTypeRules(tr); setRule85(r85);
    } catch (e) {
      setLoadError(message(e, "Could not load attendance standing."));
    } finally {
      setLoading(false);
    }
  }, [clubId, yearId, month, isOfficer]);
  useEffect(() => { load(); }, [load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setSuccess(null);
    try { await action(); setSuccess(done); await load(); }
    catch (e) { setError(message(e, "That did not work. Please try again.")); }
    finally { setBusy(false); }
  };

  // ── forms ──
  const members = standing?.members ?? [];
  const [mk, setMk] = useState({ memberId: "", makeupDate: "", makeupType: "other_club", note: "" });
  const [lv, setLv] = useState({ memberId: "", fromDate: "", toDate: "", reason: "" });
  const [ex, setEx] = useState({ memberId: "", reason: "", endDate: "" });

  const pending = makeups.filter((m) => m.status === "pending");

  const memberSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label="Member"><SelectValue placeholder="Choose a member" /></SelectTrigger>
      <SelectContent>
        {members.map((m) => <SelectItem key={m.memberId} value={String(m.memberId)}>{m.memberName}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader title="Attendance standing" description={<>Makeups, leave of absence and exemptions, and each member&apos;s attendance.</>} back={`/clubs/${clubId}/attendance`} />

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="w-full sm:w-48">
            <Select value={yearId ? String(yearId) : ""} onValueChange={(v) => setYearId(Number(v))}>
              <SelectTrigger aria-label="Rotary year"><SelectValue placeholder="Rotary year" /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Select value={month ? String(month) : "all"} onValueChange={(v) => setMonth(v === "all" ? null : Number(v))}>
              <SelectTrigger aria-label="Month"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Whole year</SelectItem>
                {[7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6].map((m) => <SelectItem key={m} value={String(m)}>{MONTHS[m - 1]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <SuccessAlert open={!!success} title="Saved" description={success ?? ""} onOk={() => setSuccess(null)} />
        {error && <ErrorState message={error} />}

        {loading ? <ListPageSkeleton /> : loadError ? (
          <ErrorState message={loadError} onRetry={load} retryLabel="Try again" />
        ) : !standing ? (
          <p className="text-muted-foreground">No Rotary years are set up for this club yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile tone="azure" label="Club attendance" value={pct(standing.clubPercent)} note="Present plus approved makeups" />
              <KpiTile tone="sky" label="Meetings held" value={standing.meetings} />
              <KpiTile tone="cream2" label="Makeups waiting" value={pending.length} note="Logged by members in the app" />
              <KpiTile tone="lilac" label="Makeup window" value={`${standing.windowDays} days`} note="Either side of a missed meeting" />
            </div>

            <Tabs defaultValue={pending.length ? "makeups" : "standing"}>
              <TabsList>
                <TabsTrigger value="standing">Standing</TabsTrigger>
                <TabsTrigger value="makeups">Makeups{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
                <TabsTrigger value="leave">Leave of absence</TabsTrigger>
                <TabsTrigger value="exemptions">Exemptions</TabsTrigger>
                <TabsTrigger value="meetings">Meetings</TabsTrigger>
                {isOfficer && <TabsTrigger value="rule85">Rule of 85{rule85.length ? ` (${rule85.length})` : ""}</TabsTrigger>}
                {canManage && <TabsTrigger value="settings">Settings</TabsTrigger>}
              </TabsList>

              <TabsContent value="standing">
                <Panel title="Member standing" subtitle={`${standing.from} to ${standing.to}. Meetings on leave or under an exemption are not counted.`}>
                  {members.length === 0 ? <p className="text-muted-foreground py-6">No members on the roll for this period.</p> : (
                    <div className={rowTable.wrap}>
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Member</TableHead><TableHead>Counted</TableHead><TableHead>Present</TableHead>
                          <TableHead>Made up</TableHead><TableHead>Excused</TableHead><TableHead>Attendance</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {members.map((m) => (
                            <TableRow key={m.memberId}>
                              <TableCell>
                                {m.memberName}
                                {(m.memberType !== "active" || !m.inClubTotal) && (
                                  <span className="block text-[13px] text-muted-foreground">
                                    {m.memberType}{m.inClubTotal ? "" : ", not in the club total"}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{m.counted}</TableCell>
                              <TableCell className="text-muted-foreground">{m.present}</TableCell>
                              <TableCell className="text-muted-foreground">{m.madeUp}</TableCell>
                              <TableCell className="text-muted-foreground">{m.excused}</TableCell>
                              <TableCell>{m.percent == null ? "Not counted" : `${m.percent}%`}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {m.exempt ? "Exempt" : m.rule85 ? (
                                  canManage ? (
                                    <Button size="sm" variant="outline" disabled={busy}
                                      onClick={() => run(() => saveAttendanceExemption(clubId, { memberId: m.memberId, reason: RULE85 }), `${m.memberName} is exempt under the rule of 85.`)}>
                                      Grant rule of 85
                                    </Button>
                                  ) : "Qualifies for rule of 85"
                                ) : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="makeups" className="space-y-6">
                {canManage && (
                  <Panel title="Record a makeup" subtitle="A makeup you record here is approved at once.">
                    <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => {
                      e.preventDefault();
                      if (!mk.memberId || !mk.makeupDate) { setError("Choose a member and a date."); return; }
                      run(async () => { await addAttendanceMakeup(clubId, { memberId: Number(mk.memberId), makeupDate: mk.makeupDate, makeupType: mk.makeupType, note: mk.note || undefined }); setMk({ ...mk, makeupDate: "", note: "" }); }, "Makeup recorded.");
                    }}>
                      {memberSelect(mk.memberId, (v) => setMk({ ...mk, memberId: v }), "mk-member")}
                      <Input type="date" aria-label="Makeup date" value={mk.makeupDate} onChange={(e) => setMk({ ...mk, makeupDate: e.target.value })} />
                      <Select value={mk.makeupType} onValueChange={(v) => setMk({ ...mk, makeupType: v })}>
                        <SelectTrigger aria-label="Makeup type"><SelectValue /></SelectTrigger>
                        <SelectContent>{MAKEUP_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input aria-label="Note" placeholder="Note (optional)" maxLength={500} value={mk.note} onChange={(e) => setMk({ ...mk, note: e.target.value })} />
                      <Button type="submit" disabled={busy}>Record makeup</Button>
                    </form>
                  </Panel>
                )}
                <Panel title="Makeups" subtitle="Waiting ones are listed first. Only approved makeups count.">
                  {makeups.length === 0 ? <p className="text-muted-foreground py-6">No makeups this year.</p> : (
                    <div className={rowTable.wrap}>
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Member</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead>
                          <TableHead>For meeting</TableHead><TableHead>Note</TableHead><TableHead>Status</TableHead>
                          {canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
                        </TableRow></TableHeader>
                        <TableBody>
                          {makeups.map((m) => (
                            <TableRow key={m.id}>
                              <TableCell>{m.memberName}</TableCell>
                              <TableCell className="text-muted-foreground">{m.makeupDate}</TableCell>
                              <TableCell className="text-muted-foreground">{typeLabel(m.makeupType)}</TableCell>
                              <TableCell className="text-muted-foreground">{m.missedEventName ?? "Nearest missed meeting"}</TableCell>
                              <TableCell className="text-muted-foreground">{m.note ?? ""}</TableCell>
                              <TableCell>
                                {m.status === "pending" ? "Waiting for approval" : m.status === "approved" ? "Approved" : `Rejected${m.reviewNote ? `: ${m.reviewNote}` : ""}`}
                              </TableCell>
                              {canManage && (
                                <TableCell>
                                  <div className="flex gap-2">
                                    {m.status === "pending" && <>
                                      <Button size="sm" disabled={busy} onClick={() => run(() => reviewAttendanceMakeup(clubId, m.id, true), "Makeup approved.")}>Approve</Button>
                                      <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                                        const note = window.prompt("Reason for rejecting (optional)") ?? undefined;
                                        run(() => reviewAttendanceMakeup(clubId, m.id, false, note), "Makeup rejected.");
                                      }}>Reject</Button>
                                    </>}
                                    <Button size="sm" variant="outline" disabled={busy}
                                      onClick={() => window.confirm("Delete this makeup?") && run(() => deleteAttendanceMakeup(clubId, m.id), "Makeup deleted.")}>Delete</Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="leave" className="space-y-6">
                {canManage && (
                  <Panel title="Grant leave of absence" subtitle="Meetings during the leave are not counted for the member.">
                    <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => {
                      e.preventDefault();
                      if (!lv.memberId || !lv.fromDate || !lv.toDate) { setError("Choose a member and both dates."); return; }
                      run(async () => { await addAttendanceLeave(clubId, { memberId: Number(lv.memberId), fromDate: lv.fromDate, toDate: lv.toDate, reason: lv.reason || undefined }); setLv({ memberId: "", fromDate: "", toDate: "", reason: "" }); }, "Leave of absence saved.");
                    }}>
                      {memberSelect(lv.memberId, (v) => setLv({ ...lv, memberId: v }), "lv-member")}
                      <Input type="date" aria-label="From" value={lv.fromDate} onChange={(e) => setLv({ ...lv, fromDate: e.target.value })} />
                      <Input type="date" aria-label="To" value={lv.toDate} onChange={(e) => setLv({ ...lv, toDate: e.target.value })} />
                      <Input aria-label="Reason" placeholder="Reason (optional)" maxLength={500} value={lv.reason} onChange={(e) => setLv({ ...lv, reason: e.target.value })} />
                      <Button type="submit" disabled={busy}>Save leave</Button>
                    </form>
                  </Panel>
                )}
                <Panel title="Leave of absence">
                  {leaves.length === 0 ? <p className="text-muted-foreground py-6">No leave of absence this year.</p> : (
                    <div className={rowTable.wrap}>
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Member</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Reason</TableHead>
                          {canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
                        </TableRow></TableHeader>
                        <TableBody>
                          {leaves.map((l) => (
                            <TableRow key={l.id}>
                              <TableCell>{l.memberName}</TableCell><TableCell className="text-muted-foreground">{l.fromDate}</TableCell>
                              <TableCell className="text-muted-foreground">{l.toDate}</TableCell><TableCell className="text-muted-foreground">{l.reason ?? ""}</TableCell>
                              {canManage && <TableCell>
                                <Button size="sm" variant="outline" disabled={busy}
                                  onClick={() => window.confirm("Delete this leave of absence?") && run(() => deleteAttendanceLeave(clubId, l.id), "Leave deleted.")}>Delete</Button>
                              </TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="exemptions" className="space-y-6">
                {canManage && (
                  <Panel title="Exempt a member" subtitle="An exempt member is left out of the club's attendance. Leave the end date empty for no end.">
                    <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => {
                      e.preventDefault();
                      if (!ex.memberId || !ex.reason.trim()) { setError("Choose a member and give a reason."); return; }
                      run(async () => { await saveAttendanceExemption(clubId, { memberId: Number(ex.memberId), reason: ex.reason, endDate: ex.endDate || null }); setEx({ memberId: "", reason: "", endDate: "" }); }, "Exemption saved.");
                    }}>
                      {memberSelect(ex.memberId, (v) => setEx({ ...ex, memberId: v }), "ex-member")}
                      <Input aria-label="Reason" placeholder="Reason, for example Rule of 85" maxLength={200} value={ex.reason} onChange={(e) => setEx({ ...ex, reason: e.target.value })} />
                      <Input type="date" aria-label="End date" value={ex.endDate} onChange={(e) => setEx({ ...ex, endDate: e.target.value })} />
                      <Button type="submit" disabled={busy}>Save exemption</Button>
                    </form>
                  </Panel>
                )}
                <Panel title="Exemptions">
                  {exemptions.length === 0 ? <p className="text-muted-foreground py-6">No member is exempt.</p> : (
                    <div className={rowTable.wrap}>
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Member</TableHead><TableHead>Reason</TableHead><TableHead>Ends</TableHead>
                          {canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
                        </TableRow></TableHeader>
                        <TableBody>
                          {exemptions.map((x) => (
                            <TableRow key={x.id}>
                              <TableCell>{x.memberName}</TableCell><TableCell className="text-muted-foreground">{x.reason}</TableCell>
                              <TableCell className="text-muted-foreground">{x.endDate ?? "No end"}</TableCell>
                              {canManage && <TableCell>
                                <Button size="sm" variant="outline" disabled={busy}
                                  onClick={() => window.confirm("Remove this exemption?") && run(() => deleteAttendanceExemption(clubId, x.id), "Exemption removed.")}>Remove</Button>
                              </TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="meetings">
                <Panel title="Meetings" subtitle="A closed meeting's attendance and makeups cannot change until an officer reopens it. Closing and reopening are recorded in the audit log.">
                  {meetings.length === 0 ? <p className="text-muted-foreground py-6">No meetings recorded this year.</p> : (
                    <div className={rowTable.wrap}>
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Meeting</TableHead><TableHead>Date</TableHead><TableHead>Present</TableHead>
                          <TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {meetings.map((m) => (
                            <TableRow key={m.id}>
                              <TableCell>{m.eventName}</TableCell>
                              <TableCell className="text-muted-foreground">{m.meetingDate}</TableCell>
                              <TableCell className="text-muted-foreground">{m.presentCount}</TableCell>
                              <TableCell className="text-muted-foreground">{m.closed ? `Closed${m.closedByName ? ` by ${m.closedByName}` : ""}` : "Open"}</TableCell>
                              <TableCell>
                                <div className="flex gap-2">
                                  {isOfficer && (
                                    <Button size="sm" variant="outline" disabled={busy}
                                      onClick={() => run(async () => saveBlob(await downloadAttendanceSignInSheet(clubId, m.id), `sign-in-sheet-${m.meetingDate}.pdf`), "Sign-in sheet downloaded.")}>
                                      Sign-in sheet
                                    </Button>
                                  )}
                                  {canManage && (m.closed ? (
                                    <Button size="sm" variant="outline" disabled={busy}
                                      onClick={() => window.confirm("Reopen this meeting? Its attendance and makeups can then be changed.") && run(() => setAttendanceMeetingClosed(clubId, m.id, false), "Meeting reopened.")}>Reopen</Button>
                                  ) : (
                                    <Button size="sm" disabled={busy}
                                      onClick={() => window.confirm("Close this meeting? Its attendance and makeups will be locked.") && run(() => setAttendanceMeetingClosed(clubId, m.id, true), "Meeting closed.")}>Close</Button>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Panel>
              </TabsContent>

              {isOfficer && (
                <TabsContent value="rule85">
                  <Panel title="Rule of 85" subtitle="Active members whose age plus years of membership in any club is 85 or more. The board grants the exemption on the member's written request."
                    headerRight={
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => saveBlob(await downloadAttendanceRule85(clubId, "csv"), "rule-of-85.csv"), "CSV downloaded.")}>CSV</Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => saveBlob(await downloadAttendanceRule85(clubId, "pdf"), "rule-of-85.pdf"), "PDF downloaded.")}>Print (PDF)</Button>
                      </div>
                    }>
                    {rule85.length === 0 ? <p className="text-muted-foreground py-6">No member qualifies at present. Members without a birth date or join date cannot be checked.</p> : (
                      <div className={rowTable.wrap}>
                        <Table>
                          <TableHeader><TableRow>
                            <TableHead>Member</TableHead><TableHead>Age</TableHead><TableHead>Years a member</TableHead>
                            <TableHead>Total</TableHead><TableHead>Exempt</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>
                            {rule85.map((r) => (
                              <TableRow key={r.memberId}>
                                <TableCell>{r.memberName}</TableCell><TableCell className="text-muted-foreground">{r.age}</TableCell>
                                <TableCell className="text-muted-foreground">{r.years}</TableCell><TableCell>{r.age + r.years}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {r.exempt ? "Yes" : canManage ? (
                                    <Button size="sm" variant="outline" disabled={busy}
                                      onClick={() => run(() => saveAttendanceExemption(clubId, { memberId: r.memberId, reason: RULE85 }), `${r.memberName} is exempt under the rule of 85.`)}>
                                      Grant exemption
                                    </Button>
                                  ) : "Not yet"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </Panel>
                </TabsContent>
              )}

              {canManage && (
                <TabsContent value="settings" className="space-y-6">
                  <Panel title="Makeup window" subtitle="How many days before or after a missed meeting a makeup still counts (0 to 90).">
                    <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => {
                      e.preventDefault();
                      const days = Number(windowDays);
                      if (!Number.isInteger(days) || days < 0 || days > 90) { setError("Enter a whole number of days from 0 to 90."); return; }
                      run(() => saveAttendanceSettings(clubId, days), "Makeup window saved.");
                    }}>
                      <Input type="number" min={0} max={90} className="w-32" aria-label="Days" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
                      <Button type="submit" disabled={busy}>Save</Button>
                    </form>
                  </Panel>
                  <Panel title="Member types" subtitle="How each member type counts in attendance. Own figure only: the member sees their own percentage, but it is left out of the club's.">
                    <div className="space-y-3">
                      {typeRules.map((t) => (
                        <div key={t.memberType} className="flex flex-wrap items-center gap-3">
                          <span className="w-40 font-medium">{t.label}</span>
                          <div className="w-full sm:w-80">
                            <Select value={t.rule} onValueChange={(v) => run(() => saveAttendanceMemberTypeRule(clubId, t.memberType, v as AttendanceCountRule), `${t.label} members: rule saved.`)}>
                              <SelectTrigger aria-label={`Rule for ${t.label}`}><SelectValue /></SelectTrigger>
                              <SelectContent>{COUNT_RULES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          {t.isDefault && <span className="text-[13px] text-muted-foreground">Default</span>}
                        </div>
                      ))}
                    </div>
                  </Panel>
                </TabsContent>
              )}
            </Tabs>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
