"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import { DayMonthPicker } from "@/components/DayMonthPicker";
import { BLOOD_GROUPS, GENDERS, LANGUAGES } from "@/lib/constants";
import {
  publicDirectoryGetConfig,
  publicDirectorySearch,
  publicDirectoryGetMasked,
  publicDirectorySendOtp,
  publicDirectoryVerifyOtp,
  publicDirectorySubmit,
  publicDirectoryUploadPhoto,
  publicDirectoryPhotoUrl,
  publicGetCountries,
  publicDirectoryAdminLogin,
  publicDirectoryAdminLoadFields,
} from "@/services/api";
import { Country } from "@/types/member";
import { tryValidateAndProcessUpload } from "@/lib/uploadValidate";

// "admin-login" is shown ONLY when the URL has &fetch=admin and the admin hasn't logged in yet.
// In admin mode, "masked" and "otp" are skipped — the admin selects a member and jumps to "form".
type Step = "admin-login" | "search" | "masked" | "otp" | "form" | "done";

interface FieldItem { key: string; label: string; section: string; type: string; value: string | null; }

export default function PublicDirectoryFormPage() {
  const params = useSearchParams();
  const urlHash = params.get("ID") ?? "";
  // Admin-proxy mode trigger. Manually appended to the URL by SuperAdmin when sharing with
  // the 2 contact persons. Normal flow (?ID=... only) is untouched.
  const isAdminMode = params.get("fetch") === "admin";

  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(isAdminMode ? "admin-login" : "search");

  // Admin-proxy login state (only used when isAdminMode === true)
  const [adminMobile, setAdminMobile] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminLoggingIn, setAdminLoggingIn] = useState(false);

  // search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ memberId: number; name: string; clubName: string }[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);

  // masked
  const [masked, setMasked] = useState<any>(null);

  // otp
  const [otpValue, setOtpValue] = useState("");
  // debugOtp removed post-go-live: the API no longer returns it on the public
  // directory link. Leaving the variable + Debug OTP <p> in place would just
  // show a stale undefined.
  // const [debugOtp, setDebugOtp] = useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);

  // form
  const [sessionToken, setSessionToken] = useState("");
  const [group, setGroup] = useState<"DC" | "BOD" | "Member" | "">("");
  const [fields, setFields] = useState<FieldItem[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [completion, setCompletion] = useState<{ filled: number; total: number; percent: number; pending: string[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  // Spouse — Not Applicable. Only meaningful when this config has at least one Family-section field.
  // When true, Family fields are hidden in the form AND skipped from the completion calc.
  const [spouseNotApplicable, setSpouseNotApplicable] = useState(false);
  const [hasSpouseFields, setHasSpouseFields] = useState(false);

  useEffect(() => {
    if (!urlHash) { setError("Invalid link"); setLoading(false); return; }
    (async () => {
      try {
        const [c, cs] = await Promise.all([
          publicDirectoryGetConfig(urlHash),
          publicGetCountries().catch(() => [] as Country[]),
        ]);
        setCfg(c);
        setCountries(cs);
      } catch (e: any) {
        setError(e?.response?.data?.message ?? "Invalid or expired link");
      } finally { setLoading(false); }
    })();
  }, [urlHash]);

  useEffect(() => {
    if (step !== "search") return;
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await publicDirectorySearch(urlHash, query.trim());
        setResults(r);
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [query, step, urlHash]);

  // Admin-proxy login. Validates mobile + password against the 2 contact rows on the config
  // and stores the returned token. On success, drops the admin into the normal member-search screen.
  const adminLogin = async () => {
    if (!adminMobile.trim() || !adminPassword) {
      setError("Mobile and password are required.");
      return;
    }
    setAdminLoggingIn(true);
    setError(null);
    try {
      const r = await publicDirectoryAdminLogin(urlHash, adminMobile.trim(), adminPassword);
      setAdminToken(r.adminToken);
      setAdminPassword("");
      setStep("search");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Invalid credentials");
    } finally {
      setAdminLoggingIn(false);
    }
  };

  const selectMember = async (memberId: number) => {
    setSelectedMemberId(memberId);
    // Admin-proxy path: skip masked + OTP entirely, fetch form fields directly.
    if (adminToken) {
      try {
        const r = await publicDirectoryAdminLoadFields(urlHash, memberId, adminToken);
        setGroup(r.group);
        setFields(r.fields);
        const initVals: Record<string, any> = {};
        for (const f of r.fields) initVals[f.key] = f.value ?? "";
        setValues(initVals);
        setCompletion(r.completion);
        setSpouseNotApplicable(!!r.spouseNotApplicable);
        setHasSpouseFields(!!r.hasSpouseFields);
        setStep("form");
      } catch (e: any) {
        // 401 = admin session expired — kick back to login.
        if (e?.response?.status === 401) {
          setAdminToken(null);
          setStep("admin-login");
        }
        setError(e?.response?.data?.message ?? "Failed to load member fields");
      }
      return;
    }
    // Normal flow — masked + OTP path (untouched).
    try {
      const m = await publicDirectoryGetMasked(urlHash, memberId);
      setMasked(m);
      setStep("masked");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Member not found");
    }
  };

  const requestOtp = async (channel: "email" | "sms" | "both") => {
    if (!selectedMemberId) return;
    setSendingOtp(true);
    try {
      await publicDirectorySendOtp(urlHash, selectedMemberId, channel);
      setStep("otp");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to send OTP");
    } finally { setSendingOtp(false); }
  };

  const verifyOtp = async () => {
    if (!selectedMemberId) return;
    try {
      const r = await publicDirectoryVerifyOtp(urlHash, selectedMemberId, otpValue);
      setSessionToken(r.sessionToken);
      setGroup(r.group);
      setFields(r.fields);
      const initVals: Record<string, any> = {};
      for (const f of r.fields) initVals[f.key] = f.value ?? "";
      setValues(initVals);
      setCompletion(r.completion);
      setSpouseNotApplicable(!!r.spouseNotApplicable);
      setHasSpouseFields(!!r.hasSpouseFields);
      setStep("form");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "OTP verification failed");
    }
  };

  const setAddressSubField = (fieldKey: string, sub: string, val: string) => {
    let current: any = {};
    try { current = values[fieldKey] ? JSON.parse(values[fieldKey]) : {}; } catch { current = {}; }
    current[sub] = val;
    setValues((v) => ({ ...v, [fieldKey]: JSON.stringify(current) }));
  };
  const getAddressSub = (fieldKey: string, sub: string) => {
    try { const p = values[fieldKey] ? JSON.parse(values[fieldKey]) : {}; return p[sub] ?? ""; } catch { return ""; }
  };

  const isFieldFilled = (f: FieldItem, raw: any): boolean => {
    if (f.type === "address-bulk") {
      try {
        const p = raw ? JSON.parse(raw) : {};
        return !!(p.Address && p.City && p.State && p.PinCode);
      } catch { return false; }
    }
    return !!(raw && String(raw).trim());
  };
  // Effective fields: when spouse is N/A, drop Family-section fields from progress calc + form view.
  const effectiveFields = spouseNotApplicable ? fields.filter((f) => f.section !== "Family") : fields;
  const filledCount = effectiveFields.filter((f) => isFieldFilled(f, values[f.key])).length;
  const totalCount = effectiveFields.length;
  const livePct = totalCount ? Math.round((100 * filledCount) / totalCount) : 0;

  const validateAddresses = (): string[] => {
    const errs: string[] = [];
    for (const f of fields) {
      if (f.type !== "address-bulk") continue;
      const raw = values[f.key];
      if (!raw) continue;
      let p: any = {};
      try { p = JSON.parse(raw); } catch { continue; }
      const anyFilled = !!(p.Address || p.City || p.State || p.PinCode || p.PhoneNumber || p.BusinessEmailId || p.Designation);
      const allCore = !!(p.Address && p.City && p.State && p.PinCode);
      if (anyFilled && !allCore) {
        errs.push(`${f.label}: please fill Address, City, State and PinCode — or clear all fields.`);
      }
    }
    return errs;
  };

  const submit = async () => {
    if (!selectedMemberId) return;
    const addrErrs = validateAddresses();
    if (addrErrs.length) { setError(addrErrs.join("\n")); return; }
    setSubmitting(true);
    try {
      const payload: Record<string, string | null> = {};
      // Send only non-spouse fields when spouse is N/A — backend already guards, but this avoids wasted bytes.
      for (const f of fields) {
        if (spouseNotApplicable && f.section === "Family") continue;
        payload[f.key] = values[f.key] ?? null;
      }
      // Pass adminToken when in admin-proxy mode — backend skips the per-member OTP session check.
      const r = await publicDirectorySubmit(urlHash, { memberId: selectedMemberId, sessionToken, fields: payload, spouseNotApplicable, adminToken: adminToken ?? undefined });
      setCompletion(r.completion);
      setSuccess(r.message ?? "Saved");
      setStep("done");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Save failed");
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RotaryLoader /></div>;

  // Disabled by the district admin → the public link is closed. Big red message, no form.
  if (cfg?.closed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center px-4">
        <Card className="max-w-lg w-full border-red-200 shadow-lg">
          <CardContent className="py-14 text-center space-y-4">
            <div className="text-5xl">🔒</div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-red-600 tracking-tight">Link is closed</h1>
            <p className="text-base text-muted-foreground">
              This directory data-collection link is currently closed
              {cfg.districtNumber ? <> for District <b>{cfg.districtNumber}</b></> : null}
              {cfg.yearLabel ? <> · {cfg.yearLabel}</> : null}.
              <br />Please contact your district office for assistance.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-primary">District Directory — Data Collection</CardTitle>
            {cfg && <p className="text-muted-foreground">District <b>{cfg.districtNumber}</b> &middot; Year <b>{cfg.yearLabel}</b></p>}
          </CardHeader>
          {cfg && (cfg.firstContactName || cfg.secondContactName) && (
            <CardContent className="text-sm text-muted-foreground text-center">
              For assistance:
              {cfg.firstContactName && <> <b>{cfg.firstContactName}</b>{cfg.firstContactMobile ? ` (${cfg.firstContactMobile})` : ""}</>}
              {cfg.secondContactName && <> {" or "} <b>{cfg.secondContactName}</b>{cfg.secondContactMobile ? ` (${cfg.secondContactMobile})` : ""}</>}
            </CardContent>
          )}
        </Card>

        <SuccessAlert open={!!success} title="Success" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error ?? ""} onOk={() => setError(null)} />

        {/* Admin-proxy login — shown only when URL has &fetch=admin and admin hasn't logged in.
            One of the 2 contact persons enters their mobile + password set by SuperAdmin. */}
        {step === "admin-login" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Admin Access</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                For First / Second contact persons only. Enter your registered mobile and password to fill the form on a member's behalf.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="mb-1 block">Mobile</Label>
                <Input
                  value={adminMobile}
                  onChange={(e) => setAdminMobile(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="e.g. 9238331991"
                  inputMode="numeric"
                  autoComplete="username"
                />
              </div>
              <div>
                <Label className="mb-1 block">Password</Label>
                <Input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  onKeyDown={(e) => { if (e.key === "Enter") adminLogin(); }}
                />
              </div>
              <Button onClick={adminLogin} disabled={adminLoggingIn || !adminMobile || !adminPassword} className="w-full">
                {adminLoggingIn ? "Logging in…" : "Log in"}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "search" && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Step 1 — Find your name</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Type your name (min 2 chars)" value={query} onChange={(e) => setQuery(e.target.value)} />
              {results.length > 0 && (
                <div className="border rounded-md divide-y max-h-80 overflow-y-auto">
                  {results.map((r) => (
                    <button key={r.memberId} onClick={() => selectMember(r.memberId)}
                            className="w-full text-left p-3 hover:bg-muted/50 text-sm">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.clubName}</div>
                    </button>
                  ))}
                </div>
              )}
              {query.trim().length >= 2 && results.length === 0 && (
                <p className="text-sm text-muted-foreground">No member found. Contact your district team.</p>
              )}
            </CardContent>
          </Card>
        )}

        {step === "masked" && masked && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Step 2 — Confirm your identity</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">We will send an OTP to your registered contact:</p>
              <div className="rounded-md bg-muted p-3 text-sm">
                <div><b>Name:</b> {masked.name}</div>
                {masked.hasMobile && <div><b>Mobile:</b> +91 {masked.maskedMobile}</div>}
                {masked.hasEmail && <div><b>Email:</b> {masked.maskedEmail}</div>}
              </div>
              {/* India members get SMS OTP only; outside-India members get Email OTP only —
                  the member's own country decides this, so there's exactly one working option
                  (server ignores the legacy channel picker for routing; "both" is kept as the
                  call shape). */}
              <div className="flex flex-wrap gap-2">
                {masked.otpChannel === "sms" ? (
                  masked.hasMobile ? (
                    <Button onClick={() => requestOtp("both")} disabled={sendingOtp}>Send OTP via SMS</Button>
                  ) : (
                    <p className="text-sm text-destructive">No mobile number on file — SMS OTP can&apos;t be sent. Please contact the district team.</p>
                  )
                ) : (
                  masked.hasEmail ? (
                    <Button onClick={() => requestOtp("both")} disabled={sendingOtp}>Send OTP via Email</Button>
                  ) : (
                    <p className="text-sm text-destructive">No email on file — Email OTP can&apos;t be sent. Please contact the district team.</p>
                  )
                )}
              </div>
              <Button variant="link" onClick={() => setStep("search")}>Back</Button>
            </CardContent>
          </Card>
        )}

        {step === "otp" && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Step 3 — Enter OTP</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="6-digit OTP" value={otpValue} onChange={(e) => setOtpValue(e.target.value)} maxLength={6} />
              {/* Debug OTP display removed post-go-live. */}
              <div className="flex gap-2">
                <Button onClick={verifyOtp} disabled={otpValue.length !== 6}>Verify</Button>
                <Button variant="outline" onClick={() => setStep("masked")}>Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "form" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 4 — Fill your details ({group})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>Progress</span>
                  <span className="font-medium">{filledCount}/{totalCount} ({livePct}%)</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${livePct}%` }} />
                </div>
              </CardContent>
            </Card>

            {Object.entries(groupBySection(fields)).map(([section, sectionFields]) => {
              const isFamily = section === "Family";
              const hideSpouseFields = isFamily && spouseNotApplicable;
              return (
              <Card key={section}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <CardTitle className="text-base">{section}</CardTitle>
                    {isFamily && hasSpouseFields && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={spouseNotApplicable}
                          onChange={(e) => setSpouseNotApplicable(e.target.checked)}
                        />
                        <span>Not Applicable (no spouse)</span>
                      </label>
                    )}
                  </div>
                  {isFamily && hideSpouseFields && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Spouse fields are hidden and won&apos;t affect your completion %. Untick the box above if you want to fill them.
                    </p>
                  )}
                </CardHeader>
                {!hideSpouseFields && (
                <CardContent className="space-y-3">
                  {sectionFields.map((f) => {
                    const filled = isFieldFilled(f, values[f.key]);
                    const wrapCls = `rounded-md p-3 border-l-4 ${filled ? "bg-green-50/40 border-green-500" : "bg-amber-50/40 border-amber-500"}`;
                    const pill = filled
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">✓ Filled</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">⚠ Pending</span>;
                    const labelRow = (
                      <div className="flex items-center justify-between mb-1">
                        <Label className="m-0">{f.label}</Label>
                        {pill}
                      </div>
                    );

                    if (f.type === "address-bulk") {
                      const isBiz = f.key === "businessAddress";
                      const currentCountry = getAddressSub(f.key, "CountryId");
                      const currentCountryStr = currentCountry ? String(currentCountry) : "";
                      const currentState = getAddressSub(f.key, "State");
                      // Live validation: if any sub-field has a value, ALL core (Address/City/State/PinCode) must be filled
                      let p: any = {};
                      try { p = values[f.key] ? JSON.parse(values[f.key]) : {}; } catch {}
                      const anyFilled = !!(p.Address || p.City || p.State || p.PinCode || p.PhoneNumber || p.BusinessEmailId || p.Designation);
                      const missing = [
                        !p.Address ? "Address" : null,
                        !p.City ? "City" : null,
                        !p.State ? "State" : null,
                        !p.PinCode ? "PinCode" : null,
                      ].filter(Boolean) as string[];
                      const showValidationErr = anyFilled && missing.length > 0;
                      const invCls = "border-red-400 ring-1 ring-red-300";
                      return (
                        <div key={f.key} className={wrapCls + " space-y-2"}>
                          <div className="flex items-center justify-between">
                            <div className="font-medium text-sm">{f.label}</div>
                            {pill}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="md:col-span-2"><Label>Address <span className="text-red-500">*</span></Label><Textarea rows={2} className={showValidationErr && !p.Address ? invCls : ""} value={getAddressSub(f.key, "Address")} onChange={(e) => setAddressSubField(f.key, "Address", e.target.value)} /></div>
                            <div><Label>City <span className="text-red-500">*</span></Label><Input type="text" className={showValidationErr && !p.City ? invCls : ""} value={getAddressSub(f.key, "City")} onChange={(e) => setAddressSubField(f.key, "City", e.target.value)} /></div>
                            <div>
                              <Label>State <span className="text-red-500">*</span></Label>
                              <Input
                                type="text"
                                className={showValidationErr && !p.State ? invCls : ""}
                                value={currentState || ""}
                                onChange={(e) => setAddressSubField(f.key, "State", e.target.value)}
                                placeholder="Enter state"
                              />
                            </div>
                            <div><Label>Pincode <span className="text-red-500">*</span></Label><Input type="text" className={showValidationErr && !p.PinCode ? invCls : ""} value={getAddressSub(f.key, "PinCode")} onChange={(e) => setAddressSubField(f.key, "PinCode", e.target.value.replace(/[^0-9]/g, ""))} /></div>
                            <div>
                              <Label>Country</Label>
                              <Select value={currentCountryStr || undefined} onValueChange={(v) => setAddressSubField(f.key, "CountryId", v)}>
                                <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                                <SelectContent>
                                  {countries.map((c) => (<SelectItem key={c.id} value={String(c.id)}>{c.countryName}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div><Label>Phone Number</Label><Input type="tel" value={getAddressSub(f.key, "PhoneNumber")} onChange={(e) => setAddressSubField(f.key, "PhoneNumber", e.target.value.replace(/[^0-9+]/g, ""))} /></div>
                            {isBiz && <>
                              <div><Label>Business Email</Label><Input type="email" value={getAddressSub(f.key, "BusinessEmailId")} onChange={(e) => setAddressSubField(f.key, "BusinessEmailId", e.target.value)} /></div>
                              <div><Label>Designation</Label><Input type="text" value={getAddressSub(f.key, "Designation")} onChange={(e) => setAddressSubField(f.key, "Designation", e.target.value)} /></div>
                            </>}
                          </div>
                          {showValidationErr && (
                            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
                              ⚠ Please fill <b>{missing.join(", ")}</b> — or clear ALL address fields to leave this block blank.
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (f.type === "textarea") return (
                      <div key={f.key} className={wrapCls}>{labelRow}<Textarea value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></div>
                    );
                    // All "date" fields here are birth-of-something / anniversary —
                    // we only collect day + month per project rule (year stored as
                    // 1900 placeholder). DayMonthPicker handles parsing the
                    // incoming "YYYY-MM-DD" and emits "1900-MM-DD" on change.
                    if (f.type === "date") return (
                      <div key={f.key} className={wrapCls}>{labelRow}<DayMonthPicker value={values[f.key] ?? null} onChange={(v) => setValues({ ...values, [f.key]: v ?? "" })} /></div>
                    );
                    if (f.type === "image") return (
                      <div key={f.key} className={wrapCls}>
                        {labelRow}
                        <PhotoField
                          field={f}
                          value={values[f.key] ?? ""}
                          onChange={(v) => setValues({ ...values, [f.key]: v })}
                          urlHash={urlHash}
                          memberId={selectedMemberId!}
                          sessionToken={sessionToken}
                          adminToken={adminToken ?? undefined}
                          hideOwnLabel
                        />
                      </div>
                    );
                    if (f.type === "bloodgroup") return (
                      <div key={f.key} className={wrapCls}>
                        {labelRow}
                        <Select value={values[f.key] || undefined} onValueChange={(v) => setValues({ ...values, [f.key]: v })}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{BLOOD_GROUPS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    );
                    if (f.type === "gender") return (
                      <div key={f.key} className={wrapCls}>
                        {labelRow}
                        <Select value={values[f.key] || undefined} onValueChange={(v) => setValues({ ...values, [f.key]: v })}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{GENDERS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    );
                    if (f.type === "language") return (
                      <div key={f.key} className={wrapCls}>
                        {labelRow}
                        <Select value={values[f.key] || undefined} onValueChange={(v) => setValues({ ...values, [f.key]: v })}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{LANGUAGES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    );
                    if (f.type === "email") return (
                      <div key={f.key} className={wrapCls}>{labelRow}<Input type="email" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></div>
                    );
                    if (f.type === "url") return (
                      <div key={f.key} className={wrapCls}>{labelRow}<Input type="url" placeholder="https://..." value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></div>
                    );
                    if (f.type === "tel") return (
                      <div key={f.key} className={wrapCls}>{labelRow}<Input type="tel" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value.replace(/[^0-9+]/g, "") })} /></div>
                    );
                    if (f.type === "digits") return (
                      <div key={f.key} className={wrapCls}>{labelRow}<Input type="text" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value.replace(/[^0-9]/g, "") })} /></div>
                    );
                    // Default: plain text (text, address-single)
                    return (
                      <div key={f.key} className={wrapCls}>{labelRow}<Input type="text" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></div>
                    );
                  })}
                </CardContent>
                )}
              </Card>
              );
            })}

            <div className="flex justify-end">
              <Button onClick={submit} disabled={submitting} size="lg">{submitting ? "Saving..." : "Submit"}</Button>
            </div>
          </>
        )}

        {step === "done" && completion && (
          <Card>
            <CardHeader><CardTitle className="text-lg text-green-700">Thank you!</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p>Your data has been saved for District <b>{cfg?.districtNumber}</b> ({cfg?.yearLabel}).</p>
              <p>Status: <b>{completion.filled}/{completion.total}</b> fields — <b>{completion.percent}%</b>.</p>
              {completion.pending.length > 0 && (
                <>
                  <p className="text-sm font-medium">Pending fields:</p>
                  <ol className="list-decimal ml-5 text-sm text-muted-foreground">
                    {completion.pending.map((p, i) => <li key={i}>{p}</li>)}
                  </ol>
                </>
              )}
              <p className="text-xs text-muted-foreground">A confirmation has been sent to your email and WhatsApp.</p>
              <div className="pt-3">
                <a
                  href={`/public/directory-data-collection?ID=${urlHash}${isAdminMode ? "&fetch=admin" : ""}`}
                  className="text-primary underline text-sm hover:text-primary/80"
                >
                  🔄 Reopen form to verify or update again
                </a>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function groupBySection(fields: FieldItem[]): Record<string, FieldItem[]> {
  const out: Record<string, FieldItem[]> = {};
  for (const f of fields) {
    if (!out[f.section]) out[f.section] = [];
    out[f.section].push(f);
  }
  return out;
}

interface PhotoFieldProps {
  field: FieldItem;
  value: string;
  onChange: (v: string) => void;
  urlHash: string;
  memberId: number;
  sessionToken: string;
  adminToken?: string;
  hideOwnLabel?: boolean;
}

function PhotoField({ field, value, onChange, urlHash, memberId, sessionToken, adminToken, hideOwnLabel }: PhotoFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const kind: "profile" | "spouse" = field.key === "spousePhoto" ? "spouse" : "profile";

  const handleFile = async (file: File) => {
    setErr(null);
    setUploading(true);
    try {
      // Phone photos are routinely 6-15 MB and often HEIC; the API rejects both.
      // Compress + re-encode to JPEG ≤ 5 MB in the browser before upload.
      const result = await tryValidateAndProcessUpload(file, /* treatAsImage */ true);
      if (!result.ok) { setErr(result.error); return; }
      const r = await publicDirectoryUploadPhoto(urlHash, memberId, sessionToken, kind, result.file, adminToken);
      onChange(r.path);
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = () => onChange("");

  const preview = value ? publicDirectoryPhotoUrl(value) : "";

  return (
    <div>
      {!hideOwnLabel && <Label>{field.label}</Label>}
      <div className="flex items-center gap-3 mt-1">
        {preview ? (
          <img src={preview} alt={field.label} className="h-24 w-24 object-cover rounded-md border" />
        ) : (
          <div className="h-24 w-24 rounded-md border border-dashed flex items-center justify-center text-xs text-muted-foreground bg-muted/30">No photo</div>
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading..." : value ? "Change Photo" : "Upload Photo"}
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={remove} disabled={uploading}>
              Remove
            </Button>
          )}
          <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, WEBP</p>
        </div>
      </div>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
      <p className="text-xs text-muted-foreground mt-1">JPG / PNG / WEBP, max 5 MB</p>
    </div>
  );
}
