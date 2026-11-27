import { useState, useEffect, useMemo } from "react";
import { getDistricts, getThemes, getClubWebsites, getClubWebsiteLogs, getClubWebsiteHistory, getClubWebsiteSettings, updateClubWebsiteSettings, getAvailableClubsForWebsite, createClubWebsite, updateClubWebsite, deleteClubWebsite, activateClubWebsite, deactivateClubWebsite, sendClubWebsiteReminder, retryClubWebsiteActivation, retryClubWebsiteSsl, testPleskConnection, listPleskSubdomains, pleskDiagnostic, pleskDiagnosticSubdomain, forceDeletePleskSubdomain, bulkStartClubWebsiteTrial, recycleAllClubWebsitePools, checkClubWebsiteDomainPointing, getClubWebsiteDomainPleskStatus } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import { appLocale } from "@/lib/appFormat";
import { Row, validateDomain, validateLabel, sanitizeLabelInput, sanitizeDomainInput, splitSubdomain, PAGE_SIZE } from "./clubWebsitesShared";

export function useClubWebsites() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [districtFilter, setDistrictFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, statusFilter, districtFilter]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [clubs, setClubs] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [defaultReminderDays, setDefaultReminderDays] = useState<number>(15);
  const [parentDomain, setParentDomain] = useState<string>("portal.example.org");
  const [serverIp, setServerIp] = useState<string>("");
  const [hasPlesk, setHasPlesk] = useState(false);

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
        setHasPlesk(!!sRes?.pleskConfigured);
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
        setSuccessMessage("Activated: welcome email sent to Pres/Sec.");
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
      setSuccessMessage(`Bulk trial done: ${parts.join(", ")}.`);
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
      "DO NOT use this for normal theme/banner/project changes: those auto-refresh without recycling.\n\n" +
      "Continue?"
    )) return;
    setRecyclingPools(true);
    try {
      const res = await recycleAllClubWebsitePools();
      if (res.error) {
        setErrorMessage(`Recycle failed: ${res.error}`);
      } else if (res.permissionDenied) {
        setErrorMessage(
          `Recycled ${res.recycled}/${res.totalPools} pools. ${res.failed} failed: most likely a permission issue. ` +
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
    if (!confirm(`Force-delete '${label.trim()}' from Plesk?\n\nOnly removes from Plesk/IIS: ClubWebsite folder is protected.`)) return;
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
      setSuccessMessage(`Reminder: sent: ${res.sent}, failed: ${res.failed}.`);
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

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  // Clamped: deleting the last row of the last page must not leave an empty page.
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
        { key: "daysLeft", label: "Days Left", width: 10, numeric: true },
        { key: "status", label: "Status", width: 12 },
        { key: "amountPaid", label: "Amount", width: 12, numeric: true },
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
        { key: "bannerCount", label: "Banners", width: 10, numeric: true },
        { key: "advertisementCount", label: "Advertisements", width: 14, numeric: true },
        { key: "projectCount", label: "Projects", width: 10, numeric: true },
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
        { key: "daysLeft", label: "Days Left", width: 10, numeric: true },
        { key: "status", label: "Status", width: 12 },
        // Current-year content + activity (user 2026-09-29): ACTIVE banners and advertisements,
        // and the club's projects counted the same way the public site and the daily report count
        // them - Club Service excluded, an ongoing project once, never its repeat entries.
        { key: "bannerCount", label: "Banners", width: 10, numeric: true },
        { key: "advertisementCount", label: "Advertisements", width: 14, numeric: true },
        { key: "projectCount", label: "Projects", width: 10, numeric: true },
      ],
      { title: "Club Websites | Third party Domains", subtitle: `Exported ${new Date().toLocaleDateString(appLocale())}` });
    // No success alert here either - see the note in exportExcel.
  };

  const selectedClubName = clubs.find((c: any) => String(c.id) === formClubId)?.clubName || "";
  const selectedDistrictNumber = districts.find((d: any) => String(d.id) === formDistrictId)?.districtNumber || "";
  return { rows, loading, statusFilter, setStatusFilter, districtFilter, setDistrictFilter, search, setSearch, setPage, districts, clubs, themes, errorMessage, setErrorMessage, successMessage, setSuccessMessage, defaultReminderDays, parentDomain, serverIp, hasPlesk, editOpen, setEditOpen, editingId, formDistrictId, setFormDistrictId, formClubId, setFormClubId, formSubdomain, setFormSubdomain, formClientDomain, setFormClientDomain, originalClientDomain, domainInPlesk, domainCheckingPlesk, domainCheck, setDomainCheck, formThemeId, setFormThemeId, formStartDate, setFormStartDate, formEndDate, setFormEndDate, formReminderDays, setFormReminderDays, formAmount, setFormAmount, formTransactionId, setFormTransactionId, formPaymentDate, setFormPaymentDate, formPaymentMode, setFormPaymentMode, formNotes, setFormNotes, formMode, setFormMode, formTrialDays, setFormTrialDays, clubHistory, saving, busyId, selectedIds, setSelectedIds, bulkTrialDays, setBulkTrialDays, bulkBusy, logsOpen, setLogsOpen, logs, logsLoading, settingsOpen, setSettingsOpen, settingsDays, setSettingsDays, settingsParent, setSettingsParent, loadRows, openAdd, openEdit, runDomainCheck, domainGateBlocksSave, saveForm, doDelete, doDeleteDbOnly, doToggle, doBulkStartTrial, doRetry, doRetrySsl, doForceActivate, doTestPlesk, recyclingPools, doRecycleAllPools, doForceCleanPlesk, pleskListOpen, setPleskListOpen, pleskList, pleskListLoading, sslDiagOpen, setSslDiagOpen, sslDiagText, sslDiagLoading, diagOpen, setDiagOpen, diagLoading, diagData, diagType, runDiag, doListPleskSubdomains, doReminder, viewLogs, saveSettings, openSettings, filteredRows, totalPages, currentPage, pagedRows, expiringSoon, expired, active, exportExcel, exportThirdPartyDomains, selectedClubName };
}

export type ClubWebsitesCtx = ReturnType<typeof useClubWebsites>;
