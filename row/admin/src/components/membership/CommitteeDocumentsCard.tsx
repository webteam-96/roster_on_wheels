"use client";

/**
 * Documents of a district committee or sub-committee (build spec 3.12): list, upload, remove. Uploading and
 * removing need a district manager; the API refuses anyone else. Hidden when the membership_fields module is off.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, Trash2, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AlertModal from "@/components/AlertModal";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { fmtDate } from "@/components/dashboard/formatters";
import { useFeatureOn } from "@/components/FeatureGate";
import {
  getCommitteeDocuments, getPhotoUrl, removeCommitteeDocument, uploadCommitteeDocument,
  type CommitteeDocument, type CommitteeRef,
} from "@/services/api";
import { apiMessage } from "./FoundationDesignationsCard";

/** Pass groupId for a committee, or subGroupId for one of its sub-committees. */
export default function CommitteeDocumentsCard({ districtId, groupId, subGroupId }: { districtId: number; groupId?: number; subGroupId?: number }) {
  const on = useFeatureOn("membership_fields");
  const [docs, setDocs] = useState<CommitteeDocument[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CommitteeDocument | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const committee: CommitteeRef | null = subGroupId ? { subGroupId } : groupId ? { groupId } : null;

  const load = useCallback(async () => {
    try {
      setDocs(await getCommitteeDocuments(districtId, subGroupId ? { subGroupId } : { groupId: groupId ?? 0 }));
    } catch {
      setHidden(true); // module off (404) or no access (403)
    }
  }, [districtId, groupId, subGroupId]);

  useEffect(() => {
    if (on && districtId > 0 && (groupId || subGroupId)) load();
  }, [on, districtId, groupId, subGroupId, load]);

  if (!on || hidden || !(districtId > 0) || !committee) return null;

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadCommitteeDocument(districtId, committee, title.trim(), file);
      setTitle("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (err) {
      setError(apiMessage(err, err instanceof Error && err.message ? err.message : "Could not upload the document."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    const target = removing;
    setRemoving(null);
    setBusy(true);
    setError(null);
    try {
      await removeCommitteeDocument(districtId, target.id);
      await load();
    } catch (err) {
      setError(apiMessage(err, "Could not remove the document."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[20px] border border-slate-200 overflow-hidden bg-white">
      <header className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <FileText className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Documents</h3>
      </header>
      <div className="p-4 space-y-4">
        {docs === null ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : docs.length === 0 ? (
          <p className="text-sm text-slate-500">No documents yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <a href={getPhotoUrl(d.url)} target="_blank" rel="noopener noreferrer" className="font-medium text-azure hover:underline">
                    {d.title}
                  </a>
                  <span className="block truncate text-xs text-slate-500">
                    {d.originalFileName ? `${d.originalFileName} · ` : ""}{fmtDate(d.createdDate)}
                  </span>
                </span>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(d)} aria-label={`Remove ${d.title}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="space-y-1 text-xs font-semibold text-slate-700">
            <span>Title</span>
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-700">
            <span>File (PDF, Word, Excel, PowerPoint)</span>
            <Input
              ref={fileInput}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button type="button" onClick={upload} disabled={busy || !file || !title.trim()}>
            <Upload className="h-4 w-4 mr-1" /> Upload
          </Button>
        </div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>

      <AlertModal
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Remove document"
        description={removing ? `Remove ${removing.title}?` : ""}
        confirmLabel="Remove"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={remove}
        cancelLabel="Cancel"
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
