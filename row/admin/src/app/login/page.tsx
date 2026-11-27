"use client";

import { useState, useEffect, useRef } from "react";
import { safeReturnPath } from "@/lib/returnUrl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { LinkButton } from "@/components/ui/text-buttons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import LanguagePicker from "@/components/LanguagePicker";
import BrandLogo from "@/components/BrandLogo";
import { login as loginApi, resolveDashboardLanding, requestMagicLink, consumeMagicLink, type MfaLoginResponse } from "@/services/api";
import MfaSignInStep from "@/components/MfaSignInStep";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";

export default function LoginPage() {
  const router = useRouter();
  const returnPath = () => safeReturnPath(new URLSearchParams(window.location.search).get("returnUrl"));
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  // Account security: second step (MFA) and email sign-in link.
  const [mfa, setMfa] = useState<{ token: string; setupRequired: boolean } | null>(null);
  const [mode, setMode] = useState<"password" | "magic" | "magicSent">("password");
  const magicStarted = useRef(false);

  useEffect(() => {
    // An emailed sign-in link lands here as /login?magic=<token>: spend it once, and drop it from the address bar.
    const magic = new URLSearchParams(window.location.search).get("magic");
    if (!magic || magicStarted.current) return;
    magicStarted.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    setIsLoading(true);
    consumeMagicLink(magic)
      .then((res) => finishSignIn(res))
      .catch((err) => setError(err?.response?.data?.message || "This sign-in link is invalid or has expired. Please ask for a new one."))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Restore remembered login details
    const remembered = localStorage.getItem("remember_me");
    if (remembered) {
      const data = JSON.parse(remembered);
      setIdentifier(data.identifier || "");
      setRememberMe(true);
    }
  }, []);

  const handleMagicRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await requestMagicLink(identifier.trim());
      setMode("magicSent");
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 429 ? "Too many requests. Please wait a minute and try again." : "Could not send the link. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // The same landing for every way in: password, password + MFA, email link.
  async function finishSignIn(response: MfaLoginResponse) {
    if (response.mfaRequired && response.mfaToken) {
      setMfa({ token: response.mfaToken, setupRequired: !!response.mfaSetupRequired });
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
          // Wave 9B: forward per-role scope data (undefined if older backend)
          scopedRoles: response.scopedRoles,
          accessibleZones: response.accessibleZones,
          accessibleDistricts: response.accessibleDistricts,
          accessibleClubs: response.accessibleClubs,
        },
        response.lastLoginTime,
        response.sessionExpiryMinutes,
      );

      if (response.isTemporaryPassword) {
        setShowChangePassword(true);
      } else {
        // Multi-role routing (2026-08-14): the member lands DIRECTLY on a real dashboard — the
        // resolver returns the highest-priority operational dashboard they hold (District Admin,
        // Club Admin, …). SuperAdmin is switch-only unless it's their sole role. They switch roles
        // from the sidebar "Switch dashboard" dropdown, which reads the `available` list we prime
        // below under its own cache key so it paints instantly on first landing.
        let landingRoute = "/";
        try {
          const landing = await resolveDashboardLanding();
          if (landing?.route) landingRoute = landing.route;
          if (landing?.available && landing.available.length > 0) {
            localStorage.setItem("dashboard_available_v2", JSON.stringify(landing.available));
            localStorage.removeItem("dashboard_available");
          } else {
            localStorage.removeItem("dashboard_available_v2");
            localStorage.removeItem("dashboard_available");
          }
        } catch {
          // Resolver failed — fall back to the flat-role hint so login still lands sensibly.
          if (response.roles.includes("SuperAdmin")) landingRoute = "/settings/global-search";
        }
        router.push(returnPath() ?? landingRoute);
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // ROW signs in by email only.
      const response: MfaLoginResponse = await loginApi({ email: identifier.trim(), password });

      // Save or clear remember me
      if (rememberMe) {
        localStorage.setItem("remember_me", JSON.stringify({ identifier }));
      } else {
        localStorage.removeItem("remember_me");
      }

      await finishSignIn(response);
    } catch {
      setError("Invalid credentials. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      {/* The logo artwork has a white field, so it sits on the light card itself: no dark band, no plate. */}
      <Card className="w-full max-w-md overflow-hidden border-[color:var(--row-line)]">
        <CardHeader className="gap-6 px-7 pb-2 pt-7">
          <div className="flex items-start justify-between gap-3">
            <BrandLogo className="h-14" />
            <LanguagePicker />
          </div>
          <CardTitle className="font-display text-3xl font-semibold tracking-tight text-foreground">
            {mfa ? "Verify it is you" : mode === "password" ? "Sign In" : "Email sign-in link"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-7 pb-7 pt-6">
          {mfa ? (
            <MfaSignInStep
              mfaToken={mfa.token}
              setupRequired={mfa.setupRequired}
              onSignedIn={(res) => { void finishSignIn(res); }}
              onCancel={() => { setMfa(null); setPassword(""); }}
            />
          ) : mode === "magicSent" ? (
            <div className="space-y-4">
              <p className="text-sm text-[#1B2C42]">
                If the account exists, a sign-in link has been sent to the registered email. It works once and expires in 15 minutes.
              </p>
              <Button type="button" variant="outline" className="w-full" onClick={() => setMode("password")}>Back to sign in</Button>
            </div>
          ) : mode === "magic" ? (
            <form onSubmit={handleMagicRequest} className="space-y-4">
              <p className="text-sm text-muted-foreground">We will email you a link that signs you in once, without your password.</p>
              <div className="space-y-2">
                <Label htmlFor="magic-email">Email</Label>
                <Input id="magic-email" type="email" autoComplete="email" placeholder="Enter your email"
                  value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
                {isLoading && <RotaryLoader size="sm" />}
                Send sign-in link
              </Button>
              <LinkButton onClick={() => { setError(""); setMode("password"); }} className="w-full">
                Sign in with password
              </LinkButton>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email</Label>
              <Input
                id="identifier"
                type="email"
                autoComplete="email"
                placeholder="Enter your email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  className="pr-11"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <IconButton
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </IconButton>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                  style={{ accentColor: "#F7A81B" }}
                />
                <span className="text-sm text-muted-foreground">Remember Me</span>
              </label>
              <Link
                href="/forgot-password"
                className="text-sm font-semibold text-primary hover:underline"
              >
                Forgot Password?
              </Link>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
              {isLoading && <RotaryLoader size="sm" />}
              Sign In
            </Button>

            <LinkButton onClick={() => { setError(""); setMode("magic"); }} className="w-full">
              Email me a sign-in link instead
            </LinkButton>
            <p className="text-center text-sm text-muted-foreground">
              Club executive without a password?{" "}
              <Link href="/exec-signin" className="font-semibold text-primary hover:underline">Sign in with an email code</Link>
            </p>
          </form>
          )}
        </CardContent>
      </Card>

      <ChangePasswordDialog
        required
        open={showChangePassword}
        onClose={() => {
          setShowChangePassword(false);
          router.push(returnPath() ?? "/admin");
        }}
      />
    </div>
  );
}
