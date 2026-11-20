"use client";

import { useEffect, useState } from "react";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mfaLoginSetup, mfaLoginVerify, type MfaLoginResponse, type MfaSetupInfo } from "@/services/api";

type Props = {
  mfaToken: string;
  setupRequired: boolean;
  onSignedIn: (response: MfaLoginResponse) => void;
  onCancel: () => void;
};

function apiMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === "string" && msg ? msg : fallback;
}

/** The server-made QR (SVG from our own otpauth URI) shown as an image, so no HTML is injected. */
export function QrImage({ svg }: { svg: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
      alt="QR code for your authenticator app"
      width={184}
      height={184}
      className="rounded-[8px] border border-[color:var(--row-line)] bg-[#FCFDFE] p-2"
    />
  );
}

export function RecoveryCodeList({ codes }: { codes: string[] }) {
  return (
    <ol className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-[8px] border border-[color:var(--row-line)] bg-[#EDF4FB] px-4 py-3 font-mono text-sm text-[#1B2C42]">
      {codes.map((c) => <li key={c}>{c}</li>)}
    </ol>
  );
}

/** Second step of sign-in: a code from the authenticator app or a recovery code; first-time setup when required. */
export default function MfaSignInStep({ mfaToken, setupRequired, onSignedIn, onCancel }: Props) {
  const [setup, setSetup] = useState<MfaSetupInfo | null>(null);
  const [setupError, setSetupError] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<MfaLoginResponse | null>(null);

  useEffect(() => {
    if (!setupRequired) return;
    let live = true;
    mfaLoginSetup(mfaToken)
      .then((s) => { if (live) setSetup(s); })
      .catch((e) => { if (live) setSetupError(apiMessage(e, "Could not start the setup. Please sign in again.")); });
    return () => { live = false; };
  }, [mfaToken, setupRequired]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await mfaLoginVerify(mfaToken, code.trim());
      if (res.recoveryCodes && res.recoveryCodes.length > 0) setDone(res);
      else onSignedIn(res);
    } catch (err) {
      setError(apiMessage(err, "That code is not right. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#1B2C42]">
          Multi-factor sign-in is on. Save these recovery codes somewhere safe. Each one works once if you lose your phone.
        </p>
        <RecoveryCodeList codes={done.recoveryCodes ?? []} />
        <Button type="button" size="lg" className="w-full" onClick={() => onSignedIn(done)}>Continue</Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {setupRequired ? (
        <div className="space-y-3">
          <p className="text-sm text-[#1B2C42]">
            Your account needs multi-factor sign-in. Scan this code with an authenticator app, then enter the 6-digit code it shows.
          </p>
          {setupError && <p className="text-sm text-destructive">{setupError}</p>}
          {!setup && !setupError && <div className="h-[184px] w-[184px] animate-pulse rounded-[8px] bg-[#EDF4FB]" aria-label="Loading" />}
          {setup && (
            <div className="flex flex-col items-start gap-2">
              <QrImage svg={setup.qrSvg} />
              <p className="text-xs text-muted-foreground">Cannot scan? Enter this key: <span className="font-mono break-all">{setup.secret}</span></p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-[#1B2C42]">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      )}
      <div className="space-y-2">
        <Label htmlFor="mfa-code">Code</Label>
        <Input
          id="mfa-code"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={20}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy || (setupRequired && !setup)}>
        {busy && <RotaryLoader size="sm" />}
        Verify
      </Button>
      <button type="button" onClick={onCancel} className="w-full text-sm font-semibold text-primary hover:underline">
        Back to sign in
      </button>
    </form>
  );
}
