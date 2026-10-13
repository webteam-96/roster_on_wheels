"use client";

import React, { useState, useEffect, useMemo } from "react";
import DateField from "@/components/DateField";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import WebsiteTrainingAppointmentsTab from "./WebsiteTrainingAppointmentsTab";
import TrainingAvailabilityTab from "./TrainingAvailabilityTab";
import {
  ArrowLeft, Plus, Pencil, Trash2, Power, PowerOff, Send, FileText, Download,
  CheckCircle2, Clock, AlertTriangle, XCircle, Globe, Settings as SettingsIcon,
  RotateCw, Server, Loader2, Lock, Wrench, ChevronDown, Zap, Sparkles,
} from "lucide-react";
import {
  getDistricts, getThemes,
  getClubWebsites, getClubWebsiteLogs, getClubWebsiteHistory,
  getClubWebsiteSettings, updateClubWebsiteSettings,
  getAvailableClubsForWebsite,
  createClubWebsite, updateClubWebsite, deleteClubWebsite,
  activateClubWebsite, deactivateClubWebsite, sendClubWebsiteReminder,
  retryClubWebsiteActivation, retryClubWebsiteSsl, testPleskConnection, listPleskSubdomains, pleskDiagnostic, pleskDiagnosticSubdomain,
  forceDeletePleskSubdomain,
  bulkStartClubWebsiteTrial,
  recycleAllClubWebsitePools,
  checkClubWebsiteDomainPointing, getClubWebsiteDomainPleskStatus,
} from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";

import { appLocale, currencySymbol } from "@/lib/appFormat";
type Row = {
  id: number; clubId: number; clubName: string; clubRotaryId: string;
  districtNumber: string; subdomain: string; clientDomain: string | null;
  themeId: number | null; themeName: string | null;
  startDate: string; endDate: string; status: string;
  isPurchased?: boolean;
  reminderDays: number | null; amountPaid: number | null;
  transactionId: string | null; paymentDate: string | null;
  paymentMode: string | null; paymentProofPath: string | null;
  lastReminderSent: string | null; notes: string | null;
  daysLeft: number; createdDate: string;
  // Current-year President / Secretary contact (for the Excel export).
  presidentName?: string | null; presidentMobile?: string | null; presidentEmail?: string | null;
  secretaryName?: string | null; secretaryMobile?: string | null; secretaryEmail?: string | null;
  // Phase 4 kill-switch: 1 when club + district + zone are all active; 0 when chain is broken.
  chainActive?: number;
};

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!.*\.\.)(?!.*--)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/; // single subdomain label

// Permissive (product decision): any characters allowed, including ':' and '/'. Presence + length only.
function validateDomain(value: string, required: boolean): string | null {
  const v = value.trim();
  if (!v) return required ? "Required." : null;
  if (v.length > 253) return "Too long (max 253 chars).";
  return null;
}

function validateLabel(value: string, required: boolean): string | null {
  const v = value.trim();
  if (!v) return required ? "Required." : null;
  if (v.length > 253) return "Too long (max 253 chars).";
  return null;
}

// Product decision: Subdomain / Third party Domain accept ANY characters (including ':' and '/')
// and are kept exactly as typed — no stripping, no normalization. Lower-cased only (domains are
// case-insensitive and the API lower-cases on save).
function sanitizeLabelInput(value: string): string { return (value || "").toLowerCase(); }
function sanitizeDomainInput(value: string): string { return (value || "").toLowerCase(); }

// Given a full subdomain like "club.example.org" and parent "portal.example.org",
// return just the label "rcmumbai". If parent doesn't match the suffix (e.g. legacy/imported
// rows like "club.example.org" whose parent has since changed), fall back to taking
// just the first label so the row stays editable — saving will re-suffix with the current
// parent. Returning the full dotted value would fail label validation and lock the row.
function splitSubdomain(full: string, parentDomain: string): string {
  const suffix = `.${parentDomain.toLowerCase()}`;
  const v = full.toLowerCase();
  if (v.endsWith(suffix)) return v.slice(0, -suffix.length);
  const dotIdx = v.indexOf(".");
  return dotIdx >= 0 ? v.slice(0, dotIdx) : v;
}

// Build a clean, always-https visit URL from a stored subdomain/domain value.
// Storage is intentionally permissive (see save-time comment above) — a value
// may already carry a "https://" prefix and/or trailing slash, or (legacy rows)
// be a bare label without the parent-domain suffix. Normalize ONLY here, at
// link-construction time, so a stray "https://" in storage never produces
// "https://https://..." and a bare label never opens a dangling host.
function toVisitUrl(raw: string | null | undefined, parentDomain?: string): string | null {
  let host = (raw || "").trim();
  if (!host) return null;
  host = host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host) return null;
  if (parentDomain && !host.includes(".")) host = `${host}.${parentDomain.toLowerCase()}`;
  return `https://${host}`;
}

function statusBadge(status: string, daysLeft: number) {
  if (status === "Expired") return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Expired</Badge>;
  if (status === "ActivationFailed") return <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Activation Failed</Badge>;
  if (status === "Inactive") return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Inactive</Badge>;
  if (status === "Active") {
    if (daysLeft <= 7) return <Badge className="bg-red-600"><AlertTriangle className="mr-1 h-3 w-3" />Active · {daysLeft}d</Badge>;
    if (daysLeft <= 30) return <Badge className="bg-amber-500"><AlertTriangle className="mr-1 h-3 w-3" />Active · {daysLeft}d</Badge>;
    return <Badge className="bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Active · {daysLeft}d</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

export default function ClubWebsitesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [districtFilter, setDistrictFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [districts, setDistricts] = useState<any[]>([]);
  const [clubs, setClubs] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [defaultReminderDays, setDefaultReminderDays] = useState<number>(15);
  const [parentDomain, setParentDomain] = useState<string>("portal.example.org");
  const [serverIp, setServerIp] = useState<string>("");

  // Add/Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null); // null = Add mode
  const [formDistrictId, setFormDistrictId] = useState<string>("");
  const [formClubId, setFormClubId] = useState<string>("");
  const [formSubdomain, setFormSubdomain] = useState("");
  const [formClientDomain, setFormClientDomain] = useState("");
  // Third-party (custom) domain: DNS-pointing + Plesk-application state for the dialog.
  const [originalClientDomain, setOriginalClientDomain] = useState("");      // value when the dialog opened (detect "changed")
  const [domainInPlesk, setDomainInPlesk] = useState<boolean | null>(null);   // null = unknown/not-checked
  const [domainCheckingPlesk, setDomainCheckingPlesk] = useState(false);
  const [domainCheck, setDomainCheck] = useState<{ status: "idle" | "checking" | "pass" | "fail"; ips: string[] }>({ status: "idle", ips: [] });
  const [formThemeId, setFormThemeId] = useState<string>("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formReminderDays, setFormReminderDays] = useState<string>("");
  const [formAmount, setFormAmount] = useState<string>("");
  const [formTransactionId, setFormTransactionId] = useState("");
  const [formPaymentDate, setFormPaymentDate] = useState("");
  const [formPaymentMode, setFormPaymentMode] = useState("");
  const [formNotes, setFormNotes] = useState("");
  // Purchased vs Trial radio. When Trial, payment fields are disabled and Trial Days
  // helper auto-computes End Date = Start Date + N days.
  const [formMode, setFormMode] = useState<"purchased" | "trial">("purchased");
  const [formTrialDays, setFormTrialDays] = useState<string>("30");
  const [clubHistory, setClubHistory] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Bulk Start-Trial toolbar state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkTrialDays, setBulkTrialDays] = useState<string>("30");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Logs dialog
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDays, setSettingsDays] = useState<string>("15");
  const [settingsParent, setSettingsParent] = useState<string>("");

  const loadRows = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (districtFilter) params.districtId = Number(districtFilter);
      if (search) params.search = search;
      const data = await getClubWebsites(params);
      setRows(data || []);
    } catch {
      setErrorMessage("Failed to load club websites.");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    (async () => {
      try {
        const [dRes, tRes, sRes] = await Promise.all([
          getDistricts(1, 9999, undefined, 1),
          getThemes(),
          getClubWebsiteSettings(),
        ]);
        setDistricts((dRes.items || []).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
        setThemes(tRes || []);
        setDefaultReminderDays(sRes?.defaultReminderDays || 15);
        setSettingsDays(String(sRes?.defaultReminderDays || 15));
        if (sRes?.parentDomain) setParentDomain(sRes.parentDomain);
        if (sRes?.serverIp) setServerIp(sRes.serverIp);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => { loadRows(); }, [statusFilter, districtFilter]);

  // Load clubs when a district is picked in the form
  useEffect(() => {
    if (!formDistrictId) { setClubs([]); return; }
    (async () => {
      try {
        // Only clubs WITHOUT an active website record
        const data = await getAvailableClubsForWebsite(Number(formDistrictId));
        setClubs(data || []);
      } catch { setClubs([]); }
    })();
  }, [formDistrictId]);

  // Load club's website history when club changes in Add mode
  useEffect(() => {
    if (editingId !== null || !formClubId) { setClubHistory([]); return; }
    (async () => {
      try {
        const hist = await getClubWebsiteHistory(Number(formClubId));
        setClubHistory(hist || []);
      } catch { setClubHistory([]); }
    })();
  }, [formClubId, editingId]);

  const openAdd = () => {
    setEditingId(null);
    setFormDistrictId(""); setFormClubId(""); setFormSubdomain(""); setFormClientDomain("");
    setFormThemeId(""); setFormStartDate(""); setFormEndDate("");
    setFormReminderDays(""); setFormAmount(""); setFormTransactionId("");
    setFormPaymentDate(""); setFormPaymentMode(""); setFormNotes("");
    setFormMode("purchased");
    setFormTrialDays("30");
    setOriginalClientDomain(""); setDomainInPlesk(null); setDomainCheck({ status: "idle", ips: [] });
    setClubHistory([]);
    setEditOpen(true);
  };

  const openEdit = async (r: Row) => {
    setEditingId(r.id);
    setFormDistrictId(""); // frozen — not used in edit
    setFormClubId(String(r.clubId));
    // Normalize legacy values stored as full URLs (e.g. "https://rcfoo/") so they display
    // clean and don't trip the validators when an existing record is opened for editing.
    setFormSubdomain(sanitizeLabelInput(splitSubdomain(r.subdomain, parentDomain)));
    setFormClientDomain(sanitizeDomainInput(r.clientDomain || ""));
    setOriginalClientDomain(sanitizeDomainInput(r.clientDomain || ""));
    setDomainCheck({ status: "idle", ips: [] });
    setDomainInPlesk(null);
    // Ask Plesk whether this domain is already an application on the server (decides whether the
    // DNS "Check pointing" step is still needed). Fire-and-forget; leaves null on failure.
    if (r.clientDomain && r.clientDomain.trim()) refreshDomainPleskStatus(r.clientDomain);
    setFormThemeId(r.themeId ? String(r.themeId) : "");
    setFormStartDate(r.startDate?.slice(0, 10) || "");
    setFormEndDate(r.endDate?.slice(0, 10) || "");
    setFormReminderDays(r.reminderDays ? String(r.reminderDays) : "");
    setFormAmount(r.amountPaid ? String(r.amountPaid) : "");
    setFormTransactionId(r.transactionId || "");
    setFormPaymentDate(r.paymentDate?.slice(0, 10) || "");
    setFormPaymentMode(r.paymentMode || "");
    setFormNotes(r.notes || "");
    // Plan mode: the explicit isPurchased flag is the source of truth (lets admin mark
    // Purchased with no payment data yet); Amount/TransactionId are a fallback for legacy rows.
    const isPaid = !!r.isPurchased || (r.amountPaid != null && r.amountPaid > 0) || !!(r.transactionId && r.transactionId.trim());
    setFormMode(isPaid ? "purchased" : "trial");
    // Default trial-days helper to the existing span (or 30) so admin can re-extend
    if (r.startDate && r.endDate) {
      const ms = new Date(r.endDate).getTime() - new Date(r.startDate).getTime();
      const days = Math.max(1, Math.round(ms / 86400000));
      setFormTrialDays(String(days));
    } else {
      setFormTrialDays("30");
    }
    setClubHistory([]);
    setEditOpen(true);
  };

  // Ask Plesk whether the domain already exists as an application (site-alias) on the server.
  const refreshDomainPleskStatus = async (domain: string) => {
    const d = sanitizeDomainInput(domain);
    if (!d) { setDomainInPlesk(null); return; }
    setDomainCheckingPlesk(true);
    try {
      const r = await getClubWebsiteDomainPleskStatus(d);
      setDomainInPlesk(!!r.existsInPlesk);
    } catch { setDomainInPlesk(null); }
    finally { setDomainCheckingPlesk(false); }
  };

  // Resolve the domain's A record and check it points at our server IP.
  const runDomainCheck = async () => {
    const d = sanitizeDomainInput(formClientDomain);
    if (!d) return;
    setDomainCheck({ status: "checking", ips: [] });
    try {
      const r = await checkClubWebsiteDomainPointing(d);
      setDomainCheck({ status: r.pointsToServer ? "pass" : "fail", ips: r.resolvedIps || [] });
    } catch {
      setDomainCheck({ status: "fail", ips: [] });
    }
  };

  // True when a present third-party domain still needs a passing DNS check before it can be saved:
  // it was newly added/changed, OR it isn't already an application on the server.
  const domainNeedsCheck = (): boolean => {
    const d = sanitizeDomainInput(formClientDomain);
    if (!d) return false;
    const changed = d !== sanitizeDomainInput(originalClientDomain);
    return changed || domainInPlesk !== true;
  };
  const domainGateBlocksSave = domainNeedsCheck() && domainCheck.status !== "pass";

  const saveForm = async () => {
    if (!formSubdomain || !formStartDate || !formEndDate) {
      setErrorMessage("Subdomain, Start Date and End Date are required.");
      return;
    }
    if (!formThemeId) { setErrorMessage("Template is required."); return; }
    const subErr = validateLabel(formSubdomain, true);
    if (subErr) { setErrorMessage(`Subdomain: ${subErr}`); return; }
    const cliErr = formClientDomain ? validateDomain(formClientDomain, false) : null;
    if (cliErr) { setErrorMessage(`Third party Domain: ${cliErr}`); return; }
    if (domainGateBlocksSave) {
      setErrorMessage('Verify the third-party domain points to the server (click "Check pointing") before saving.');
      return;
    }
    if (new Date(formEndDate) <= new Date(formStartDate)) {
      setErrorMessage("End date must be after start date.");
      return;
    }
    setSaving(true);
    try {
      const fullSubdomain = `${sanitizeLabelInput(formSubdomain)}.${parentDomain.toLowerCase()}`;
      // Plan-mode radio determines which group of fields is persisted. The opposite
      // group is forced to null so a trial record can't carry stale payment data and
      // vice versa.
      const isTrial = formMode === "trial";
      const payload: any = {
        subdomain: fullSubdomain,
        clientDomain: sanitizeDomainInput(formClientDomain) || null,
        themeId: Number(formThemeId),
        startDate: formStartDate,
        endDate: formEndDate,
        reminderDays: formReminderDays ? Number(formReminderDays) : null,
        isPurchased: !isTrial,
        amountPaid: isTrial ? null : (formAmount ? Number(formAmount) : null),
        transactionId: isTrial ? null : (formTransactionId.trim() || null),
        paymentDate: isTrial ? null : (formPaymentDate || null),
        paymentMode: isTrial ? null : (formPaymentMode.trim() || null),
        notes: formNotes.trim() || null,
      };
      if (editingId === null) {
        if (!formDistrictId) { setErrorMessage("District is required."); setSaving(false); return; }
        if (!formClubId) { setErrorMessage("Club is required."); setSaving(false); return; }
        payload.clubId = Number(formClubId);
        await createClubWebsite(payload);
        setSuccessMessage("Website record created.");
      } else {
        const res = await updateClubWebsite(editingId, payload);
        if (res?.domainProvisionError) {
          setErrorMessage(`Saved, but adding the domain application failed: ${res.domainProvisionError}`);
        } else {
          setSuccessMessage(`Website record updated.${res?.domainProvisionSteps ? ` Domain: ${res.domainProvisionSteps}.` : ""}`);
        }
      }
      setEditOpen(false);
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Save failed.");
    } finally { setSaving(false); }
  };

  const doDelete = async (id: number) => {
    if (!confirm("Delete this website record?\n\nThis will:\n• Remove the subdomain from Plesk (server)\n• Soft-delete the record from the portal\n\nClub members will no longer be able to access the website. This cannot be undone.")) return;
    setBusyId(`${id}-del`);
    try {
      const res = await deleteClubWebsite(id);
      setSuccessMessage(res?.pleskResult ? `Deleted. ${res.pleskResult}.` : "Deleted.");
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Delete failed.");
    } finally { setBusyId(null); }
  };

  const doDeleteDbOnly = async (id: number) => {
    if (!confirm("Delete only the portal record (keep Plesk subdomain intact)?\n\nUse this only if Plesk delete is failing or you've already cleaned up in Plesk manually.")) return;
    setBusyId(`${id}-del`);
    try {
      await deleteClubWebsite(id, true);
      setSuccessMessage("Portal record deleted (Plesk untouched).");
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Delete failed.");
    } finally { setBusyId(null); }
  };

  const doToggle = async (r: Row) => {
    setBusyId(`${r.id}-toggle`);
    try {
      if (r.status === "Active") {
        await deactivateClubWebsite(r.id);
        setSuccessMessage("Deactivated.");
      } else {
        await activateClubWebsite(r.id);
        setSuccessMessage("Activated — welcome email sent to Pres/Sec.");
      }
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Action failed.");
    } finally { setBusyId(null); }
  };

  // Bulk: start a trial period for all selected rows.
  // Skips rows that are already Purchased (amount > 0 or txn present).
  // Sends notification email to current-year Club President + Secretary in the background on the server.
  const doBulkStartTrial = async () => {
    const days = parseInt(bulkTrialDays, 10);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      setErrorMessage("Trial period must be a number between 1 and 3650 days.");
      return;
    }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { setErrorMessage("Select at least one club."); return; }
    if (!confirm(`Start a ${days}-day trial for ${ids.length} club(s)?\n\n• Purchased clubs will be skipped.\n• Notification email will be sent to Club President + Secretary.\n• This overrides any existing trial period on the selected clubs.`)) return;

    setBulkBusy(true);
    try {
      const res = await bulkStartClubWebsiteTrial(ids, days);
      const parts: string[] = [];
      parts.push(`${res.updated} updated`);
      if (res.skippedPurchased > 0) parts.push(`${res.skippedPurchased} skipped (already purchased)`);
      if (res.notFound > 0) parts.push(`${res.notFound} not found`);
      parts.push(`emails: ${res.emailsSent}/${res.emailsTotal}`);
      setSuccessMessage(`Bulk trial done — ${parts.join(", ")}.`);
      setSelectedIds(new Set());
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Bulk trial failed.");
    } finally { setBulkBusy(false); }
  };

  const doRetry = async (id: number) => {
    setBusyId(`${id}-retry`);
    try {
      const res = await retryClubWebsiteActivation(id);
      const steps = (res.pleskStepsDone || []).join(", ");
      setSuccessMessage(`Activated. ${steps ? `Plesk: ${steps}. ` : ""}Emails: ${res.emailsSent}/${res.emailsTotal}.`);
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Retry failed.");
    } finally { setBusyId(null); }
  };

  const doRetrySsl = async (id: number) => {
    setBusyId(`${id}-ssl`);
    try {
      const res = await retryClubWebsiteSsl(id);
      setSuccessMessage(res?.message || "SSL reapplied.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "SSL retry failed.");
    } finally { setBusyId(null); }
  };

  const doForceActivate = async (id: number) => {
    if (!confirm("Activate without Plesk provisioning? Use this only if Plesk is unavailable.")) return;
    setBusyId(`${id}-force`);
    try {
      await activateClubWebsite(id, true);
      setSuccessMessage("Activated (Plesk skipped). Complete Plesk setup manually.");
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Force activation failed.");
    } finally { setBusyId(null); }
  };

  const doTestPlesk = async () => {
    try {
      const res = await testPleskConnection();
      setSuccessMessage(res?.message || "Plesk connection OK.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Plesk test failed.");
    }
  };

  // Recycle every IIS app pool whose name contains the parent domain. Used after a
  // code deploy so every club website pool picks up the new code in one click.
  // Per-save changes (theme/banners/etc.) DON'T need this — purge-on-save handles those.
  const [recyclingPools, setRecyclingPools] = useState(false);
  const doRecycleAllPools = async () => {
    if (!confirm(
      "Recycle all club website IIS app pools?\n\n" +
      "Use this ONLY after deploying new club-website code so every pool picks up the new build.\n" +
      "Public club sites will be briefly slow (cold start) during recycle.\n\n" +
      "DO NOT use this for normal theme/banner/project changes — those auto-refresh without recycling.\n\n" +
      "Continue?"
    )) return;
    setRecyclingPools(true);
    try {
      const res = await recycleAllClubWebsitePools();
      if (res.error) {
        setErrorMessage(`Recycle failed: ${res.error}`);
      } else if (res.permissionDenied) {
        setErrorMessage(
          `Recycled ${res.recycled}/${res.totalPools} pools. ${res.failed} failed — most likely a permission issue. ` +
          `The API's IIS app pool identity needs permission to run appcmd.exe (add it to Administrators or grant IIS management rights).`
        );
      } else if (res.failed > 0) {
        setErrorMessage(
          `Recycled ${res.recycled}/${res.totalPools} pools in ${(res.durationMs / 1000).toFixed(1)}s. ` +
          `${res.failed} failed. First failure: ${res.failedPools[0] || "(no detail)"}`
        );
      } else {
        setSuccessMessage(
          `Successfully recycled ${res.recycled} club website app pool(s) in ${(res.durationMs / 1000).toFixed(1)}s.`
        );
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.message || "Recycle all failed.");
    } finally {
      setRecyclingPools(false);
    }
  };

  const doForceCleanPlesk = async () => {
    const label = prompt("Enter subdomain label or full FQDN to force-delete from Plesk\n(examples: 'rcc2' or 'club.example.org')\n\nThis removes from Plesk only. Our DB is not touched.\nYour shared ClubWebsite folder is protected.");
    if (!label?.trim()) return;
    if (!confirm(`Force-delete '${label.trim()}' from Plesk?\n\nOnly removes from Plesk/IIS — ClubWebsite folder is protected.`)) return;
    try {
      const res = await forceDeletePleskSubdomain(label.trim());
      setSuccessMessage(res?.message || "Done.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Force-delete failed.");
    }
  };

  const [pleskListOpen, setPleskListOpen] = useState(false);
  const [pleskList, setPleskList] = useState<any[]>([]);
  const [pleskListLoading, setPleskListLoading] = useState(false);

  const [sslDiagOpen, setSslDiagOpen] = useState(false);
  const [sslDiagText, setSslDiagText] = useState("");
  const [sslDiagLoading, setSslDiagLoading] = useState(false);

  const doSslDiagnostic = async (subdomainOrLabel: string) => {
    const input = subdomainOrLabel?.trim();
    if (!input) return;
    setSslDiagOpen(true);
    setSslDiagLoading(true);
    setSslDiagText("");
    try {
      const text = await pleskDiagnosticSubdomain(input);
      setSslDiagText(text);
    } catch (err: any) {
      setSslDiagText("ERROR: " + (err?.response?.data?.message || err?.message || "failed"));
    } finally {
      setSslDiagLoading(false);
    }
  };
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagData, setDiagData] = useState<any>(null);
  const [diagType, setDiagType] = useState<string>("list-subdomains");
  const runDiag = async (type: string) => {
    setDiagType(type);
    setDiagOpen(true);
    setDiagLoading(true);
    setDiagData(null);
    try {
      const res = await pleskDiagnostic(type);
      setDiagData(res);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Diagnostic failed.");
    } finally { setDiagLoading(false); }
  };
  const doListPleskSubdomains = async () => {
    setPleskListOpen(true);
    setPleskListLoading(true);
    setPleskList([]);
    try {
      const res = await listPleskSubdomains();
      setPleskList(res?.subdomains || []);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "List Plesk failed.");
      setPleskListOpen(false);
    } finally { setPleskListLoading(false); }
  };

  const doReminder = async (id: number) => {
    setBusyId(`${id}-rem`);
    try {
      const res = await sendClubWebsiteReminder(id);
      setSuccessMessage(`Reminder — sent: ${res.sent}, failed: ${res.failed}.`);
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Send failed.");
    } finally { setBusyId(null); }
  };

  const viewLogs = async (id: number) => {
    setLogsOpen(true);
    setLogsLoading(true);
    try {
      const data = await getClubWebsiteLogs(id);
      setLogs(data || []);
    } catch { setLogs([]); }
    finally { setLogsLoading(false); }
  };

  const saveSettings = async () => {
    const n = Number(settingsDays);
    if (!n || n < 1 || n > 180) { setErrorMessage("Enter a value between 1 and 180."); return; }
    if (settingsParent && validateDomain(settingsParent, true)) {
      setErrorMessage(`Parent Domain: ${validateDomain(settingsParent, true)}`); return;
    }
    try {
      await updateClubWebsiteSettings({ defaultReminderDays: n, parentDomain: settingsParent || undefined });
      setDefaultReminderDays(n);
      if (settingsParent) setParentDomain(settingsParent.toLowerCase());
      setSettingsOpen(false);
      setSuccessMessage("Settings saved.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Save failed.");
    }
  };

  const openSettings = () => {
    setSettingsDays(String(defaultReminderDays));
    setSettingsParent(parentDomain);
    setSettingsOpen(true);
  };

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(r =>
      r.clubName?.toLowerCase().includes(q) ||
      r.subdomain?.toLowerCase().includes(q) ||
      r.clientDomain?.toLowerCase().includes(q) ||
      r.districtNumber?.toLowerCase().includes(q));
  }, [rows, search]);

  const expiringSoon = rows.filter(r => r.status === "Active" && r.daysLeft >= 0 && r.daysLeft <= 30).length;
  const expired = rows.filter(r => r.status === "Expired").length;
  const active = rows.filter(r => r.status === "Active").length;

  const exportExcel = () => {
    if (filteredRows.length === 0) return;
    exportToCSV(filteredRows, "Club_Websites",
      [
        { key: "districtNumber", label: "District", width: 10 },
        { key: "clubName", label: "Club", width: 30 },
        { key: "subdomain", label: "Subdomain", width: 30 },
        { key: "clientDomain", label: "Third party Domain", width: 30 },
        { key: "themeName", label: "Template", width: 20 },
        { key: "startDate", label: "Start Date", width: 15 },
        { key: "endDate", label: "End Date", width: 15 },
        { key: "daysLeft", label: "Days Left", width: 10 },
        { key: "status", label: "Status", width: 12 },
        { key: "amountPaid", label: "Amount", width: 12 },
        { key: "transactionId", label: "Transaction ID", width: 20 },
        { key: "paymentDate", label: "Payment Date", width: 15 },
        { key: "presidentName", label: "President", width: 24 },
        { key: "presidentMobile", label: "President Mobile", width: 16 },
        { key: "presidentEmail", label: "President Email", width: 28 },
        { key: "secretaryName", label: "Secretary", width: 24 },
        { key: "secretaryMobile", label: "Secretary Mobile", width: 16 },
        { key: "secretaryEmail", label: "Secretary Email", width: 28 },
        // Current-year content + activity (user 2026-09-29): ACTIVE banners and advertisements,
        // and the club's projects counted the same way the public site and the daily report count
        // them - Club Service excluded, an ongoing project once, never its repeat entries.
        { key: "bannerCount", label: "Banners", width: 10 },
        { key: "advertisementCount", label: "Advertisements", width: 14 },
        { key: "projectCount", label: "Projects", width: 10 },
      ],
      { title: "Club Websites", subtitle: `Exported ${new Date().toLocaleDateString(appLocale())}` });
    // No success alert: the file lands in Downloads, which is confirmation enough (user 2026-09-29).
  };

  // Export only the rows that actually have a Third party Domain set.
  // Show "No records found." when none are configured.
  const exportThirdPartyDomains = () => {
    const thirdPartyRows = filteredRows.filter((r: any) => (r.clientDomain || "").trim() !== "");
    if (thirdPartyRows.length === 0) {
      setErrorMessage("No records found.");
      return;
    }
    exportToCSV(thirdPartyRows, "Club_Websites_Third_Party_Domains",
      [
        { key: "districtNumber", label: "District", width: 10 },
        { key: "clubName", label: "Club", width: 30 },
        { key: "subdomain", label: "Subdomain", width: 30 },
        { key: "clientDomain", label: "Third party Domain", width: 30 },
        { key: "startDate", label: "Start Date", width: 15 },
        { key: "endDate", label: "End Date", width: 15 },
        { key: "daysLeft", label: "Days Left", width: 10 },
        { key: "status", label: "Status", width: 12 },
        // Current-year content + activity (user 2026-09-29): ACTIVE banners and advertisements,
        // and the club's projects counted the same way the public site and the daily report count
        // them - Club Service excluded, an ongoing project once, never its repeat entries.
        { key: "bannerCount", label: "Banners", width: 10 },
        { key: "advertisementCount", label: "Advertisements", width: 14 },
        { key: "projectCount", label: "Projects", width: 10 },
      ],
      { title: "Club Websites — Third party Domains", subtitle: `Exported ${new Date().toLocaleDateString(appLocale())}` });
    // No success alert here either - see the note in exportExcel.
  };

  const selectedClubName = clubs.find((c: any) => String(c.id) === formClubId)?.clubName || "";
  const selectedDistrictNumber = districts.find((d: any) => String(d.id) === formDistrictId)?.districtNumber || "";

  return (
    <ProtectedRoute>
      <Tabs defaultValue="websites" className="space-y-4">
        <TabsList>
          <TabsTrigger value="websites">Club Websites</TabsTrigger>
          <TabsTrigger value="training">Website Training Appointments</TabsTrigger>
          <TabsTrigger value="availability">Training Availability</TabsTrigger>
        </TabsList>
        <TabsContent value="websites">
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {busyId && (busyId.endsWith("-toggle") || busyId.endsWith("-retry") || busyId.endsWith("-force") || busyId.endsWith("-del")) && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-xl p-8 max-w-md flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <div className="text-center">
                <p className="font-semibold text-lg">
                  {busyId.endsWith("-del") ? "Deleting website..." :
                   busyId.endsWith("-force") ? "Activating (manual mode)..." :
                   "Activating website..."}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {busyId.endsWith("-del")
                    ? "Removing subdomain from Plesk + IIS and deleting the portal record. Please wait — do not close this tab."
                    : busyId.endsWith("-force")
                    ? "Updating status and sending emails."
                    : "Creating subdomain in Plesk, provisioning SSL, and sending welcome email. This may take up to 30 seconds."}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Club Websites</h2>
              <p className="text-muted-foreground text-base">Manage club website subscriptions, templates & renewals</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" title="Advanced Plesk tools">
                  <Wrench className="mr-2 h-4 w-4" />Plesk Tools<ChevronDown className="ml-2 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={doTestPlesk}>
                  <Server className="mr-2 h-4 w-4" />Test Connection
                </DropdownMenuItem>
                <DropdownMenuItem onClick={doListPleskSubdomains}>
                  <Globe className="mr-2 h-4 w-4" />List All Subdomains
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => runDiag("list-subdomains")}>
                  <AlertTriangle className="mr-2 h-4 w-4" />Raw XML Diagnostic
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={doForceCleanPlesk} className="text-red-600 focus:text-red-700">
                  <Trash2 className="mr-2 h-4 w-4" />Force Clean Subdomain
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={openSettings}>
              <SettingsIcon className="mr-2 h-4 w-4" />Settings ({defaultReminderDays}d · .{parentDomain})
            </Button>
            <Button
              variant="outline"
              onClick={doRecycleAllPools}
              disabled={recyclingPools}
              title="Recycle every IIS app pool whose name contains the parent domain. Use AFTER a code deploy so all pools pick up the new build in one shot. Theme/banner/project changes auto-refresh — don't need this."
            >
              {recyclingPools
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Recycling all pools…</>
                : <><RotateCw className="mr-2 h-4 w-4" />Recycle All Pools</>}
            </Button>
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />Add Website
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{rows.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active</p><p className="text-xl font-bold text-green-600">{active}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Expiring (≤30d)</p><p className="text-xl font-bold text-amber-600">{expiringSoon}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Expired</p><p className="text-xl font-bold text-red-600">{expired}</p></CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
                <SelectItem value="Expired">Expired</SelectItem>
                <SelectItem value="ActivationFailed">Activation Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={districtFilter || "all"} onValueChange={(v) => setDistrictFilter(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="District" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {districts.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Search club / subdomain..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadRows()} />
            <Button variant="outline" onClick={exportExcel} disabled={filteredRows.length === 0}>
              <Download className="mr-2 h-4 w-4" />Export Excel
            </Button>
            <Button variant="outline" onClick={exportThirdPartyDomains} disabled={filteredRows.length === 0} title="Export report focused on Third party Domains (all rows)">
              <Download className="mr-2 h-4 w-4" />Export Third party Domains
            </Button>
          </CardContent>
        </Card>

        {/* Bulk Start-Trial toolbar — visible only when at least 1 row is selected. */}
        {selectedIds.size > 0 && (
          <Card className="border-amber-300 bg-amber-50/60">
            <CardContent className="p-3 flex flex-wrap items-center gap-3">
              <Sparkles className="h-5 w-5 text-amber-600" />
              <div className="text-sm">
                <span className="font-semibold">{selectedIds.size}</span> selected · Start a trial period and notify President + Secretary
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Label className="text-xs whitespace-nowrap">Trial Period (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={bulkTrialDays}
                  onChange={(e) => setBulkTrialDays(e.target.value)}
                  className="w-24 h-8"
                />
                <Button size="sm" onClick={doBulkStartTrial} disabled={bulkBusy}>
                  {bulkBusy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Zap className="mr-2 h-3 w-3" />}
                  Start Trial & Notify
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy}>
                  Clear
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
            ) : filteredRows.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">No websites found.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(r.id))}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedIds(new Set(filteredRows.map(r => r.id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>District</TableHead><TableHead>Club</TableHead>
                  <TableHead>Subdomain</TableHead><TableHead>Template</TableHead>
                  <TableHead>Start</TableHead><TableHead>End</TableHead>
                  <TableHead>Status</TableHead><TableHead className="w-56">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredRows.map(r => {
                    // Phase 4 kill-switch: row is "chain inactive" when its club, district, or zone is inactive.
                    const chainInactive = r.chainActive === 0;
                    const inactiveTitle = chainInactive ? "Inactive — reactivate from Clubs/Districts page" : undefined;
                    const subUrl = toVisitUrl(r.subdomain, parentDomain);
                    const clientUrl = r.clientDomain ? toVisitUrl(r.clientDomain) : null;
                    return (
                    <TableRow key={r.id} className={selectedIds.has(r.id) ? "bg-muted/40" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onCheckedChange={(checked) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (checked) next.add(r.id); else next.delete(r.id);
                              return next;
                            });
                          }}
                          aria-label={`Select ${r.clubName}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">D{r.districtNumber}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{r.clubName}</div>
                          {chainInactive && <Badge variant="destructive">Inactive</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.clubRotaryId}</div>
                      </TableCell>
                      <TableCell>
                        {subUrl ? (
                          <a
                            href={subUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center"
                            title={`Open ${subUrl} in new tab`}
                          >
                            <Globe className="inline h-3 w-3 mr-1" />{r.subdomain}
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">{r.subdomain}</span>
                        )}
                        {r.clientDomain && (
                          <div>
                            {clientUrl ? (
                              <a
                                href={clientUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-muted-foreground hover:text-blue-600 hover:underline"
                                title={`Open ${clientUrl} in new tab`}
                              >
                                {r.clientDomain}
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">{r.clientDomain}</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{r.themeName || "—"}</TableCell>
                      <TableCell className="text-xs">{r.startDate ? new Date(r.startDate).toLocaleDateString(appLocale()) : "—"}</TableCell>
                      <TableCell className="text-xs">{r.endDate ? new Date(r.endDate).toLocaleDateString(appLocale()) : "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          {statusBadge(r.status, r.daysLeft)}
                          {(() => {
                            const isPaid = !!r.isPurchased || (r.amountPaid != null && r.amountPaid > 0) || !!(r.transactionId && r.transactionId.trim());
                            if (isPaid) {
                              return <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">Purchased</Badge>;
                            }
                            const daysLabel = r.daysLeft > 0 ? `${r.daysLeft}d left` : (r.daysLeft === 0 ? "ends today" : "expired");
                            return <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">Trial · {daysLabel}</Badge>;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => openEdit(r)} title="Edit website details"><Pencil className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => doToggle(r)} disabled={busyId === `${r.id}-toggle` || chainInactive} title={chainInactive ? inactiveTitle : (r.status === "Active" ? "Deactivate website" : "Activate website (creates subdomain in Plesk + sends welcome email)")}>
                            {busyId === `${r.id}-toggle` ? <Loader2 className="h-3 w-3 animate-spin" /> : r.status === "Active" ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                          </Button>
                          {r.status === "ActivationFailed" && (
                            <>
                              <Button size="sm" variant="default" className="h-7 bg-blue-600 hover:bg-blue-700" onClick={() => doRetry(r.id)} disabled={busyId === `${r.id}-retry` || chainInactive} title={chainInactive ? inactiveTitle : "Retry Plesk activation"}>
                                {busyId === `${r.id}-retry` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-amber-700" onClick={() => doForceActivate(r.id)} disabled={busyId === `${r.id}-force` || chainInactive} title={chainInactive ? inactiveTitle : "Force Activate (skip Plesk — manual setup required)"}>
                                {busyId === `${r.id}-force` ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
                              </Button>
                            </>
                          )}
                          {r.status === "Active" && (
                            <Button size="sm" variant="outline" className="h-7 text-green-700" onClick={() => doRetrySsl(r.id)} disabled={busyId === `${r.id}-ssl` || chainInactive} title={chainInactive ? inactiveTitle : "Re-apply wildcard SSL certificate in Plesk (use if site shows 'not secure')"}>
                              {busyId === `${r.id}-ssl` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7" onClick={() => doReminder(r.id)} disabled={busyId === `${r.id}-rem` || r.status !== "Active" || chainInactive} title={chainInactive ? inactiveTitle : (r.status !== "Active" ? "Send reminder (only available for Active websites)" : "Send renewal reminder email to Pres/Sec now")}>
                            {busyId === `${r.id}-rem` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => viewLogs(r.id)} title="View activity log (all changes, activations, reminders)">
                            <FileText className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => doDelete(r.id)} disabled={busyId === `${r.id}-del` || chainInactive} title={chainInactive ? inactiveTitle : "Delete website — removes from Plesk + portal"}>
                            {busyId === `${r.id}-del` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-red-400" onClick={() => doDeleteDbOnly(r.id)} disabled={busyId === `${r.id}-del` || chainInactive} title={chainInactive ? inactiveTitle : "Delete portal record only (keep Plesk subdomain intact)"}>
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Add / Edit Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId === null ? "Add Club Website" : "Edit Club Website"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>District * {editingId !== null && <span className="text-xs text-muted-foreground">(frozen)</span>}</Label>
                {editingId === null ? (
                  <>
                    <Select value={formDistrictId} onValueChange={(v) => { setFormDistrictId(v); setFormClubId(""); }}>
                      <SelectTrigger className={!formDistrictId ? "border-red-500" : ""}><SelectValue placeholder="Select District" /></SelectTrigger>
                      <SelectContent>
                        {districts.map((d: any) => (
                          <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!formDistrictId && <p className="text-xs text-red-600 mt-1">Required.</p>}
                  </>
                ) : (
                  <Input disabled value={rows.find(r => r.id === editingId)?.districtNumber ? `District ${rows.find(r => r.id === editingId)?.districtNumber}` : ""} />
                )}
              </div>
              <div>
                <Label>Club * {editingId !== null && <span className="text-xs text-muted-foreground">(frozen)</span>}</Label>
                {editingId === null ? (
                  <>
                    <Select value={formClubId} onValueChange={setFormClubId} disabled={!formDistrictId}>
                      <SelectTrigger className={!formClubId && formDistrictId ? "border-red-500" : ""}>
                        <SelectValue placeholder={
                          !formDistrictId ? "Pick district first" :
                          clubs.length === 0 ? "No clubs available (all have websites)" :
                          "Select Club"
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {clubs.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formDistrictId && clubs.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        All clubs in this district already have an active website. Delete one first to free up a club.
                      </p>
                    )}
                    {formDistrictId && clubs.length > 0 && !formClubId && <p className="text-xs text-red-600 mt-1">Required.</p>}
                  </>
                ) : (
                  <Input disabled value={rows.find(r => r.id === editingId)?.clubName || ""} />
                )}
              </div>
              <div>
                {(() => {
                  const currentStatus = editingId !== null ? rows.find(r => r.id === editingId)?.status : null;
                  const isFrozen = editingId !== null && currentStatus && currentStatus !== "Inactive";
                  return (
                    <>
                      <Label>Subdomain * {isFrozen && <span className="text-xs text-muted-foreground">(frozen — cannot change after activation)</span>}</Label>
                      <div className="flex items-stretch">
                        <Input
                          placeholder="rcmumbai"
                          value={formSubdomain}
                          onChange={(e) => setFormSubdomain(sanitizeLabelInput(e.target.value))}
                          disabled={!!isFrozen}
                          className={`rounded-r-none ${formSubdomain && !isFrozen && validateLabel(formSubdomain, true) ? "border-red-500" : ""}`}
                        />
                        <span className="inline-flex items-center px-3 text-sm bg-muted border border-l-0 border-input rounded-r-md text-muted-foreground select-none">
                          .{parentDomain}
                        </span>
                      </div>
                      {isFrozen ? (
                        <p className="text-xs text-amber-600 mt-1">
                          To rename: Deactivate this website → Delete → Add a new record with a different subdomain.
                        </p>
                      ) : formSubdomain && validateLabel(formSubdomain, true) ? (
                        <p className="text-xs text-red-600 mt-1">{validateLabel(formSubdomain, true)}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">Stored exactly as entered (&apos;:&apos; and &apos;/&apos; allowed). Auto-lowercased. Main domain auto-appended.</p>
                      )}
                    </>
                  );
                })()}
              </div>
              <div>
                <Label>Third party Domain (optional)</Label>
                <Input
                  placeholder="e.g., rotarymumbai.org"
                  value={formClientDomain}
                  onChange={(e) => { setFormClientDomain(sanitizeDomainInput(e.target.value)); setDomainCheck({ status: "idle", ips: [] }); }}
                  className={formClientDomain && validateDomain(formClientDomain, false) ? "border-red-500" : ""}
                />
                {formClientDomain && validateDomain(formClientDomain, false) && (
                  <p className="text-xs text-red-600 mt-1">{validateDomain(formClientDomain, false)}</p>
                )}
                {/* DNS pointing + Plesk-application status for the third-party domain */}
                {formClientDomain && !validateDomain(formClientDomain, false) && (() => {
                  const domainChanged = sanitizeDomainInput(formClientDomain) !== sanitizeDomainInput(originalClientDomain);
                  const alreadyAdded = editingId !== null && !domainChanged && domainInPlesk === true;
                  if (domainCheckingPlesk && domainInPlesk === null) {
                    return <p className="text-xs text-muted-foreground mt-2">Checking server for this domain…</p>;
                  }
                  if (alreadyAdded) {
                    return (
                      <div className="mt-2 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700">
                        ✓ This domain is already added as an application on the server. No DNS check needed.
                      </div>
                    );
                  }
                  return (
                    <div className="mt-2 rounded-md border border-input bg-muted/40 p-3 text-xs space-y-2">
                      <p className="font-medium text-foreground">Point this domain to our server first</p>
                      <p className="text-muted-foreground">At your domain provider&apos;s DNS settings, add this record:</p>
                      <div className="font-mono text-[11px] bg-background border rounded p-2 leading-5">
                        <div>Type: <strong>A</strong></div>
                        <div>Host / Name: <strong>@</strong> (and <strong>www</strong> if you use it)</div>
                        <div>Value / Points to: <strong>{serverIp || "—"}</strong></div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button type="button" size="sm" variant="outline" className="h-7" onClick={runDomainCheck} disabled={domainCheck.status === "checking"}>
                          {domainCheck.status === "checking" ? "Checking…" : "Check pointing"}
                        </Button>
                        {domainCheck.status === "pass" && (
                          <span className="text-green-700">✓ Points to our server ({serverIp}) — you can save now.</span>
                        )}
                        {domainCheck.status === "fail" && (
                          <span className="text-red-600">
                            ✗ Not pointing yet{domainCheck.ips.length ? ` — found: ${domainCheck.ips.join(", ")}` : " — no A record found"}
                          </span>
                        )}
                      </div>
                      {domainCheck.status !== "pass" && (
                        <p className="text-amber-600">DNS changes can take a while to propagate. Verify pointing before saving this domain.</p>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div>
                <Label>Template *</Label>
                <Select value={formThemeId} onValueChange={setFormThemeId}>
                  <SelectTrigger className={!formThemeId ? "border-red-500" : ""}><SelectValue placeholder="Select Template" /></SelectTrigger>
                  <SelectContent>
                    {themes.map((t: any) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.themeName || t.theme_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!formThemeId && <p className="text-xs text-red-600 mt-1">Required.</p>}
              </div>
              <div>
                <Label>Reminder Days (override) — default {defaultReminderDays}</Label>
                <Input type="number" min="1" max="180" placeholder={`Default ${defaultReminderDays}`} value={formReminderDays} onChange={(e) => setFormReminderDays(e.target.value)} />
              </div>
              <div>
                <Label>Start Date *</Label>
                <DateField value={formStartDate} onChange={setFormStartDate} />
              </div>
              <div>
                <Label>End Date *</Label>
                <DateField value={formEndDate} onChange={setFormEndDate} />
              </div>
              <div className="md:col-span-2 border-t pt-3">
                <Label className="text-sm font-semibold text-primary">Plan</Label>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="planMode"
                      value="purchased"
                      checked={formMode === "purchased"}
                      onChange={() => setFormMode("purchased")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Purchased</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="planMode"
                      value="trial"
                      checked={formMode === "trial"}
                      onChange={() => setFormMode("trial")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Trial</span>
                  </label>
                  {formMode === "trial" && (
                    <div className="flex items-center gap-2 ml-auto">
                      <Label className="text-xs whitespace-nowrap">Trial Period (days)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={formTrialDays}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFormTrialDays(v);
                          // Auto-update End Date when admin types — pivot off Start Date,
                          // falling back to today so the date picker isn't left blank.
                          const n = parseInt(v, 10);
                          if (Number.isFinite(n) && n > 0) {
                            const base = formStartDate ? new Date(formStartDate) : new Date();
                            base.setDate(base.getDate() + n);
                            setFormEndDate(base.toISOString().slice(0, 10));
                          }
                        }}
                        className="w-24"
                      />
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {formMode === "purchased"
                    ? "Capture the payment details below. Trial period is not applicable."
                    : "Payment fields are disabled. Trial Period auto-fills End Date from Start Date."}
                </p>
              </div>
              <div>
                <Label className={formMode === "trial" ? "text-muted-foreground" : ""}>Amount Paid</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formMode === "trial" ? "" : formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  disabled={formMode === "trial"}
                  placeholder={formMode === "trial" ? "—" : ""}
                />
              </div>
              <div>
                <Label className={formMode === "trial" ? "text-muted-foreground" : ""}>Transaction ID</Label>
                <Input
                  value={formMode === "trial" ? "" : formTransactionId}
                  onChange={(e) => setFormTransactionId(e.target.value)}
                  disabled={formMode === "trial"}
                  placeholder={formMode === "trial" ? "—" : ""}
                />
              </div>
              <div>
                <Label className={formMode === "trial" ? "text-muted-foreground" : ""}>Payment Date</Label>
                <DateField value={formMode === "trial" ? "" : formPaymentDate} onChange={setFormPaymentDate} disabled={formMode === "trial"} />
              </div>
              <div>
                <Label className={formMode === "trial" ? "text-muted-foreground" : ""}>Payment Mode</Label>
                <Input
                  placeholder={formMode === "trial" ? "—" : "UPI / Cheque / Bank Transfer"}
                  value={formMode === "trial" ? "" : formPaymentMode}
                  onChange={(e) => setFormPaymentMode(e.target.value)}
                  disabled={formMode === "trial"}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Notes</Label>
                <Textarea rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
              </div>
            </div>

            {/* Club website history (Add mode only) */}
            {editingId === null && clubHistory.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <Label className="text-sm font-semibold text-primary mb-2 block">
                  Previous Websites for {selectedClubName || "this club"}
                </Label>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Subdomain</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead>
                      <TableHead>Status</TableHead><TableHead>Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {clubHistory.map((h: any) => (
                        <TableRow key={h.id}>
                          <TableCell className="font-mono text-xs">{h.subdomain}</TableCell>
                          <TableCell className="text-xs">{h.startDate ? new Date(h.startDate).toLocaleDateString(appLocale()) : "—"}</TableCell>
                          <TableCell className="text-xs">{h.endDate ? new Date(h.endDate).toLocaleDateString(appLocale()) : "—"}</TableCell>
                          <TableCell><Badge variant="outline">{h.status}</Badge></TableCell>
                          <TableCell className="text-xs">{h.amountPaid ? `${currencySymbol()}${Number(h.amountPaid).toLocaleString(appLocale())}` : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={saveForm} disabled={saving || domainGateBlocksSave} title={domainGateBlocksSave ? "Verify the third-party domain points to the server before saving" : undefined}>{saving ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Logs Dialog */}
        <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Activity Log</DialogTitle></DialogHeader>
            {logsLoading ? (
              <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No log entries.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Action</TableHead>
                  <TableHead>By</TableHead><TableHead>Details</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {logs.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{new Date(l.performedDate).toLocaleString(appLocale())}</TableCell>
                      <TableCell><Badge variant="outline">{l.action}</Badge></TableCell>
                      <TableCell className="text-xs">{l.performedByName || (l.performedBy === 0 ? "System" : "—")}</TableCell>
                      <TableCell className="text-xs">{l.details || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DialogContent>
        </Dialog>

        {/* Plesk Raw Diagnostic Dialog */}
        <Dialog open={diagOpen} onOpenChange={setDiagOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Plesk Raw Diagnostic</DialogTitle></DialogHeader>
            <div className="flex gap-2 flex-wrap mb-2">
              <Button size="sm" variant={diagType === "list-subdomains" ? "default" : "outline"} onClick={() => runDiag("list-subdomains")}>Subdomains</Button>
              <Button size="sm" variant={diagType === "list-sites" ? "default" : "outline"} onClick={() => runDiag("list-sites")}>Sites / Domains</Button>
              <Button size="sm" variant={diagType === "list-webspaces" ? "default" : "outline"} onClick={() => runDiag("list-webspaces")}>Webspaces</Button>
            </div>
            {diagLoading ? (
              <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
            ) : diagData ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold">Request XML sent to Plesk</Label>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{diagData.request}</pre>
                </div>
                <div>
                  <Label className="text-xs font-semibold">Response XML from Plesk</Label>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{diagData.response}</pre>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDiagOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* SSL Diagnostic Dialog */}
        <Dialog open={sslDiagOpen} onOpenChange={setSslDiagOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>SSL Diagnostic (raw Plesk XML)</DialogTitle></DialogHeader>
            {sslDiagLoading ? (
              <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">Copy this full output and paste it back in chat — it shows exactly how Plesk represents this subdomain and which endpoint exposes cert properties.</p>
                <Textarea readOnly value={sslDiagText} className="font-mono text-xs h-[60vh]" onFocus={(e) => e.currentTarget.select()} />
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(sslDiagText); setSuccessMessage("Copied to clipboard."); }}>Copy</Button>
              <Button variant="outline" onClick={() => setSslDiagOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Plesk Subdomains List Dialog */}
        <Dialog open={pleskListOpen} onOpenChange={setPleskListOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>All Subdomains in Plesk ({pleskList.length})</DialogTitle></DialogHeader>
            {pleskListLoading ? (
              <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
            ) : pleskList.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No subdomains found in Plesk.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Plesk ID</TableHead><TableHead>Subdomain</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pleskList.map((s: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{s.id}</TableCell>
                      <TableCell className="font-mono">{s.name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPleskListOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Settings Dialog */}
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Club Website Settings</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Parent Domain</Label>
                <Input value={settingsParent} onChange={(e) => setSettingsParent(sanitizeDomainInput(e.target.value))} placeholder="e.g., portal.example.org" />
                <p className="text-xs text-muted-foreground mt-1">All club subdomains are created under this domain. Changing this does not rewrite existing records.</p>
              </div>
              <div>
                <Label>Default Reminder Days</Label>
                <Input type="number" min="1" max="180" value={settingsDays} onChange={(e) => setSettingsDays(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">
                  Reminders start this many days before expiry. Can be overridden per-record.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
              <Button onClick={saveSettings}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
        </TabsContent>
        <TabsContent value="training">
          <WebsiteTrainingAppointmentsTab />
        </TabsContent>
        {/* When the training team is free / blocked — drives the club's "Request a Training Date". */}
        <TabsContent value="availability">
          <TrainingAvailabilityTab />
        </TabsContent>
      </Tabs>
    </ProtectedRoute>
  );
}
