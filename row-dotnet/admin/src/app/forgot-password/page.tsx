"use client";

import { useBrand } from "@/contexts/BrandContext";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
import { forgotPassword, getCountries } from "@/services/api";
import { Country } from "@/types/member";

type InputMode = "unknown" | "email" | "mobile";

function detectInputMode(value: string): InputMode {
  if (!value) return "unknown";
  const first = value[0];
  if (first === "+" || /\d/.test(first)) return "mobile";
  return "email";
}

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [countries, setCountries] = useState<Country[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const brand = useBrand();
  const inputMode = detectInputMode(identifier);

  useEffect(() => {
    getCountries()
      .then(setCountries)
      .catch(() => {});
  }, []);

  // ROW: the code starts on the brand's default country (none when Brand:Locale:DefaultCountryId is 0).
  useEffect(() => {
    const c = countries.find((x) => x.id === brand.locale.defaultCountryId);
    if (c?.phoneCode) setCountryCode((cur) => cur || c.phoneCode);
  }, [countries, brand.locale.defaultCountryId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const payload =
        inputMode === "mobile"
          ? { countryCode, mobileNumber: identifier }
          : { email: identifier };

      await forgotPassword(payload);
      setSubmitted(true);
    } catch {
      setSubmitted(true);
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
              src="/brand/row-logo-badge.png"
              alt="Roster On Wheels"
              className="h-16 object-contain"
            />
            <div>
              <CardTitle className="text-xl text-white">Forgot Password</CardTitle>
              <p className="text-sm text-white/70 mt-0.5">Reset your account password</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {submitted ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                If the account exists, a password reset link has been sent to the
                registered email address.
              </p>
              <Link href="/login">
                <Button
                  variant="outline"
                  className="w-full font-semibold hover:opacity-90"
                  style={{ borderColor: "#1e3a5f", color: "#1e3a5f" }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Login
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier">Email or Mobile Number</Label>
                {inputMode === "mobile" && (
                  <Select value={countryCode} onValueChange={setCountryCode}>
                    <SelectTrigger className="mb-2">
                      <SelectValue placeholder="Country code" />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map((c) => (
                        <SelectItem key={c.id} value={c.phoneCode}>
                          {c.phoneCode} - {c.countryName}
                        </SelectItem>
                      ))}
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
                Send Reset Link
              </Button>

              <div className="text-center">
                <Link
                  href="/login"
                  className="text-sm font-medium hover:underline"
                  style={{ color: "#1e3a5f" }}
                >
                  Back to Login
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
