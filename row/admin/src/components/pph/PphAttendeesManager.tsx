"use client";

import { useState, useEffect, useCallback } from "react";
import {
  PphCamp,
  PphAttendee,
  PphAttendeeDetail,
  PphMedicalReading,
  PphMobileHistory,
  CreatePphReadingPayload,
  UpdatePphAttendeePayload,
  UpdatePphReadingPayload,
} from "@/types/pphCamp";
import {
  getPphCamps,
  getPphAttendees,
  getPphAttendeeDetail,
  addPphReading,
  updatePphAttendee,
  updatePphReading,
  deletePphReading,
  deletePphAttendee,
  getPphAttendeeHistoryByMobile,
  getDistrictPphCamps,
  getDistrictPphAttendees,
  getDistrictPphAttendeeDetail,
  addDistrictPphReading,
  updateDistrictPphAttendee,
  updateDistrictPphReading,
  deleteDistrictPphReading,
  deleteDistrictPphAttendee,
  getDistrictPphAttendeeHistoryByMobile,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
  AlertTriangle,
  History,
  Building2,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

type Scope = "club" | "district";

// ── Scope-aware API binding ──────────────────────────────────────────────
function bindApi(scope: Scope, scopeId: number) {
  if (scope === "club") {
    return {
      listCamps: () => getPphCamps(scopeId),
      listAttendees: (campId: number) => getPphAttendees(scopeId, campId),
      getDetail: (campId: number, attendeeId: number) => getPphAttendeeDetail(scopeId, campId, attendeeId),
      addReading: (campId: number, dto: CreatePphReadingPayload) => addPphReading(scopeId, campId, dto),
      updateAttendee: (campId: number, attendeeId: number, dto: UpdatePphAttendeePayload) => updatePphAttendee(scopeId, campId, attendeeId, dto),
      updateReading: (campId: number, readingId: number, dto: UpdatePphReadingPayload) => updatePphReading(scopeId, campId, readingId, dto),
      deleteReading: (campId: number, readingId: number) => deletePphReading(scopeId, campId, readingId),
      deleteAttendee: (campId: number, attendeeId: number) => deletePphAttendee(scopeId, campId, attendeeId),
      historyByMobile: (mobile: string) => getPphAttendeeHistoryByMobile(scopeId, mobile),
      backHref: `/clubs/${scopeId}/pph-camps`,
    };
  }
  return {
    listCamps: () => getDistrictPphCamps(scopeId),
    listAttendees: (campId: number) => getDistrictPphAttendees(scopeId, campId),
    getDetail: (campId: number, attendeeId: number) => getDistrictPphAttendeeDetail(scopeId, campId, attendeeId),
    addReading: (campId: number, dto: CreatePphReadingPayload) => addDistrictPphReading(scopeId, campId, dto),
    updateAttendee: (campId: number, attendeeId: number, dto: UpdatePphAttendeePayload) => updateDistrictPphAttendee(scopeId, campId, attendeeId, dto),
    updateReading: (campId: number, readingId: number, dto: UpdatePphReadingPayload) => updateDistrictPphReading(scopeId, campId, readingId, dto),
    deleteReading: (campId: number, readingId: number) => deleteDistrictPphReading(scopeId, campId, readingId),
    deleteAttendee: (campId: number, attendeeId: number) => deleteDistrictPphAttendee(scopeId, campId, attendeeId),
    historyByMobile: (mobile: string) => getDistrictPphAttendeeHistoryByMobile(scopeId, mobile),
    backHref: `/districts/${scopeId}/pph-camps`,
  };
}

// ── Form models ───────────────────────────────────────────────────────────
interface ReadingForm {
  // person
  name: string;
  mobileNo: string;
  sex: string;
  address: string;
  age: string;
  // medical
  bpSystolic: string;
  bpDiastolic: string;
  bloodSugarType: string;
  bloodSugarValue: string;
  heightCm: string;
  weightKg: string;
  bmi: string;
  diabetesStatus: string;
  bpStatus: string;
  isConsentedForMessages: boolean;
  remarks: string;
}

const emptyForm: ReadingForm = {
  name: "", mobileNo: "", sex: "", address: "", age: "",
  bpSystolic: "", bpDiastolic: "", bloodSugarType: "", bloodSugarValue: "",
  heightCm: "", weightKg: "", bmi: "", diabetesStatus: "", bpStatus: "",
  isConsentedForMessages: false, remarks: "",
};

function calcBmi(heightCm: string, weightKg: string): string {
  const h = parseFloat(heightCm);
  const w = parseFloat(weightKg);
  if (!h || !w || h <= 0 || w <= 0) return "";
  const m = h / 100;
  return (Math.round((w / (m * m)) * 100) / 100).toString();
}

function bpText(r: PphMedicalReading | null): string {
  if (!r || !r.bpSystolic || !r.bpDiastolic) return "-";
  return `${r.bpSystolic}/${r.bpDiastolic}`;
}
function sugarText(r: PphMedicalReading | null): string {
  if (!r || !r.bloodSugarValue) return "-";
  return `${r.bloodSugarValue}${r.bloodSugarType ? ` (${r.bloodSugarType})` : ""}`;
}
function fmtDate(s: string): string {
  if (!s) return "-";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function bmiText(r: PphMedicalReading): string {
  if (r.bmi == null) return "-";
  return `${r.bmi}${r.isObese ? " (Obese)" : r.isOverweight ? " (Overweight)" : ""}`;
}
function htWtText(r: PphMedicalReading): string {
  if (r.heightCm == null && r.weightKg == null) return "-";
  return `${r.heightCm ?? "-"} cm / ${r.weightKg ?? "-"} kg`;
}

// Newest medical reading across every camp in a mobile history (with where it was taken).
function latestHistoryReading(h: PphMobileHistory): { reading: PphMedicalReading; groupName: string; campTitle: string } | null {
  let best: { reading: PphMedicalReading; groupName: string; campTitle: string } | null = null;
  for (const g of h.groups) {
    for (const e of g.entries) {
      for (const r of e.readings ?? []) {
        if (!best || new Date(r.readingDate).getTime() > new Date(best.reading.readingDate).getTime()) {
          best = { reading: r, groupName: g.groupName, campTitle: e.campTitle };
        }
      }
    }
  }
  return best;
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-white px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium leading-tight">{value}</p>
    </div>
  );
}

export default function PphAttendeesManager({ scope, scopeId, campId, backHref, variant = "v1" }: { scope: Scope; scopeId: number; campId: number; backHref?: string; variant?: "v1" | "v2" }) {
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;
  const fns = bindApi(scope, scopeId);

  // v2 renders in the new dashboard palette (slate + emerald) instead of the
  // legacy primary-blue theme, so it blends into the V2 camp module chrome.
  const v2 = variant === "v2";
  const accentText = v2 ? "text-slate-800" : "text-primary";
  const headRowCls = v2 ? "bg-slate-100 hover:bg-slate-100" : "bg-primary hover:bg-primary";
  const headCellCls = v2 ? "text-slate-600 text-xs font-semibold uppercase" : "text-primary-foreground text-sm font-semibold";
  const addBtnCls = v2 ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "";

  const [camp, setCamp] = useState<PphCamp | null>(null);
  const [attendees, setAttendees] = useState<PphAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Add reading dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<ReadingForm>(emptyForm);
  const [matchedAttendee, setMatchedAttendee] = useState<PphAttendee | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // History dialog (per-attendee MEDICAL readings — camp-local)
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detail, setDetail] = useState<PphAttendeeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Cross-club PARTICIPATION history (by mobile) — popup opened from a row action or the add form.
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [mobileHistory, setMobileHistory] = useState<PphMobileHistory | null>(null);
  const [mobileHistoryLoading, setMobileHistoryLoading] = useState(false);
  const [mobileHistoryMobile, setMobileHistoryMobile] = useState("");

  // Add-form inline history: auto-looked-up when a mobile is entered (debounced, informational only).
  const [addHistory, setAddHistory] = useState<PphMobileHistory | null>(null);
  const [addHistoryLoading, setAddHistoryLoading] = useState(false);

  // Edit attendee dialog
  const [editAttendeeOpen, setEditAttendeeOpen] = useState(false);
  const [editingAttendee, setEditingAttendee] = useState<PphAttendee | null>(null);
  const [attForm, setAttForm] = useState({ name: "", mobileNo: "", sex: "", address: "", isConsentedForMessages: false });

  // Edit reading dialog
  const [editReadingOpen, setEditReadingOpen] = useState(false);
  const [editingReading, setEditingReading] = useState<PphMedicalReading | null>(null);
  const [rdgForm, setRdgForm] = useState({ age: "", bpSystolic: "", bpDiastolic: "", bloodSugarType: "", bloodSugarValue: "", heightCm: "", weightKg: "", bmi: "", diabetesStatus: "", bpStatus: "", remarks: "" });

  // Delete targets
  const [deleteAttendeeTarget, setDeleteAttendeeTarget] = useState<PphAttendee | null>(null);
  const [deleteReadingTarget, setDeleteReadingTarget] = useState<PphMedicalReading | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [camps, list] = await Promise.all([fns.listCamps(), fns.listAttendees(campId)]);
      setCamp((camps as PphCamp[]).find((c) => c.id === campId) || null);
      setAttendees(list);
    } catch (err: unknown) {
      const r = (err as { response?: { data?: { message?: string } } })?.response?.data;
      setErrorMessage(r?.message || "Failed to load attendee data.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, scopeId, campId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Add reading ──────────────────────────────────────────────────────
  const openAdd = () => {
    setAddForm(emptyForm);
    setMatchedAttendee(null);
    setAddHistory(null);
    setAddOpen(true);
  };

  // ── Cross-club participation history (by mobile) ───────────────────────
  const openMobileHistory = async (mobile: string) => {
    const m = (mobile || "").trim();
    if (!m) return;
    setMobileHistoryMobile(m);
    setMobileHistory(null);
    setMobileHistoryOpen(true);
    setMobileHistoryLoading(true);
    try {
      setMobileHistory(await fns.historyByMobile(m));
    } catch {
      setErrorMessage("Failed to load participation history.");
    } finally {
      setMobileHistoryLoading(false);
    }
  };

  // Auto-lookup on the add form: when a mobile reaches 10 digits, fetch that person's
  // cross-club history (debounced) and surface it inline — informational only, never
  // auto-filling the other fields. No matches → nothing shown (new member).
  useEffect(() => {
    if (!addOpen) return;
    const digits = (addForm.mobileNo || "").replace(/\D/g, "");
    if (digits.length < 10) { setAddHistory(null); setAddHistoryLoading(false); return; }
    let cancelled = false;
    setAddHistoryLoading(true);
    const t = setTimeout(async () => {
      try {
        const h = await fns.historyByMobile(addForm.mobileNo.trim());
        if (!cancelled) setAddHistory(h && h.totalEntries > 0 ? h : null);
      } catch {
        if (!cancelled) setAddHistory(null);
      } finally {
        if (!cancelled) setAddHistoryLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addForm.mobileNo, addOpen]);

  // Full cross-club history renderer: every camp visit (any club / district camp / year) with the person's
  // details and EVERY medical reading's values, plus the latest reading summarised on top.
  const renderMobileHistory = (h: PphMobileHistory) => {
    const latest = latestHistoryReading(h);
    const totalReadings = h.groups.reduce(
      (sum, g) => sum + g.entries.reduce((s, e) => s + (e.readings?.length ?? e.readingCount ?? 0), 0), 0);
    return (
      <div className="space-y-4">
        <p className="text-sm">
          <span className="font-semibold">
            {h.totalEntries} camp visit{h.totalEntries === 1 ? "" : "s"} across {h.groupCount} club{h.groupCount === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground"> · {totalReadings} medical reading{totalReadings === 1 ? "" : "s"}</span>
        </p>

        {latest && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-3">
            <p className="text-xs font-semibold text-emerald-900 mb-2">
              Latest reading · {fmtDate(latest.reading.readingDate)} · {latest.campTitle} ({latest.groupName})
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <HistoryStat label="Age" value={latest.reading.age != null ? String(latest.reading.age) : "-"} />
              <HistoryStat label="Blood Pressure" value={`${bpText(latest.reading)}${latest.reading.bpStatus ? ` · ${latest.reading.bpStatus}` : ""}`} />
              <HistoryStat label="Blood Sugar" value={sugarText(latest.reading)} />
              <HistoryStat label="Diabetes" value={latest.reading.diabetesStatus || "-"} />
              <HistoryStat label="Height / Weight" value={htWtText(latest.reading)} />
              <HistoryStat label="BMI" value={bmiText(latest.reading)} />
            </div>
          </div>
        )}

        {h.groups.map((g, gi) => (
          <div key={gi} className="rounded-md border overflow-hidden">
            <div className={`flex items-center justify-between px-3 py-2 ${v2 ? "bg-slate-100" : "bg-primary/10"}`}>
              <span className="font-semibold text-sm flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />{g.groupName}
              </span>
              <span className="text-xs font-medium rounded-full bg-white px-2 py-0.5 border">
                {g.entryCount} camp visit{g.entryCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="divide-y">
              {g.entries.map((e) => (
                <div key={e.attendeeId} className="p-3 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{e.campTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      Camp date {fmtDate(e.campDate)} · RY {e.yearLabel} · {e.readings?.length ?? e.readingCount} reading{(e.readings?.length ?? e.readingCount) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                    <span><span className="text-muted-foreground">Name:</span> {e.attendeeName || "-"}</span>
                    <span><span className="text-muted-foreground">Mobile:</span> {e.mobileNo || "-"}</span>
                    <span><span className="text-muted-foreground">Sex:</span> {e.sex || "-"}</span>
                    <span><span className="text-muted-foreground">Consent for messages:</span> {e.isConsentedForMessages ? "Yes" : "No"}</span>
                    <span className="sm:col-span-2 lg:col-span-4"><span className="text-muted-foreground">Address:</span> {e.address || "-"}</span>
                  </div>
                  {e.readings && e.readings.length > 0 ? (
                    <div className="overflow-x-auto rounded border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Reg No</TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                            <TableHead className="text-xs text-center">Age</TableHead>
                            <TableHead className="text-xs text-center">BP</TableHead>
                            <TableHead className="text-xs">BP Status</TableHead>
                            <TableHead className="text-xs text-center">Sugar</TableHead>
                            <TableHead className="text-xs">Diabetes</TableHead>
                            <TableHead className="text-xs text-center">Height / Weight</TableHead>
                            <TableHead className="text-xs text-center">BMI</TableHead>
                            <TableHead className="text-xs">Remarks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {e.readings.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="text-sm font-medium">{r.registrationNo || "-"}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{fmtDate(r.readingDate)}</TableCell>
                              <TableCell className="text-sm text-center">{r.age ?? "-"}</TableCell>
                              <TableCell className="text-sm text-center whitespace-nowrap">{bpText(r)}</TableCell>
                              <TableCell className="text-sm">{r.bpStatus || "-"}</TableCell>
                              <TableCell className="text-sm text-center whitespace-nowrap">{sugarText(r)}</TableCell>
                              <TableCell className="text-sm">{r.diabetesStatus || "-"}</TableCell>
                              <TableCell className="text-sm text-center whitespace-nowrap">{htWtText(r)}</TableCell>
                              <TableCell className="text-sm text-center whitespace-nowrap">{bmiText(r)}</TableCell>
                              <TableCell className="text-sm">{r.remarks || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No medical readings recorded at this camp.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const onAddField = (field: keyof ReadingForm, value: string | boolean) => {
    setAddForm((prev) => {
      const next = { ...prev, [field]: value } as ReadingForm;
      if (field === "heightCm" || field === "weightKg") {
        next.bmi = calcBmi(field === "heightCm" ? (value as string) : prev.heightCm, field === "weightKg" ? (value as string) : prev.weightKg);
      }
      return next;
    });
    // When mobile matches an existing attendee in this camp, prefill + lock person fields.
    if (field === "mobileNo") {
      const mob = (value as string).trim();
      const match = mob ? attendees.find((a) => a.mobileNo === mob) || null : null;
      setMatchedAttendee(match);
      if (match) {
        setAddForm((prev) => ({
          ...prev,
          mobileNo: mob,
          name: match.name,
          sex: match.sex || "",
          address: match.address || "",
          isConsentedForMessages: match.isConsentedForMessages,
          // Age is per-visit — keep whatever the user is entering now (not locked).
        }));
      }
    }
  };

  const validateReading = (f: { bpSystolic: string; bpDiastolic: string; bloodSugarType: string; bloodSugarValue: string; heightCm: string; weightKg: string }): string | null => {
    if (!f.bpSystolic.trim() || !f.bpDiastolic.trim()) return "Blood Pressure (systolic and diastolic) is required.";
    if (!f.bloodSugarType.trim()) return "Blood Sugar type is required.";
    if (!f.bloodSugarValue.trim()) return "Blood Sugar value is required.";
    if (!f.heightCm.trim()) return "Height is required.";
    if (!f.weightKg.trim()) return "Weight is required.";
    return null;
  };

  const submitAdd = async () => {
    if (!addForm.name.trim()) return setErrorMessage("Name is required.");
    if (!addForm.mobileNo.trim()) return setErrorMessage("Mobile number is required.");
    if (!addForm.sex.trim()) return setErrorMessage("Sex is required.");
    if (!addForm.address.trim()) return setErrorMessage("Address is required.");
    if (!addForm.age.trim()) return setErrorMessage("Age is required.");
    const medErr = validateReading(addForm);
    if (medErr) return setErrorMessage(medErr);

    setSubmitting(true);
    try {
      const dto: CreatePphReadingPayload = {
        name: addForm.name.trim(),
        mobileNo: addForm.mobileNo.trim(),
        sex: addForm.sex,
        address: addForm.address.trim(),
        age: parseInt(addForm.age),
        bpSystolic: parseInt(addForm.bpSystolic),
        bpDiastolic: parseInt(addForm.bpDiastolic),
        bloodSugarType: addForm.bloodSugarType,
        bloodSugarValue: parseFloat(addForm.bloodSugarValue),
        heightCm: parseFloat(addForm.heightCm),
        weightKg: parseFloat(addForm.weightKg),
        diabetesStatus: addForm.diabetesStatus || null,
        bpStatus: addForm.bpStatus || null,
        isConsentedForMessages: addForm.isConsentedForMessages,
        remarks: addForm.remarks.trim() || null,
      };
      const result = await fns.addReading(campId, dto);
      const newReg = result?.history?.[0]?.registrationNo;
      setAddOpen(false);
      setSuccessMessage(
        `${matchedAttendee ? "New reading added to existing attendee" : "Attendee and reading added successfully"}${newReg ? `: Reg ${newReg}` : ""}.`
      );
      fetchData();
    } catch (err: unknown) {
      const r = (err as { response?: { data?: { message?: string; title?: string } } })?.response?.data;
      setErrorMessage(r?.message || r?.title || "Failed to save reading.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── History ──────────────────────────────────────────────────────────
  const openHistory = async (attendee: PphAttendee) => {
    setHistoryOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await fns.getDetail(campId, attendee.id));
    } catch {
      setErrorMessage("Failed to load medical history.");
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Edit attendee (shows latest reading) ──────────────────────────────
  const openEditAttendee = (a: PphAttendee) => {
    setEditingAttendee(a);
    setAttForm({
      name: a.name || "",
      mobileNo: a.mobileNo || "",
      sex: a.sex || "",
      address: a.address || "",
      isConsentedForMessages: a.isConsentedForMessages,
    });
    setEditAttendeeOpen(true);
  };

  const submitEditAttendee = async () => {
    if (!editingAttendee) return;
    if (!attForm.name.trim()) return setErrorMessage("Name is required.");
    if (!attForm.mobileNo.trim()) return setErrorMessage("Mobile number is required.");
    if (!attForm.sex.trim()) return setErrorMessage("Sex is required.");
    if (!attForm.address.trim()) return setErrorMessage("Address is required.");
    setSubmitting(true);
    try {
      const dto: UpdatePphAttendeePayload = {
        name: attForm.name.trim(),
        mobileNo: attForm.mobileNo.trim(),
        sex: attForm.sex,
        address: attForm.address.trim(),
        isConsentedForMessages: attForm.isConsentedForMessages,
      };
      await fns.updateAttendee(campId, editingAttendee.id, dto);
      setEditAttendeeOpen(false);
      setSuccessMessage("Attendee updated successfully.");
      fetchData();
    } catch (err: unknown) {
      const r = (err as { response?: { data?: { message?: string } } })?.response?.data;
      setErrorMessage(r?.message || "Failed to update attendee.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Edit reading ──────────────────────────────────────────────────────
  const openEditReading = (r: PphMedicalReading) => {
    setEditingReading(r);
    setRdgForm({
      age: r.age?.toString() || "",
      bpSystolic: r.bpSystolic?.toString() || "",
      bpDiastolic: r.bpDiastolic?.toString() || "",
      bloodSugarType: r.bloodSugarType || "",
      bloodSugarValue: r.bloodSugarValue?.toString() || "",
      heightCm: r.heightCm?.toString() || "",
      weightKg: r.weightKg?.toString() || "",
      bmi: r.bmi?.toString() || "",
      diabetesStatus: r.diabetesStatus || "",
      bpStatus: r.bpStatus || "",
      remarks: r.remarks || "",
    });
    setEditReadingOpen(true);
  };

  const onRdgField = (field: keyof typeof rdgForm, value: string) => {
    setRdgForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "heightCm" || field === "weightKg") {
        next.bmi = calcBmi(field === "heightCm" ? value : prev.heightCm, field === "weightKg" ? value : prev.weightKg);
      }
      return next;
    });
  };

  const submitEditReading = async () => {
    if (!editingReading) return;
    if (!rdgForm.age.trim()) return setErrorMessage("Age is required.");
    const medErr = validateReading(rdgForm);
    if (medErr) return setErrorMessage(medErr);
    setSubmitting(true);
    try {
      const dto: UpdatePphReadingPayload = {
        age: parseInt(rdgForm.age),
        bpSystolic: parseInt(rdgForm.bpSystolic),
        bpDiastolic: parseInt(rdgForm.bpDiastolic),
        bloodSugarType: rdgForm.bloodSugarType,
        bloodSugarValue: parseFloat(rdgForm.bloodSugarValue),
        heightCm: parseFloat(rdgForm.heightCm),
        weightKg: parseFloat(rdgForm.weightKg),
        diabetesStatus: rdgForm.diabetesStatus || null,
        bpStatus: rdgForm.bpStatus || null,
        remarks: rdgForm.remarks.trim() || null,
      };
      await fns.updateReading(campId, editingReading.id, dto);
      setEditReadingOpen(false);
      // Refresh history if open
      if (detail) {
        try { setDetail(await fns.getDetail(campId, detail.attendee.id)); } catch { /* ignore */ }
      }
      setSuccessMessage("Reading updated successfully.");
      fetchData();
    } catch (err: unknown) {
      const r = (err as { response?: { data?: { message?: string } } })?.response?.data;
      setErrorMessage(r?.message || "Failed to update reading.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Deletes ───────────────────────────────────────────────────────────
  const confirmDeleteAttendee = async () => {
    if (!deleteAttendeeTarget) return;
    try {
      await fns.deleteAttendee(campId, deleteAttendeeTarget.id);
      setDeleteAttendeeTarget(null);
      if (historyOpen && detail?.attendee.id === deleteAttendeeTarget.id) setHistoryOpen(false);
      setSuccessMessage("Attendee and all their readings deleted.");
      fetchData();
    } catch {
      setDeleteAttendeeTarget(null);
      setErrorMessage("Failed to delete attendee.");
    }
  };

  const confirmDeleteReading = async () => {
    if (!deleteReadingTarget) return;
    try {
      await fns.deleteReading(campId, deleteReadingTarget.id);
      const wasAttendee = detail?.attendee.id;
      setDeleteReadingTarget(null);
      if (detail && wasAttendee) {
        try { setDetail(await fns.getDetail(campId, wasAttendee)); } catch { /* ignore */ }
      }
      setSuccessMessage("Reading deleted.");
      fetchData();
    } catch {
      setDeleteReadingTarget(null);
      setErrorMessage("Failed to delete reading.");
    }
  };

  const filtered = attendees.filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (a.name || "").toLowerCase().includes(q) || (a.mobileNo || "").toLowerCase().includes(q) || (a.address || "").toLowerCase().includes(q);
  });

  const personLocked = !!matchedAttendee;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={backHref ?? fns.backHref}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className={`text-2xl font-bold tracking-tight ${accentText}`}>
                {camp ? `${camp.title} - Attendees` : "PPH Camp Attendees"}
              </h2>
              <p className="text-muted-foreground text-base">Each attendee (unique mobile) can have multiple medical readings.</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAdd} className={addBtnCls}><Plus className="mr-2 h-4 w-4" />Add Reading</Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
        )}

        {!loading && attendees.length > 0 && (
          <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Search by name, mobile, address..." />
        )}

        {!loading && attendees.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No attendees yet</h3>
            <p className="text-muted-foreground mt-2">{canManage ? 'Click "Add Reading" to register the first attendee.' : "No attendees for this camp."}</p>
          </div>
        )}

        {!loading && filtered.length === 0 && attendees.length > 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No results found</h3>
            <p className="text-muted-foreground mt-2">No attendees match &quot;{searchQuery}&quot;.</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className={headRowCls}>
                    <TableHead className={`${headCellCls} w-12`}>#</TableHead>
                    <TableHead className={headCellCls}>Name</TableHead>
                    <TableHead className={headCellCls}>Mobile</TableHead>
                    <TableHead className={headCellCls}>Sex</TableHead>
                    <TableHead className={`${headCellCls} text-center`}>Age</TableHead>
                    <TableHead className={`${headCellCls} text-center`}>Latest BP</TableHead>
                    <TableHead className={`${headCellCls} text-center`}>Latest Sugar</TableHead>
                    <TableHead className={`${headCellCls} text-center`}>Latest BMI</TableHead>
                    <TableHead className={`${headCellCls} text-center`}>Readings</TableHead>
                    <TableHead className={`${headCellCls} w-32`}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a, i) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{i + 1}</TableCell>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{a.mobileNo}</TableCell>
                      <TableCell>{a.sex || "-"}</TableCell>
                      <TableCell className="text-center">{a.latestReading?.age ?? "-"}</TableCell>
                      <TableCell className="text-center">{bpText(a.latestReading)}</TableCell>
                      <TableCell className="text-center">{sugarText(a.latestReading)}</TableCell>
                      <TableCell className="text-center">{a.latestReading?.bmi ?? "-"}</TableCell>
                      <TableCell className="text-center">{a.readingCount}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Medical history (this camp)" onClick={() => openHistory(a)}>
                            <History className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Participation history across all clubs & camps" onClick={() => openMobileHistory(a.mobileNo)}>
                            <Building2 className="h-4 w-4" />
                          </Button>
                          {canManage && (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit attendee" onClick={() => openEditAttendee(a)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete attendee" onClick={() => setDeleteAttendeeTarget(a)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* ── Add Reading dialog ── */}
        <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setAddOpen(false); }}>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Reading</DialogTitle>
              <DialogDescription>
                Enter the mobile number first. If the attendee already exists in this camp, their details are reused and a new reading is added.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Mobile first (the key) */}
              <div className="space-y-2">
                <Label htmlFor="add-mobile">Mobile No <span className="text-destructive">*</span></Label>
                <Input id="add-mobile" value={addForm.mobileNo} onChange={(e) => onAddField("mobileNo", e.target.value)} placeholder="Mobile number (unique per camp)" />
                {matchedAttendee && (
                  <p className="text-xs text-amber-600 font-medium">Existing attendee &quot;{matchedAttendee.name}&quot;. This adds a NEW reading to them. Person details are locked (edit them from the attendee row).</p>
                )}
                {addHistoryLoading && (
                  <p className="text-xs text-muted-foreground">Checking participation history…</p>
                )}
                {addHistory && (
                  <div className="rounded-md border border-sky-200 bg-sky-50/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-sky-900 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                        This mobile has attended before: {addHistory.totalEntries} entr{addHistory.totalEntries === 1 ? "y" : "ies"} across {addHistory.groupCount} club{addHistory.groupCount === 1 ? "" : "s"}.
                      </p>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => openMobileHistory(addForm.mobileNo)}>
                        View history
                      </Button>
                    </div>
                    {(() => {
                      const last = latestHistoryReading(addHistory);
                      return last ? (
                        <p className="mt-1 text-[11px] text-sky-900">
                          Last reading {fmtDate(last.reading.readingDate)} at {last.groupName}: BP {bpText(last.reading)}
                          {last.reading.bpStatus ? ` (${last.reading.bpStatus})` : ""} · Sugar {sugarText(last.reading)}
                          {last.reading.diabetesStatus ? ` (${last.reading.diabetesStatus})` : ""} · BMI {bmiText(last.reading)}
                        </p>
                      ) : null;
                    })()}
                    <p className="mt-1 text-[11px] text-sky-800">Informational only. Please still fill in the details below.</p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-name">Name <span className="text-destructive">*</span></Label>
                <Input id="add-name" value={addForm.name} disabled={personLocked} onChange={(e) => onAddField("name", e.target.value)} placeholder="Enter name" />
              </div>
              <div className="space-y-2">
                <Label>Sex <span className="text-destructive">*</span></Label>
                <Select value={addForm.sex} onValueChange={(v) => onAddField("sex", v)} disabled={personLocked}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-address">Address <span className="text-destructive">*</span></Label>
                <Textarea id="add-address" value={addForm.address} disabled={personLocked} onChange={(e) => onAddField("address", e.target.value)} placeholder="Enter address" rows={2} />
              </div>

              <div className={`border-t pt-3 text-sm font-semibold ${accentText}`}>Medical reading</div>

              {/* Age is part of the reading — it can change between visits, so always editable. */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="add-age">Age <span className="text-destructive">*</span></Label>
                  <Input id="add-age" type="number" value={addForm.age} onChange={(e) => onAddField("age", e.target.value)} placeholder="Age at this visit" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Blood Pressure (mmHg) <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-2 gap-4">
                  <Input type="number" value={addForm.bpSystolic} onChange={(e) => onAddField("bpSystolic", e.target.value)} placeholder="Systolic" />
                  <Input type="number" value={addForm.bpDiastolic} onChange={(e) => onAddField("bpDiastolic", e.target.value)} placeholder="Diastolic" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Blood Sugar (mg/dl) <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-2 gap-4">
                  <Select value={addForm.bloodSugarType} onValueChange={(v) => onAddField("bloodSugarType", v)}>
                    <SelectTrigger><SelectValue placeholder="FBS / RBS" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FBS">FBS (Fasting)</SelectItem>
                      <SelectItem value="RBS">RBS (Random)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" value={addForm.bloodSugarValue} onChange={(e) => onAddField("bloodSugarValue", e.target.value)} placeholder="Value" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Height (cm) <span className="text-destructive">*</span></Label>
                  <Input type="number" value={addForm.heightCm} onChange={(e) => onAddField("heightCm", e.target.value)} placeholder="cm" />
                </div>
                <div className="space-y-2">
                  <Label>Weight (kg) <span className="text-destructive">*</span></Label>
                  <Input type="number" value={addForm.weightKg} onChange={(e) => onAddField("weightKg", e.target.value)} placeholder="kg" />
                </div>
                <div className="space-y-2">
                  <Label>BMI</Label>
                  <Input value={addForm.bmi} disabled className="bg-muted" placeholder="Auto" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Diabetes Status</Label>
                  <Select value={addForm.diabetesStatus} onValueChange={(v) => onAddField("diabetesStatus", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">None</SelectItem>
                      <SelectItem value="Pre-existing Diabetes">Pre-existing Diabetes</SelectItem>
                      <SelectItem value="New Diabetes Detected">New Diabetes Detected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>BP Status</Label>
                  <Select value={addForm.bpStatus} onValueChange={(v) => onAddField("bpStatus", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">None</SelectItem>
                      <SelectItem value="Pre-existing High Blood Pressure">Pre-existing High Blood Pressure</SelectItem>
                      <SelectItem value="New High Blood Pressure Detected">New High Blood Pressure Detected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="add-consent" checked={addForm.isConsentedForMessages} disabled={personLocked} onCheckedChange={(c) => onAddField("isConsentedForMessages", !!c)} />
                <Label htmlFor="add-consent" className="text-sm font-normal">Consented for health-related messages on mobile</Label>
              </div>
              <div className="space-y-2">
                <Label>Remarks</Label>
                <Textarea value={addForm.remarks} onChange={(e) => onAddField("remarks", e.target.value)} placeholder="Any remarks" rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={submitAdd} disabled={submitting}>{submitting ? "Saving..." : "Add Reading"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── History dialog ── */}
        <Dialog open={historyOpen} onOpenChange={(o) => { if (!o) setHistoryOpen(false); }}>
          <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{detail ? `${detail.attendee.name}: Medical History` : "Medical History"}</DialogTitle>
              <DialogDescription>
                {detail ? `${detail.attendee.mobileNo} · ${detail.attendee.sex || "-"} · ${detail.history.length} reading(s)` : "Loading..."}
              </DialogDescription>
            </DialogHeader>
            {detailLoading && <div className="flex justify-center py-10"><RotaryLoader size="md" /></div>}
            {!detailLoading && detail && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Reg No</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-center">Age</TableHead>
                      <TableHead className="text-xs text-center">BP</TableHead>
                      <TableHead className="text-xs text-center">Sugar</TableHead>
                      <TableHead className="text-xs text-center">Ht/Wt</TableHead>
                      <TableHead className="text-xs text-center">BMI</TableHead>
                      <TableHead className="text-xs">Diabetes</TableHead>
                      <TableHead className="text-xs">BP Status</TableHead>
                      {canManage && <TableHead className="text-xs w-20">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.history.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm font-medium">{r.registrationNo || "-"}</TableCell>
                        <TableCell className="text-sm">{fmtDate(r.readingDate)}</TableCell>
                        <TableCell className="text-sm text-center">{r.age ?? "-"}</TableCell>
                        <TableCell className="text-sm text-center">{bpText(r)}</TableCell>
                        <TableCell className="text-sm text-center">{sugarText(r)}</TableCell>
                        <TableCell className="text-sm text-center">{(r.heightCm ?? "-")}/{(r.weightKg ?? "-")}</TableCell>
                        <TableCell className="text-sm text-center">{r.bmi ?? "-"}</TableCell>
                        <TableCell className="text-sm">{r.diabetesStatus || "-"}</TableCell>
                        <TableCell className="text-sm">{r.bpStatus || "-"}</TableCell>
                        {canManage && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditReading(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteReadingTarget(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setHistoryOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Cross-club participation history dialog (by mobile) ── */}
        <Dialog open={mobileHistoryOpen} onOpenChange={(o) => { if (!o) setMobileHistoryOpen(false); }}>
          <DialogContent className="sm:max-w-[1100px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Participation &amp; Medical History</DialogTitle>
              <DialogDescription>
                {mobileHistoryMobile
                  ? `Mobile ${mobileHistoryMobile}: every camp visit across all clubs, district camps and years, with all medical readings.`
                  : "Loading…"}
              </DialogDescription>
            </DialogHeader>
            {mobileHistoryLoading && <div className="flex justify-center py-10"><RotaryLoader size="md" /></div>}
            {!mobileHistoryLoading && mobileHistory && (
              mobileHistory.totalEntries === 0
                ? <p className="py-6 text-center text-muted-foreground text-sm">No prior participation found for this mobile.</p>
                : renderMobileHistory(mobileHistory)
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setMobileHistoryOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Edit attendee dialog (shows latest reading) ── */}
        <Dialog open={editAttendeeOpen} onOpenChange={(o) => { if (!o) setEditAttendeeOpen(false); }}>
          <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Attendee</DialogTitle>
              <DialogDescription>Update the person&apos;s details. Their latest reading is shown for reference.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input value={attForm.name} onChange={(e) => setAttForm({ ...attForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mobile No <span className="text-destructive">*</span></Label>
                  <Input value={attForm.mobileNo} onChange={(e) => setAttForm({ ...attForm, mobileNo: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Sex <span className="text-destructive">*</span></Label>
                  <Select value={attForm.sex} onValueChange={(v) => setAttForm({ ...attForm, sex: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address <span className="text-destructive">*</span></Label>
                <Textarea value={attForm.address} onChange={(e) => setAttForm({ ...attForm, address: e.target.value })} rows={2} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="edit-consent" checked={attForm.isConsentedForMessages} onCheckedChange={(c) => setAttForm({ ...attForm, isConsentedForMessages: !!c })} />
                <Label htmlFor="edit-consent" className="text-sm font-normal">Consented for health-related messages on mobile</Label>
              </div>

              {editingAttendee?.latestReading && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <p className={`font-semibold mb-1 ${accentText}`}>Latest reading ({fmtDate(editingAttendee.latestReading.readingDate)})</p>
                  <p className="text-muted-foreground">
                    Age {editingAttendee.latestReading.age ?? "-"} · BP {bpText(editingAttendee.latestReading)} · Sugar {sugarText(editingAttendee.latestReading)} · BMI {editingAttendee.latestReading.bmi ?? "-"}
                    {editingAttendee.latestReading.diabetesStatus ? ` · ${editingAttendee.latestReading.diabetesStatus}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">To change readings, use the medical-history view.</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditAttendeeOpen(false)}>Cancel</Button>
              <Button onClick={submitEditAttendee} disabled={submitting}>{submitting ? "Saving..." : "Update"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Edit reading dialog ── */}
        <Dialog open={editReadingOpen} onOpenChange={(o) => { if (!o) setEditReadingOpen(false); }}>
          <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Reading{editingReading?.registrationNo ? `: ${editingReading.registrationNo}` : ""}</DialogTitle>
              <DialogDescription>Update this medical reading. A new reading is not created (the registration number stays the same).</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Age <span className="text-destructive">*</span></Label>
                  <Input type="number" value={rdgForm.age} onChange={(e) => onRdgField("age", e.target.value)} placeholder="Age at this visit" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Blood Pressure (mmHg) <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-2 gap-4">
                  <Input type="number" value={rdgForm.bpSystolic} onChange={(e) => onRdgField("bpSystolic", e.target.value)} placeholder="Systolic" />
                  <Input type="number" value={rdgForm.bpDiastolic} onChange={(e) => onRdgField("bpDiastolic", e.target.value)} placeholder="Diastolic" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Blood Sugar (mg/dl) <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-2 gap-4">
                  <Select value={rdgForm.bloodSugarType} onValueChange={(v) => onRdgField("bloodSugarType", v)}>
                    <SelectTrigger><SelectValue placeholder="FBS / RBS" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FBS">FBS (Fasting)</SelectItem>
                      <SelectItem value="RBS">RBS (Random)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" value={rdgForm.bloodSugarValue} onChange={(e) => onRdgField("bloodSugarValue", e.target.value)} placeholder="Value" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Height (cm) <span className="text-destructive">*</span></Label>
                  <Input type="number" value={rdgForm.heightCm} onChange={(e) => onRdgField("heightCm", e.target.value)} placeholder="cm" />
                </div>
                <div className="space-y-2">
                  <Label>Weight (kg) <span className="text-destructive">*</span></Label>
                  <Input type="number" value={rdgForm.weightKg} onChange={(e) => onRdgField("weightKg", e.target.value)} placeholder="kg" />
                </div>
                <div className="space-y-2">
                  <Label>BMI</Label>
                  <Input value={rdgForm.bmi} disabled className="bg-muted" placeholder="Auto" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Diabetes Status</Label>
                  <Select value={rdgForm.diabetesStatus} onValueChange={(v) => onRdgField("diabetesStatus", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">None</SelectItem>
                      <SelectItem value="Pre-existing Diabetes">Pre-existing Diabetes</SelectItem>
                      <SelectItem value="New Diabetes Detected">New Diabetes Detected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>BP Status</Label>
                  <Select value={rdgForm.bpStatus} onValueChange={(v) => onRdgField("bpStatus", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">None</SelectItem>
                      <SelectItem value="Pre-existing High Blood Pressure">Pre-existing High Blood Pressure</SelectItem>
                      <SelectItem value="New High Blood Pressure Detected">New High Blood Pressure Detected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Remarks</Label>
                <Textarea value={rdgForm.remarks} onChange={(e) => onRdgField("remarks", e.target.value)} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditReadingOpen(false)}>Cancel</Button>
              <Button onClick={submitEditReading} disabled={submitting}>{submitting ? "Saving..." : "Update"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmations */}
        <AlertModal
          open={!!deleteAttendeeTarget}
          onOpenChange={(o) => !o && setDeleteAttendeeTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Attendee"
          description={<>Delete <span className="font-semibold text-foreground">{deleteAttendeeTarget?.name}</span> and ALL their medical readings? This cannot be undone.</>}
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={confirmDeleteAttendee}
          cancelLabel="Cancel"
          onCancel={() => setDeleteAttendeeTarget(null)}
        />
        <AlertModal
          open={!!deleteReadingTarget}
          onOpenChange={(o) => !o && setDeleteReadingTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Reading"
          description={<>Delete this medical reading from {fmtDate(deleteReadingTarget?.readingDate || "")}? This cannot be undone.</>}
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={confirmDeleteReading}
          cancelLabel="Cancel"
          onCancel={() => setDeleteReadingTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
