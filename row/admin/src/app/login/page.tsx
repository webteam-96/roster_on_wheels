"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import LanguagePicker from "@/components/LanguagePicker";
import BrandLogo from "@/components/BrandLogo";
import { login as loginApi, resolveDashboardLanding } from "@/services/api";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    // Restore remembered login details
    const remembered = localStorage.getItem("remember_me");
    if (remembered) {
      const data = JSON.parse(remembered);
      setIdentifier(data.identifier || "");
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // ROW signs in by email only.
      const response = await loginApi({ email: identifier.trim(), password });

      // Save or clear remember me
      if (rememberMe) {
        localStorage.setItem("remember_me", JSON.stringify({ identifier }));
      } else {
        localStorage.removeItem("remember_me");
      }

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
        router.push(landingRoute);
      }
    } catch {
      setError("Invalid credentials. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      {/* The logo artwork has a white field, so it sits on the light card itself: no dark band, no plate. */}
      <Card className="w-full max-w-md overflow-hidden rounded-[20px] border border-[color:var(--row-line)]">
        <CardHeader className="gap-6 px-7 pb-2 pt-7">
          <div className="flex items-start justify-between gap-3">
            <BrandLogo className="h-14" />
            <LanguagePicker />
          </div>
          <CardTitle className="font-display text-3xl font-semibold tracking-tight text-foreground">Sign In</CardTitle>
        </CardHeader>
        <CardContent className="px-7 pb-7 pt-6">
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
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
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

          </form>
        </CardContent>
      </Card>

      <ChangePasswordDialog
        open={showChangePassword}
        onClose={() => {
          setShowChangePassword(false);
          router.push("/admin");
        }}
      />
    </div>
  );
}
