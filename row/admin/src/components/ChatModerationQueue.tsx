"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getChatReports, resolveChatReport, setChatMemberMuted, setChatMessageHidden, type ChatReport,
} from "@/services/api";
import { useFormat } from "@/hooks/useFormat";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw } from "@/components/icons";

type Status = "open" | "resolved";

const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

interface Props {
  scope: "clubs" | "districts";
  /** The club or district; null while the dashboard has not picked one. */
  ownerId: number | null;
}

/**
 * Chat moderation queue (build spec 3.10, flag chat): messages that members reported in the club's or district's
 * chats. A moderator hides the message, mutes its sender in that chat and resolves the report; the API writes each
 * action to the audit log. Moderators see the reported message only, never the whole chat. Message text is plain
 * text typed by members and is rendered as text.
 */
export default function ChatModerationQueue({ scope, ownerId }: Props) {
  const fmt = useFormat();
  const [status, setStatus] = useState<Status>("open");
  const [reports, setReports] = useState<ChatReport[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!ownerId) return;
    setReports(null);
    getChatReports(scope, ownerId, status)
      .then(setReports)
      .catch((err) => {
        setReports([]);
        setErrorMessage(apiMessage(err, "Could not load the reports."));
      });
  }, [scope, ownerId, status]);

  useEffect(load, [load]);

  const patch = (match: (x: ChatReport) => boolean, change: Partial<ChatReport>) =>
    setReports((list) => list?.map((x) => (match(x) ? { ...x, ...change } : x)) ?? null);

  async function run(r: ChatReport, action: () => Promise<void>, done: () => void, failure: string) {
    setBusy(r.id);
    try {
      await action();
      done();
    } catch (err) {
      setErrorMessage(apiMessage(err, failure));
    } finally {
      setBusy(null);
    }
  }

  const toggleHidden = (r: ChatReport) => run(r,
    () => setChatMessageHidden(scope, ownerId!, r.messageId, !r.hidden),
    () => patch((x) => x.messageId === r.messageId, { hidden: !r.hidden }),
    "Could not change the message.");

  const toggleMuted = (r: ChatReport) => run(r,
    () => setChatMemberMuted(scope, ownerId!, r.conversationId, r.senderId, !r.senderMuted),
    () => patch((x) => x.conversationId === r.conversationId && x.senderId === r.senderId, { senderMuted: !r.senderMuted }),
    "Could not change the mute.");

  // Resolving closes every open report of the same message.
  const resolve = (r: ChatReport) => run(r,
    () => resolveChatReport(scope, ownerId!, r.id, notes[r.id]?.trim() ?? ""),
    () => setReports((list) => list?.filter((x) => x.messageId !== r.messageId) ?? null),
    "Could not resolve the report.");

  if (!ownerId) {
    return <p className="p-6 text-sm text-muted-foreground">Choose a {scope === "clubs" ? "club" : "district"} first.</p>;
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Chat moderation</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Messages that members reported in your {scope === "clubs" ? "club's" : "district's"} chats. Hide a message,
            mute its sender in that chat, then resolve the report. You see the reported message only, never the whole chat.
          </p>
        </div>
        <Button variant="outline" onClick={load} className="gap-1.5">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div role="tablist" aria-label="Reports" className="inline-flex gap-1 rounded-md border p-1">
        {(["open", "resolved"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {s === "open" ? "Open" : "Resolved"}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {reports == null ? (
            <div className="space-y-3 p-4" aria-busy="true">
              {[0, 1, 2].map((n) => <div key={n} className="h-28 w-full animate-pulse rounded-md bg-muted" />)}
            </div>
          ) : reports.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {status === "open" ? "No open reports." : "No resolved reports yet."}
            </p>
          ) : (
            <ul className="divide-y">
              {reports.map((r) => (
                <li key={r.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium" data-no-translate>{r.senderName ?? "Former member"}</span>
                    <span className="text-muted-foreground">
                      in {r.conversationKind === "group" ? <span data-no-translate>{r.conversationTitle}</span> : "a direct chat"}
                      {" · "}{fmt.dateTime(r.messageAt)}
                    </span>
                    {r.hidden && <Badge variant="secondary">Hidden from members</Badge>}
                    {r.senderMuted && <Badge variant="secondary">Sender muted in this chat</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-sm" data-no-translate>
                    {r.messageBody}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Reported by <span data-no-translate>{r.reporterName ?? "a former member"}</span> on {fmt.dateTime(r.reportedAt)}
                    {r.reason ? <>: <span className="text-foreground" data-no-translate>{r.reason}</span></> : ", no reason given."}
                  </p>
                  {r.resolvedAt && (
                    <p className="text-sm text-muted-foreground">
                      Resolved by <span data-no-translate>{r.resolvedByName ?? "a former member"}</span> on {fmt.dateTime(r.resolvedAt)}
                      {r.resolution && <>: <span className="text-foreground" data-no-translate>{r.resolution}</span></>}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => toggleHidden(r)}>
                      {r.hidden ? "Show message again" : "Hide message"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => toggleMuted(r)}>
                      {r.senderMuted ? "Unmute sender" : "Mute sender in this chat"}
                    </Button>
                    {status === "open" && (
                      <>
                        <Input className="h-9 w-full sm:w-72" maxLength={500} placeholder="Note for the record (optional)"
                          aria-label="Note for the record" value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                        <Button size="sm" disabled={busy === r.id} onClick={() => resolve(r)}>Resolve</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}
