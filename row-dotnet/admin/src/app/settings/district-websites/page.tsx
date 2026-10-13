"use client";

import React, { useState, useEffect, useMemo } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  ArrowLeft, Plus, Pencil, Trash2, Power, PowerOff, FileText, Download,
  CheckCircle2, Clock, AlertTriangle, XCircle, Globe,
  RotateCw, Server, Loader2, Lock, Wrench, ChevronDown,
} from "lucide-react";
import { exportToCSV } from "@/utils/csvExport";
import {
  getDistrictWebsites, getDistrictWebsiteLogs, getAvailableDistrictsForWebsite,
  createDistrictWebsite, updateDistrictWebsite, deleteDistrictWebsite,
  activateDistrictWebsite, deactivateDistrictWebsite,
  retryDistrictWebsiteActivation, retryDistrictWebsiteSsl,
  testDistrictPleskConnection, listDistrictPleskSubdomains, forceDeleteDistrictPleskSubdomain,
} from "@/services/api";

import { appLocale } from "@/lib/appFormat";
type Row = {
  id: number;
  districtId: number;
  districtNumber: string;
  subdomain: string;
  clientDomain: string | null;
  status: string;
  notes: string | null;
  createdDate: string;
  // Phase 4 kill-switch: 1 when district + zone are both active; 0 when chain is broken.
  chainActive?: number;
};

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!.*\.\.)(?!.*--)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

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

// Subdomain / Third party Domain accept ANY characters (including ':' and '/') and are kept
// exactly as typed — no stripping, no normalization. Lower-cased only.
function sanitizeLabelInput(value: string): string { return (value || "").toLowerCase(); }
function sanitizeDomainInput(value: string): string { return (value || "").toLowerCase(); }

const PARENT_DOMAIN = "portal.example.org";

function splitSubdomain(full: string): string {
  // If stored value doesn't end with the current parent (legacy/imported rows like
  // "club.example.org"), fall back to just the first label so the row stays editable.
  const suffix = `.${PARENT_DOMAIN}`;
  const v = full.toLowerCase();
  if (v.endsWith(suffix)) return v.slice(0, -suffix.length);
  const dotIdx = v.indexOf(".");
  return dotIdx >= 0 ? v.slice(0, dotIdx) : v;
}

function statusBadge(status: string) {
  if (status === "ActivationFailed") return <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Activation Failed</Badge>;
  if (status === "Inactive") return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Inactive</Badge>;
  if (status === "Active") return <Badge className="bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Active</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function DistrictWebsitesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [availableDistricts, setAvailableDistricts] = useState<any[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    districtId: 0,
    subdomainLabel: "",
    clientDomain: "",
    notes: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [pleskListOpen, setPleskListOpen] = useState(false);
  const [pleskList, setPleskList] = useState<any[]>([]);
  const [pleskListLoading, setPleskListLoading] = useState(false);

  const loadRows = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (search) params.search = search;
      const data = await getDistrictWebsites(params);
      setRows(data as Row[]);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load.");
    } finally { setLoading(false); }
  };

  useEffect(() => { loadRows(); }, []);

  const loadAvailableDistricts = async () => {
    try { setAvailableDistricts(await getAvailableDistrictsForWebsite()); }
    catch { setAvailableDistricts([]); }
  };

  const openAdd = async () => {
    setEditingId(null);
    setForm({ districtId: 0, subdomainLabel: "", clientDomain: "", notes: "" });
    setFormErrors({});
    await loadAvailableDistricts();
    setEditOpen(true);
  };

  const openEdit = (r: Row) => {
    setEditingId(r.id);
    setForm({
      districtId: r.districtId,
      subdomainLabel: sanitizeLabelInput(splitSubdomain(r.subdomain)),
      clientDomain: sanitizeDomainInput(r.clientDomain || ""),
      notes: r.notes || "",
    });
    setFormErrors({});
    setEditOpen(true);
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (editingId === null && form.districtId <= 0) errs.districtId = "District is required.";
    const subErr = validateLabel(form.subdomainLabel, true);
    if (subErr) errs.subdomain = subErr;
    if (form.clientDomain) {
      const cliErr = validateDomain(form.clientDomain, false);
      if (cliErr) errs.clientDomain = cliErr;
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      const subdomain = `${sanitizeLabelInput(form.subdomainLabel)}.${PARENT_DOMAIN}`;
      if (editingId === null) {
        await createDistrictWebsite({
          districtId: form.districtId,
          subdomain,
          clientDomain: sanitizeDomainInput(form.clientDomain) || null,
          notes: form.notes || null,
        });
        setSuccessMessage("District website created. Click Activate to provision in Plesk.");
      } else {
        await updateDistrictWebsite(editingId, {
          subdomain,
          clientDomain: sanitizeDomainInput(form.clientDomain) || null,
          notes: form.notes || null,
        });
        setSuccessMessage("Updated.");
      }
      setEditOpen(false);
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Save failed.");
    } finally { setSaving(false); }
  };

  const doDelete = async (id: number) => {
    if (!confirm("Delete this district website? This removes the subdomain from Plesk + portal.")) return;
    setBusyId(`${id}-del`);
    try {
      const res = await deleteDistrictWebsite(id, false);
      setSuccessMessage(res?.pleskResult ? `Deleted. ${res.pleskResult}` : "Deleted.");
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Delete failed.");
    } finally { setBusyId(null); }
  };

  const doDeleteDbOnly = async (id: number) => {
    if (!confirm("Delete the portal record only (keep Plesk subdomain intact)? Use this only if Plesk is already clean.")) return;
    setBusyId(`${id}-del`);
    try {
      await deleteDistrictWebsite(id, true);
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
        await deactivateDistrictWebsite(r.id);
        setSuccessMessage("Deactivated.");
      } else {
        const res = await activateDistrictWebsite(r.id);
        const steps = (res.pleskStepsDone || []).join(", ");
        setSuccessMessage(`Activated.${steps ? ` Plesk: ${steps}.` : ""}`);
      }
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Action failed.");
    } finally { setBusyId(null); }
  };

  const doRetry = async (id: number) => {
    setBusyId(`${id}-retry`);
    try {
      const res = await retryDistrictWebsiteActivation(id);
      const steps = (res.pleskStepsDone || []).join(", ");
      setSuccessMessage(`Activated.${steps ? ` Plesk: ${steps}.` : ""}`);
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Retry failed.");
    } finally { setBusyId(null); }
  };

  const doRetrySsl = async (id: number) => {
    setBusyId(`${id}-ssl`);
    try {
      const res = await retryDistrictWebsiteSsl(id);
      setSuccessMessage(res?.message || "SSL reapplied.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "SSL retry failed.");
    } finally { setBusyId(null); }
  };

  const doForceActivate = async (id: number) => {
    if (!confirm("Activate without Plesk provisioning? Use this only if Plesk is unavailable.")) return;
    setBusyId(`${id}-force`);
    try {
      await activateDistrictWebsite(id, true);
      setSuccessMessage("Activated (Plesk skipped). Complete Plesk setup manually.");
      await loadRows();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Force activation failed.");
    } finally { setBusyId(null); }
  };

  const doTestPlesk = async () => {
    try {
      const res = await testDistrictPleskConnection();
      setSuccessMessage(res?.message || "Plesk connection OK.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Plesk test failed.");
    }
  };

  const doListPleskSubdomains = async () => {
    setPleskListOpen(true);
    setPleskListLoading(true);
    try {
      const res = await listDistrictPleskSubdomains();
      setPleskList(res?.subdomains || []);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "List failed.");
      setPleskList([]);
    } finally { setPleskListLoading(false); }
  };

  const doForceCleanPlesk = async () => {
    const label = prompt(`Enter subdomain label or full FQDN to force-delete from Plesk\n(examples: 'd3131' or 'd3131.${PARENT_DOMAIN}')\n\nThis removes from Plesk only. DB not touched.\nShared DistrictWebsite folder is protected.`);
    if (!label?.trim()) return;
    if (!confirm(`Force-delete '${label.trim()}' from Plesk?\n\nOnly removes from Plesk/IIS — DistrictWebsite folder is protected.`)) return;
    try {
      const res = await forceDeleteDistrictPleskSubdomain(label.trim());
      setSuccessMessage(res?.message || "Done.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Force-delete failed.");
    }
  };

  const viewLogs = async (id: number) => {
    setLogsOpen(true);
    setLogsLoading(true);
    try { setLogs(await getDistrictWebsiteLogs(id)); }
    catch (err: any) { setErrorMessage(err?.response?.data?.message || "Logs failed."); setLogs([]); }
    finally { setLogsLoading(false); }
  };

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== "all") r = r.filter(x => x.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      r = r.filter(x =>
        (x.districtNumber || "").toLowerCase().includes(s) ||
        (x.subdomain || "").toLowerCase().includes(s) ||
        (x.clientDomain || "").toLowerCase().includes(s));
    }
    return r;
  }, [rows, statusFilter, search]);

  const active = rows.filter(r => r.status === "Active").length;
  const inactive = rows.filter(r => r.status === "Inactive").length;
  const failed = rows.filter(r => r.status === "ActivationFailed").length;

  const currentStatus = editingId !== null ? rows.find(r => r.id === editingId)?.status : null;
  const isFrozen = editingId !== null && currentStatus && currentStatus !== "Inactive";

  const exportExcel = () => {
    if (filtered.length === 0) return;
    exportToCSV(filtered, "District_Websites",
      [
        { key: "districtNumber", label: "District", width: 15 },
        { key: "subdomain", label: "Subdomain", width: 35 },
        { key: "clientDomain", label: "Third party Domain", width: 35 },
        { key: "status", label: "Status", width: 15 },
        { key: "notes", label: "Notes", width: 40 },
      ],
      { title: "District Websites", subtitle: `Exported ${new Date().toLocaleDateString(appLocale())}` });
    setSuccessMessage("Exported.");
  };

  return (
    <ProtectedRoute>
      {/* Full-screen loader during long operations */}
      {busyId && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-background rounded-lg p-6 shadow-xl flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Processing… please wait</p>
          </div>
        </div>
      )}

      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">District Websites</h2>
              <p className="text-muted-foreground text-base">Manage district website subdomains (no subscription/expiry)</p>
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={doForceCleanPlesk} className="text-red-600 focus:text-red-700">
                  <Trash2 className="mr-2 h-4 w-4" />Force Clean Subdomain
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0} title="Export all district website records to Excel">
              <Download className="mr-2 h-4 w-4" />Export Excel
            </Button>
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />Add Website
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{rows.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active</p><p className="text-xl font-bold text-green-600">{active}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Inactive</p><p className="text-xl font-bold text-muted-foreground">{inactive}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Activation Failed</p><p className="text-xl font-bold text-red-600">{failed}</p></CardContent></Card>
        </div>

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />

        <Card>
          <CardHeader><CardTitle>Websites ({filtered.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap mb-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                  <SelectItem value="ActivationFailed">Activation Failed</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Search district / subdomain / client domain" value={search} onChange={(e) => setSearch(e.target.value)} className="w-96" />
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No district websites found.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>District</TableHead>
                    <TableHead>Subdomain</TableHead>
                    <TableHead>Third party Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    // Phase 4 kill-switch: row is "chain inactive" when its district or zone is inactive.
                    const chainInactive = r.chainActive === 0;
                    const inactiveTitle = chainInactive ? "Inactive — reactivate from Districts page" : undefined;
                    return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{r.districtNumber}</span>
                          {chainInactive && <Badge variant="destructive">Inactive</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.status === "Active" ? (
                          <a href={`https://${r.subdomain}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            {r.subdomain}
                          </a>
                        ) : r.subdomain}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.clientDomain ? (
                          r.status === "Active" ? (
                            <a href={`https://${r.clientDomain}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                              {r.clientDomain}
                            </a>
                          ) : r.clientDomain
                        ) : "—"}
                      </TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => openEdit(r)} title="Edit website details"><Pencil className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => doToggle(r)} disabled={busyId === `${r.id}-toggle` || chainInactive} title={chainInactive ? inactiveTitle : (r.status === "Active" ? "Deactivate website" : "Activate website (creates subdomain in Plesk)")}>
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
                            <Button size="sm" variant="outline" className="h-7 text-green-700" onClick={() => doRetrySsl(r.id)} disabled={busyId === `${r.id}-ssl` || chainInactive} title={chainInactive ? inactiveTitle : "Re-apply wildcard SSL certificate in Plesk"}>
                              {busyId === `${r.id}-ssl` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7" onClick={() => viewLogs(r.id)} title="View activity log">
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
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId === null ? "Add District Website" : "Edit District Website"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {editingId === null && (
                <div>
                  <Label>District <span className="text-red-500">*</span></Label>
                  <Select value={form.districtId ? String(form.districtId) : ""} onValueChange={(v) => setForm({ ...form, districtId: Number(v) })}>
                    <SelectTrigger><SelectValue placeholder="Select District" /></SelectTrigger>
                    <SelectContent>
                      {availableDistricts.length === 0 ? (
                        <div className="px-2 py-2 text-sm text-muted-foreground">All districts already have websites.</div>
                      ) : availableDistricts.map((d: any) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formErrors.districtId && <p className="text-xs text-red-500 mt-1">{formErrors.districtId}</p>}
                  <p className="text-xs text-muted-foreground mt-1">Only districts without an existing website are shown.</p>
                </div>
              )}

              {editingId !== null && (
                <div>
                  <Label>District</Label>
                  <div className="text-sm p-2 bg-muted rounded">
                    {rows.find(r => r.id === editingId)?.districtNumber || "—"}
                  </div>
                </div>
              )}

              <div>
                <Label>Subdomain <span className="text-red-500">*</span></Label>
                <div className="flex items-center gap-0">
                  <Input
                    value={form.subdomainLabel}
                    onChange={(e) => setForm({ ...form, subdomainLabel: sanitizeLabelInput(e.target.value) })}
                    placeholder="e.g., d3131"
                    className="rounded-r-none"
                    disabled={!!isFrozen}
                  />
                  <div className="bg-muted border border-l-0 rounded-r-md px-3 py-2 text-sm text-muted-foreground font-mono whitespace-nowrap">
                    .{PARENT_DOMAIN}
                  </div>
                </div>
                {formErrors.subdomain && <p className="text-xs text-red-500 mt-1">{formErrors.subdomain}</p>}
                {isFrozen ? (
                  <p className="text-xs text-amber-600 mt-1">
                    Frozen (status: {currentStatus}). To rename: Deactivate → Delete → Add a new record with a different subdomain.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Stored exactly as entered. Example: <span className="font-mono">d3131</span> → becomes <span className="font-mono">d3131.{PARENT_DOMAIN}</span></p>
                )}
              </div>

              <div>
                <Label>Third party Domain (optional)</Label>
                <Input value={form.clientDomain} onChange={(e) => setForm({ ...form, clientDomain: sanitizeDomainInput(e.target.value) })} placeholder="e.g., rotary3131.org" />
                {formErrors.clientDomain && <p className="text-xs text-red-500 mt-1">{formErrors.clientDomain}</p>}
                <p className="text-xs text-muted-foreground mt-1">If set, this will be added as a domain alias pointing to the subdomain.</p>
              </div>

              <div>
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Internal notes…" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save"}
              </Button>
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
              <div className="text-center py-12 text-muted-foreground">No activity yet.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>By</TableHead><TableHead>Action</TableHead><TableHead>Details</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {logs.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs whitespace-nowrap">{l.performedDate ? new Date(l.performedDate).toLocaleString(appLocale()) : "—"}</TableCell>
                      <TableCell className="text-xs">{l.performedByName || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{l.action}</TableCell>
                      <TableCell className="text-xs">{l.details || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setLogsOpen(false)}>Close</Button>
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
      </div>
    </ProtectedRoute>
  );
}
