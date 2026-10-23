"use client";

/**
 * Grants (api/Services/GrantService.cs): pieces shared by the club and district application pages. The server
 * decides which transitions the viewer may make (app.actions); these components only render them.
 */

import { useState, type ReactNode } from "react";
import { Download, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import { downloadGrantAttachment, type GrantSide } from "@/services/api";
import { ACTION_LABEL, EVENT_LABEL, PAYMENT_METHODS, STATUS_LABEL, STATUS_TONE, budgetTotals } from "@/lib/grants";
import type { GrantActionBody, GrantActionInfo, GrantApplication, GrantStatus } from "@/types/grants";

export function StatusBadge({ status }: { status: GrantStatus }) {
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

/** Title, club, year and status above an application. */
export function GrantHeader({ app }: { app: GrantApplication }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-primary">{app.title}</h2>
        <StatusBadge status={app.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        {app.clubName}, Rotary year {app.yearLabel}
        {app.createdByName ? `. Started by ${app.createdByName}` : ""}
      </p>
      {app.status === "rejected" && app.rejectionReason && (
        <p className="text-sm text-red-700" role="status">Reason: {app.rejectionReason}</p>
      )}
    </div>
  );
}

/** The application as submitted: project, budget, partners, members, report, payments. */
export function GrantSummary({ app }: { app: GrantApplication }) {
  const fmt = useFormat();
  const totals = budgetTotals(app.lines);
  const field = (label: string, value: ReactNode) =>
    value === null || value === undefined || value === "" ? null : (
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm">{value}</dd>
      </div>
    );
  const lines = (kind: "income" | "expense") => app.lines.filter((l) => l.kind === kind);
  const partners = app.lines.filter((l) => l.kind === "partner");

  return (
    <>
      <Section title="Project">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field("Location", app.location)}
          {field("Starts", app.startDate && fmt.date(app.startDate))}
          {field("Ends", app.endDate && fmt.date(app.endDate))}
          {field("Beneficiaries", app.beneficiaries != null && fmt.number(app.beneficiaries))}
          {field("Amount requested", fmt.money(app.amountRequested))}
          {field("Amount approved", app.amountApproved != null && fmt.money(app.amountApproved))}
        </dl>
        {app.description && <p className="whitespace-pre-line text-sm">{app.description}</p>}
      </Section>

      <Section title="Budget">
        <div className="grid gap-4 md:grid-cols-2">
          {(["income", "expense"] as const).map((kind) => (
            <div key={kind}>
              <p className="mb-1 text-sm font-medium">{kind === "income" ? "Other income" : "Expenses"}</p>
              {lines(kind).length === 0 ? (
                <p className="text-sm text-muted-foreground">None listed.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {lines(kind).map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-2">{l.description}{l.detail ? <span className="block text-xs text-muted-foreground">{l.detail}</span> : null}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt.money(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Expenses {fmt.money(totals.expense)}, other income {fmt.money(totals.income)}, left to fund {fmt.money(totals.gap)}.
        </p>
      </Section>

      <Section title="Partners">
        {partners.length === 0 ? (
          <p className="text-sm text-muted-foreground">No partners listed.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {partners.map((p, i) => (
              <li key={i}>
                <span className="font-medium">{p.description}</span>
                {p.detail ? `: ${p.detail}` : ""}
                {p.amount != null ? ` (${fmt.money(p.amount)})` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Qualified members">
        {app.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members listed.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {app.members.map((m) => (
              <li key={m.memberId}>
                {m.memberName ?? `Member ${m.memberId}`}
                {m.note ? <span className="text-muted-foreground">: {m.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {app.reportSummary && (
        <Section title="Final report">
          <dl className="grid gap-3 sm:grid-cols-3">
            {field("Submitted", app.reportSubmittedAt && fmt.date(app.reportSubmittedAt))}
            {field("Amount spent", app.reportAmountSpent != null && fmt.money(app.reportAmountSpent))}
            {field("Beneficiaries reached", app.reportBeneficiaries != null && fmt.number(app.reportBeneficiaries))}
          </dl>
          <p className="whitespace-pre-line text-sm">{app.reportSummary}</p>
        </Section>
      )}

      {app.payments.length > 0 && (
        <Section title="Payments">
          <PaymentsTable app={app} />
        </Section>
      )}
    </>
  );
}

export function PaymentsTable({ app }: { app: GrantApplication }) {
  const fmt = useFormat();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">Date</th>
            <th className="py-2 font-medium">Method</th>
            <th className="py-2 font-medium">Reference</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {app.payments.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="py-2">{fmt.date(p.paidOn)}</td>
              <td className="py-2">{PAYMENT_METHODS[p.method] ?? p.method}</td>
              <td className="py-2">{p.reference ?? ""}{p.note ? <span className="block text-xs text-muted-foreground">{p.note}</span> : null}</td>
              <td className="py-2 text-right tabular-nums">{fmt.money(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-muted-foreground">
        Paid {fmt.money(app.paid)} of {fmt.money(app.amountApproved ?? 0)} approved.
      </p>
    </div>
  );
}

/** Files on the application; the club may remove the ones of the kind it can still change. */
export function AttachmentList({ app, side, scopeId, onDelete, children }: {
  app: GrantApplication;
  side: GrantSide;
  scopeId: number;
  onDelete?: (attachmentId: number) => void;
  children?: ReactNode;
}) {
  const fmt = useFormat();
  const [error, setError] = useState<string | null>(null);
  const download = async (id: number) => {
    setError(null);
    try {
      await downloadGrantAttachment(side, scopeId, app.id, app.attachments.find((a) => a.id === id)!);
    } catch {
      setError("Could not download the file.");
    }
  };
  return (
    <Section title="Files">
      {app.attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {app.attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-all">
                {a.originalName}
                <span className="block text-xs text-muted-foreground">
                  {a.kind === "report" ? "Report" : "Application"}, {Math.max(1, Math.round(a.sizeBytes / 1024))} KB, {fmt.date(a.createdDate)}
                </span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => download(a.id)}>
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
                {onDelete && app.attachmentKind === a.kind && (
                  <Button size="sm" variant="ghost" aria-label={`Remove ${a.originalName}`} onClick={() => onDelete(a.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {children}
    </Section>
  );
}

export function GrantHistory({ app }: { app: GrantApplication }) {
  const fmt = useFormat();
  return (
    <Section title="History and comments">
      {app.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet. The history starts when the club submits.</p>
      ) : (
        <ol className="space-y-3">
          {[...app.events].reverse().map((e) => (
            <li key={e.id} className="border-b pb-3 text-sm last:border-0 last:pb-0">
              <p>
                <span className="font-medium">{e.memberName ?? "Someone"}</span>
                <span className="text-muted-foreground"> ({e.side})</span> {EVENT_LABEL[e.action] ?? e.action}
                {e.toStatus && e.toStatus !== e.fromStatus ? `. Now ${STATUS_LABEL[e.toStatus].toLowerCase()}.` : ""}
              </p>
              {e.comment && <p className="mt-1 whitespace-pre-line text-muted-foreground">{e.comment}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{fmt.dateTime(e.createdDate)}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** The transitions the server allows the viewer, plus a comment. Approve asks for an amount, the final report for its fields. */
export function ActionPanel({ app, busy, onAct, onComment }: {
  app: GrantApplication;
  busy: boolean;
  onAct: (action: string, body: GrantActionBody) => void;
  onComment: (comment: string) => void;
}) {
  const fmt = useFormat();
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState(String(app.amountRequested));
  const [summary, setSummary] = useState(app.reportSummary ?? "");
  const [spent, setSpent] = useState(app.reportAmountSpent?.toString() ?? "");
  const [reached, setReached] = useState(app.reportBeneficiaries?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const has = (action: string) => app.actions.some((a) => a.action === action);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const act = (a: GrantActionInfo) => {
    if (a.commentRequired && !comment.trim()) {
      setError(a.action === "reject" ? "Give the reason for the rejection in the comment." : "Add a comment explaining what is needed.");
      return;
    }
    // shortcut: the browser's own confirm box (LiveTranslate cannot reach it), use AlertModal when this page is localised.
    if (a.action === "cancel" && !window.confirm("Cancel this application? This cannot be undone.")) return;
    setError(null);
    onAct(a.action, {
      comment: comment.trim() || null,
      amount: a.action === "approve" ? num(amount) : null,
      ...(a.action === "submit_report" ? { reportSummary: summary, reportAmountSpent: num(spent), reportBeneficiaries: num(reached) } : {}),
    });
  };

  return (
    <Section title="Next step">
      {app.actions.length === 0 && <p className="text-sm text-muted-foreground">Nothing for you to do now. You can still add a comment.</p>}
      {has("submit_report") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="report-summary">Final report</Label>
            <Textarea id="report-summary" rows={5} maxLength={8000} value={summary} onChange={(e) => setSummary(e.target.value)}
              placeholder="What was done, who benefited, what changed." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-spent">Amount spent</Label>
            <Input id="report-spent" type="number" min={0} step="0.01" value={spent} onChange={(e) => setSpent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-reached">Beneficiaries reached</Label>
            <Input id="report-reached" type="number" min={0} value={reached} onChange={(e) => setReached(e.target.value)} />
          </div>
        </div>
      )}
      {has("approve") && (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="approve-amount">Amount to approve</Label>
          <Input id="approve-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Up to the {fmt.money(app.amountRequested)} requested, within the cycle&apos;s DDF budget.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="grant-comment">Comment</Label>
        <Textarea id="grant-comment" rows={3} maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="Shared with the club and the district. Required to request information or an adjustment, and to reject." />
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {app.actions.map((a) => (
          <Button key={a.action} disabled={busy} onClick={() => act(a)}
            variant={a.action === "reject" || a.action === "cancel" || a.action === "return_report" ? "outline" : "default"}>
            {ACTION_LABEL[a.action] ?? a.action}
          </Button>
        ))}
        <Button variant="ghost" disabled={busy || !comment.trim()} onClick={() => onComment(comment.trim())}>
          Post comment only
        </Button>
      </div>
    </Section>
  );
}
