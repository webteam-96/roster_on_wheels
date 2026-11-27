"use client";
import { LinkButton } from "@/components/ui/text-buttons";

/**
 * KIS/ROW/SUB/01 sections 4.1 / 4.2: a club executive (President, President-Elect, Past President, Secretary,
 * Treasurer, Executive Secretary on record with Rotary International) signs in with a code sent by email.
 * The API checks the office and that the club has a District or Club subscription (exception 1 shows the reason).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import LanguagePicker from "@/components/LanguagePicker";
import BrandLogo from "@/components/BrandLogo";
import { requestExecutiveCode, verifyExecutiveCode, resolveDashboardLanding, type MfaLoginResponse } from "@/services/api";
import MfaSignInStep from "@/components/MfaSignInStep";

function apiMessage(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

export default function ExecutiveSignInPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Account security: the emailed code is the first factor; an account with MFA then asks for its app code.
  const [mfa, setMfa] = useState<{ token: string; setupRequired: boolean } | null>(null);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await requestExecutiveCode(email.trim());
      setInfo(r.message);
      setCodeSent(true);
    } catch (err) {
      setError(apiMessage(err, "Could not send the code. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await finish(await verifyExecutiveCode(email.trim(), code.trim()));
    } catch (err) {
      setError(apiMessage(err, "That code did not work. Try again."));
      setBusy(false);
    }
  };

  const finish = async (response: MfaLoginResponse) => {
    if (response.mfaRequired && response.mfaToken) {
      setMfa({ token: response.mfaToken, setupRequired: !!response.mfaSetupRequired });
      setBusy(false);
      return;
    }
    {
      login(
        response.token,
        {
          memberId: response.memberId,
          name: response.memberName,
          email: response.email,
          roles: response.roles,
          scopedRoles: response.scopedRoles,
          accessibleZones: response.accessibleZones,
          accessibleDistricts: response.accessibleDistricts,
          accessibleClubs: response.accessibleClubs,
        },
        response.lastLoginTime,
        response.sessionExpiryMinutes,
      );
      let landingRoute = "/";
      try {
        const landing = await resolveDashboardLanding();
        if (landing?.route) landingRoute = landing.route;
        if (landing?.available && landing.available.length > 0) {
          localStorage.setItem("dashboard_available_v2", JSON.stringify(landing.available));
        }
      } catch { /* land on home */ }
      router.replace(landingRoute);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md overflow-hidden border-[color:var(--row-line)]">
        <CardHeader className="gap-6 px-7 pb-2 pt-7">
          <div className="flex items-start justify-between gap-3">
            <BrandLogo className="h-14" />
            <LanguagePicker />
          </div>
          <CardTitle className="font-display text-3xl font-semibold tracking-tight text-foreground">Club executive sign-in</CardTitle>
          <p className="text-sm text-muted-foreground">
            For club Presidents, Presidents-Elect, Past Presidents, Secretaries, Treasurers and Executive Secretaries.
            We email you a code; no password needed.
          </p>
        </CardHeader>
        <CardContent className="px-7 pb-7 pt-6">
          {mfa ? (
            <MfaSignInStep mfaToken={mfa.token} setupRequired={mfa.setupRequired}
              onSignedIn={(res) => { void finish(res); }}
              onCancel={() => { setMfa(null); setCodeSent(false); setCode(""); }} />
          ) : !codeSent ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="The email in My Rotary" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={busy || !email.trim()}>
                {busy && <RotaryLoader size="sm" />}
                Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              {info && <p className="text-sm text-muted-foreground">{info}</p>}
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6 digits" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== 6}>
                {busy && <RotaryLoader size="sm" />}
                Sign in
              </Button>
              <LinkButton disabled={busy}
                onClick={() => { setCode(""); void sendCode(); }}>
                Send a new code
              </LinkButton>
            </form>
          )}
          <p className="mt-6 text-sm text-muted-foreground">
            Have a password? <Link href="/login" className="font-semibold text-primary hover:underline">Sign in with password</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
