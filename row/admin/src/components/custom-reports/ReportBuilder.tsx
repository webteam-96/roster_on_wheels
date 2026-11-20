"use client";

/**
 * Report builder for club and district admins (api/Controllers/CustomReportsController.cs). Pick a source, columns
 * from its whitelist, filters, sort and grouping; run, export, save, and email it to the officers every month.
 * A district report covers every club of the district; a club report covers that club.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Play, Plus, Save, Send, Trash2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ErrorAlert from "@/components/ErrorAlert";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import {
  deleteCustomReport, exportCustomReport, getCustomReportCatalog, getCustomReports, getRotaryYears, runCustomReport,
  saveCustomReport, sendCustomReport,
} from "@/services/api";
import { OP_LABELS, cellText, definitionProblem, emptyDefinition, keepValid, needsValue, opsFor } from "@/lib/customReports";
import type {
  CustomReport, CustomReportDefinition, CustomReportFormat, CustomReportOp, CustomReportResult, CustomReportScope,
  CustomReportSource,
} from "@/types/customReports";
import type { RotaryYear } from "@/types/rotaryYear";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const FORMATS: { key: CustomReportFormat; label: string }[] = [
  { key: "xlsx", label: "Excel" }, { key: "csv", label: "CSV" }, { key: "pdf", label: "PDF" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const message = (err: any, fallback: string): string => err?.response?.data?.message || fallback;

interface Props { scope: CustomReportScope; scopeId: number }

export default function ReportBuilder({ scope, scopeId }: Props) {
  const fmt = useFormat();
  const [catalog, setCatalog] = useState<CustomReportSource[] | null>(null);
  const [saved, setSaved] = useState<CustomReport[] | null>(null);
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [def, setDef] = useState<CustomReportDefinition>(emptyDefinition("members"));
  const [monthly, setMonthly] = useState(false);
  const [day, setDay] = useState(1);
  const [format, setFormat] = useState<CustomReportFormat>("xlsx");

  const [result, setResult] = useState<CustomReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const loadSaved = useCallback(() => {
    getCustomReports(scope, scopeId).then(setSaved).catch((err) => setLoadError(message(err, "Could not load the saved reports.")));
  }, [scope, scopeId]);

  useEffect(() => {
    setCatalog(null);
    setSaved(null);
    setLoadError(null);
    getCustomReportCatalog(scope, scopeId).then(setCatalog).catch((err) => setLoadError(message(err, "Could not load the report builder.")));
    loadSaved();
    getRotaryYears().then(setYears).catch(() => setYears([]));
  }, [scope, scopeId, loadSaved]);

  const source = useMemo(() => catalog?.find((s) => s.key === def.source) ?? null, [catalog, def.source]);
  const fields = source?.fields ?? [];
  const numberFields = fields.filter((f) => f.type === "number");
  const fieldOf = (key: string) => fields.find((f) => f.key === key);

  const update = (patch: Partial<CustomReportDefinition>) => { setDef((d) => ({ ...d, ...patch })); setResult(null); };

  const changeSource = (key: string) => {
    const next = catalog?.find((s) => s.key === key);
    setDef((d) => keepValid({ ...d, source: key, yearId: key === "projects" ? d.yearId : null }, next?.fields ?? []));
    setResult(null);
  };

  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const newReport = () => {
    setEditingId(null); setName(""); setDef(emptyDefinition(catalog?.[0]?.key ?? "members"));
    setMonthly(false); setDay(1); setFormat("xlsx"); setResult(null);
  };

  const open = (r: CustomReport) => {
    setEditingId(r.id); setName(r.name); setDef({ ...emptyDefinition(r.definition.source), ...r.definition });
    setMonthly(r.scheduleMonthly); setDay(r.scheduleDay); setFormat(r.scheduleFormat); setResult(null);
  };

  const run = async () => {
    const problem = definitionProblem(def);
    if (problem) { setError(problem); return; }
    setRunning(true);
    setResult(null);
    try { setResult(await runCustomReport(scope, scopeId, def)); }
    catch (err) { setError(message(err, "Could not run the report.")); }
    finally { setRunning(false); }
  };

  const save = async () => {
    const problem = definitionProblem(def) ?? (name.trim() ? null : "Give the report a name.");
    if (problem) { setError(problem); return; }
    setBusy("save");
    try {
      const { id } = await saveCustomReport(scope, scopeId, editingId,
        { name: name.trim(), definition: def, scheduleMonthly: monthly, scheduleDay: day, scheduleFormat: format });
      setEditingId(id);
      setNotice("Report saved.");
      loadSaved();
    } catch (err) { setError(message(err, "Could not save the report.")); }
    finally { setBusy(null); }
  };

  const remove = async (id: number) => {
    setBusy(`delete-${id}`);
    try {
      await deleteCustomReport(scope, scopeId, id);
      if (editingId === id) newReport();
      setConfirmDelete(null);
      loadSaved();
    } catch (err) { setError(message(err, "Could not delete the report.")); }
    finally { setBusy(null); }
  };

  const send = async (r: CustomReport) => {
    setBusy(`send-${r.id}`);
    try {
      const { sent } = await sendCustomReport(scope, scopeId, r.id);
      setNotice(`Sent to ${sent} officer${sent === 1 ? "" : "s"}.`);
      loadSaved();
    } catch (err) { setError(message(err, "Could not send the report.")); }
    finally { setBusy(null); }
  };

  const download = async (f: CustomReportFormat) => {
    const problem = definitionProblem(def);
    if (problem) { setError(problem); return; }
    setBusy(`export-${f}`);
    try {
      const title = name.trim() || source?.label || "Report";
      const blob = await exportCustomReport(scope, scopeId, def, f, title);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^\w-]+/g, "-").toLowerCase()}.${f}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { setError("Could not export the report."); }
    finally { setBusy(null); }
  };

  const setFilter = (i: number, patch: Partial<CustomReportDefinition["filters"][number]>) =>
    update({ filters: def.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  if (loadError) {
    return <Card><CardContent className="p-5 text-sm text-destructive" role="alert">{loadError}</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      {/* Saved reports */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Saved reports</h3>
          <Button variant="outline" className="gap-1.5" onClick={newReport}><Plus className="h-4 w-4" /> New report</Button>
        </div>
        {saved == null ? (
          <TableSkeleton rows={3} />
        ) : saved.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-muted-foreground">No saved reports yet. Build one below and save it to run it again or email it every month.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {saved.map((r) => (
                <div key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${editingId === r.id ? "bg-muted/50" : ""}`}>
                  <div className="min-w-[12rem] flex-1">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {catalog?.find((s) => s.key === r.definition.source)?.label ?? r.definition.source}
                      {r.scheduleMonthly ? `. Emailed to officers on day ${r.scheduleDay} of each month` : ". Not scheduled"}
                      {r.lastSentAt ? `. Last sent ${fmt.date(r.lastSentAt)}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => open(r)}>Open</Button>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy === `send-${r.id}`} onClick={() => send(r)}>
                    {busy === `send-${r.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Email officers now
                  </Button>
                  {confirmDelete === r.id ? (
                    <>
                      <Button size="sm" variant="destructive" disabled={busy === `delete-${r.id}`} onClick={() => remove(r.id)}>Confirm delete</Button>
                      <Button size="sm" variant="ghost" aria-label="Keep the report" onClick={() => setConfirmDelete(null)}><X className="h-4 w-4" /></Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => setConfirmDelete(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Builder */}
      {catalog == null ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-48 w-full" /></div>
      ) : (
        <Card>
          <CardContent className="space-y-5 p-5">
            <h3 className="text-lg font-semibold">{editingId ? "Edit report" : "New report"}</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="cr-name">Report name</Label>
                <Input id="cr-name" maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-source">Source</Label>
                <select id="cr-source" className={SELECT} value={def.source} onChange={(e) => changeSource(e.target.value)}>
                  {catalog.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              {def.source === "projects" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cr-year">Rotary year</Label>
                  <select id="cr-year" className={SELECT} value={def.yearId ?? ""}
                    onChange={(e) => update({ yearId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Current year</option>
                    {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}</option>)}
                  </select>
                </div>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Columns</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {fields.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={def.columns.includes(f.key)} onChange={() => update({ columns: toggle(def.columns, f.key) })} />
                    {f.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Filters</legend>
              {def.filters.length === 0 && <p className="text-sm text-muted-foreground">No filters: every row in scope is included.</p>}
              {def.filters.map((flt, i) => {
                const field = fieldOf(flt.field);
                const type = field?.type ?? "text";
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select aria-label="Filter field" className={`${SELECT} w-44`} value={flt.field}
                      onChange={(e) => {
                        const t = fieldOf(e.target.value)?.type ?? "text";
                        setFilter(i, { field: e.target.value, op: opsFor(t)[0], value: t === "bool" ? "true" : "" });
                      }}>
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <select aria-label="Condition" className={`${SELECT} w-40`} value={flt.op}
                      onChange={(e) => setFilter(i, { op: e.target.value as CustomReportOp })}>
                      {opsFor(type).map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
                    </select>
                    {needsValue(flt.op) && (type === "bool" ? (
                      <select aria-label="Value" className={`${SELECT} w-28`} value={flt.value ?? "true"} onChange={(e) => setFilter(i, { value: e.target.value })}>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <Input aria-label="Value" className="w-48" type={type === "date" ? "date" : type === "number" ? "number" : "text"}
                        maxLength={200} value={flt.value ?? ""} onChange={(e) => setFilter(i, { value: e.target.value })} />
                    ))}
                    <Button size="sm" variant="ghost" aria-label="Remove filter" onClick={() => update({ filters: def.filters.filter((_, j) => j !== i) })}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              {fields.length > 0 && def.filters.length < 20 && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => {
                  const f = fields[0];
                  update({ filters: [...def.filters, { field: f.key, op: opsFor(f.type)[0], value: f.type === "bool" ? "true" : "" }] });
                }}><Plus className="h-4 w-4" /> Add filter</Button>
              )}
            </fieldset>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="cr-group">Group by</Label>
                <select id="cr-group" className={SELECT} value={def.groupBy ?? ""}
                  onChange={(e) => update({ groupBy: e.target.value || null, sumFields: e.target.value ? def.sumFields : [] })}>
                  <option value="">No grouping (one row each)</option>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-sort">Sort by</Label>
                <select id="cr-sort" className={SELECT} value={def.sortBy ?? ""} onChange={(e) => update({ sortBy: e.target.value || null })}>
                  <option value="">{def.groupBy ? "Group value" : "No sorting"}</option>
                  {def.groupBy
                    ? [<option key="count" value="count">Count</option>,
                       ...def.sumFields.map((k) => <option key={k} value={k}>Total {fieldOf(k)?.label.toLowerCase()}</option>)]
                    : fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={def.sortDesc} onChange={(e) => update({ sortDesc: e.target.checked })} />
                Largest or latest first
              </label>
            </div>
            {def.groupBy && numberFields.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Totals per group</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {numberFields.map((f) => (
                    <label key={f.key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={def.sumFields.includes(f.key)} onChange={() => update({ sumFields: toggle(def.sumFields, f.key) })} />
                      {f.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <fieldset className="space-y-2 border-t pt-4">
              <legend className="sr-only">Monthly email</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
                Email this report to the {scope === "club" ? "club's" : "district's"} officers every month (saved reports only)
              </label>
              {monthly && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-day">Day of the month</Label>
                    <Input id="cr-day" type="number" min={1} max={28} className="w-28" value={day}
                      onChange={(e) => setDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-format">Attach as</Label>
                    <select id="cr-format" className={`${SELECT} w-32`} value={format} onChange={(e) => setFormat(e.target.value as CustomReportFormat)}>
                      {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </fieldset>

            <div className="flex flex-wrap gap-2">
              <Button className="gap-1.5" disabled={running} onClick={run}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
              </Button>
              <Button variant="outline" className="gap-1.5" disabled={busy === "save"} onClick={save}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {editingId ? "Save changes" : "Save"}
              </Button>
              {FORMATS.map((f) => (
                <Button key={f.key} variant="outline" className="gap-1.5" disabled={busy === `export-${f.key}`} onClick={() => download(f.key)}>
                  {busy === `export-${f.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {f.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {running ? (
        <div aria-busy="true"><TableSkeleton rows={6} /></div>
      ) : result && (
        result.rows.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-muted-foreground">No rows match this report.</CardContent></Card>
        ) : (
          <section className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {fmt.number(result.rows.length)} row{result.rows.length === 1 ? "" : "s"}
              {result.truncated ? ". Only the first rows are shown: add a filter or export a narrower report." : "."}
            </p>
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-[13px] text-muted-foreground">
                    <tr>{result.columns.map((c) => <th key={c.key} className={`px-3 py-2 font-medium ${c.type === "number" ? "text-right" : ""}`}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-t">
                        {row.map((v, j) => (
                          <td key={j} className={`px-3 py-2 ${result.columns[j].type === "number" ? "text-right tabular-nums" : ""}`}>
                            {cellText(v, result.columns[j].type, { number: (n) => fmt.number(n), date: (d) => fmt.date(d) })}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </section>
        )
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
      <ErrorAlert open={!!notice} title="Done" description={notice || ""} onOk={() => setNotice(null)} />
    </div>
  );
}
