"use client";

// Contact import from a CSV or Excel file. The browser reads the sheet; the API classifies every row (new,
// duplicate by email and then by name and phone, or not valid) for the preview, and checks again on import.

import { useState } from "react";
import {
  previewContactImport, importContacts,
  type ContactGroup, type ContactImportPreviewRow, type ContactScope,
} from "@/services/api";
import { errorText, label, mapSheetRows, type ContactImportRow } from "@/lib/contacts";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "@/components/icons";

const MAX_ROWS = 5000;
const STATUS_STYLE: Record<string, string> = {
  new: "bg-emerald-50 text-emerald-800",
  duplicate: "bg-amber-50 text-amber-800",
  invalid: "bg-rose-50 text-rose-800",
};

interface Props {
  open: boolean;
  onClose: () => void;
  scope: ContactScope;
  ownerId: number;
  groups: ContactGroup[];
  onDone: (message: string) => void;
}

export default function ContactImportDialog({ open, onClose, scope, ownerId, groups, onDone }: Props) {
  const [rows, setRows] = useState<ContactImportRow[] | null>(null);
  const [preview, setPreview] = useState<ContactImportPreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupId, setGroupId] = useState(0);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setRows(null); setPreview(null); setError(null); setGroupId(0); setUpdateExisting(false);
    onClose();
  };

  const readFile = async (file: File) => {
    setError(null); setPreview(null); setRows(null); setBusy(true);
    try {
      const XLSX = await import("xlsx-js-style");
      // CSV is read as text so names keep their accents; Excel files as bytes.
      const book = /\.csv$/i.test(file.name)
        ? XLSX.read(await file.text(), { type: "string" })
        : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]];
      const mapped = mapSheetRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }));
      if (mapped.length === 0) { setError("The file has no rows. Use a header row with Name, Email, Phone, Type, Organisation and Notes."); return; }
      if (mapped.length > MAX_ROWS) { setError(`Import at most ${MAX_ROWS} rows at a time.`); return; }
      setRows(mapped);
      setPreview(await previewContactImport(scope, ownerId, mapped));
    } catch (e) {
      setError(errorText(e, "Could not read the file. Save it as CSV or Excel and try again."));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await importContacts(scope, ownerId, rows, groupId || null, updateExisting);
      setRows(null); setPreview(null); setGroupId(0); setUpdateExisting(false);
      onDone(`Import finished: ${r.created} added, ${r.updated} updated, ${r.skipped} skipped, ${r.invalid} not valid.`);
    } catch (e) {
      setError(errorText(e, "Could not import the contacts."));
    } finally {
      setBusy(false);
    }
  };

  const count = (s: string) => preview?.filter((r) => r.status === s).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Import contacts</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            A CSV or Excel file with a header row: Name, Email, Phone, Type, Organisation, Notes. A row is a duplicate
            when its email, or its name and phone, match a contact you already have or an earlier row.
          </p>
          <input type="file" accept=".csv,.xlsx,.xls" aria-label="Contacts file" className="text-sm"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
          {busy && !preview && <TableSkeleton rows={4} />}
          {error && <p className="text-sm text-rose-700">{error}</p>}
          {preview && (
            <>
              <p className="text-sm text-slate-700">
                {count("new")} new, {count("duplicate")} duplicate, {count("invalid")} not valid
              </p>
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left uppercase text-slate-500">
                    <tr><th className="px-2 py-2">Row</th><th className="px-2 py-2">Name</th><th className="px-2 py-2">Email</th>
                      <th className="px-2 py-2">Phone</th><th className="px-2 py-2">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((r) => (
                      <tr key={r.row}>
                        <td className="px-2 py-1.5 text-slate-500">{r.row}</td>
                        <td className="px-2 py-1.5 text-slate-800">{r.name || "-"}</td>
                        <td className="px-2 py-1.5 text-slate-600">{r.email || "-"}</td>
                        <td className="px-2 py-1.5 text-slate-600">{r.mobile || "-"}</td>
                        <td className="px-2 py-1.5">
                          <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[r.status]}`}>{label(r.status)}</span>
                          {r.reason && <span className="ml-2 text-slate-500">{r.reason}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <label className="flex flex-wrap items-center gap-2">
                  Add to group
                  <select value={groupId} onChange={(e) => setGroupId(Number(e.target.value))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                    <option value={0}>No group</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-wrap items-center gap-2">
                  <Checkbox checked={updateExisting} onCheckedChange={(v) => setUpdateExisting(v === true)} />
                  Fill in missing details of duplicates
                </label>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button className="bg-azure text-white hover:bg-mint-ink" disabled={!preview || busy || count("new") + count("duplicate") === 0} onClick={run}>
            {busy && preview && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
