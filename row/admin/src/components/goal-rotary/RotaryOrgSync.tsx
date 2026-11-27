"use client";

// District Governor "Sync from Rotary.org" (user 2026-11-06). The DG signs in with his OWN Rotary.org
// login; the server queues the sync and a background worker fetches the district's current-year goals.
// Shows queue / progress / time left, the "as on" date, and the saved-login state (expired password,
// nightly auto-sync, remove). Same "as on" line is used on View Club Goals (RotaryOrgAsOn).
// CLUB mode (user 2026-11-10): clubId > 0 = that club's own sync by its Club Admin / President / Secretary
// with THEIR OWN Rotary.org login (Club Goals, new CMR). tone "light" = for white pages.
import { LinkButton } from "@/components/ui/text-buttons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "@/components/icons";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getRotaryOrgSyncAsOn, setRotaryOrgSyncNightly, removeRotaryOrgSyncLogin,
} from "@/services/api";
import {
  getRotaryOrgSyncStatusForYear as getRotaryOrgSyncStatus, startRotaryOrgSyncForYear as startRotaryOrgSync, cancelRotaryOrgSync,
  type RotaryOrgSyncYearStatus as RotaryOrgSyncStatus,
} from "@/services/goalFlowApi";

const fmt = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
};
const mins = (s: number) => (s < 60 ? "under a minute" : `about ${Math.round(s / 60)} min`);
const errMsg = (e: unknown, f: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || f;

/** "Synced from Rotary.org as on …" - district page and View Club Goals. */
export function RotaryOrgAsOn({ districtId, className }: { districtId: number | null | undefined; className?: string }) {
  const [asOn, setAsOn] = useState<string | null>(null);
  useEffect(() => {
    if (!districtId) return;
    getRotaryOrgSyncAsOn(districtId).then((r) => setAsOn(r.asOn)).catch(() => setAsOn(null));
  }, [districtId]);
  const t = fmt(asOn);
  return <span className={className}>{t ? `Synced from Rotary.org as on ${t}` : "Not synced from Rotary.org yet"}</span>;
}

export default function RotaryOrgSync({ districtId, clubId, tone = "dark", onSynced, yearId, actions, alert = false, lead }: {
  districtId?: number | null; clubId?: number | null; tone?: "dark" | "light"; onSynced?: () => void;
  /** Buttons shown right after "Sync from Rotary.org", on the same row (RCC Goals pages). */
  actions?: ReactNode;
  /** Every status line in one yellow alert under the buttons (RCC Goals pages). */
  alert?: boolean;
  /** Shown first on the button row (e.g. the page title), the sync buttons pushed to the right. */
  lead?: ReactNode;
  /** The Rotary year the page shows: the sync fetches THAT year, for the admin of that year (past year = Achieved +
   *  a goal only where none is saved; next year = goals only). Leave out = current year. */
  yearId?: number | null;
}) {
  const isClub = !!clubId && clubId > 0;
  const light = tone === "light";
  const cBase = light
    ? { muted: "text-slate-500", btn: "border-navy-950 text-navy-950 hover:bg-slate-50", box: "bg-slate-100 text-slate-800", bar: "bg-slate-200", bad: "bg-red-50 text-red-700", soft: "bg-slate-100 text-slate-600" }
    : { muted: "text-navy-200", btn: "border-navy-400 text-white hover:bg-white/10", box: "bg-white/10 text-white", bar: "bg-white/20", bad: "bg-red-500/20 text-white", soft: "bg-white/10 text-navy-200" };
  const c = alert ? { ...cBase, muted: "text-amber-900" } : cBase;
  const alertCls = "w-full rounded-go-md border border-amber-300 bg-amber-50 px-4 py-3 space-y-1.5 text-go-body text-amber-900";
  const [st, setSt] = useState<RotaryOrgSyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(true);
  const [nightly, setNightly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);   // saved login: ask before starting (user 2026-11-23)
  const [cancelling, setCancelling] = useState(false);
  const { years, currentYearId } = useRotaryYears();
  const [err, setErr] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    if (!districtId && !isClub) return;
    try {
      const s = await getRotaryOrgSyncStatus(districtId ?? 0, clubId ?? 0, yearId);
      setSt(s);
      if (wasRunning.current && !s.current) { wasRunning.current = false; if (s.last?.status === "DONE") onSynced?.(); }
      if (s.current) wasRunning.current = true;
    } catch { /* keep the last state */ }
  }, [districtId, clubId, isClub, onSynced, yearId]);

  useEffect(() => { load(); }, [load]);
  // Poll while a sync is queued / running.
  useEffect(() => {
    if (!st?.current) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [st?.current, load]);

  // Still loading the sync status: keep the page's title and buttons on screen (no header flash).
  if ((!districtId && !isClub) || !st)
    return lead || actions ? <div className="flex flex-wrap items-center gap-2.5">{lead}{lead && <span className="flex-1" />}{actions}</div> : null;
  const dId = districtId ?? 0, cId = clubId ?? 0;
  const asOn = fmt(st.asOn);
  const asOnText = asOn ? `Synced from Rotary.org as on ${asOn}` : "Not synced from Rotary.org yet";
  const leadEl = lead ? <>{lead}<span className="flex-1" /></> : null;
  if (!st.canSync) return alert || actions || lead ? (
    <div className="flex flex-col items-stretch gap-2">
      {(actions || lead) && <div className="flex flex-wrap items-center gap-2.5">{leadEl}{actions}</div>}
      <p className={alert ? alertCls : `text-xs ${c.muted}`}>{asOnText}</p>
    </div>
  ) : <p className={`text-xs ${c.muted}`}>{asOnText}</p>;

  const login = st.savedLogin;
  const needsPassword = !login || login.status === "EXPIRED" || login.status === "DISABLED" || login.status === "MFA";
  const run = st.current;

  const start = async (useForm: boolean) => {
    setBusy(true); setErr(null);
    try {
      await startRotaryOrgSync(useForm
        ? { districtId: dId, clubId: cId, email: email.trim(), password, savePassword: save, allowNightly: save && nightly, yearId: yearId || 0 }
        : { districtId: dId, clubId: cId, yearId: yearId || 0 });
      setPassword(""); setOpen(false); wasRunning.current = true;
      await load();
    } catch (e) { setErr(errMsg(e, "The sync could not be started.")); }
    finally { setBusy(false); }
  };
  const onSyncClick = () => { setErr(null); if (needsPassword) { setEmail(""); setOpen(true); } else setConfirmOpen(true); };
  const cancelSync = async () => {
    setCancelling(true); setErr(null);
    try { await cancelRotaryOrgSync(dId, cId); await load(); }
    catch (e) { setErr(errMsg(e, "The sync could not be cancelled.")); }
    finally { setCancelling(false); }
  };
  // The year shown on the page is the year synced (the server allows only the DG / admin of that year).
  const shownYearId = yearId || currentYearId;
  const yearKind = !yearId || !currentYearId || yearId === currentYearId ? "current" : yearId < currentYearId ? "past" : "next";
  const currentYearLabel = years.find((y) => y.id === shownYearId)?.yearLabel ?? "this Rotary year";

  const pct = run && run.clubsTotal > 0 ? Math.min(100, Math.round((run.clubsDone / run.clubsTotal) * 100)) : 0;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="button" onClick={onSyncClick} disabled={!!run || busy || st.configured === false}
          variant="outline"
          title={st.configured === false ? "Rotary.org sync is not set up on the server yet" : `Fetch this ${isClub ? "club" : "district"}'s goals from Rotary.org (about ${st.estimateMinutes ?? 5} min)`}>
          {run || busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync from Rotary.org
        </Button>
        <span className={`text-xs ${c.muted}`}>{asOn ? `Synced from Rotary.org as on ${asOn}` : "Not synced from Rotary.org yet"}</span>
      </div>
      {yearKind !== "current" && !run && (
        <p className={`text-xs ${c.muted}`}>
          {yearKind === "past"
            ? `Syncing ${currentYearLabel} (a past year) updates the Achieved figures; a goal is filled only where none is saved.`
            : `Syncing ${currentYearLabel} (next year) brings in the goals only. Achieved starts on 1 July.`}
        </p>
      )}
      {isClub && st.districtAuto && !run && (
        <p className={`text-xs ${c.muted}`}>Your district&apos;s weekly Rotary.org sync is on - it already updates this club every week. You can still sync any time.</p>
      )}

      {run && (
        <div className={`w-full max-w-md rounded-lg px-3 py-2 text-xs ${c.box}`}>
          {run.status === "QUEUED"
            ? <>Waiting in queue{run.queuePosition > 1 ? ` (${run.queuePosition - 1} ahead)` : ""} · starts soon · done in {mins(run.etaSeconds)}</>
            : <>{run.stage || "Syncing"}{!isClub && run.clubsTotal > 0 ? ` · clubs ${run.clubsDone} of ${run.clubsTotal}` : ""} · {mins(run.etaSeconds)} left</>}
          <div className={`mt-1.5 h-1.5 w-full rounded-full ${c.bar}`}><div className="h-1.5 rounded-full bg-marigold transition-all" style={{ width: `${run.status === "QUEUED" ? 2 : Math.max(4, pct)}%` }} /></div>
          {run.cancelling || run.status === "CANCELLING"
            ? <p className={`mt-1 ${c.muted}`}>Cancelling. It stops before saving anything, so your figures stay as they were.</p>
            : <p className={`mt-1 ${c.muted}`}>You can leave this page. The sync carries on in the background.</p>}
          {run.canCancel && !(run.cancelling || run.status === "CANCELLING") && (
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={cancelSync} disabled={cancelling}>
              {cancelling ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Cancel sync
            </Button>
          )}
        </div>
      )}

      {!run && login?.status === "EXPIRED" && (
        <p className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${c.bad}`}>
          <AlertTriangle size={13} /> Your Rotary.org password has changed. Please enter the new one to resume syncing.
          <LinkButton type="button" onClick={() => { setEmail(""); setOpen(true); }}>Update password</LinkButton>
        </p>
      )}
      {!run && login?.status === "MFA" && (
        <p className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${c.bad}`}><AlertTriangle size={13} /> This Rotary.org account needs extra verification, so automatic sync is not possible.</p>
      )}
      {!run && login?.status === "DISABLED" && login.statusMessage && (
        <p className={`rounded-lg px-3 py-1.5 text-xs ${c.soft}`}>{login.statusMessage}</p>
      )}
      {!run && st.last?.status === "CANCELLED" && (
        <p className={`flex items-center gap-1.5 text-xs ${c.muted}`}><XCircle size={13} /> Last sync was cancelled {fmt(st.last.finishedAt)} - nothing was changed.</p>
      )}
      {!run && st.last && st.last.status !== "DONE" && st.last.status !== "CANCELLED" && login?.status !== "EXPIRED" && (
        <p className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${c.bad}`}>
          <AlertTriangle size={13} /> Last sync {st.last.status === "LOGIN_FAILED" ? "could not sign in to Rotary.org" : "failed"}{st.last.error ? `: ${st.last.error}` : ""}.
        </p>
      )}
      {!run && st.last?.status === "DONE" && (
        <p className={`flex items-center gap-1.5 text-xs ${c.muted}`}><CheckCircle2 size={13} className="text-green-500" /> Last sync finished {fmt(st.last.finishedAt)}{isClub ? "" : ` · ${st.last.clubs} clubs`}</p>
      )}
      {login && login.status !== "DISABLED" && !run && (
        <div className={`flex flex-wrap items-center gap-3 text-xs ${c.muted}`}>
          <span>Saved login: {login.email}</span>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={login.allowNightly} onChange={async (e) => { try { await setRotaryOrgSyncNightly(dId, e.target.checked, cId); await load(); } catch { /* ignore */ } }} />
            Auto-sync every week
          </label>
          <LinkButton type="button" onClick={async () => { try { await removeRotaryOrgSyncLogin(dId, cId); await load(); } catch { /* ignore */ } }}>Remove saved login</LinkButton>
        </div>
      )}
      {err && !open && <p className={`rounded-lg px-3 py-1.5 text-xs ${c.bad}`}>{err}</p>}

      {/* Saved login: confirm first (user 2026-11-23) - a click no longer starts a 5-10 min sync straight away. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !busy && setConfirmOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Sync from Rotary.org now?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            This {isClub ? "club" : "district"}&apos;s goals and figures for {currentYearLabel} will be fetched from Rotary.org with the saved login
            {login?.email ? <> (<span className="font-medium">{login.email}</span>)</> : null}. It takes about {isClub ? 5 : 10} minutes and runs in the background.
          </p>
          {yearKind === "past" && <p className="mt-2 text-xs text-slate-500">{currentYearLabel} is a past year: the Achieved figures are updated, and a goal is filled only where none is saved.</p>}
          {yearKind === "next" && <p className="mt-2 text-xs text-slate-500">{currentYearLabel} is next year: only the goals are brought in.</p>}
          <p className="mt-2 text-xs text-slate-500">You can cancel it while it runs - nothing is saved until it finishes.</p>
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="button" disabled={busy}
              onClick={async () => { await start(false); setConfirmOpen(false); }}>
              {busy && <Loader2 size={14} className="animate-spin" />} Sync now
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Sync from Rotary.org</DialogTitle></DialogHeader>
          {isClub
            ? <p className="text-sm text-slate-600">Sign in with <strong>your own My Rotary (Rotary.org) login</strong> - a login of a member of this club. A login of another club is refused. We fetch this club&apos;s goals for this Rotary year in the background (about {st.estimateMinutes ?? 2} min); this month&apos;s Foundation figure is updated, earlier months are never changed.</p>
            : <p className="text-sm text-slate-600">Sign in with <strong>this district&apos;s District Governor My Rotary (Rotary.org) login</strong>. A login from another district is refused. We fetch the district&apos;s and all its clubs&apos; goals for this Rotary year in the background (about {st.estimateMinutes ?? 5} min).</p>}
          <label className="mt-3 block text-sm font-medium text-slate-800" htmlFor="ro-email">Rotary.org email</label>
          <Input id="ro-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1" />
          <label className="mt-3 block text-sm font-medium text-slate-800" htmlFor="ro-pass">Rotary.org password</label>
          <Input id="ro-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1" />
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={save} onChange={(e) => setSave(e.target.checked)} />
            <span>Save this login (stored encrypted) - saved only after the sync succeeds</span>
          </label>
          {save && (
            <label className="mt-2 ml-6 flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={nightly} onChange={(e) => setNightly(e.target.checked)} />
              <span>Auto-sync every week with my login (you can still sync any time)</span>
            </label>
          )}
          <p className="mt-2 text-xs text-slate-500">If you change your Rotary.org password later, syncing stops and we ask you for the new one. We never try a wrong password twice.</p>
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)} variant="outline">Cancel</Button>
            <Button type="button" onClick={() => start(true)} disabled={busy || !email.trim() || !password}
              >
              {busy && <Loader2 size={14} className="animate-spin" />} Start sync
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
