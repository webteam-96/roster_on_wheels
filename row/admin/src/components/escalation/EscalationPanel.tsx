"use client";

/**
 * Escalation alerts for a district (B.1 #32, flag escalation): the district's rules (a club behind its targets, a club
 * that held fewer meetings than the rule in a finished month), the delays before the Assistant Governor and then the
 * District Governor hear about it, and the log of every alert sent: who, when, why and at which level.
 */

import { useEffect, useState } from "react";
import { Bell } from "@/components/icons";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import SectionHeader from "@/components/dashboard/SectionHeader";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { fmtDate } from "@/components/dashboard/formatters";
import { apiMessage, selectCls } from "@/components/membership/FoundationDesignationsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EMAIL_STATUS_LABELS, ESCALATION_FEATURE, MAX_DELAY_DAYS, MAX_SHORTFALL, RULE_LABELS, parseWhole } from "@/lib/escalation";
import { monthLabel } from "@/lib/meetingCompliance";
import {
  getEscalationAlerts, getEscalationSettings, saveEscalationSettings,
  type EscalationAlert, type EscalationRule, type EscalationSettings,
} from "@/services/api";

export default function EscalationPanel({ districtId }: { districtId: number }) {
  const on = useFeatureLoadedOn(ESCALATION_FEATURE);
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Escalation alerts"
        subtitle="A club that misses a rule alerts its president, then its Assistant Governor, then the District Governor"
        icon={Bell}
      />
      {on && districtId > 0 && (
        <>
          <Rules districtId={districtId} />
          <AlertLog districtId={districtId} />
        </>
      )}
    </div>
  );
}

function Rules({ districtId }: { districtId: number }) {
  const [settings, setSettings] = useState<EscalationSettings | null>(null);
  const [target, setTarget] = useState<"" | "red" | "amber">("");
  const [shortfall, setShortfall] = useState("");
  const [agDelay, setAgDelay] = useState("");
  const [dgDelay, setDgDelay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const show = (s: EscalationSettings) => {
    setSettings(s);
    setTarget(s.targetStatus ?? "");
    setShortfall(s.meetingShortfall == null ? "" : String(s.meetingShortfall));
    setAgDelay(String(s.agDelayDays));
    setDgDelay(String(s.dgDelayDays));
  };

  useEffect(() => {
    let live = true;
    getEscalationSettings(districtId)
      .then((s) => live && show(s))
      .catch((err) => live && setError(apiMessage(err, "Could not load the escalation rules.")));
    return () => {
      live = false;
    };
  }, [districtId]);

  const meetings = shortfall.trim() === "" ? null : parseWhole(shortfall, 1, MAX_SHORTFALL);
  const ag = parseWhole(agDelay, 1, MAX_DELAY_DAYS);
  const dg = parseWhole(dgDelay, 1, MAX_DELAY_DAYS);
  const valid = (shortfall.trim() === "" || meetings !== null) && ag !== null && dg !== null;
  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setSaved(false);
  };

  const save = async () => {
    if (!valid || ag === null || dg === null) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      show(await saveEscalationSettings(districtId, { targetStatus: target || null, meetingShortfall: meetings, agDelayDays: ag, dgDelayDays: dg }));
      setSaved(true);
    } catch (err) {
      setError(apiMessage(err, "Could not save the escalation rules."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
      <header className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">Rules</h2>
      </header>
      <div className="space-y-4 p-4">
        {!settings && !error ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-10 w-1/3" />
          </div>
        ) : settings && (
          <>
            <p className="max-w-3xl text-sm text-slate-600">
              A check runs every morning. A club that misses a rule alerts its club president by email and in the app. If
              the club has not caught up after the first delay, its Assistant Governor is alerted; after the second
              delay, the District Governor. Each alert goes once per club, rule and month.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Targets</span>
                <select className={selectCls} value={target} onChange={(e) => { setTarget(e.target.value as "" | "red" | "amber"); setSaved(false); }}>
                  <option value="">Off</option>
                  <option value="red">Alert when a club is red on the target dashboard</option>
                  <option value="amber">Alert when a club is amber or red</option>
                </select>
                {target && !settings.targetRuleActive && (
                  <span className="block font-normal text-amber-700">This rule runs once Live target dashboard is switched on in Settings, Features.</span>
                )}
              </label>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Meetings missed in a month</span>
                <Input inputMode="numeric" placeholder="Off" value={shortfall} aria-invalid={shortfall.trim() !== "" && meetings === null} onChange={edit(setShortfall)} />
                <span className="block font-normal text-slate-500">
                  Alert when a finished month had at least this many meetings fewer than the club&apos;s meeting rule. Leave
                  it empty for no meeting alerts.
                </span>
                {meetings !== null && !settings.meetingRuleActive && (
                  <span className="block font-normal text-amber-700">This rule runs once Meetings is switched on in Settings, Features.</span>
                )}
              </label>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Days before the Assistant Governor is alerted</span>
                <Input inputMode="numeric" value={agDelay} aria-invalid={ag === null} onChange={edit(setAgDelay)} />
              </label>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Days after that before the District Governor is alerted</span>
                <Input inputMode="numeric" value={dgDelay} aria-invalid={dg === null} onChange={edit(setDgDelay)} />
              </label>
            </div>
            {!valid && (
              <p className="text-xs text-red-700">
                Meetings missed is a whole number from 1 to {MAX_SHORTFALL}; delays are whole days from 1 to {MAX_DELAY_DAYS}.
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button type="button" onClick={save} disabled={busy || !valid}>Save</Button>
              {saved && <span className="text-sm text-slate-600" role="status">Saved.</span>}
            </div>
          </>
        )}
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function AlertLog({ districtId }: { districtId: number }) {
  const [rule, setRule] = useState<EscalationRule | "">("");
  const [rows, setRows] = useState<EscalationAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    getEscalationAlerts(districtId, rule)
      .then((r) => live && setRows(r))
      .catch((err) => live && setError(apiMessage(err, "Could not load the alert log.")));
    return () => {
      live = false;
    };
  }, [districtId, rule]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800">Alert log</h2>
        <label className="w-56 space-y-1 text-xs font-semibold text-slate-700">
          <span>Show</span>
          <select className={selectCls} value={rule} onChange={(e) => setRule(e.target.value as EscalationRule | "")}>
            <option value="">All rules</option>
            <option value="target">{RULE_LABELS.target}</option>
            <option value="meetings">{RULE_LABELS.meetings}</option>
          </select>
        </label>
      </div>
      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>}
      {rows === null ? (
        !error && <TableSkeleton rows={5} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>Club</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-slate-600">{fmtDate(a.createdDate)}</TableCell>
                  <TableCell className="font-medium text-slate-800">{a.clubName ?? `Club ${a.clubId}`}</TableCell>
                  <TableCell className="whitespace-nowrap">{RULE_LABELS[a.rule]}, {monthLabel(a.period)}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.level}. {a.role}</TableCell>
                  <TableCell>{a.recipientName ?? "Nobody"}</TableCell>
                  <TableCell className="text-slate-600">{EMAIL_STATUS_LABELS[a.emailStatus] ?? a.emailStatus}</TableCell>
                  <TableCell className="min-w-64 text-slate-600">{a.reason}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    No alerts yet. Set a rule above; the check runs every morning.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
