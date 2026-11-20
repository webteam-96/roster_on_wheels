"use client";

/**
 * Mass email compose tools (club and district): template library with merge fields, the sender's own signature and
 * attachments. Files picked before the email exists wait in `pendingFiles`; the page uploads them with
 * uploadPendingAttachments once it has the email id.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMassEmailTemplates, createMassEmailTemplate, updateMassEmailTemplate, deleteMassEmailTemplate,
  getMassEmailAttachments, uploadMassEmailAttachment, deleteMassEmailAttachment, downloadMassEmailAttachment,
  getMassEmailSignature, saveMassEmailSignature,
  type CommsScope, type MassEmailTemplateLibrary, type MassEmailAttachment,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RichTextEditor from "@/components/RichTextEditor";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Copy, Download, FileText, Loader2, Paperclip, Save, Trash2, X } from "@/components/icons";

export const ATTACHMENT_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".ics", ".jpg", ".jpeg", ".png", ".gif"];
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/** Null when the file can join the list; otherwise why not (the server checks again, including the content). */
export function attachmentProblem(file: { name: string; size: number }, already: { size: number }[]): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!file.name.includes(".") || !ATTACHMENT_EXTENSIONS.includes(ext)) return `${file.name}: this file type cannot be attached.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}: each file can be 5 MB at most.`;
  if (already.length >= MAX_FILES) return `An email can carry ${MAX_FILES} files at most.`;
  if (already.reduce((s, f) => s + f.size, 0) + file.size > MAX_TOTAL_BYTES) return "All attachments together can be 10 MB at most.";
  return null;
}

export async function uploadPendingAttachments(scope: CommsScope, ownerId: number, emailId: number, files: File[]): Promise<void> {
  for (const f of files) await uploadMassEmailAttachment(scope, ownerId, emailId, f);
}

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

interface ComposeToolsProps {
  scope: CommsScope;
  ownerId: number;
  emailId: number | null;
  subject: string;
  body: string;
  onApply: (subject: string, body: string) => void;
  pendingFiles: File[];
  onPendingFiles: (files: File[]) => void;
}

export default function ComposeTools({ scope, ownerId, emailId, subject, body, onApply, pendingFiles, onPendingFiles }: ComposeToolsProps) {
  const [library, setLibrary] = useState<MassEmailTemplateLibrary | null | undefined>(undefined); // undefined: loading, null: failed
  const [picked, setPicked] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const [signature, setSignature] = useState<string | null>(null);
  const [editingSig, setEditingSig] = useState(false);
  const [sigDraft, setSigDraft] = useState("");

  const [attachments, setAttachments] = useState<MassEmailAttachment[] | null>(emailId ? null : []);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadLibrary = useCallback(() => {
    getMassEmailTemplates(scope, ownerId).then(setLibrary).catch(() => setLibrary(null));
  }, [scope, ownerId]);
  useEffect(() => { if (ownerId) loadLibrary(); }, [ownerId, loadLibrary]);
  useEffect(() => { getMassEmailSignature().then((s) => setSignature(s.html)).catch(() => setSignature("")); }, []);
  useEffect(() => {
    if (!emailId || !ownerId) return;
    getMassEmailAttachments(scope, ownerId, emailId).then(setAttachments).catch(() => { setAttachments([]); setNote({ ok: false, text: "Could not load the attachments." }); });
  }, [scope, ownerId, emailId]);

  const all = library ? [...library.starters.map((t) => ({ ...t, ref: `s:${t.key}` })), ...library.saved.map((t) => ({ ...t, ref: `t:${t.id}` }))] : [];
  const current = all.find((t) => t.ref === picked);

  const run = async (work: () => Promise<string>) => {
    setBusy(true); setNote(null);
    try { setNote({ ok: true, text: await work() }); } catch (e) { setNote({ ok: false, text: errText(e, "That did not work. Try again.") }); }
    setBusy(false);
  };

  const useTemplate = () => {
    if (!current) return;
    const hasText = subject.trim() !== "" || body.replace(/<[^>]*>/g, "").trim() !== "";
    if (hasText && !window.confirm("Replace the subject and body you have typed with this template?")) return;
    onApply(current.subject, current.bodyHtml);
    setNote({ ok: true, text: `Template "${current.name}" applied. Edit it as you like before sending.` });
  };

  const saveAsNew = () => run(async () => {
    const name = newName.trim();
    const { id } = await createMassEmailTemplate(scope, ownerId, { name, subject, bodyHtml: body });
    setNewName(""); loadLibrary(); setPicked(`t:${id}`);
    return `Saved as template "${name}".`;
  });

  const overwrite = () => current && !current.isStarter && run(async () => {
    await updateMassEmailTemplate(scope, ownerId, current.id, { name: current.name, subject, bodyHtml: body });
    loadLibrary();
    return `Template "${current.name}" updated with this subject and body.`;
  });

  const remove = () => current && !current.isStarter && window.confirm(`Delete the template "${current.name}"?`) && run(async () => {
    await deleteMassEmailTemplate(scope, ownerId, current.id);
    setPicked(""); loadLibrary();
    return "Template deleted.";
  });

  const copyToken = async (token: string) => {
    try { await navigator.clipboard.writeText(token); setNote({ ok: true, text: `${token} copied. Paste it into the subject or body.` }); }
    catch { setNote({ ok: false, text: `Copy did not work. Type ${token} into the subject or body.` }); }
  };

  const addSignature = () => { if (signature) onApply(subject, `${body}<p><br></p>${signature}`); };

  const saveSignature = () => run(async () => {
    const saved = await saveMassEmailSignature(sigDraft);
    setSignature(saved.html); setEditingSig(false);
    return "Your signature is saved.";
  });

  const pickFiles = async (list: FileList | null) => {
    if (!list) return;
    const existing = [...(attachments ?? []).map((a) => ({ size: a.sizeBytes })), ...pendingFiles.map((f) => ({ size: f.size }))];
    const accepted: File[] = [];
    for (const f of Array.from(list)) {
      const problem = attachmentProblem(f, [...existing, ...accepted]);
      if (problem) { setNote({ ok: false, text: problem }); continue; }
      accepted.push(f);
    }
    if (fileInput.current) fileInput.current.value = "";
    if (accepted.length === 0) return;
    if (emailId) {
      await run(async () => {
        for (const f of accepted) {
          const added = await uploadMassEmailAttachment(scope, ownerId, emailId, f);
          setAttachments((prev) => [...(prev ?? []), added]);
        }
        return accepted.length === 1 ? `${accepted[0].name} attached.` : `${accepted.length} files attached.`;
      });
    } else {
      onPendingFiles([...pendingFiles, ...accepted]);
    }
  };

  const removeAttachment = (a: MassEmailAttachment) => emailId && run(async () => {
    await deleteMassEmailAttachment(scope, ownerId, emailId, a.id);
    setAttachments((prev) => (prev ?? []).filter((x) => x.id !== a.id));
    return `${a.fileName} removed.`;
  });

  const download = async (a: MassEmailAttachment) => {
    if (!emailId) return;
    try {
      const url = URL.createObjectURL(await downloadMassEmailAttachment(scope, ownerId, emailId, a.id));
      const link = document.createElement("a"); link.href = url; link.download = a.fileName; link.click();
      URL.revokeObjectURL(url);
    } catch (e) { setNote({ ok: false, text: errText(e, "Could not download the file.") }); }
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-3">
      {/* Templates */}
      <section className="space-y-2" aria-label="Templates">
        <p className="text-sm font-medium text-slate-700">Templates</p>
        {library === undefined && <Skeleton className="h-10 w-full md:w-96" />}
        {library === null && <p className="text-sm text-red-700">Templates could not be loaded. <button type="button" className="underline" onClick={loadLibrary}>Try again</button></p>}
        {library && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Template" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm md:w-96" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">Pick a template</option>
              <optgroup label="ROW starters">
                {library.starters.map((t) => <option key={t.key} value={`s:${t.key}`}>{t.name}</option>)}
              </optgroup>
              <optgroup label={scope === "clubs" ? "Saved by your club" : "Saved by your district"}>
                {library.saved.length === 0 ? <option disabled value="none">None saved yet</option>
                  : library.saved.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}
              </optgroup>
            </select>
            <Button type="button" variant="outline" disabled={!current || busy} onClick={useTemplate}><FileText className="mr-2 h-4 w-4" />Use template</Button>
            {current && !current.isStarter && (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={overwrite}><Save className="mr-2 h-4 w-4" />Update with current text</Button>
                <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={remove}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
              </>
            )}
          </div>
        )}
        {library && (
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="New template name" className="md:w-72" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} placeholder="Name for a new template" />
            <Button type="button" variant="outline" disabled={busy || !newName.trim()} onClick={saveAsNew}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save subject and body as template
            </Button>
          </div>
        )}
        {library && (
          <div className="space-y-1">
            <p className="text-xs text-slate-500">Merge fields: each recipient gets their own value when the email is sent.</p>
            <div className="flex flex-wrap gap-2">
              {library.mergeFields.map((f) => (
                <button key={f.token} type="button" onClick={() => copyToken(f.token)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                  <Copy className="h-3 w-3" />{f.label} <code className="text-slate-500">{f.token}</code>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Signature */}
      <section className="space-y-2 border-t border-slate-200 pt-3" aria-label="Signature">
        <p className="text-sm font-medium text-slate-700">My signature</p>
        {signature === null ? <Skeleton className="h-8 w-64" /> : editingSig ? (
          <div className="space-y-2">
            <RichTextEditor value={sigDraft} onChange={setSigDraft} placeholder="Your name, role and contact details" height={120} />
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={saveSignature}><Save className="mr-2 h-4 w-4" />Save signature</Button>
              <Button type="button" variant="ghost" onClick={() => setEditingSig(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={!signature} onClick={addSignature}>Add my signature to the body</Button>
            <Button type="button" variant="ghost" onClick={() => { setSigDraft(signature); setEditingSig(true); }}>{signature ? "Edit my signature" : "Create my signature"}</Button>
            {!signature && <span className="text-xs text-slate-500">You have no signature yet.</span>}
          </div>
        )}
      </section>

      {/* Attachments */}
      <section className="space-y-2 border-t border-slate-200 pt-3" aria-label="Attachments">
        <p className="text-sm font-medium text-slate-700">Attachments</p>
        <p className="text-xs text-slate-500">Up to {MAX_FILES} files, 5 MB each and 10 MB in all. PDF, Word, Excel, PowerPoint, text, CSV, calendar, JPG, PNG or GIF.</p>
        {attachments === null ? <Skeleton className="h-8 w-full" /> : (
          <ul className="divide-y rounded-md border border-slate-200 text-sm">
            {attachments.length === 0 && pendingFiles.length === 0 && <li className="px-3 py-2 text-slate-500">No files attached.</li>}
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                <Paperclip className="h-4 w-4 text-slate-500" />
                <span className="min-w-0 flex-1 truncate">{a.fileName}</span>
                <span className="text-xs text-slate-500">{sizeLabel(a.sizeBytes)}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Download ${a.fileName}`} onClick={() => download(a)}><Download className="h-4 w-4" /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${a.fileName}`} disabled={busy} onClick={() => removeAttachment(a)}><X className="h-4 w-4" /></Button>
              </li>
            ))}
            {pendingFiles.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <Paperclip className="h-4 w-4 text-slate-500" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-slate-500">{sizeLabel(f.size)}, uploads when you save</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${f.name}`} onClick={() => onPendingFiles(pendingFiles.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
        <input ref={fileInput} type="file" multiple className="hidden" accept={ATTACHMENT_EXTENSIONS.join(",")} onChange={(e) => pickFiles(e.target.files)} />
        <Button type="button" variant="outline" disabled={busy || attachments === null} onClick={() => fileInput.current?.click()}>
          <Paperclip className="mr-2 h-4 w-4" />Attach files
        </Button>
      </section>

      {note && <p role="status" className={`text-sm ${note.ok ? "text-slate-600" : "text-red-700"}`}>{note.text}</p>}
    </div>
  );
}
