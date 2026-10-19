"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Plus, Edit, Trash2, Link as LinkIcon, Mail, FileSpreadsheet, ExternalLink, Power, PowerOff, Loader2 } from "@/components/icons";
import {
  getDirectoryConfigs, deleteDirectoryConfig, toggleDirectoryConfigActive,
  sendDirectoryReminders, getDirectoryPublicUrl,
  downloadDirectoryReportExcel,
  DirectoryConfigListRow,
} from "@/services/api";

export default function DirectoryDataCollectionListPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [allRows, setAllRows] = useState<DirectoryConfigListRow[]>([]);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [districtFilter, setDistrictFilter] = useState<string>("all");

  // Enable/disable the public collection link. Optimistic list update.
  const toggleActive = async (id: number) => {
    const row = allRows.find((r) => r.id === id);
    const isOpen = row?.isActive !== 0; // isActive === 0 means CLOSED
    const confirmMsg = isOpen
      ? "Close this link? Members will no longer be able to open or submit this form."
      : "Open this link? Members will be able to open and submit this form.";
    if (!confirm(confirmMsg)) return;
    setBusy(`active:${id}`);
    setError(null);
    try {
      const res = await toggleDirectoryConfigActive(id);
      setAllRows((prev) => prev.map((r) => (r.id === id ? { ...r, isActive: res.isActive } : r)));
      setSuccess(res.message);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to update link status");
    } finally {
      setBusy(null);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const list = await getDirectoryConfigs({});
      setAllRows(list);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load configs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Build filter dropdown options from ACTUAL data (not the full master list)
  const yearOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of allRows) map.set(r.yearId, r.yearLabel);
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) => b.label.localeCompare(a.label));
  }, [allRows]);

  const districtOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of allRows) map.set(r.districtId, r.districtNumber);
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allRows]);

  const rows = useMemo(() => {
    return allRows.filter((r) => {
      if (yearFilter !== "all" && String(r.yearId) !== yearFilter) return false;
      if (districtFilter !== "all" && String(r.districtId) !== districtFilter) return false;
      return true;
    });
  }, [allRows, yearFilter, districtFilter]);

  // Show a spinner in place of the icon while that specific action (busy key) is running.
  const spin = (key: string, icon: React.ReactNode) =>
    busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : icon;

  const copyUrl = async (id: number) => {
    try {
      setBusy(`url:${id}`);
      const { url } = await getDirectoryPublicUrl(id);
      await navigator.clipboard.writeText(url);
      setSuccess("Public URL copied to clipboard");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to copy URL");
    } finally { setBusy(null); }
  };

  const openUrl = async (id: number) => {
    try {
      setBusy(`open:${id}`);
      const { url } = await getDirectoryPublicUrl(id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to open URL");
    } finally { setBusy(null); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this configuration? Members will no longer be able to open this form.")) return;
    try {
      setBusy(`del:${id}`);
      await deleteDirectoryConfig(id);
      setSuccess("Deleted");
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Delete failed");
    } finally { setBusy(null); }
  };

  const downloadExcel = async (r: DirectoryConfigListRow) => {
    try {
      setBusy(`xls:${r.id}`);
      await downloadDirectoryReportExcel(r.id, r.districtNumber, r.yearLabel);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to download report");
    } finally { setBusy(null); }
  };

  const sendReminder = async (id: number, channel: "email") => {
    if (!confirm(`Send ${channel} reminder to all members with <100% completion?`)) return;
    try {
      setBusy(`${channel}:${id}`);
      await sendDirectoryReminders(id, channel);
      setSuccess("Email reminders queued. They will be sent in background.");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to queue reminders");
    } finally { setBusy(null); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">Directory Data Collection</h2>
            <p className="text-muted-foreground text-base">Configure per-district member data collection forms (DC, BOD, Members)</p>
          </div>
          <Button asChild>
            <Link href="/settings/directory-data-collection/new"><Plus className="h-4 w-4 mr-2" />Add New</Link>
          </Button>
        </div>

        <SuccessAlert open={!!success} title="Success" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error ?? ""} onOk={() => setError(null)} />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Rotary Year</label>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {yearOptions.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>{y.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">District</label>
              <Select value={districtFilter} onValueChange={setDistrictFilter}>
                <SelectTrigger><SelectValue placeholder="All Districts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Districts</SelectItem>
                  {districtOptions.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <RotaryLoader />
        ) : rows.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            {allRows.length === 0 ? <>No configurations yet. Click <b>Add New</b> to create one.</> : <>No results for the selected filters.</>}
          </CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="min-w-full divide-y">
                <thead className="bg-muted/40">
                  <tr className="text-left text-sm text-muted-foreground">
                    <th className="p-3 w-10">Sr</th>
                    <th className="p-3">District</th>
                    <th className="p-3">Year</th>
                    <th className="p-3">1st Contact</th>
                    <th className="p-3">2nd Contact</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => (
                    <tr key={r.id} className="text-sm">
                      <td className="p-3">{i + 1}</td>
                      <td className="p-3 font-medium">{r.districtNumber}</td>
                      <td className="p-3">{r.yearLabel}</td>
                      <td className="p-3">
                        {r.firstContactName ? <>{r.firstContactName}<br /><span className="text-xs text-muted-foreground">{r.firstContactMobile ?? ""}</span></> : "–"}
                      </td>
                      <td className="p-3">
                        {r.secondContactName ? <>{r.secondContactName}<br /><span className="text-xs text-muted-foreground">{r.secondContactMobile ?? ""}</span></> : "–"}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1 justify-end flex-wrap">
                          <Button size="sm" variant="outline" asChild title="Edit">
                            <Link href={`/settings/directory-data-collection/${r.id}/edit`}><Edit className="h-4 w-4" /></Link>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => copyUrl(r.id)} disabled={busy === `url:${r.id}`} title="Copy public URL">
                            {spin(`url:${r.id}`, <LinkIcon className="h-4 w-4" />)}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openUrl(r.id)} disabled={busy === `open:${r.id}`} title="Open public form in new tab">
                            {spin(`open:${r.id}`, <ExternalLink className="h-4 w-4" />)}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => sendReminder(r.id, "email")} disabled={busy === `email:${r.id}` || r.sendEmail === 0} title={r.sendEmail === 0 ? "Email is disabled for this district: enable it in the config to send email reminders" : "Email reminder to all incomplete members"}>
                            {spin(`email:${r.id}`, <Mail className="h-4 w-4" />)}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => downloadExcel(r)} disabled={busy === `xls:${r.id}`} title="Download Excel report">
                            {spin(`xls:${r.id}`, <FileSpreadsheet className="h-4 w-4" />)}
                          </Button>
                          {/* Enable / disable the public link. Shows current state; red when closed. */}
                          <Button
                            size="sm"
                            variant={r.isActive === 0 ? "destructive" : "outline"}
                            className={r.isActive === 0 ? "" : "border-green-500 text-green-700 hover:bg-green-50"}
                            onClick={() => toggleActive(r.id)}
                            disabled={busy === `active:${r.id}`}
                            title={r.isActive === 0 ? "Link is CLOSED. Click to enable" : "Link is OPEN. Click to disable"}
                          >
                            {busy === `active:${r.id}`
                              ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />{r.isActive === 0 ? "Closed" : "Open"}</>
                              : (r.isActive === 0 ? <><PowerOff className="h-4 w-4 mr-1" />Closed</> : <><Power className="h-4 w-4 mr-1" />Open</>)}
                          </Button>
                          {/* Delete allowed only when the link is CLOSED (disabled). */}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(r.id)}
                            disabled={busy === `del:${r.id}` || r.isActive !== 0}
                            title={r.isActive !== 0 ? "Close (disable) the link before deleting" : "Delete"}
                          >
                            {spin(`del:${r.id}`, <Trash2 className="h-4 w-4" />)}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </ProtectedRoute>
  );
}
