"use client";

import { useState } from "react";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import { ArrowLeft } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { forgotPassword } from "@/services/api";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // ROW resets by email only.
      await forgotPassword({ email: identifier.trim() });
      setSubmitted(true);
    } catch {
      setSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md overflow-hidden rounded-[var(--row-panel-r)] border border-[color:var(--row-line)] shadow-none">
        <CardHeader className="gap-6 px-7 pb-2 pt-7">
          <BrandLogo className="h-14 self-start" />
          <div>
            <CardTitle className="font-display text-3xl font-semibold tracking-tight text-foreground">Forgot Password</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Reset your account password</p>
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
                  style={{ borderColor: "#17458f", color: "#17458f" }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Login
                </Button>
              </Link>
            </div>
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

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full font-semibold hover:opacity-90"
                style={{ backgroundColor: "#F7A81B", color: "#17458f" }}
                disabled={isLoading}
              >
                {isLoading && <RotaryLoader size="sm" />}
                Send Reset Link
              </Button>

              <div className="text-center">
                <Link
                  href="/login"
                  className="text-sm font-medium hover:underline"
                  style={{ color: "#17458f" }}
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
