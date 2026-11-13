"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CenteredCard from "@/components/CenteredCard";
import { ApiError, login, type LoginRequest } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";

// Same rule as the admin portal: a leading digit or "+" means a mobile number, otherwise email.
const isMobile = (v: string) => /^[+\d]/.test(v);

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-navy-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-700/20 focus-visible:ring-offset-0";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  const mobile = isMobile(identifier);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const id = identifier.trim();
    const payload: LoginRequest = mobile
      ? { countryCode: countryCode.trim(), mobileNumber: id, password }
      : { email: id, password };
    try {
      const res = await login(payload);
      setToken(res.token);
      router.replace("/");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't reach the server. Check your connection and try again.",
      );
      setBusy(false);
    }
  }

  return (
    <CenteredCard title="ROW Assistant">
      <p className="mb-5 text-sm text-slate-600">Sign in with your Rotary portal account.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="identifier" className="block text-sm font-medium text-slate-700">
            Email or mobile number
          </label>
          <div className="flex gap-2">
            {mobile && (
              <>
                <label htmlFor="countryCode" className="sr-only">
                  Country code
                </label>
                <input
                  id="countryCode"
                  type="text"
                  inputMode="tel"
                  autoComplete="tel-country-code"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  pattern="\+?[0-9]{1,4}"
                  required
                  className={`${inputClass} w-20 shrink-0`}
                />
              </>
            )}
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              autoFocus
              placeholder="Enter email or mobile number"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          {mobile && <p className="text-xs text-slate-500">Mobile number: check the country code.</p>}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={`${inputClass} pr-16`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-pressed={showPassword}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              {showPassword ? "Hide" : "Show"}
              <span className="sr-only"> password</span>
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-gold-600 disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </CenteredCard>
  );
}
