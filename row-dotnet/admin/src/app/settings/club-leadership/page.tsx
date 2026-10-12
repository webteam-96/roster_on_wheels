"use client";

import React, { useState, useEffect, useMemo } from "react";
import DateField from "@/components/DateField";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Pencil, Download, Send, Clock, CheckCircle2, XCircle, User, ShieldCheck, Loader2, ListTree, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import {
  getDistricts, getRotaryYears,
  getClubLeadership, getClubLeadershipMembers, upsertClubLeadership,
  scheduleClubLeadershipEmail, getClubLeadershipEmailStatus,
  makeClubLeadershipAdmin, getClubLeadershipAllSchedules, getClubLeadershipScheduleLog,
  deleteClubLeadershipSchedule,
} from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";

type Row = {
  clubId: number; clubName: string; clubRotaryId: string;
  presidentMemberId: number | null; presidentName: string | null;
  presidentMobile: string | null; presidentEmail: string | null;
  presidentIsAdmin: boolean | number;
  secretaryMemberId: number | null; secretaryName: string | null;
  secretaryMobile: string | null; secretaryEmail: string | null;
  secretaryIsAdmin: boolean | number;
  // Phase 4 kill-switch: 1 when club + district + zone are all active; 0 when chain is broken.
  chainActive?: number;
};

type Member = { memberId: number; memberName: string; mobile: string | null; email: string | null };

export default function ClubLeadershipPage() {
  const [districts, setDistricts] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [districtId, setDistrictId] = useState<string>("");
  const [yearId, setYearId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editClubId, setEditClubId] = useState<number>(0);
  const [editClubName, setEditClubName] = useState<string>("");
  const [editRole, setEditRole] = useState<"President" | "Secretary">("President");
  const [clubMembers, setClubMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [memberSearch, setMemberSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Schedule dialog
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>("");
  const [scheduleTime, setScheduleTime] = useState<string>("");
  const [scheduling, setScheduling] = useState(false);

  // Status
  const [emailStatus, setEmailStatus] = useState<any>({ schedules: [], logs: [] });
  const [makingAdmin, setMakingAdmin] = useState<string | null>(null); // key: `${clubId}-${role}`

  // View All Schedules dialog
  const [allOpen, setAllOpen] = useState(false);
  const [allSchedules, setAllSchedules] = useState<any[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [expandedScheduleId, setExpandedScheduleId] = useState<number | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<any[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [dRes, yRes] = await Promise.all([
          getDistricts(1, 9999, undefined, 1),
          getRotaryYears(),
        ]);
        setDistricts((dRes.items || []).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
        setYears(yRes || []);
        const cur = (yRes || []).find((y: any) => y.isCurrent);
        if (cur) setYearId(String(cur.id));
      } catch {
        setErrorMessage("Failed to load districts/years.");
      }
    })();
  }, []);

  // silent=true refreshes rows in place WITHOUT flipping the full-page `loading`
  // spinner. That keeps the table mounted so the scroll position is preserved
  // after a row action (Make Admin, save, delete, schedule) instead of the whole
  // table unmounting and jumping back to the top.
  const loadRows = async (silent = false) => {
    if (!districtId || !yearId) return;
    if (!silent) setLoading(true);
    try {
      const [data, status] = await Promise.all([
        getClubLeadership(Number(districtId), Number(yearId)),
        getClubLeadershipEmailStatus(Number(districtId), Number(yearId)),
      ]);
      setRows(data || []);
      setEmailStatus(status || { schedules: [], logs: [] });
    } catch {
      setErrorMessage("Failed to load clubs.");
    } finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { loadRows(); }, [districtId, yearId]);

  const openEdit = async (clubId: number, clubName: string, role: "President" | "Secretary", currentMemberId: number | null) => {
    setEditClubId(clubId); setEditClubName(clubName); setEditRole(role);
    setSelectedMemberId(currentMemberId ? String(currentMemberId) : "");
    setMemberSearch("");
    setEditOpen(true);
    try {
      const members = await getClubLeadershipMembers(clubId);
      setClubMembers(members || []);
    } catch {
      setErrorMessage("Failed to load club members.");
      setClubMembers([]);
    }
  };

  const filteredMembers = useMemo(() => {
    const q = memberSearch.toLowerCase().trim();
    if (!q) return clubMembers;
    return clubMembers.filter(m =>
      m.memberName?.toLowerCase().includes(q) ||
      m.mobile?.includes(q) ||
      m.email?.toLowerCase().includes(q));
  }, [clubMembers, memberSearch]);

  const saveEdit = async () => {
    if (!selectedMemberId) { setErrorMessage("Please select a member."); return; }
    setSaving(true);
    try {
      await upsertClubLeadership({
        clubId: editClubId, yearId: Number(yearId),
        memberId: Number(selectedMemberId), role: editRole,
      });
      setSuccessMessage(`${editRole} saved.`);
      setEditOpen(false);
      await loadRows(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Save failed.");
    } finally { setSaving(false); }
  };

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(r =>
      r.clubName?.toLowerCase().includes(q) ||
      r.clubRotaryId?.toLowerCase().includes(q) ||
      r.presidentName?.toLowerCase().includes(q) ||
      r.secretaryName?.toLowerCase().includes(q));
  }, [rows, search]);

  const exportExcel = () => {
    if (rows.length === 0) return;
    const dist = districts.find((d: any) => String(d.id) === districtId);
    const yr = years.find((y: any) => String(y.id) === yearId);
    exportToCSV(rows, `Club_Leadership_D${dist?.districtNumber || ""}_${yr?.yearLabel || ""}`,
      [
        { key: "clubName", label: "Club", width: 30 },
        { key: "clubRotaryId", label: "Club ID", width: 15 },
        { key: "presidentName", label: "President Name", width: 25 },
        { key: "presidentMobile", label: "President Mobile", width: 15 },
        { key: "presidentEmail", label: "President Email", width: 25 },
        { key: "secretaryName", label: "Secretary Name", width: 25 },
        { key: "secretaryMobile", label: "Secretary Mobile", width: 15 },
        { key: "secretaryEmail", label: "Secretary Email", width: 25 },
      ],
      { title: `Club Leadership — District ${dist?.districtNumber || ""}`, subtitle: `Year: ${yr?.yearLabel || ""}` });
    setSuccessMessage("Exported.");
  };

  const openAllSchedules = async () => {
    setAllOpen(true);
    setAllLoading(true);
    setExpandedScheduleId(null);
    setExpandedLogs([]);
    try {
      const data = await getClubLeadershipAllSchedules();
      setAllSchedules(data || []);
    } catch {
      setErrorMessage("Failed to load all schedules.");
    } finally { setAllLoading(false); }
  };

  const deleteSchedule = async (scheduleId: number) => {
    // Collapse any expanded log FIRST so user isn't seeing details next to the confirm/success dialogs
    setExpandedScheduleId(null);
    setExpandedLogs([]);
    if (!confirm("Delete this scheduled email? This cannot be undone.")) return;
    try {
      await deleteClubLeadershipSchedule(scheduleId);
      if (allOpen) {
        // refresh all-schedules list quietly
        const data = await getClubLeadershipAllSchedules();
        setAllSchedules(data || []);
      }
      if (districtId && yearId) await loadRows(true);
      setSuccessMessage("Schedule deleted.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Delete failed.");
    }
  };

  const toggleScheduleLog = async (scheduleId: number) => {
    if (expandedScheduleId === scheduleId) {
      setExpandedScheduleId(null);
      setExpandedLogs([]);
      return;
    }
    setExpandedScheduleId(scheduleId);
    setLogLoading(true);
    try {
      const data = await getClubLeadershipScheduleLog(scheduleId);
      setExpandedLogs(data || []);
    } catch {
      setErrorMessage("Failed to load log.");
      setExpandedLogs([]);
    } finally { setLogLoading(false); }
  };

  const makeAdmin = async (clubId: number, memberId: number, role: "President" | "Secretary") => {
    const key = `${clubId}-${role}`;
    setMakingAdmin(key);
    try {
      const res = await makeClubLeadershipAdmin({
        clubId, yearId: Number(yearId), districtId: Number(districtId), memberId, role,
      });
      setSuccessMessage(res?.message || "Admin email sent.");
      await loadRows(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Make Admin failed.");
      await loadRows(true); // role may have been added before email failed — refresh to show admin status
    } finally { setMakingAdmin(null); }
  };

  const submitSchedule = async () => {
    if (!scheduleDate || !scheduleTime) { setErrorMessage("Pick date and time."); return; }
    setScheduling(true);
    try {
      const dt = `${scheduleDate}T${scheduleTime}:00`;
      const res = await scheduleClubLeadershipEmail({
        districtId: Number(districtId), yearId: Number(yearId), scheduleDateTime: dt,
      });
      setSuccessMessage(`Scheduled for ${res.totalRecipients} recipients.`);
      setScheduleOpen(false);
      setScheduleDate(""); setScheduleTime("");
      await loadRows(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Schedule failed.");
    } finally { setScheduling(false); }
  };

  const total = rows.length;
  const withPresident = rows.filter(r => r.presidentMemberId).length;
  const withSecretary = rows.filter(r => r.secretaryMemberId).length;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Club Leadership</h2>
              <p className="text-muted-foreground text-base">Bulk setup of club Presidents &amp; Secretaries across districts</p>
            </div>
          </div>
          <Button variant="outline" onClick={openAllSchedules}>
            <ListTree className="mr-2 h-4 w-4" />View All Schedules
          </Button>
        </div>

        {/* Filter row */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <Select value={districtId} onValueChange={setDistrictId}>
              <SelectTrigger><SelectValue placeholder="Select District" /></SelectTrigger>
              <SelectContent>
                {districts.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={yearId} onValueChange={setYearId}>
              <SelectTrigger><SelectValue placeholder="Select Year" /></SelectTrigger>
              <SelectContent>
                {years.map((y: any) => (
                  <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Search club / name..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={exportExcel} disabled={rows.length === 0} className="flex-1">
                <Download className="mr-2 h-4 w-4" />Export Excel
              </Button>
              <Button onClick={() => setScheduleOpen(true)} disabled={rows.length === 0} className="flex-1">
                <Send className="mr-2 h-4 w-4" />Schedule Email
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        {districtId && yearId && !loading && (
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Clubs</p><p className="text-xl font-bold">{total}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">With President</p><p className="text-xl font-bold">{withPresident} / {total}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">With Secretary</p><p className="text-xl font-bold">{withSecretary} / {total}</p></CardContent></Card>
          </div>
        )}

        {/* Clubs table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
            ) : !districtId || !yearId ? (
              <div className="text-center py-20 text-muted-foreground">Select District and Year to load clubs.</div>
            ) : filteredRows.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">No clubs found.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Club</TableHead>
                  <TableHead>President</TableHead>
                  <TableHead>Secretary</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredRows.map(r => {
                    // Phase 4 kill-switch: row is "chain inactive" when its club, district, or zone is inactive.
                    const chainInactive = r.chainActive === 0;
                    const inactiveTitle = chainInactive ? "Inactive — reactivate from Clubs/Districts page" : undefined;
                    return (
                    <TableRow key={r.clubId}>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{r.clubName}</div>
                          {chainInactive && <Badge variant="destructive">Inactive</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.clubRotaryId}</div>
                      </TableCell>
                      <TableCell className="align-top">
                        {r.presidentMemberId ? (
                          <div>
                            <div className="font-medium flex items-center gap-1">
                              {r.presidentName}
                              {!!r.presidentIsAdmin && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                            </div>
                            <div className="text-xs text-muted-foreground">{r.presidentMobile || "—"} · {r.presidentEmail || "—"}</div>
                            <div className="flex gap-1 mt-1">
                              <Button size="sm" variant="outline" className="h-7" onClick={() => openEdit(r.clubId, r.clubName, "President", r.presidentMemberId)}><Pencil className="mr-1 h-3 w-3" />Change</Button>
                              <Button size="sm" variant={r.presidentIsAdmin ? "secondary" : "default"} className={`h-7 ${r.presidentIsAdmin ? "bg-green-100 text-green-800 hover:bg-green-200 border border-green-300" : ""}`} disabled={makingAdmin === `${r.clubId}-President` || !r.presidentEmail || chainInactive} title={chainInactive ? inactiveTitle : undefined} onClick={() => makeAdmin(r.clubId, r.presidentMemberId!, "President")}>
                                {makingAdmin === `${r.clubId}-President` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> :
                                 r.presidentIsAdmin ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                                {r.presidentIsAdmin ? "Already Admin — Resend" : "Make Admin"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => openEdit(r.clubId, r.clubName, "President", null)}><User className="mr-1 h-3 w-3" />Add President</Button>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {r.secretaryMemberId ? (
                          <div>
                            <div className="font-medium flex items-center gap-1">
                              {r.secretaryName}
                              {!!r.secretaryIsAdmin && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                            </div>
                            <div className="text-xs text-muted-foreground">{r.secretaryMobile || "—"} · {r.secretaryEmail || "—"}</div>
                            <div className="flex gap-1 mt-1">
                              <Button size="sm" variant="outline" className="h-7" onClick={() => openEdit(r.clubId, r.clubName, "Secretary", r.secretaryMemberId)}><Pencil className="mr-1 h-3 w-3" />Change</Button>
                              <Button size="sm" variant={r.secretaryIsAdmin ? "secondary" : "default"} className={`h-7 ${r.secretaryIsAdmin ? "bg-green-100 text-green-800 hover:bg-green-200 border border-green-300" : ""}`} disabled={makingAdmin === `${r.clubId}-Secretary` || !r.secretaryEmail || chainInactive} title={chainInactive ? inactiveTitle : undefined} onClick={() => makeAdmin(r.clubId, r.secretaryMemberId!, "Secretary")}>
                                {makingAdmin === `${r.clubId}-Secretary` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> :
                                 r.secretaryIsAdmin ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                                {r.secretaryIsAdmin ? "Already Admin — Resend" : "Make Admin"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => openEdit(r.clubId, r.clubName, "Secretary", null)}><User className="mr-1 h-3 w-3" />Add Secretary</Button>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Email schedules — click row to expand per-recipient log */}
        {districtId && yearId && emailStatus.schedules?.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Email Schedules</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Scheduled For</TableHead><TableHead>Status</TableHead>
                  <TableHead>Recipients</TableHead><TableHead>Sent</TableHead><TableHead>Failed</TableHead><TableHead>Processed</TableHead>
                  <TableHead className="w-20">Action</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {emailStatus.schedules.map((s: any) => (
                    <React.Fragment key={s.id}>
                      <TableRow>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => toggleScheduleLog(s.id)}>
                            {expandedScheduleId === s.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell>{new Date(s.scheduleDateTime).toLocaleString("en-IN")}</TableCell>
                        <TableCell><Badge variant={s.status === "Completed" ? "default" : s.status === "Failed" ? "destructive" : "secondary"}>{s.status}</Badge></TableCell>
                        <TableCell>{s.totalRecipients}</TableCell>
                        <TableCell className="text-green-600">{s.sentCount}</TableCell>
                        <TableCell className="text-red-600">{s.failedCount}</TableCell>
                        <TableCell>{s.processedDate ? new Date(s.processedDate).toLocaleString("en-IN") : "—"}</TableCell>
                        <TableCell>
                          {s.status === "Pending" && (
                            <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => deleteSchedule(s.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expandedScheduleId === s.id && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted p-4">
                            {logLoading ? (
                              <div className="flex justify-center py-4"><RotaryLoader size="sm" /></div>
                            ) : expandedLogs.length === 0 ? (
                              <div className="text-center py-4 text-sm text-muted-foreground">No recipients logged.</div>
                            ) : (
                              <div className="overflow-x-auto">
                                <Table>
                                  <TableHeader><TableRow>
                                    <TableHead>Club</TableHead><TableHead>Member</TableHead>
                                    <TableHead>Designation</TableHead><TableHead>Email</TableHead>
                                    <TableHead>Status</TableHead><TableHead>Sent</TableHead>
                                    <TableHead>Error / Note</TableHead>
                                  </TableRow></TableHeader>
                                  <TableBody>
                                    {expandedLogs.map((l: any, i: number) => {
                                      const isAcceptAll = l.status === "Sent" && typeof l.errorMessage === "string" && l.errorMessage.startsWith("ACCEPT_ALL");
                                      return (
                                        <TableRow key={i}>
                                          <TableCell className="font-medium">{l.clubName}</TableCell>
                                          <TableCell>{l.memberName}</TableCell>
                                          <TableCell>{l.designation}</TableCell>
                                          <TableCell className="text-xs">{l.email}</TableCell>
                                          <TableCell>
                                            {l.status === "Sent" && isAcceptAll ? <Badge className="bg-amber-500"><CheckCircle2 className="mr-1 h-3 w-3" />Sent (unverified)</Badge> :
                                             l.status === "Sent" ? <Badge className="bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Sent</Badge> :
                                             l.status === "Failed" ? <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Failed</Badge> :
                                             <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />{l.status}</Badge>}
                                          </TableCell>
                                          <TableCell className="text-xs">{l.sentDate ? new Date(l.sentDate).toLocaleString("en-IN") : "—"}</TableCell>
                                          <TableCell className={`text-xs ${l.status === "Failed" ? "text-red-600" : "text-muted-foreground"}`}>{l.errorMessage || "—"}</TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Edit Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Select {editRole} — {editClubName}</DialogTitle>
            </DialogHeader>
            <Input placeholder="Search member..." value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
            <div className="max-h-80 overflow-y-auto border rounded">
              {filteredMembers.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No members found.</div>
              ) : filteredMembers.map(m => (
                <label key={m.memberId} className={`flex items-start gap-2 p-3 border-b cursor-pointer hover:bg-accent ${selectedMemberId === String(m.memberId) ? "bg-primary/10" : ""}`}>
                  <input type="radio" name="member" value={m.memberId} checked={selectedMemberId === String(m.memberId)} onChange={() => setSelectedMemberId(String(m.memberId))} className="mt-1" />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{m.memberName}</div>
                    <div className="text-xs text-muted-foreground">{m.mobile || "—"} · {m.email || "—"}</div>
                  </div>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={saving || !selectedMemberId}>{saving ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View All Schedules Dialog */}
        <Dialog open={allOpen} onOpenChange={setAllOpen}>
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>All Email Schedules (across all districts &amp; years)</DialogTitle>
            </DialogHeader>
            {allLoading ? (
              <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
            ) : allSchedules.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No schedules yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>District</TableHead><TableHead>Year</TableHead>
                    <TableHead>Scheduled For</TableHead><TableHead>Status</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>Processed</TableHead>
                    <TableHead className="w-20">Action</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {allSchedules.map((s: any) => (
                      <React.Fragment key={s.id}>
                        <TableRow>
                          <TableCell>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => toggleScheduleLog(s.id)}>
                              {expandedScheduleId === s.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">D{s.districtNumber || s.districtId}</TableCell>
                          <TableCell>{s.yearLabel || "—"}</TableCell>
                          <TableCell>{new Date(s.scheduleDateTime).toLocaleString("en-IN")}</TableCell>
                          <TableCell><Badge variant={s.status === "Completed" ? "default" : s.status === "Failed" ? "destructive" : "secondary"}>{s.status}</Badge></TableCell>
                          <TableCell className="text-right">{s.totalRecipients}</TableCell>
                          <TableCell className="text-right text-green-600">{s.sentCount}</TableCell>
                          <TableCell className="text-right text-red-600">{s.failedCount}</TableCell>
                          <TableCell className="text-xs">{s.processedDate ? new Date(s.processedDate).toLocaleString("en-IN") : "—"}</TableCell>
                          <TableCell>
                            {s.status === "Pending" && (
                              <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => deleteSchedule(s.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {expandedScheduleId === s.id && (
                          <TableRow>
                            <TableCell colSpan={10} className="bg-muted p-4">
                              {logLoading ? (
                                <div className="flex justify-center py-4"><RotaryLoader size="sm" /></div>
                              ) : expandedLogs.length === 0 ? (
                                <div className="text-center py-4 text-sm text-muted-foreground">No recipients logged for this schedule.</div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <Table>
                                    <TableHeader><TableRow>
                                      <TableHead>Club</TableHead><TableHead>Member</TableHead>
                                      <TableHead>Designation</TableHead><TableHead>Email</TableHead>
                                      <TableHead>Status</TableHead><TableHead>Sent</TableHead>
                                      <TableHead>Error</TableHead>
                                    </TableRow></TableHeader>
                                    <TableBody>
                                      {expandedLogs.map((l: any, i: number) => {
                                        const isAcceptAll = l.status === "Sent" && typeof l.errorMessage === "string" && l.errorMessage.startsWith("ACCEPT_ALL");
                                        return (
                                        <TableRow key={i}>
                                          <TableCell className="font-medium">{l.clubName}</TableCell>
                                          <TableCell>{l.memberName}</TableCell>
                                          <TableCell>{l.designation}</TableCell>
                                          <TableCell className="text-xs">{l.email}</TableCell>
                                          <TableCell>
                                            {l.status === "Sent" && isAcceptAll ? <Badge className="bg-amber-500"><CheckCircle2 className="mr-1 h-3 w-3" />Sent (unverified)</Badge> :
                                             l.status === "Sent" ? <Badge className="bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Sent</Badge> :
                                             l.status === "Failed" ? <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Failed</Badge> :
                                             <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />{l.status}</Badge>}
                                          </TableCell>
                                          <TableCell className="text-xs">{l.sentDate ? new Date(l.sentDate).toLocaleString("en-IN") : "—"}</TableCell>
                                          <TableCell className={`text-xs ${l.status === "Failed" ? "text-red-600" : "text-muted-foreground"}`}>{l.errorMessage || "—"}</TableCell>
                                        </TableRow>);
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAllOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Schedule Dialog */}
        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Schedule Credentials Email</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Email will be sent to all Presidents &amp; Secretaries of the selected district and year at the scheduled time.</p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Date</label>
              <DateField value={scheduleDate} onChange={setScheduleDate} />
              <label className="text-sm font-medium">Time</label>
              <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
              <Button onClick={submitSchedule} disabled={scheduling}>{scheduling ? "Scheduling..." : "Schedule"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
