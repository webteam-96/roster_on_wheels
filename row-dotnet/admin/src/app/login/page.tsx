"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { login as loginApi, getCountries, resolveDashboardLanding } from "@/services/api";
import { Country } from "@/types/member";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";

type InputMode = "unknown" | "email" | "mobile";

function detectInputMode(value: string): InputMode {
  if (!value) return "unknown";
  const first = value[0];
  if (first === "+" || /\d/.test(first)) return "mobile";
  return "email";
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [countries, setCountries] = useState<Country[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const inputMode = detectInputMode(identifier);

  useEffect(() => {
    getCountries()
      .then(setCountries)
      .catch(() => {});

    // Restore remembered login details
    const remembered = localStorage.getItem("remember_me");
    if (remembered) {
      const data = JSON.parse(remembered);
      setIdentifier(data.identifier || "");
      setCountryCode(data.countryCode || "+91");
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const payload =
        inputMode === "mobile"
          ? { countryCode, mobileNumber: identifier, password }
          : { email: identifier, password };

      const response = await loginApi(payload);

      // Save or clear remember me
      if (rememberMe) {
        localStorage.setItem("remember_me", JSON.stringify({ identifier, countryCode }));
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
          else if (response.roles.includes("RIDirector")) landingRoute = "/ri-director/v2";
          else if (response.roles.includes("ZonalCoordinator")) landingRoute = "/zonal-dashboard";
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
    <div className="flex min-h-[80vh] items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md overflow-hidden border-t-4" style={{ borderTopColor: "#F7A81B" }}>
        <CardHeader className="text-white rounded-t-none" style={{ backgroundColor: "#0f172a" }}>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/rotary-white-live.png"
              alt="Rotary"
              className="h-16 object-contain"
            />
            <CardTitle className="text-xl text-white">Sign In</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or Mobile Number</Label>
              {inputMode === "mobile" && (
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger className="mb-2">
                    <SelectValue placeholder="Country code" />
                  </SelectTrigger>
                  <SelectContent>
                    {countries.length > 0
                      ? Array.from(
                          countries
                            .filter((c) => c.phoneCode)
                            .reduce((map, c) => {
                              if (!map.has(c.phoneCode)) map.set(c.phoneCode, c.countryName);
                              else map.set(c.phoneCode, map.get(c.phoneCode) + ", " + c.countryName);
                              return map;
                            }, new Map<string, string>())
                        ).map(([code, names]) => (
                          <SelectItem key={code} value={code}>
                            {code} - {names}
                          </SelectItem>
                        ))
                      : <SelectItem value="+91">+91 - India</SelectItem>
                    }
                  </SelectContent>
                </Select>
              )}
              <Input
                id="identifier"
                type="text"
                placeholder="Enter email or mobile number"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
              {inputMode === "unknown" && identifier === "" && (
                <p className="text-xs text-muted-foreground">
                  Start typing: digits for mobile, letters for email
                </p>
              )}
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

            <div className="flex items-center justify-between">
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
                className="text-sm font-medium hover:underline"
                style={{ color: "#1e3a5f" }}
              >
                Forgot Password?
              </Link>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full font-semibold hover:opacity-90"
              style={{ backgroundColor: "#F7A81B", color: "#1e3a5f" }}
              disabled={isLoading}
            >
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
