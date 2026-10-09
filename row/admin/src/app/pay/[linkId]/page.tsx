"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getPublicEventLink, getPublicEventClubs, searchPublicEventMembers,
  sendPublicEventOtp, verifyPublicEventOtp, createPublicEventOrder,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Build a hidden form and submit it as POST. Used to send the proxy params in
// the request body (not the URL) so WAF/ModSecurity URL-based rules don't 403.
function postRedirect(url: string) {
  const u = new URL(url);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${u.origin}${u.pathname}`;
  u.searchParams.forEach((value, key) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

interface EventLink {
  id: number;
  formType: number;
  title?: string;
  description?: string;
  purposeEventImage?: string;
  purposeLogo?: string;
  backgroundImage?: string;
  isForm: boolean;
  isTshirtSize: boolean;
  isFood: boolean;
  foodPreferenceIds?: string;
  isPartner: boolean;
  isPartnerName: boolean;
  isPartnerMobile: boolean;
  isPartnerEmail: boolean;
  isPartnerGender: boolean;
  isRemark1: boolean;
  remark1Title?: string;
  isRemark2: boolean;
  remark2Title?: string;
  isRemark3: boolean;
  remark3Title?: string;
  isDesignation: boolean;
  designationLabel?: string;
  isPersonal: boolean;
  isPersonalName: boolean;
  isPersonalMobile: boolean;
  isPersonalEmail: boolean;
  isPersonalDistrict: boolean;
  isPersonalClub: boolean;
  isForAllDistricts: boolean;
  districtIdsList?: string;
  fkDistrictMasterId?: number;
  fkClubId?: number;
  districtNumber?: string;
  clubName?: string;
  registrations: Array<{ id: number; registrationName: string; amount: number }>;
  designations: Array<{ id: number; designationName: string }>;
  tshirtSizes: Array<{ id: number; sizeName: string }>;
  foodPreferences: Array<{ id: number; foodType: string }>;
  districts: Array<{ id: number; districtNumber: string }>;
}

interface SearchMember {
  memberProfileId: number;
  memberName?: string;
  maskedMobile?: string;
  maskedEmail?: string;
  isPaid?: boolean;
}

interface Club {
  id: number;
  clubName: string;
}

type Step = "details" | "otp" | "form" | "paying";

export default function PublicPaymentPage() {
  const params = useParams();
  const router = useRouter();
  const linkId = Number(params.linkId);

  const [eventLink, setEventLink] = useState<EventLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("details");

  // Standard form - member search
  const [selectedDistrictId, setSelectedDistrictId] = useState("");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState("");
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<SearchMember | null>(null);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Dynamic form - personal details
  const [personalName, setPersonalName] = useState("");
  const [personalMobile, setPersonalMobile] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [personalDistrict, setPersonalDistrict] = useState("");
  const [personalClub, setPersonalClub] = useState("");

  // OTP
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // Registration form
  const [selectedRegId, setSelectedRegId] = useState("");
  const [selectedTshirtId, setSelectedTshirtId] = useState("");
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [partnerMobile, setPartnerMobile] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [partnerGender, setPartnerGender] = useState("");
  const [remark1, setRemark1] = useState("");
  const [remark2, setRemark2] = useState("");
  const [remark3, setRemark3] = useState("");
  const [selectedDesigId, setSelectedDesigId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getPublicEventLink(linkId);
        setEventLink(data);
      } catch {
        setError("This payment link is not available or has been deactivated.");
      } finally {
        setLoading(false);
      }
    })();
  }, [linkId]);

  // Load clubs: for single district auto-load, for multiple districts load when selected
  useEffect(() => {
    const distId = selectedDistrictId || (eventLink?.fkDistrictMasterId && !eventLink?.fkClubId ? String(eventLink.fkDistrictMasterId) : null);
    if (!distId) { setClubs([]); return; }
    (async () => {
      try {
        const data = await getPublicEventClubs(linkId, Number(distId));
        setClubs(data);
      } catch { setClubs([]); }
    })();
  }, [linkId, selectedDistrictId, eventLink?.fkDistrictMasterId, eventLink?.fkClubId]);

  // Debounced autocomplete search — same pattern as /pay/dues. Type 2+ chars, wait 300ms, popup dropdown.
  useEffect(() => {
    const q = memberSearchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setDropdownOpen(false);
      return;
    }
    if (selectedMember && q === selectedMember.memberName) return;

    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const clubId = eventLink?.fkClubId || (selectedClubId ? Number(selectedClubId) : undefined);
        const districtId = selectedDistrictId ? Number(selectedDistrictId) : (eventLink?.fkDistrictMasterId || undefined);
        const data = await searchPublicEventMembers(linkId, { districtId, clubId, query: q });
        const arr = Array.isArray(data) ? data : [];
        setSearchResults(arr);
        setDropdownOpen(arr.length > 0);
      } catch {
        setSearchResults([]);
        setDropdownOpen(false);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(handle);
  }, [memberSearchQuery, linkId, selectedDistrictId, selectedClubId, eventLink?.fkClubId, eventLink?.fkDistrictMasterId, selectedMember]);

  // Click outside to close the dropdown.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleSendOtp = async () => {
    setOtpSending(true);
    setOtpError(null);
    try {
      let email: string | undefined;
      let mobile: string | undefined;
      let memberProfileId: number | undefined;
      if (eventLink?.formType === 1 && selectedMember) {
        // For standard form, send memberProfileId — backend will look up email/mobile
        memberProfileId = selectedMember.memberProfileId;
      } else {
        email = personalEmail || undefined;
        mobile = personalMobile || undefined;
      }
      const result = await sendPublicEventOtp(linkId, { email, mobile, memberProfileId });
      if (result.success) {
        setOtpSent(true);
        setStep("otp");
      } else {
        setOtpError(result.message || "Failed to send OTP.");
      }
    } catch (err: any) {
      setOtpError(err?.response?.data?.message || "Failed to send OTP.");
    } finally { setOtpSending(false); }
  };

  const handleVerifyOtp = async () => {
    setOtpVerifying(true);
    setOtpError(null);
    try {
      let email: string | undefined;
      let mobile: string | undefined;
      let memberProfileId: number | undefined;
      if (eventLink?.formType === 1 && selectedMember) {
        memberProfileId = selectedMember.memberProfileId;
      } else {
        email = personalEmail || undefined;
        mobile = personalMobile || undefined;
      }
      const result = await verifyPublicEventOtp(linkId, { email, mobile, otpCode, memberProfileId });
      if (result.success) {
        setOtpVerified(true);
        setStep("form");
      } else {
        setOtpError("Invalid or expired OTP. Please try again.");
      }
    } catch (err: any) {
      setOtpError(err?.response?.data?.message || "OTP verification failed.");
    } finally { setOtpVerifying(false); }
  };

  const handleSubmitPayment = async () => {
    if (!selectedRegId) { setSubmitError("Please select a registration type."); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: any = {
        fkRegistrationId: Number(selectedRegId),
        fkTshirtSizeId: selectedTshirtId ? Number(selectedTshirtId) : null,
        fkFoodPreferenceId: selectedFoodId ? Number(selectedFoodId) : null,
        partnerName: partnerName || null,
        partnerMobile: partnerMobile || null,
        partnerEmail: partnerEmail || null,
        partnerGender: partnerGender || null,
        remark1: remark1 || null,
        remark2: remark2 || null,
        remark3: remark3 || null,
        fkDesignationId: selectedDesigId ? Number(selectedDesigId) : null,
      };

      if (eventLink?.formType === 1 && selectedMember) {
        payload.fkMemberProfileId = selectedMember.memberProfileId;
      } else {
        payload.memberName = personalName;
        payload.mobile = personalMobile;
        payload.email = personalEmail;
        payload.districtNumber = personalDistrict;
        payload.clubName = personalClub;
      }

      const result = await createPublicEventOrder(linkId, payload);
      setStep("paying");

      // Preferred path: redirect to the shared Cashfree proxy on kaizeninfotech.com
      // (which Cashfree has whitelisted). The proxy renders the SDK + handles the return.
      // POST instead of GET — the long `return_url=https%3A%2F%2F...` query string
      // triggers WAF/ModSecurity open-redirect rules; POST body bypasses URL-based filters.
      if (result.gatewayProxyUrl) {
        postRedirect(result.gatewayProxyUrl);
        return;
      }

      // Fallback (sandbox / proxy not configured): open Cashfree SDK directly
      if (result.paymentSessionId) {
        const script = document.createElement("script");
        script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
        script.onload = () => {
          const cashfree = (window as any).Cashfree({ mode: result.environment === "sandbox" ? "sandbox" : "production" });
          cashfree.checkout({
            paymentSessionId: result.paymentSessionId,
            redirectTarget: "_self",
            returnUrl: `${window.location.origin}/pay/${linkId}/thank-you?orderId=${result.orderId}&memberPaymentId=${result.memberPaymentId}`,
          });
        };
        document.head.appendChild(script);
      }
    } catch (err: any) {
      setSubmitError(err?.response?.data?.message || "Failed to create payment order.");
      setStep("form");
    } finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !eventLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h3 className="text-lg font-semibold">{error || "Payment link not found"}</h3>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedReg = eventLink.registrations.find(r => r.id === Number(selectedRegId));

  return (
    <div className="min-h-screen bg-gray-50" style={{ backgroundImage: eventLink.backgroundImage ? `url(${API_BASE_URL}${eventLink.backgroundImage})` : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", backgroundSize: "cover", backgroundPosition: "center" }}>
      <div className="max-w-2xl mx-auto py-8 px-4">
        {/* Header */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-4">
              <img src={eventLink.purposeLogo ? `${API_BASE_URL}${eventLink.purposeLogo}` : "/images/rotary-logo.png"} alt="Logo" className="h-16 w-16 object-contain rounded" />
              <div>
                <h1 className="text-2xl font-bold text-primary">{eventLink.title}</h1>
                {eventLink.description && <p className="text-muted-foreground mt-1">{eventLink.description}</p>}
              </div>
            </div>
            {/* Show district/club info based on form config */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mb-2">
              {eventLink.formType === 1 && eventLink.isForAllDistricts && eventLink.districts.length > 0 && (
                <span><strong>Districts:</strong> {eventLink.districts.map(d => d.districtNumber).join(", ")}</span>
              )}
              {eventLink.formType === 1 && !eventLink.isForAllDistricts && eventLink.districtNumber && (
                <span><strong>District:</strong> {eventLink.districtNumber}</span>
              )}
              {eventLink.formType === 1 && !eventLink.isForAllDistricts && eventLink.clubName && (
                <span><strong>Club:</strong> {eventLink.clubName}</span>
              )}
            </div>
            {eventLink.purposeEventImage && (
              <img src={`${API_BASE_URL}${eventLink.purposeEventImage}`} alt="Event" className="w-full rounded-lg max-h-64 object-cover" />
            )}
          </CardContent>
        </Card>

        {/* Step: Details (Standard - member search / Dynamic - personal info) */}
        {step === "details" && (
          <Card>
            <CardHeader>
              <CardTitle>{eventLink.formType === 1 ? "Find Your Membership" : "Your Details"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {eventLink.formType === 1 ? (
                <>
                  {/* Multiple districts: show district dropdown */}
                  {eventLink.isForAllDistricts && eventLink.districts.length > 0 && (
                    <div>
                      <Label>Select District *</Label>
                      <Select value={selectedDistrictId} onValueChange={v => { setSelectedDistrictId(v); setSelectedClubId(""); setSearchResults([]); setSelectedMember(null); }}>
                        <SelectTrigger><SelectValue placeholder="Choose district" /></SelectTrigger>
                        <SelectContent>
                          {eventLink.districts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Single district without club OR multiple districts after district selected: show club dropdown */}
                  {((!eventLink.isForAllDistricts && !eventLink.fkClubId && eventLink.fkDistrictMasterId) ||
                    (eventLink.isForAllDistricts && selectedDistrictId)) && clubs.length > 0 && (
                    <div>
                      <Label>Select Club *</Label>
                      <Select value={selectedClubId} onValueChange={v => { setSelectedClubId(v); setSearchResults([]); setSelectedMember(null); }}>
                        <SelectTrigger><SelectValue placeholder="Choose club" /></SelectTrigger>
                        <SelectContent>
                          {clubs.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Show member search when ready:
                      - Club-specific link: show directly
                      - Single district: after club selected
                      - Multiple districts: after district + club selected */}
                  {(eventLink.fkClubId ||
                    (!eventLink.isForAllDistricts && !eventLink.fkClubId && selectedClubId) ||
                    (eventLink.isForAllDistricts && selectedClubId)) && (
                    <div ref={searchBoxRef}>
                      <Label>Search Member *</Label>
                      <div className="relative">
                        <Input
                          value={memberSearchQuery}
                          onChange={e => {
                            setMemberSearchQuery(e.target.value);
                            if (selectedMember && e.target.value !== selectedMember.memberName) {
                              setSelectedMember(null);
                            }
                          }}
                          onFocus={() => { if (searchResults.length > 0) setDropdownOpen(true); }}
                          placeholder="Start typing name or mobile…"
                          className="pr-9"
                          autoComplete="off"
                        />
                        {searching && (
                          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                        {dropdownOpen && searchResults.length > 0 && (
                          <div className="absolute z-20 mt-1 w-full bg-white border rounded-md shadow-lg max-h-72 overflow-y-auto">
                            {searchResults.map(m => (
                              <button
                                type="button"
                                key={m.memberProfileId}
                                disabled={m.isPaid}
                                onClick={() => {
                                  if (m.isPaid) return;
                                  setSelectedMember(m);
                                  setMemberSearchQuery(m.memberName ?? "");
                                  setDropdownOpen(false);
                                }}
                                className={`block w-full text-left px-3 py-2 transition-colors border-b last:border-b-0 ${
                                  m.isPaid
                                    ? "opacity-60 cursor-not-allowed bg-gray-50"
                                    : selectedMember?.memberProfileId === m.memberProfileId
                                      ? "bg-primary/5 hover:bg-primary/10"
                                      : "hover:bg-primary/10"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-medium text-sm truncate">{m.memberName}</p>
                                    <p className="text-xs text-muted-foreground truncate">{m.maskedMobile} | {m.maskedEmail}</p>
                                  </div>
                                  {m.isPaid && (
                                    <span className="text-[10px] font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded whitespace-nowrap">Already Paid</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {memberSearchQuery.trim().length >= 2 && !searching && searchResults.length === 0 && dropdownOpen && (
                          <div className="absolute z-20 mt-1 w-full bg-white border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
                            No members found for &quot;{memberSearchQuery}&quot;.
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Type 2+ characters — matches appear automatically.</p>
                    </div>
                  )}

                  {selectedMember && (
                    <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="font-medium text-green-800">Selected: {selectedMember.memberName}</span>
                    </div>
                  )}
                  {selectedMember && (
                    <Button onClick={handleSendOtp} disabled={otpSending} className="w-full">
                      {otpSending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending OTP...</> : "Send OTP & Continue"}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {eventLink.isPersonalName && <div><Label>Full Name *</Label><Input value={personalName} onChange={e => setPersonalName(e.target.value)} placeholder="Your full name" /></div>}
                  {eventLink.isPersonalMobile && <div><Label>Mobile Number *</Label><Input value={personalMobile} onChange={e => setPersonalMobile(e.target.value)} placeholder="10-digit mobile" /></div>}
                  {eventLink.isPersonalEmail && <div><Label>Email</Label><Input type="email" value={personalEmail} onChange={e => setPersonalEmail(e.target.value)} placeholder="your@email.com" /></div>}
                  {eventLink.isPersonalDistrict && eventLink.districts.length > 0 && (
                    <div>
                      <Label>District</Label>
                      <Select value={personalDistrict} onValueChange={setPersonalDistrict}>
                        <SelectTrigger><SelectValue placeholder="Select district" /></SelectTrigger>
                        <SelectContent>
                          {eventLink.districts.map(d => <SelectItem key={d.id} value={d.districtNumber}>{d.districtNumber}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {eventLink.isPersonalClub && <div><Label>Club Name</Label><Input value={personalClub} onChange={e => setPersonalClub(e.target.value)} placeholder="Club name" /></div>}
                  <Button onClick={handleSendOtp} disabled={otpSending || (!personalMobile && !personalEmail)} className="w-full">
                    {otpSending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending OTP...</> : "Send OTP & Continue"}
                  </Button>
                </>
              )}
              {otpError && <p className="text-sm text-destructive">{otpError}</p>}
            </CardContent>
          </Card>
        )}

        {/* Step: OTP Verification */}
        {step === "otp" && (
          <Card>
            <CardHeader><CardTitle>Verify OTP</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">An OTP has been sent to your registered mobile/email.</p>
              <div>
                <Label>Enter OTP</Label>
                <Input value={otpCode} onChange={e => setOtpCode(e.target.value)} placeholder="Enter 6-digit OTP" maxLength={6} className="text-center text-2xl tracking-widest" />
              </div>
              {otpError && <p className="text-sm text-destructive">{otpError}</p>}
              <Button onClick={handleVerifyOtp} disabled={otpVerifying || otpCode.length < 4} className="w-full">
                {otpVerifying ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Verifying...</> : "Verify OTP"}
              </Button>
              <Button variant="link" onClick={() => { setOtpSent(false); setStep("details"); }} className="w-full">Back</Button>
            </CardContent>
          </Card>
        )}

        {/* Step: Registration Form */}
        {step === "form" && (
          <Card>
            <CardHeader><CardTitle>Registration Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Registration Type *</Label>
                <Select value={selectedRegId} onValueChange={setSelectedRegId}>
                  <SelectTrigger><SelectValue placeholder="Select registration" /></SelectTrigger>
                  <SelectContent>
                    {eventLink.registrations.map(r => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.registrationName} - ₹{r.amount.toFixed(2)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedReg && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-lg font-semibold text-blue-800">Amount: ₹{selectedReg.amount.toFixed(2)}</p>
                </div>
              )}

              {eventLink.isTshirtSize && eventLink.tshirtSizes.length > 0 && (
                <div>
                  <Label>T-shirt Size</Label>
                  <Select value={selectedTshirtId} onValueChange={setSelectedTshirtId}>
                    <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                    <SelectContent>
                      {eventLink.tshirtSizes.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.sizeName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {eventLink.isFood && eventLink.foodPreferences.length > 0 && (
                <div>
                  <Label>Food Preference</Label>
                  <Select value={selectedFoodId} onValueChange={setSelectedFoodId}>
                    <SelectTrigger><SelectValue placeholder="Select preference" /></SelectTrigger>
                    <SelectContent>
                      {eventLink.foodPreferences.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.foodType}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {eventLink.isPartner && (
                <div className="space-y-3 p-4 border rounded-lg">
                  <h4 className="font-medium">Partner Details</h4>
                  {eventLink.isPartnerName && <div><Label>Partner Name</Label><Input value={partnerName} onChange={e => setPartnerName(e.target.value)} /></div>}
                  {eventLink.isPartnerMobile && <div><Label>Partner Mobile</Label><Input value={partnerMobile} onChange={e => setPartnerMobile(e.target.value)} /></div>}
                  {eventLink.isPartnerEmail && <div><Label>Partner Email</Label><Input value={partnerEmail} onChange={e => setPartnerEmail(e.target.value)} /></div>}
                  {eventLink.isPartnerGender && (
                    <div>
                      <Label>Partner Gender</Label>
                      <Select value={partnerGender} onValueChange={setPartnerGender}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              {eventLink.isRemark1 && <div><Label>{eventLink.remark1Title || "Remark 1"}</Label><Input value={remark1} onChange={e => setRemark1(e.target.value)} /></div>}
              {eventLink.isRemark2 && <div><Label>{eventLink.remark2Title || "Remark 2"}</Label><Input value={remark2} onChange={e => setRemark2(e.target.value)} /></div>}
              {eventLink.isRemark3 && <div><Label>{eventLink.remark3Title || "Remark 3"}</Label><Input value={remark3} onChange={e => setRemark3(e.target.value)} /></div>}

              {eventLink.isDesignation && eventLink.designations.length > 0 && (
                <div>
                  <Label>{eventLink.designationLabel || "Designation"}</Label>
                  <Select value={selectedDesigId} onValueChange={setSelectedDesigId}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {eventLink.designations.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.designationName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {submitError && <p className="text-sm text-destructive">{submitError}</p>}

              <Button onClick={handleSubmitPayment} disabled={submitting || !selectedRegId} className="w-full" size="lg">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing...</> : `Pay ₹${selectedReg?.amount.toFixed(2) || "0.00"}`}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step: Paying */}
        {step === "paying" && (
          <Card>
            <CardContent className="pt-6 text-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Redirecting to payment gateway...</h3>
              <p className="text-muted-foreground">Please do not close this window.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
