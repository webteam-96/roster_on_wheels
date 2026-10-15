"use client";

import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getPublicMembershipDues, searchMembershipDuesMembers,
  getMemberDuesStatus, sendMembershipDuesOtp, verifyMembershipDuesOtp,
  createMembershipDuesPaymentOrder,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Loader2, Upload, Clock, XCircle } from "lucide-react";

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

interface DuesInfo {
  id: number;
  purpose: string;
  purposeDescription?: string;
  purposeLogo?: string;
  backgroundImage?: string;
  districtNumber?: string;
  clubName?: string;
  isFees1: boolean;
  isFees2: boolean;
  isFees3: boolean;
  fees1Text?: string;
  fees2Text?: string;
  fees3Text?: string;
  modeOfPayment: number; // 1=Online, 2=Offline, 3=Both
}

interface SearchMember {
  memberId: number;
  memberName: string;
  emailId?: string;
  primaryMobileNumber?: string;
}

interface FeeOption {
  feeType: number;
  label: string;
  amount: number; // derived online (with-surcharge) amount — what "Pay Online" charges
  offlineAmount: number; // the ONE true (base) amount — what an offline payment charges
  isPaid: boolean;
  isAvailable: boolean;
  isPending?: boolean;
  isRejected?: boolean;
  rejectionReason?: string;
  paymentDate?: string;
  paymentMode?: string;
  prevTransactionType?: string;
  prevTransactionId?: string;
  prevGivenTo?: string;
  prevPaymentDate?: string;
  prevRemark?: string;
  prevAttachment?: string;
}

interface MemberDuesStatus {
  feeId: number;
  categoryType?: string;
  availableFees: FeeOption[];
  modeOfPayment: number;
  isShowBankInReceipt?: boolean;
  offlineBankName?: string;
  offlineAccountNumber?: string;
  offlineIfscCode?: string;
  message?: string; // returned if no allocation found
}

type Step = "search" | "otp" | "fees" | "payment" | "offline" | "paying";

// Mask mobile: "7700900123" -> "77****0123"
function maskMobile(mobile?: string): string {
  if (!mobile || mobile.length < 6) return mobile || "";
  return mobile.slice(0, 2) + "****" + mobile.slice(-4);
}

// Mask email: "support@example.org" -> "con****@example.org"
function maskEmail(email?: string): string {
  if (!email) return "";
  const atIdx = email.indexOf("@");
  if (atIdx < 3) return email;
  return email.slice(0, 3) + "****" + email.slice(atIdx);
}

export default function MembershipDuesPaymentPage() {
  const params = useParams();
  const router = useRouter();
  const duesId = Number(params.duesId);

  // Mobile deep-link params — when the Flutter app surfaces the pay link, it
  // appends ?memberId=&token=&from=mobile. We verify the signed token with
  // the API and, if valid, skip the member-search + OTP steps and drop the
  // user straight into the fee-selection screen for that member.
  const searchParams = useSearchParams();
  const tokenMemberId = Number(searchParams?.get("memberId") ?? "");
  const tokenValue = searchParams?.get("token") ?? "";
  const fromMobile = (searchParams?.get("from") ?? "") === "mobile";

  const [duesInfo, setDuesInfo] = useState<DuesInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("search");

  // Member search (smart autocomplete: debounced + dropdown)
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<SearchMember | null>(null);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // OTP
  const [otpSending, setOtpSending] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // Fee selection
  const [duesStatus, setDuesStatus] = useState<MemberDuesStatus | null>(null);
  const [selectedFee, setSelectedFee] = useState<FeeOption | null>(null);
  const [feesLoading, setFeesLoading] = useState(false);

  // Payment
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Offline payment fields
  const [txnType, setTxnType] = useState("");
  const [givenTo, setGivenTo] = useState("");
  const [txnId, setTxnId] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [txnDate, setTxnDate] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [offlineRemark, setOfflineRemark] = useState("");
  const [offlineSubmitting, setOfflineSubmitting] = useState(false);
  const [offlineSuccess, setOfflineSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getPublicMembershipDues(duesId);
        setDuesInfo(data);
      } catch {
        setError("This payment link is not available or has been deactivated.");
      } finally {
        setLoading(false);
      }
    })();
  }, [duesId]);

  // Mobile deep-link: verify ?memberId=&token= with the API; on success skip
  // the search + OTP steps and land the user on the fees screen with their
  // status pre-loaded. Runs once per (token, memberId) combo.
  useEffect(() => {
    if (!fromMobile || !tokenValue || !tokenMemberId || tokenMemberId <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        setFeesLoading(true);
        // Use the same API_BASE_URL declared at the top of the file —
        // process.env.NEXT_PUBLIC_API_BASE_URL was a typo of the actual var name
        // (NEXT_PUBLIC_API_URL, no "BASE_"). The wrong-name lookup returned ""
        // so the fetch hit `/api/...` on the frontend host instead of
        // `https://portal.example.org/API/api/...`, producing a 404 that the
        // catch reported as "Token verification failed".
        const res = await fetch(
          `${API_BASE_URL}/api/public/membership-dues/${duesId}/verify-mobile-token?memberId=${tokenMemberId}&token=${encodeURIComponent(tokenValue)}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message || "Token verification failed.");
        }
        const json = await res.json();
        if (cancelled) return;
        // The member-status payload has memberName/email/mobile + per-fee
        // breakdown; use the same shape as the OTP flow so the rest of the
        // page reads them transparently.
        const status = json?.status;
        if (status) {
          setSelectedMember({
            memberId: tokenMemberId,
            memberName: status.memberName ?? status.MemberName ?? "Member",
            emailId: status.emailId ?? status.EmailId ?? "",
            primaryMobileNumber: status.primaryMobileNumber ?? status.PrimaryMobileNumber ?? "",
          });
          setDuesStatus(status);
          setStep("fees");
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not verify your mobile link. Please request a fresh link from the app.");
      } finally {
        if (!cancelled) setFeesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [duesId, fromMobile, tokenValue, tokenMemberId]);

  // Debounced auto-search: as user types, after 300ms of inactivity, query the API
  // and pop the dropdown. Result selection happens via click on a dropdown row.
  useEffect(() => {
    const q = memberSearchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setDropdownOpen(false);
      return;
    }
    // Skip the search if user just selected someone (text matches selection).
    if (selectedMember && q === selectedMember.memberName) return;

    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const data = await searchMembershipDuesMembers(duesId, q);
        const mapped = (Array.isArray(data) ? data : []).map((m: any) => ({
          memberId: m.memberId ?? m.MemberId,
          memberName: m.memberName ?? m.MemberName ?? "",
          emailId: m.emailId ?? m.EmailId ?? "",
          primaryMobileNumber: m.primaryMobileNumber ?? m.PrimaryMobileNumber ?? "",
        }));
        setSearchResults(mapped);
        setDropdownOpen(mapped.length > 0);
      } catch {
        setSearchResults([]);
        setDropdownOpen(false);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(handle);
  }, [memberSearchQuery, duesId, selectedMember]);

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
    if (!selectedMember) return;
    setOtpSending(true);
    setOtpError(null);
    try {
      const result = await sendMembershipDuesOtp(duesId, {
        memberProfileId: selectedMember.memberId,
        email: selectedMember.emailId,
        mobile: selectedMember.primaryMobileNumber,
      });
      if (result.success) {
        setStep("otp");
      } else {
        setOtpError(result.message || "Failed to send OTP.");
      }
    } catch (err: any) {
      setOtpError(err?.response?.data?.message || "Failed to send OTP.");
    } finally { setOtpSending(false); }
  };

  const handleVerifyOtp = async () => {
    if (!selectedMember) return;
    setOtpVerifying(true);
    setOtpError(null);
    try {
      const result = await verifyMembershipDuesOtp(duesId, {
        otpCode,
        memberProfileId: selectedMember.memberId,
        email: selectedMember.emailId,
        mobile: selectedMember.primaryMobileNumber,
      });
      if (result.success) {
        // OTP verified - fetch dues status
        setFeesLoading(true);
        setStep("fees");
        try {
          const status = await getMemberDuesStatus(duesId, selectedMember.memberId);
          setDuesStatus(status);
          // Auto-select if only one available unpaid fee
          const unpaidFees = (status.availableFees || []).filter((f: FeeOption) => f.isAvailable && !f.isPaid && !f.isPending && !f.isRejected);
          if (unpaidFees.length === 1) {
            setSelectedFee(unpaidFees[0]);
          }
        } catch {
          setSubmitError("Failed to load dues status.");
        } finally { setFeesLoading(false); }
      } else {
        setOtpError("Invalid or expired OTP. Please try again.");
      }
    } catch (err: any) {
      setOtpError(err?.response?.data?.message || "OTP verification failed.");
    } finally { setOtpVerifying(false); }
  };

  const handleOnlinePayment = async () => {
    if (!selectedMember || !selectedFee) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        fkMemberProfileId: selectedMember.memberId,
        feeType: selectedFee.feeType,
      };
      const result = await createMembershipDuesPaymentOrder(duesId, payload);
      setStep("paying");

      // Preferred path: redirect to the shared Cashfree proxy on example.org
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
            returnUrl: `${window.location.origin}/pay/dues/${duesId}/thank-you?orderId=${result.orderId}&paymentId=${result.paymentId}`,
          });
        };
        document.head.appendChild(script);
      }
    } catch (err: any) {
      setSubmitError(err?.response?.data?.message || "Failed to create payment order.");
      setStep("fees");
    } finally { setSubmitting(false); }
  };

  const handleOfflinePayment = async () => {
    if (!selectedMember || !selectedFee) return;
    // Validate required fields
    if (!txnType) { setSubmitError("Please select a transaction type."); return; }
    if ((txnType === "Cash" || txnType === "Cheque") && !givenTo.trim()) {
      setSubmitError("'Given To' is required for Cash/Cheque payments.");
      return;
    }

    setOfflineSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append("fkMemberProfileId", String(selectedMember.memberId));
      formData.append("feeType", String(selectedFee.feeType));
      formData.append("transactionType", txnType);
      if (givenTo) formData.append("givenTo", givenTo);
      if (txnId) formData.append("transactionId", txnId);
      if (bankName) formData.append("bankName", bankName);
      if (chequeNo) formData.append("chequeNumber", chequeNo);
      if (txnDate) formData.append("paymentDate", txnDate);
      if (offlineRemark) formData.append("remark", offlineRemark);
      if (attachment) formData.append("attachment", attachment);

      const response = await fetch(`${API_BASE_URL}/api/public/membership-dues/${duesId}/offline-payment`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to submit offline payment.");
      }
      setOfflineSuccess(true);
    } catch (err: any) {
      setSubmitError(err?.message || "Failed to submit offline payment.");
    } finally { setOfflineSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !duesInfo) {
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

  const availableFees = (duesStatus?.availableFees || []).filter(f => f.isAvailable && !f.isPaid && !f.isPending && !f.isRejected);
  const showOnline = duesInfo.modeOfPayment === 1 || duesInfo.modeOfPayment === 3;
  const showOffline = duesInfo.modeOfPayment === 2 || duesInfo.modeOfPayment === 3;

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{
        backgroundImage: duesInfo.backgroundImage
          ? `url(${API_BASE_URL}${duesInfo.backgroundImage})`
          : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="max-w-2xl mx-auto py-8 px-4">
        {/* Header — logo centered on top, purpose below, then description.
            purposeDescription is HTML produced by the admin's ReactQuill
            editor on the v2 edit page (bold/italic/lists/colors/etc).
            Render with dangerouslySetInnerHTML + Tailwind `prose` styles so
            formatting comes through. Admin-only input, no XSS sanitiser. */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center mb-4">
              <img
                src={duesInfo.purposeLogo ? `${API_BASE_URL}${duesInfo.purposeLogo}` : "/brand/row-mark.png"}
                alt="Logo"
                className="h-40 sm:h-56 w-auto max-w-full object-contain rounded mb-2"
              />
              <h1 className="text-2xl font-bold text-primary">{duesInfo.purpose || "Club Dues"}</h1>
              {duesInfo.purposeDescription && (
                <div
                  className={[
                    // Container fit — never bust the card width
                    "w-full max-w-full mt-2 text-sm leading-relaxed text-slate-700 text-left",
                    "break-words [overflow-wrap:anywhere]",
                    // Tailwind preflight strips list-style from <ul>/<ol>; restore.
                    "[&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2",
                    "[&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2",
                    "[&_li]:my-1",
                    // Heading scales — preflight nukes h1/h2/h3 too.
                    "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2",
                    "[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2",
                    "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1",
                    // Inline emphasis — make sure ReactQuill's <strong>/<em>/<u> render.
                    "[&_strong]:font-semibold [&_b]:font-semibold",
                    "[&_em]:italic [&_i]:italic",
                    "[&_u]:underline",
                    // Quill colour spans use inline style — already work.
                    // Block-level wraps for long content
                    "[&_p]:my-1",
                    "[&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic",
                    "[&_a]:text-blue-600 [&_a]:underline [&_a]:break-all",
                    "[&_img]:max-w-full [&_img]:h-auto",
                    "[&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto",
                    "[&_pre]:whitespace-pre-wrap [&_pre]:break-words",
                    "[&_*]:max-w-full",
                  ].join(" ")}
                  dangerouslySetInnerHTML={{ __html: duesInfo.purposeDescription }}
                />
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {duesInfo.districtNumber && <span><strong>District:</strong> {duesInfo.districtNumber}</span>}
              {duesInfo.clubName && <span><strong>Club:</strong> {duesInfo.clubName}</span>}
            </div>
          </CardContent>
        </Card>

        {/* Step 1: Member Search */}
        {step === "search" && (
          <Card>
            <CardHeader>
              <CardTitle>Find Your Membership</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div ref={searchBoxRef}>
                <Label>Search Member *</Label>
                <div className="relative">
                  <Input
                    value={memberSearchQuery}
                    onChange={e => {
                      setMemberSearchQuery(e.target.value);
                      // Typing again after selection → clear selection so the user can re-pick.
                      if (selectedMember && e.target.value !== selectedMember.memberName) {
                        setSelectedMember(null);
                      }
                    }}
                    onFocus={() => { if (searchResults.length > 0) setDropdownOpen(true); }}
                    placeholder="Start typing name, mobile or email…"
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
                          key={m.memberId}
                          onClick={() => {
                            setSelectedMember(m);
                            setMemberSearchQuery(m.memberName);
                            setDropdownOpen(false);
                          }}
                          className={`block w-full text-left px-3 py-2 hover:bg-primary/10 transition-colors border-b last:border-b-0 ${
                            selectedMember?.memberId === m.memberId ? "bg-primary/5" : ""
                          }`}
                        >
                          <p className="font-medium text-sm">{m.memberName}</p>
                          <p className="text-xs text-muted-foreground">
                            {maskMobile(m.primaryMobileNumber)} | {maskEmail(m.emailId)}
                          </p>
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
              {otpError && <p className="text-sm text-destructive">{otpError}</p>}
            </CardContent>
          </Card>
        )}

        {/* Step 2: OTP Verification */}
        {step === "otp" && (
          <Card>
            <CardHeader><CardTitle>Verify OTP</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">An OTP has been sent to your registered mobile/email.</p>
              <div>
                <Label>Enter OTP</Label>
                <Input
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value)}
                  placeholder="Enter 6-digit OTP"
                  maxLength={6}
                  className="text-center text-2xl tracking-widest"
                />
              </div>
              {otpError && <p className="text-sm text-destructive">{otpError}</p>}
              <Button onClick={handleVerifyOtp} disabled={otpVerifying || otpCode.length < 4} className="w-full">
                {otpVerifying ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Verifying...</> : "Verify OTP"}
              </Button>
              <Button variant="link" onClick={() => { setOtpCode(""); setOtpError(null); setSelectedMember(null); setSearchResults([]); setMemberSearchQuery(""); setStep("search"); }} className="w-full">
                Back
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Fee Selection */}
        {step === "fees" && (
          <Card>
            <CardHeader><CardTitle>Select Fee to Pay</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {feesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <>
                  {/* Show "no allocation" message if backend returned it */}
                  {duesStatus?.message && (
                    <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200 text-yellow-800">
                      <p>{duesStatus.message}</p>
                    </div>
                  )}

                  {duesStatus?.categoryType && (
                    <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <span className="font-medium text-blue-800">Category: {duesStatus.categoryType}</span>
                    </div>
                  )}

                  {/* Show bank details for offline payments if configured */}
                  {showOffline && duesStatus?.isShowBankInReceipt && duesStatus?.offlineBankName && (
                    <div className="p-3 bg-gray-50 rounded-lg border text-sm space-y-1">
                      <p className="font-semibold">Bank Details for Offline Payment:</p>
                      <p>Bank: {duesStatus.offlineBankName}</p>
                      {duesStatus.offlineAccountNumber && <p>A/C: {duesStatus.offlineAccountNumber}</p>}
                      {duesStatus.offlineIfscCode && <p>IFSC: {duesStatus.offlineIfscCode}</p>}
                    </div>
                  )}

                  {/* Show all fees with status */}
                  {duesStatus?.availableFees && duesStatus.availableFees.length > 0 && (
                    <div className="space-y-2">
                      {duesStatus.availableFees.map(fee => {
                        const canSelect = fee.isAvailable && !fee.isPaid && !fee.isPending && !fee.isRejected;
                        return (
                          <div
                            key={fee.feeType}
                            onClick={() => canSelect && setSelectedFee(fee)}
                            className={`p-4 rounded-lg border transition-colors ${
                              fee.isPaid ? "bg-green-50 border-green-200 opacity-75" :
                              fee.isPending ? "bg-yellow-50 border-yellow-200 opacity-85" :
                              fee.isRejected ? "bg-red-50 border-red-200" :
                              !fee.isAvailable ? "bg-gray-50 opacity-50" :
                              selectedFee?.feeType === fee.feeType ? "border-primary bg-primary/5 cursor-pointer" :
                              "hover:bg-muted cursor-pointer"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium">{fee.label}</p>
                                <p className="text-lg font-semibold">&#8377;{fee.offlineAmount}</p>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {fee.isPaid && (
                                  <>
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded">
                                      <CheckCircle2 className="h-3 w-3" /> Paid
                                    </span>
                                    {fee.paymentDate && (
                                      <span className="text-[10px] text-green-600">{fee.paymentDate}</span>
                                    )}
                                    {fee.paymentMode && (
                                      <span className="text-[10px] text-green-600">via {fee.paymentMode}</span>
                                    )}
                                  </>
                                )}
                                {fee.isPending && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-100 px-2 py-1 rounded">
                                    <Clock className="h-3 w-3" /> Pending Approval
                                  </span>
                                )}
                                {fee.isRejected && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-1 rounded">
                                    <XCircle className="h-3 w-3" /> Rejected
                                  </span>
                                )}
                                {!fee.isPaid && !fee.isPending && !fee.isRejected && fee.isAvailable && (
                                  <span className="text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1 rounded">Pay Now</span>
                                )}
                                {!fee.isAvailable && !fee.isPaid && !fee.isPending && !fee.isRejected && (
                                  <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">N/A</span>
                                )}
                              </div>
                            </div>
                            {fee.isRejected && fee.rejectionReason && (
                              <p className="mt-2 text-xs text-red-600">Reason: {fee.rejectionReason}</p>
                            )}
                            {fee.isRejected && (
                              <div className="flex gap-2 mt-2">
                                {showOnline && (
                                  <Button size="sm" variant="outline" className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                                    onClick={(e) => { e.stopPropagation(); setSelectedFee(fee); handleOnlinePayment(); }}>
                                    Pay Online
                                  </Button>
                                )}
                                {showOffline && (
                                  <Button size="sm" variant="outline" className="text-xs border-red-300 text-red-700 hover:bg-red-50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedFee(fee);
                                      // Pre-fill with previous submission
                                      if (fee.prevTransactionType) setTxnType(fee.prevTransactionType);
                                      if (fee.prevTransactionId) setTxnId(fee.prevTransactionId);
                                      if (fee.prevGivenTo) setGivenTo(fee.prevGivenTo);
                                      if (fee.prevPaymentDate) setTxnDate(fee.prevPaymentDate);
                                      if (fee.prevRemark) setOfflineRemark(fee.prevRemark);
                                      setStep("offline");
                                    }}>
                                    Resubmit Offline
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {availableFees.length === 0 && !feesLoading && !duesStatus?.message && (
                    <div className="text-center py-4 text-muted-foreground">
                      <p>No fees available for payment at this time.</p>
                    </div>
                  )}

                  {submitError && <p className="text-sm text-destructive">{submitError}</p>}

                  {selectedFee && (
                    <div className="space-y-3">
                      {showOnline && (
                        <Button onClick={handleOnlinePayment} disabled={submitting} className="w-full" size="lg">
                          {submitting ? (
                            <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing...</>
                          ) : (
                            `Pay Online - \u20B9${selectedFee.offlineAmount} + Payment Gateway Charges`
                          )}
                        </Button>
                      )}
                      {showOffline && (
                        <Button
                          onClick={() => setStep("offline")}
                          variant={showOnline ? "outline" : "default"}
                          className="w-full"
                          size="lg"
                        >
                          Pay Offline
                        </Button>
                      )}
                    </div>
                  )}

                  <Button
                    variant="link"
                    onClick={() => { setSelectedFee(null); setDuesStatus(null); setOtpCode(""); setOtpError(null); setSelectedMember(null); setSearchResults([]); setMemberSearchQuery(""); setStep("search"); }}
                    className="w-full"
                  >
                    Back to Search
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 4: Offline Payment */}
        {step === "offline" && !offlineSuccess && (
          <Card>
            <CardHeader><CardTitle>Offline Payment</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {selectedFee && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-1">
                  <p className="font-medium text-blue-800">Member: {selectedMember?.memberName}</p>
                  <p className="font-medium text-blue-800">Fee: {selectedFee.label}</p>
                  <p className="text-lg font-semibold text-blue-800">Amount: &#8377;{selectedFee.offlineAmount}</p>
                </div>
              )}

              {/* Bank details */}
              {duesStatus?.isShowBankInReceipt && duesStatus?.offlineBankName && (
                <div className="p-3 bg-gray-50 rounded-lg border text-sm space-y-1">
                  <p className="font-semibold">Bank Details:</p>
                  <p>Bank: {duesStatus.offlineBankName}</p>
                  {duesStatus.offlineAccountNumber && <p>A/C: {duesStatus.offlineAccountNumber}</p>}
                  {duesStatus.offlineIfscCode && <p>IFSC: {duesStatus.offlineIfscCode}</p>}
                </div>
              )}

              <div>
                <Label>Payment Mode *</Label>
                <Select value={txnType} onValueChange={setTxnType}>
                  <SelectTrigger><SelectValue placeholder="Select payment mode" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEFT/IMPS/RTGS">NEFT / IMPS / RTGS</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(txnType === "Cash" || txnType === "Cheque") && (
                <div>
                  <Label>Given To *</Label>
                  <Input value={givenTo} onChange={e => setGivenTo(e.target.value)} placeholder="Name of person who received payment" />
                </div>
              )}

              {(txnType === "NEFT/IMPS/RTGS" || txnType === "UPI") && (
                <div>
                  <Label>Transaction ID</Label>
                  <Input value={txnId} onChange={e => setTxnId(e.target.value)} placeholder="Transaction reference number" />
                </div>
              )}

              {txnType === "Cheque" && (
                <>
                  <div>
                    <Label>Cheque Number</Label>
                    <Input value={chequeNo} onChange={e => setChequeNo(e.target.value)} placeholder="Cheque number" />
                  </div>
                  <div>
                    <Label>Bank Name</Label>
                    <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name" />
                  </div>
                </>
              )}

              <div>
                <Label>Payment Date</Label>
                <DateField value={txnDate} onChange={setTxnDate} />
              </div>

              <div>
                <Label>Attachment (Receipt/Proof)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={e => {
                      const f = e.target.files?.[0] || null;
                      if (f && !(f.type.startsWith("image/") || f.type === "application/pdf")) {
                        alert("Only image files or PDF are allowed.");
                        e.target.value = "";
                        setAttachment(null);
                        return;
                      }
                      setAttachment(f);
                    }}
                    className="flex-1"
                  />
                  {attachment && <Upload className="h-4 w-4 text-green-600" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Allowed: any image or PDF</p>
                {selectedFee?.prevAttachment && (
                  <a href={`${API_BASE_URL}${selectedFee.prevAttachment}`} target="_blank" className="text-xs text-blue-600 hover:underline mt-1 inline-block">View previous attachment</a>
                )}
              </div>

              <div>
                <Label>Remark</Label>
                <Textarea value={offlineRemark} onChange={e => setOfflineRemark(e.target.value)} placeholder="Any additional notes" rows={3} />
              </div>

              {submitError && <p className="text-sm text-destructive">{submitError}</p>}

              <Button onClick={handleOfflinePayment} disabled={offlineSubmitting || !txnType} className="w-full" size="lg">
                {offlineSubmitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting...</> : "Submit Payment"}
              </Button>
              <Button variant="link" onClick={() => { setSubmitError(null); setStep("fees"); }} className="w-full">Back</Button>
            </CardContent>
          </Card>
        )}

        {/* Offline Success */}
        {step === "offline" && offlineSuccess && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-green-700">Payment Submitted!</h3>
              <p className="text-muted-foreground mt-2">Your offline payment has been submitted for approval.</p>
              <p className="text-sm text-muted-foreground mt-1">You will be notified once it is approved.</p>
              <Button className="mt-6" onClick={() => {
                // Reset form
                setStep("search");
                setSelectedMember(null);
                setSelectedFee(null);
                setDuesStatus(null);
                setSearchResults([]);
                setMemberSearchQuery("");
                setOtpCode("");
                setTxnType("");
                setGivenTo("");
                setTxnId("");
                setBankName("");
                setChequeNo("");
                setTxnDate("");
                setAttachment(null);
                setOfflineRemark("");
                setOfflineSuccess(false);
              }}>
                Make Another Payment
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step: Paying (Cashfree redirect) */}
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
