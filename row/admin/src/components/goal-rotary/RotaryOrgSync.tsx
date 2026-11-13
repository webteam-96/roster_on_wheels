"use client";

// District Governor "Sync from Rotary.org" (user 2026-11-06). The DG signs in with his OWN Rotary.org
// login; the server queues the sync and a background worker fetches the district's current-year goals.
// Shows queue / progress / time left, the "as on" date, and the saved-login state (expired password,
// nightly auto-sync, remove). Same "as on" line is used on View Club Goals (RotaryOrgAsOn).
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "@/components/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getRotaryOrgSyncStatus, getRotaryOrgSyncAsOn, startRotaryOrgSync, setRotaryOrgSyncNightly, removeRotaryOrgSyncLogin,
  type RotaryOrgSyncStatus,
} from "@/services/api";

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

export default function RotaryOrgSync({ districtId, onSynced }: { districtId: number | null | undefined; onSynced?: () => void }) {
  const [st, setSt] = useState<RotaryOrgSyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(true);
  const [nightly, setNightly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    if (!districtId) return;
    try {
      const s = await getRotaryOrgSyncStatus(districtId);
      setSt(s);
      if (wasRunning.current && !s.current) { wasRunning.current = false; if (s.last?.status === "DONE") onSynced?.(); }
      if (s.current) wasRunning.current = true;
    } catch { /* keep the last state */ }
  }, [districtId, onSynced]);

  useEffect(() => { load(); }, [load]);
  // Poll while a sync is queued / running.
  useEffect(() => {
    if (!st?.current) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [st?.current, load]);

  if (!districtId || !st) return null;
  const asOn = fmt(st.asOn);
  if (!st.canSync) return <p className="text-xs text-slate-500">{asOn ? `Synced from Rotary.org as on ${asOn}` : "Not synced from Rotary.org yet"}</p>;

  const login = st.savedLogin;
  const needsPassword = !login || login.status === "EXPIRED" || login.status === "DISABLED" || login.status === "MFA";
  const run = st.current;

  const start = async (useForm: boolean) => {
    setBusy(true); setErr(null);
    try {
      await startRotaryOrgSync(useForm
        ? { districtId, email: email.trim(), password, savePassword: save, allowNightly: save && nightly }
        : { districtId });
      setPassword(""); setOpen(false); wasRunning.current = true;
      await load();
    } catch (e) { setErr(errMsg(e, "The sync could not be started.")); }
    finally { setBusy(false); }
  };
  const onSyncClick = () => { setErr(null); if (needsPassword) { setEmail(""); setOpen(true); } else start(false); };

  const pct = run && run.clubsTotal > 0 ? Math.min(100, Math.round((run.clubsDone / run.clubsTotal) * 100)) : 0;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={onSyncClick} disabled={!!run || busy || st.configured === false}
          className="inline-flex items-center gap-2 text-sm font-bold min-h-11 px-4 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          title={st.configured === false ? "Rotary.org sync is not set up on the server yet" : `Fetch this district's goals from Rotary.org (about ${st.estimateMinutes ?? 5} min)`}>
          {run || busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync from Rotary.org
        </button>
        <span className="text-xs text-slate-500">{asOn ? `Synced from Rotary.org as on ${asOn}` : "Not synced from Rotary.org yet"}</span>
      </div>

      {run && (
        <div className="w-full max-w-md rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
          {run.status === "QUEUED"
            ? <>Waiting in queue{run.queuePosition > 1 ? ` (${run.queuePosition - 1} ahead)` : ""} · starts soon · done in {mins(run.etaSeconds)}</>
            : <>{run.stage || "Syncing"}{run.clubsTotal > 0 ? ` · clubs ${run.clubsDone} of ${run.clubsTotal}` : ""} · {mins(run.etaSeconds)} left</>}
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200"><div className="h-1.5 rounded-full bg-amber-500 transition-all" style={{ width: `${run.status === "QUEUED" ? 2 : Math.max(4, pct)}%` }} /></div>
          <p className="mt-1 text-slate-500">You can leave this page - the sync carries on in the background.</p>
        </div>
      )}

      {!run && login?.status === "EXPIRED" && (
        <p className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
          <AlertTriangle size={13} /> Your Rotary.org password has changed. Please enter the new one to resume syncing.
          <button type="button" onClick={() => { setEmail(""); setOpen(true); }} className="font-bold underline">Update password</button>
        </p>
      )}
      {!run && login?.status === "MFA" && (
        <p className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700"><AlertTriangle size={13} /> This Rotary.org account needs extra verification, so automatic sync is not possible.</p>
      )}
      {!run && login?.status === "DISABLED" && login.statusMessage && (
        <p className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500">{login.statusMessage}</p>
      )}
      {!run && st.last && st.last.status !== "DONE" && login?.status !== "EXPIRED" && (
        <p className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
          <AlertTriangle size={13} /> Last sync {st.last.status === "LOGIN_FAILED" ? "could not sign in to Rotary.org" : "failed"}{st.last.error ? `: ${st.last.error}` : ""}.
        </p>
      )}
      {!run && st.last?.status === "DONE" && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500"><CheckCircle2 size={13} className="text-green-700" /> Last sync finished {fmt(st.last.finishedAt)} · {st.last.clubs} clubs</p>
      )}
      {login && login.status !== "DISABLED" && !run && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>Saved login: {login.email}</span>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={login.allowNightly} onChange={async (e) => { try { await setRotaryOrgSyncNightly(districtId, e.target.checked); await load(); } catch { /* ignore */ } }} />
            Auto-sync every week
          </label>
          <button type="button" className="underline" onClick={async () => { try { await removeRotaryOrgSyncLogin(districtId); await load(); } catch { /* ignore */ } }}>Remove saved login</button>
        </div>
      )}
      {err && !open && <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{err}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Sync from Rotary.org</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">Sign in with <strong>this district&apos;s District Governor My Rotary (Rotary.org) login</strong>. A login from another district is refused. We fetch the district&apos;s and all its clubs&apos; goals for this Rotary year in the background (about {st.estimateMinutes ?? 5} min).</p>
          <label className="mt-3 block text-sm font-medium text-slate-800" htmlFor="ro-email">Rotary.org email</label>
          <input id="ro-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-600 focus:outline-none" />
          <label className="mt-3 block text-sm font-medium text-slate-800" htmlFor="ro-pass">Rotary.org password</label>
          <input id="ro-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-600 focus:outline-none" />
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
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={() => start(true)} disabled={busy || !email.trim() || !password}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Start sync
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
