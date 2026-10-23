"use client";

/**
 * Club Admin Dashboard › Grants › one application: the form while the club may change it, files, the next step
 * (submit, send information, resubmit, final report, cancel) and the history. Flagged module "grants".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import ErrorAlert from "@/components/ErrorAlert";
import GrantForm from "@/components/grants/GrantForm";
import { ActionPanel, AttachmentList, DetailSkeleton, GrantHeader, GrantHistory, GrantSummary } from "@/components/grants/GrantParts";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteGrantAttachment, getGrantApplication, grantAction, grantComment, updateGrantApplication, uploadGrantAttachment,
} from "@/services/api";
import { STATUS_LABEL } from "@/lib/grants";
import type { GrantActionBody, GrantApplication, SaveGrantApplication } from "@/types/grants";

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png";

export default function ClubGrantApplicationPage() {
  const { selectedClubId: clubId } = useAuth();
  const id = Number(useParams().applicationId);
  const [app, setApp] = useState<GrantApplication | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<SaveGrantApplication | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!clubId || !id) return;
    setApp(null);
    getGrantApplication("club", clubId, id).then(setApp).catch(() => setMissing(true));
  }, [clubId, id]);

  const onChange = useCallback((body: SaveGrantApplication) => {
    pending.current = body;
  }, []);

  const run = async (work: () => Promise<GrantApplication>, done: (a: GrantApplication) => string) => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await work();
      setApp(next);
      setNotice(done(next));
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  if (missing) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm">This grant application was not found for your club.</p>
        <Link href="/club-admin-dashboard/grants" className="text-sm text-primary underline">Back to grants</Link>
      </div>
    );
  }
  if (!app) return <div className="p-6"><DetailSkeleton /></div>;

  // A submit sends what is on screen: the open form is saved first.
  const act = (action: string, body: GrantActionBody) => run(async () => {
    if (app.editable && pending.current) await updateGrantApplication(clubId, id, pending.current);
    return grantAction("club", clubId, id, action, body);
  }, (a) => `Done. The application is now ${STATUS_LABEL[a.status].toLowerCase()}.`);

  const upload = (file: File) => run(async () => {
    await uploadGrantAttachment(clubId, id, file);
    return getGrantApplication("club", clubId, id);
  }, () => "File added.");

  const remove = (attachmentId: number) => {
    if (!window.confirm("Remove this file?")) return;
    run(async () => {
      await deleteGrantAttachment(clubId, id, attachmentId);
      return getGrantApplication("club", clubId, id);
    }, () => "File removed.");
  };

  return (
    <div className="space-y-5 p-6">
      <Button variant="outline" size="sm" asChild className="gap-1.5">
        <Link href="/club-admin-dashboard/grants"><ArrowLeft className="h-4 w-4" /> All grant applications</Link>
      </Button>
      <GrantHeader app={app} />
      {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

      {app.editable ? (
        <GrantForm key={app.updatedAt} app={app} clubId={clubId} busy={busy} onChange={onChange}
          onSave={(body) => run(() => updateGrantApplication(clubId, id, body), () => "Saved.")} />
      ) : (
        <GrantSummary app={app} />
      )}

      <AttachmentList app={app} side="club" scopeId={clubId} onDelete={app.attachmentKind ? remove : undefined}>
        {app.attachmentKind && (
          <div className="space-y-1">
            <input ref={fileInput} type="file" accept={ACCEPT} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
            <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> {app.attachmentKind === "report" ? "Add a report file" : "Add a file"}
            </Button>
            <p className="text-xs text-muted-foreground">PDF, Word, Excel, PowerPoint, JPG or PNG, up to 20 MB. At most 20 files.</p>
          </div>
        )}
      </AttachmentList>

      <ActionPanel key={`${app.status}-${app.events.length}`} app={app} busy={busy} onAct={act}
        onComment={(comment) => run(() => grantComment("club", clubId, id, comment), () => "Comment posted.")} />
      <GrantHistory app={app} />

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
