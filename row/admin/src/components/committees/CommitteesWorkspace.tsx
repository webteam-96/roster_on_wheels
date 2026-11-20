"use client";

/**
 * Enhanced committees (gap agent): the club's committees (sub groups) or the district's committees as a tree with
 * subcommittees at any depth, and for the chosen committee its members, private documents and message archive.
 * Managers move committees under other committees here; the API refuses loops and committees of another club,
 * district or year. Documents are stored outside the web root and fetched through the API after its access check.
 * Messages go out through the club's or district's mass email. Platform switch "committees".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FileText, FolderTree, Mail, Send, Trash2, Upload, Users } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AlertModal from "@/components/AlertModal";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { fmtDate } from "@/components/dashboard/formatters";
import { apiMessage } from "@/components/membership/FoundationDesignationsCard";
import {
  deleteCommitteePrivateDocument, downloadCommitteePrivateDocument, getCommitteeDetail, getCommitteeMessages,
  getCommitteePrivateDocuments, getCommitteeTree, getRotaryYears, sendCommitteeMessage, setCommitteeParent,
  uploadCommitteePrivateDocument,
  type CommitteeDetail, type CommitteeDocumentRow, type CommitteeKind, type CommitteeMessageRow, type CommitteeNode,
} from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** Committees in tree order with their depth. A committee whose parent is missing counts as top level. */
export function flattenTree(nodes: CommitteeNode[]): { node: CommitteeNode; depth: number }[] {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<number | null, CommitteeNode[]>();
  for (const n of nodes) {
    const key = n.parentId != null && ids.has(n.parentId) ? n.parentId : null;
    kids.set(key, [...(kids.get(key) ?? []), n]);
  }
  const out: { node: CommitteeNode; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const n of kids.get(parent) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The committee and every committee below it (it cannot move under any of them). */
export function subtreeIds(nodes: CommitteeNode[], id: number): Set<number> {
  const result = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId != null && result.has(n.parentId) && !result.has(n.id)) {
        result.add(n.id);
        grew = true;
      }
    }
  }
  return result;
}

export default function CommitteesWorkspace({ kind, scopeId }: { kind: CommitteeKind; scopeId: number }) {
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [nodes, setNodes] = useState<CommitteeNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRotaryYears()
      .then((ys) => {
        setYears(ys);
        setYearId((ys.find((y) => y.isCurrent) ?? ys[0])?.id ?? null);
      })
      .catch((err) => setLoadError(apiMessage(err, "Could not load the Rotary years.")));
  }, []);

  const load = useCallback(async () => {
    if (!yearId) return;
    setLoadError(null);
    try {
      setNodes(await getCommitteeTree(kind, scopeId, yearId));
    } catch (err) {
      setNodes([]);
      setLoadError(apiMessage(err, "Could not load the committees."));
    }
  }, [kind, scopeId, yearId]);

  useEffect(() => {
    setNodes(null);
    setSelected(null);
    load();
  }, [load]);

  const rows = useMemo(() => flattenTree(nodes ?? []), [nodes]);

  const move = async (id: number, parentId: number | null) => {
    setBusy(true);
    setMoveError(null);
    try {
      await setCommitteeParent(kind, id, parentId);
      await load();
    } catch (err) {
      setMoveError(apiMessage(err, "Could not move the committee."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          Put committees under other committees to build subcommittees. Documents and messages of a committee are
          visible only to its members and to the {kind === "club" ? "club's" : "district's"} administrators.
          {kind === "club" ? " Committees and their members are edited under Communication, Sub Groups." : " Committees and their members are edited under District Committee."}
        </p>
        <label className="space-y-1 text-xs font-semibold text-slate-700">
          <span className="block">Rotary year</span>
          <select className={selectClass} value={yearId ?? ""} onChange={(e) => setYearId(Number(e.target.value))}>
            {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="rounded-[20px] border border-slate-200 bg-card overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
            <FolderTree className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-800">Committees</h3>
          </header>
          <div className="p-4 space-y-3">
            {loadError && <p className="text-sm text-red-700" role="alert">{loadError}</p>}
            {moveError && <p className="text-sm text-red-700" role="alert">{moveError}</p>}
            {nodes === null ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : rows.length === 0 ? (
              !loadError && <p className="text-sm text-slate-500">No committees in this year yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map(({ node, depth }) => {
                  const blocked = subtreeIds(nodes, node.id);
                  return (
                    <li key={node.id} className="py-2" style={{ paddingLeft: `${depth * 18}px` }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(node.id)}
                          className={`min-w-0 text-left text-sm font-medium hover:underline ${selected === node.id ? "text-azure" : "text-slate-800"}`}
                          data-no-translate
                        >
                          {depth > 0 && <span className="text-slate-400" aria-hidden>{"> "}</span>}
                          {node.name}
                        </button>
                        <select
                          className={selectClass}
                          aria-label={`Parent of ${node.name}`}
                          disabled={busy}
                          value={node.parentId != null && nodes.some((n) => n.id === node.parentId) ? node.parentId : ""}
                          onChange={(e) => move(node.id, e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">Top level</option>
                          {nodes.filter((n) => !blocked.has(n.id)).map((n) => (
                            <option key={n.id} value={n.id}>Under {n.name}</option>
                          ))}
                        </select>
                      </div>
                      <p className="text-xs text-slate-500">
                        {node.memberCount} members, {node.documentCount} documents, {node.messageCount} messages
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {selected ? (
          <CommitteePanel key={`${kind}-${selected}`} kind={kind} id={selected} onSelect={setSelected} onChanged={load} />
        ) : (
          <section className="rounded-[20px] border border-dashed border-slate-200 p-6 text-sm text-slate-500">
            Choose a committee to see its members, documents and messages.
          </section>
        )}
      </div>
    </div>
  );
}

function CommitteePanel({ kind, id, onSelect, onChanged }: {
  kind: CommitteeKind; id: number; onSelect: (id: number) => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CommitteeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCommitteeDetail(kind, id).then(setDetail).catch((err) => setError(apiMessage(err, "Could not load the committee.")));
  }, [kind, id]);

  if (error) return <section className="rounded-[20px] border border-slate-200 p-4 text-sm text-red-700" role="alert">{error}</section>;
  if (!detail) {
    return (
      <section className="rounded-[20px] border border-slate-200 p-4 space-y-2" aria-busy="true">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[20px] border border-slate-200 bg-card p-4 space-y-3">
        <nav aria-label="Committee path" className="flex flex-wrap items-center gap-1 text-xs text-slate-500" data-no-translate>
          {detail.path.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              {c.id === detail.id ? <span className="font-semibold text-slate-800">{c.name}</span>
                : <button type="button" className="hover:underline" onClick={() => onSelect(c.id)}>{c.name}</button>}
            </span>
          ))}
        </nav>
        {detail.children.length > 0 && (
          <p className="text-xs text-slate-600">
            Subcommittees:{" "}
            {detail.children.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <button type="button" className="text-azure hover:underline" onClick={() => onSelect(c.id)} data-no-translate>{c.name}</button>
              </span>
            ))}
          </p>
        )}
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Users className="h-4 w-4" /> Members</h4>
          {detail.members.length === 0 ? (
            <p className="text-sm text-slate-500">No members yet.</p>
          ) : (
            <ul className="mt-1 grid gap-x-4 sm:grid-cols-2 text-sm" data-no-translate>
              {detail.members.map((m, i) => (
                <li key={`${m.memberId ?? "x"}-${i}`} className="truncate">
                  {m.name}{m.designation ? <span className="text-slate-500">, {m.designation}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <DocumentsCard kind={kind} id={id} onChanged={onChanged} />
      <MessagesCard kind={kind} id={id} onChanged={onChanged} />
    </div>
  );
}

function DocumentsCard({ kind, id, onChanged }: { kind: CommitteeKind; id: number; onChanged: () => void }) {
  const [docs, setDocs] = useState<CommitteeDocumentRow[] | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CommitteeDocumentRow | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setDocs(await getCommitteePrivateDocuments(kind, id));
    } catch (err) {
      setDocs([]);
      setError(apiMessage(err, "Could not load the documents."));
    }
  }, [kind, id]);

  useEffect(() => { load(); }, [load]);

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
    } catch (err) {
      setError(apiMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const upload = () => run(async () => {
    if (!file) return;
    await uploadCommitteePrivateDocument(kind, id, title.trim(), file);
    setTitle("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }, "Could not upload the document.");

  const download = async (d: CommitteeDocumentRow) => {
    setError(null);
    try {
      await downloadCommitteePrivateDocument(kind, id, d);
    } catch (err) {
      setError(apiMessage(err, "Could not download the document."));
    }
  };

  return (
    <section className="rounded-[20px] border border-slate-200 overflow-hidden bg-card">
      <header className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <FileText className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Private documents</h3>
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
                  <span className="block font-medium text-slate-800" data-no-translate>{d.title}</span>
                  <span className="block truncate text-xs text-slate-500">
                    <span data-no-translate>{d.originalName}</span>, {Math.max(1, Math.round(d.sizeBytes / 1024))} KB, {d.uploadedByName ?? "Unknown"}, {fmtDate(d.createdDate)}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => download(d)} aria-label={`Download ${d.title}`}>
                    <Download className="h-4 w-4" />
                  </Button>
                  {d.canDelete && (
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(d)} aria-label={`Remove ${d.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </span>
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
            <span>File (PDF, Word, Excel, PowerPoint, JPG, PNG; up to 20 MB)</span>
            <Input
              ref={fileInput}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png"
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
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) run(() => deleteCommitteePrivateDocument(kind, id, target.id), "Could not remove the document.");
        }}
        cancelLabel="Cancel"
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}

function MessagesCard({ kind, id, onChanged }: { kind: CommitteeKind; id: number; onChanged: () => void }) {
  const [messages, setMessages] = useState<CommitteeMessageRow[] | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMessages(await getCommitteeMessages(kind, id));
    } catch (err) {
      setMessages([]);
      setError(apiMessage(err, "Could not load the messages."));
    }
  }, [kind, id]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendCommitteeMessage(kind, id, subject.trim(), body.trim());
      setSubject("");
      setBody("");
      setNotice("Message sent to the committee. Delivery status updates in the archive.");
      await load();
      onChanged();
    } catch (err) {
      setError(apiMessage(err, "Could not send the message."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[20px] border border-slate-200 overflow-hidden bg-card">
      <header className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <Mail className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Committee email</h3>
      </header>
      <div className="p-4 space-y-4">
        <div className="space-y-3">
          <label className="block space-y-1 text-xs font-semibold text-slate-700">
            <span>Subject</span>
            <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-slate-700">
            <span>Message</span>
            <Textarea rows={5} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Sent to every member of this committee through mass email (uses email credits).</p>
            <Button type="button" onClick={send} disabled={busy || !subject.trim() || !body.trim()}>
              <Send className="h-4 w-4 mr-1" /> Send
            </Button>
          </div>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-700">Archive</h4>
          {messages === null ? (
            <div className="mt-2 space-y-2" aria-busy="true">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : messages.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No messages yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100">
              {messages.map((m) => (
                <li key={m.id} className="py-2 text-sm">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-medium text-slate-800" data-no-translate>{m.subject}</span>
                      <span className="block text-xs text-slate-500">
                        <span data-no-translate>{m.sentByName ?? "Unknown"}</span>, {fmtDate(m.createdDate)}, {m.status ?? "Unknown"}
                        {m.totalRecipients > 0 ? `, ${m.sentCount} of ${m.totalRecipients} delivered` : ""}
                      </span>
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-slate-700" data-no-translate>{m.body}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
