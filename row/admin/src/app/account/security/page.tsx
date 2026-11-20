"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, Panel, ErrorState, SkeletonRows } from "@/components/row/AppKit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RotaryLoader from "@/components/RotaryLoader";
import { QrImage, RecoveryCodeList } from "@/components/MfaSignInStep";
import {
  getMfaStatus, startMfaEnrol, confirmMfaEnrol, disableMfa, regenerateMfaRecoveryCodes,
  getClubSecurityPolicy, setClubSecurityPolicy,
  type MfaStatus, type MfaSetupInfo, type ClubSecurityPolicy,
} from "@/services/api";
import { appLocale } from "@/lib/appFormat";

function apiMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === "string" && msg ? msg : fallback;
}

type CodeAction = "disable" | "regenerate" | null;

function MfaPanel() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [setup, setSetup] = useState<MfaSetupInfo | null>(null);
  const [action, setAction] = useState<CodeAction>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try { setStatus(await getMfaStatus()); }
    catch (e) { setLoadError(apiMessage(e, "Could not load your sign-in settings.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const reset = () => { setSetup(null); setAction(null); setCode(""); setError(""); };

  const begin = async () => {
    setError(""); setCodes(null); setBusy(true);
    try { setSetup(await startMfaEnrol()); }
    catch (e) { setError(apiMessage(e, "Could not start the setup.")); }
    finally { setBusy(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      if (setup) setCodes((await confirmMfaEnrol(code.trim())).recoveryCodes);
      else if (action === "regenerate") setCodes((await regenerateMfaRecoveryCodes(code.trim())).recoveryCodes);
      else if (action === "disable") await disableMfa(code.trim());
      reset();
      await load();
    } catch (err) {
      setError(apiMessage(err, "That code is not right. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const codeForm = (label: string) => (
    <form onSubmit={submit} className="mt-4 max-w-sm space-y-3">
      <div className="space-y-2">
        <Label htmlFor="mfa-self-code">{label}</Label>
        <Input id="mfa-self-code" autoComplete="one-time-code" autoFocus value={code} maxLength={20}
          onChange={(e) => setCode(e.target.value)} placeholder="123456" required />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy && <RotaryLoader size="sm" />}Confirm</Button>
        <Button type="button" variant="outline" onClick={reset} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );

  let body: React.ReactNode;
  if (loadError) body = <ErrorState message={loadError} onRetry={load} retryLabel="Try again" />;
  else if (!status) body = <SkeletonRows rows={3} />;
  else if (setup) body = (
    <div className="space-y-3">
      <p className="text-sm text-[#1B2C42]">Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and others), then enter the 6-digit code it shows.</p>
      <QrImage svg={setup.qrSvg} />
      <p className="text-xs text-muted-foreground">Cannot scan? Enter this key: <span className="font-mono break-all">{setup.secret}</span></p>
      {codeForm("Code from the app")}
    </div>
  );
  else body = (
    <div className="space-y-3">
      <p className="text-sm text-[#1B2C42]">
        {status.enabled
          ? `On${status.enabledAt ? ` since ${new Date(status.enabledAt + (status.enabledAt.endsWith("Z") ? "" : "Z")).toLocaleDateString(appLocale())}` : ""}. Unused recovery codes: ${status.recoveryCodesLeft}.`
          : "Off. Turn it on so a stolen password alone cannot open your account."}
      </p>
      {status.required && (
        <p className="text-sm text-muted-foreground">
          Required for your account by your club or by ROW. It cannot be turned off.
        </p>
      )}
      {!status.enabled && (
        <Button type="button" onClick={begin} disabled={busy}>{busy && <RotaryLoader size="sm" />}Turn on</Button>
      )}
      {status.enabled && !action && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { setCodes(null); setAction("regenerate"); }}>New recovery codes</Button>
          {!status.required && <Button type="button" variant="outline" onClick={() => { setCodes(null); setAction("disable"); }}>Turn off</Button>}
        </div>
      )}
      {action && codeForm("Enter a code from your app or a recovery code")}
      {error && !action && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );

  return (
    <Panel title="Multi-factor sign-in" subtitle="A 6-digit code from an authenticator app after your password or email link.">
      {codes && (
        <div className="mb-5 space-y-2">
          <p className="text-sm font-semibold text-[#1B2C42]">Save these recovery codes now. They are shown only once, and each works once.</p>
          <RecoveryCodeList codes={codes} />
        </div>
      )}
      {body}
    </Panel>
  );
}

function ClubPolicyRow({ clubId, fallbackName }: { clubId: number; fallbackName: string }) {
  const [policy, setPolicy] = useState<ClubSecurityPolicy | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try { setPolicy(await getClubSecurityPolicy(clubId)); }
    catch (e) { setError(apiMessage(e, "Could not load this club's policy.")); }
  }, [clubId]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async () => {
    if (!policy) return;
    setBusy(true); setError("");
    try { setPolicy(await setClubSecurityPolicy(clubId, !policy.requireMfa)); }
    catch (e) { setError(apiMessage(e, "Could not save.")); }
    finally { setBusy(false); }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--row-line)] py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-semibold text-[#1B2C42]">{policy?.clubName || fallbackName}</p>
        {policy && (
          <p className="text-[13px] text-[#64748B]">
            {policy.membersWithMfa} of {policy.activeMembers} active members use multi-factor sign-in.
          </p>
        )}
        {!policy && !error && <div className="mt-1 h-4 w-48 animate-pulse rounded bg-[#EDF4FB]" />}
        {error && <p className="text-[13px] text-destructive">{error}</p>}
      </div>
      {policy && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[#1B2C42]">
          <input type="checkbox" className="h-4 w-4" style={{ accentColor: "#17458F" }}
            checked={policy.requireMfa} disabled={busy} onChange={toggle} />
          Require for every member
        </label>
      )}
    </li>
  );
}

function ClubPolicyPanel() {
  const { user } = useAuth();
  const clubs = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of user?.scopedRoles ?? []) {
      if (r.roleName === "Admin" && r.clubId) seen.set(r.clubId, r.clubName ?? `Club ${r.clubId}`);
    }
    return [...seen.entries()];
  }, [user?.scopedRoles]);
  if (clubs.length === 0) return null;
  return (
    <Panel title="Club sign-in policy" subtitle="When on, every member of the club must set up multi-factor sign-in at their next sign-in, on the web and in the app.">
      <ul>{clubs.map(([id, name]) => <ClubPolicyRow key={id} clubId={id} fallbackName={name} />)}</ul>
    </Panel>
  );
}

export default function AccountSecurityPage() {
  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <PageHeader eyebrow="Account" title="Account security"
          description="Protect your sign-in with an authenticator app. You can also sign in with a one-time email link from the sign-in page." />
        <MfaPanel />
        <ClubPolicyPanel />
      </div>
    </ProtectedRoute>
  );
}
