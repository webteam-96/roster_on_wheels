"use client";

import { useState, useEffect, Suspense } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getEventPaymentLinkDetail, getEventTshirtSizes, getEventFoodPreferences,
  getEventRegistrations, getEventDesignations, recordOfflinePayment, updateOfflinePayment, getMemberPaymentDetail,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Save, Paperclip, Eye } from "lucide-react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RotaryLoader from "@/components/RotaryLoader";

import { currencySymbol } from "@/lib/appFormat";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface Registration { id: number; registrationName: string; amount: number; }
interface TshirtSize { id: number; sizeName: string; }
interface FoodPreference { id: number; foodType: string; }
interface Designation { id: number; designationName: string; }

function OfflinePaymentContent() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkId = Number(params.linkId);
  const memberId = searchParams.get("memberId") ? Number(searchParams.get("memberId")) : null;
  const editPaymentId = searchParams.get("editPaymentId") ? Number(searchParams.get("editPaymentId")) : null;
  const isEditMode = !!editPaymentId;
  // Member info from query params (Standard form)
  const qMemberName = searchParams.get("memberName") || "";
  const qMobile = searchParams.get("mobile") || "";
  const qEmail = searchParams.get("email") || "";
  const qDistrictNumber = searchParams.get("districtNumber") || "";
  const qClubName = searchParams.get("clubName") || "";

  // Link detail & config
  const [linkDetail, setLinkDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Registrations, sizes, foods, designations
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tshirtSizes, setTshirtSizes] = useState<TshirtSize[]>([]);
  const [foodPreferences, setFoodPreferences] = useState<FoodPreference[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);

  // Registration type
  const [selectedRegistrationId, setSelectedRegistrationId] = useState("");

  // Form fields
  const [tshirtSize, setTshirtSize] = useState("");
  const [foodPreference, setFoodPreference] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [partnerMobile, setPartnerMobile] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [partnerGender, setPartnerGender] = useState("");
  const [remark1, setRemark1] = useState("");
  const [remark2, setRemark2] = useState("");
  const [remark3, setRemark3] = useState("");
  const [selectedDesignation, setSelectedDesignation] = useState("");

  // Personal details (for Dynamic form)
  const [personalName, setPersonalName] = useState("");
  const [personalMobile, setPersonalMobile] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [personalDistrict, setPersonalDistrict] = useState("");
  const [personalClub, setPersonalClub] = useState("");

  // Existing attachment (edit mode)
  const [existingAttachment, setExistingAttachment] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<string | null>(null);

  // Offline payment details
  const [transactionType, setTransactionType] = useState("NEFT");
  const [transactionId, setTransactionId] = useState("");
  const [givenTo, setGivenTo] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentRemark, setPaymentRemark] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sendEmail, setSendEmail] = useState(false);

  const [saving, setSaving] = useState(false);
  const [addAnother, setAddAnother] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isDynamic = linkDetail?.formType === 2;

  // Fetch link detail, registrations, and lookup data on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [detail, regs] = await Promise.all([
          getEventPaymentLinkDetail(linkId),
          getEventRegistrations(linkId),
        ]);
        setLinkDetail(detail);
        setRegistrations(regs || []);

        // Fetch t-shirt sizes if enabled
        if (detail.isTshirtSize) {
          try {
            const sizes = await getEventTshirtSizes();
            setTshirtSizes(sizes || []);
          } catch { /* ignore */ }
        }

        // Fetch food preferences if enabled
        if (detail.isFood && detail.foodPreferenceIds) {
          try {
            const allFoods = await getEventFoodPreferences();
            const enabledIds = detail.foodPreferenceIds.split(",").map(Number).filter(Boolean);
            setFoodPreferences((allFoods || []).filter((f: FoodPreference) => enabledIds.includes(f.id)));
          } catch { /* ignore */ }
        }

        // Fetch designations if enabled
        if (detail.isDesignation) {
          try {
            const desigs = await getEventDesignations(linkId);
            setDesignations(desigs || []);
          } catch { /* ignore */ }
        }
        // Load existing payment data in edit mode
        if (editPaymentId) {
          try {
            const payment = await getMemberPaymentDetail(editPaymentId);
            console.log("Edit payment data:", JSON.stringify(payment));
            if (payment) {
              // API returns PascalCase from Dapper dynamic
              setSelectedRegistrationId(String(payment.FkRegistrationId || payment.fkRegistrationId || ""));
              const tId = payment.FkTshirtSizeId || payment.fkTshirtSizeId;
              if (tId) setTshirtSize(String(tId));
              const fId = payment.FkFoodPreferenceId || payment.fkFoodPreferenceId;
              if (fId) setFoodPreference(String(fId));
              setPartnerName(payment.PartnerName || payment.partnerName || "");
              setPartnerMobile(payment.PartnerMobile || payment.partnerMobile || "");
              setPartnerEmail(payment.PartnerEmail || payment.partnerEmail || "");
              setPartnerGender(payment.PartnerGender || payment.partnerGender || "");
              setRemark1(payment.Remark1 || payment.remark1 || "");
              setRemark2(payment.Remark2 || payment.remark2 || "");
              setRemark3(payment.Remark3 || payment.remark3 || "");
              const dId = payment.FkDesignationId || payment.fkDesignationId;
              if (dId) setSelectedDesignation(String(dId));
              setTransactionType(payment.TransactionType || payment.transactionType || "NEFT");
              setTransactionId(payment.TransactionId || payment.transactionId || "");
              setGivenTo(payment.GivenTo || payment.givenTo || "");
              setBankName(payment.BankName || payment.bankName || "");
              setChequeNumber(payment.ChequeNumber || payment.chequeNumber || "");
              const pDate = payment.PaymentDate || payment.paymentDate;
              if (pDate) setPaymentDate(new Date(pDate).toISOString().split("T")[0]);
              setPaymentRemark(payment.Remark || payment.remark || "");
              // Personal details for dynamic
              setPersonalName(payment.MemberName || payment.memberName || "");
              setPersonalMobile(payment.Mobile || payment.mobile || "");
              setPersonalEmail(payment.Email || payment.email || "");
              setPersonalDistrict(payment.DistrictNumber || payment.districtNumber || "");
              setPersonalClub(payment.ClubName || payment.clubName || "");
              // Existing attachment
              const att = payment.Attachment || payment.attachment;
              if (att) setExistingAttachment(att);
            }
          } catch (e) { console.error("Failed to load edit data:", e); }
        }
      } catch (e) {
        console.error("Failed to load link details:", e);
        setErrorMessage("Failed to load payment link details.");
      } finally {
        setLoading(false);
      }
    })();
  }, [linkId, editPaymentId]);

  const handleSubmit = async () => {
    if (!selectedRegistrationId) {
      setErrorMessage("Please select a registration type.");
      return;
    }
    // Validate configured form fields
    if (linkDetail?.isForm) {
      if (linkDetail.isTshirtSize && !tshirtSize) { setErrorMessage("Please select a T-shirt size."); return; }
      if (linkDetail.isFood && !foodPreference) { setErrorMessage("Please select a food preference."); return; }
      if (linkDetail.isPartner) {
        if (linkDetail.isPartnerName && !partnerName.trim()) { setErrorMessage("Partner name is required."); return; }
        if (linkDetail.isPartnerMobile && !partnerMobile.trim()) { setErrorMessage("Partner mobile is required."); return; }
      }
      if (linkDetail.isRemark1 && !remark1.trim()) { setErrorMessage(`${linkDetail.remark1Title || "Remark 1"} is required.`); return; }
      if (linkDetail.isRemark2 && !remark2.trim()) { setErrorMessage(`${linkDetail.remark2Title || "Remark 2"} is required.`); return; }
      if (linkDetail.isRemark3 && !remark3.trim()) { setErrorMessage(`${linkDetail.remark3Title || "Remark 3"} is required.`); return; }
      if (linkDetail.isDesignation && !selectedDesignation) { setErrorMessage("Please select a designation."); return; }
      if (isDynamic && linkDetail.isPersonal) {
        if (linkDetail.isPersonalName && !personalName.trim()) { setErrorMessage("Name is required."); return; }
        if (linkDetail.isPersonalMobile && !personalMobile.trim()) { setErrorMessage("Mobile is required."); return; }
      }
    }
    // Payment details validation
    if (!transactionType) {
      setErrorMessage("Transaction type is required.");
      return;
    }
    if (!transactionId?.trim()) {
      setErrorMessage("Transaction ID / Reference is required.");
      return;
    }
    if (!givenTo?.trim()) {
      setErrorMessage("Given To is required.");
      return;
    }
    if (!paymentDate) {
      setErrorMessage("Payment date is required.");
      return;
    }
    if ((transactionType === "NEFT" || transactionType === "Cheque") && !bankName?.trim()) {
      setErrorMessage("Bank name is required.");
      return;
    }
    if (transactionType === "Cheque" && !chequeNumber?.trim()) {
      setErrorMessage("Cheque number is required.");
      return;
    }
    if (!attachment && !existingAttachment) {
      setErrorMessage("Attachment (receipt/proof) is required.");
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      // Member info
      if (memberId) fd.append("fkMemberProfileId", String(memberId));
      if (!isDynamic && memberId) {
        fd.append("memberName", qMemberName || personalName);
        fd.append("mobile", qMobile || personalMobile);
        fd.append("email", qEmail || personalEmail);
        fd.append("districtNumber", qDistrictNumber || personalDistrict);
        fd.append("clubName", qClubName || personalClub);
      } else if (isDynamic && linkDetail?.isPersonal) {
        if (linkDetail.isPersonalName) fd.append("memberName", personalName);
        if (linkDetail.isPersonalMobile) fd.append("mobile", personalMobile);
        if (linkDetail.isPersonalEmail) fd.append("email", personalEmail);
        if (linkDetail.isPersonalDistrict) fd.append("districtNumber", personalDistrict);
        if (linkDetail.isPersonalClub) fd.append("clubName", personalClub);
      }

      // Registration
      fd.append("fkRegistrationId", selectedRegistrationId);

      // Form fields
      if (linkDetail?.isTshirtSize && tshirtSize) fd.append("fkTshirtSizeId", tshirtSize);
      if (linkDetail?.isFood && foodPreference) fd.append("fkFoodPreferenceId", foodPreference);

      // Partner details
      if (linkDetail?.isPartner) {
        fd.append("partnerName", partnerName);
        fd.append("partnerMobile", partnerMobile);
        fd.append("partnerEmail", partnerEmail);
        fd.append("partnerGender", partnerGender);
      }

      // Remarks
      if (linkDetail?.isRemark1) fd.append("remark1", remark1);
      if (linkDetail?.isRemark2) fd.append("remark2", remark2);
      if (linkDetail?.isRemark3) fd.append("remark3", remark3);

      // Designation
      if (linkDetail?.isDesignation && selectedDesignation) fd.append("fkDesignationId", selectedDesignation);

      // Offline payment details
      fd.append("transactionType", transactionType);
      fd.append("transactionId", transactionId);
      fd.append("givenTo", givenTo);
      fd.append("bankName", bankName);
      fd.append("chequeNumber", chequeNumber);
      fd.append("paymentDate", paymentDate);
      fd.append("remark", paymentRemark);
      fd.append("sendEmail", String(sendEmail));
      if (attachment) fd.append("attachment", attachment);

      if (isEditMode && editPaymentId) {
        await updateOfflinePayment(editPaymentId, fd);
      } else {
        await recordOfflinePayment(linkId, fd);
      }
      setSuccessMessage(isEditMode ? "Offline payment updated successfully." : "Offline payment recorded successfully.");
      if (addAnother) {
        // Reset only payment fields, keep member + form fields
        setTransactionType("NEFT");
        setTransactionId("");
        setGivenTo("");
        setBankName("");
        setChequeNumber("");
        setPaymentDate("");
        setPaymentRemark("");
        setAttachment(null);
        setAddAnother(false);
      } else {
        setTimeout(() => router.push(`/settings/event-payment-links/${linkId}/members`), 1500);
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  };

  if (!isSuperAdmin && !isAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
        </div>
      </ProtectedRoute>
    );
  }

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/settings/event-payment-links/${linkId}/members`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">{isEditMode ? "Update Offline Payment" : "Record Offline Payment"}</h2>
            <p className="text-muted-foreground text-base">
              {linkDetail?.title ? linkDetail.title : `Link #${linkId}`}
              {memberId && qMemberName ? ` - ${qMemberName}` : ""}
            </p>
          </div>
        </div>

        {/* A) Member Info — Standard form only */}
        {!isDynamic && memberId && (
          <Card>
            <CardHeader><CardTitle>Member Information</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {qDistrictNumber && (
                  <div>
                    <Label className="text-xs text-muted-foreground">District Number</Label>
                    <p className="font-medium">{qDistrictNumber}</p>
                  </div>
                )}
                {qClubName && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Club Name</Label>
                    <p className="font-medium">{qClubName}</p>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground">Member Name</Label>
                  <p className="font-medium">{qMemberName || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Mobile</Label>
                  <p className="font-medium">{qMobile || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="font-medium">{qEmail || "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* B) Registration Type */}
        <Card>
          <CardHeader><CardTitle>Registration Type</CardTitle></CardHeader>
          <CardContent>
            <Select value={selectedRegistrationId} onValueChange={setSelectedRegistrationId}>
              <SelectTrigger><SelectValue placeholder="Select registration type" /></SelectTrigger>
              <SelectContent>
                {registrations.map(r => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.registrationName} - {currencySymbol()}{r.amount?.toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* C) Configured Form Fields */}
        {linkDetail?.isForm && (
          <Card>
            <CardHeader><CardTitle>Additional Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {linkDetail.isTshirtSize && (
                <div>
                  <Label>T-shirt Size</Label>
                  <Select value={tshirtSize} onValueChange={setTshirtSize}>
                    <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                    <SelectContent>
                      {tshirtSizes.map(s => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.sizeName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {linkDetail.isFood && (
                <div>
                  <Label>Food Preference</Label>
                  <Select value={foodPreference} onValueChange={setFoodPreference}>
                    <SelectTrigger><SelectValue placeholder="Select food preference" /></SelectTrigger>
                    <SelectContent>
                      {foodPreferences.map(f => (
                        <SelectItem key={f.id} value={String(f.id)}>{f.foodType}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {linkDetail.isPartner && (
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Partner Details</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {linkDetail.isPartnerName && (
                      <div>
                        <Label>Partner Name</Label>
                        <Input value={partnerName} onChange={e => setPartnerName(e.target.value)} placeholder="Partner name" />
                      </div>
                    )}
                    {linkDetail.isPartnerMobile && (
                      <div>
                        <Label>Partner Mobile</Label>
                        <Input value={partnerMobile} onChange={e => setPartnerMobile(e.target.value)} placeholder="Partner mobile" />
                      </div>
                    )}
                    {linkDetail.isPartnerEmail && (
                      <div>
                        <Label>Partner Email</Label>
                        <Input type="email" value={partnerEmail} onChange={e => setPartnerEmail(e.target.value)} placeholder="Partner email" />
                      </div>
                    )}
                    {linkDetail.isPartnerGender && (
                      <div>
                        <Label>Partner Gender</Label>
                        <Select value={partnerGender} onValueChange={setPartnerGender}>
                          <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {linkDetail.isRemark1 && (
                <div>
                  <Label>{linkDetail.remark1Title || "Remark 1"}</Label>
                  <Input value={remark1} onChange={e => setRemark1(e.target.value)} placeholder={linkDetail.remark1Title || "Remark 1"} />
                </div>
              )}
              {linkDetail.isRemark2 && (
                <div>
                  <Label>{linkDetail.remark2Title || "Remark 2"}</Label>
                  <Input value={remark2} onChange={e => setRemark2(e.target.value)} placeholder={linkDetail.remark2Title || "Remark 2"} />
                </div>
              )}
              {linkDetail.isRemark3 && (
                <div>
                  <Label>{linkDetail.remark3Title || "Remark 3"}</Label>
                  <Input value={remark3} onChange={e => setRemark3(e.target.value)} placeholder={linkDetail.remark3Title || "Remark 3"} />
                </div>
              )}

              {linkDetail.isDesignation && designations.length > 0 && (
                <div>
                  <Label>{linkDetail.designationLabel || "Designation"}</Label>
                  <Select value={selectedDesignation} onValueChange={setSelectedDesignation}>
                    <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                    <SelectContent>
                      {designations.map(d => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.designationName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {linkDetail.isPersonal && (
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Personal Details</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {linkDetail.isPersonalName && (
                      <div>
                        <Label>Name</Label>
                        <Input value={personalName} onChange={e => setPersonalName(e.target.value)} placeholder="Name" />
                      </div>
                    )}
                    {linkDetail.isPersonalMobile && (
                      <div>
                        <Label>Mobile</Label>
                        <Input value={personalMobile} onChange={e => setPersonalMobile(e.target.value)} placeholder="Mobile" />
                      </div>
                    )}
                    {linkDetail.isPersonalEmail && (
                      <div>
                        <Label>Email</Label>
                        <Input type="email" value={personalEmail} onChange={e => setPersonalEmail(e.target.value)} placeholder="Email" />
                      </div>
                    )}
                    {linkDetail.isPersonalDistrict && (
                      <div>
                        <Label>District</Label>
                        <Input value={personalDistrict} onChange={e => setPersonalDistrict(e.target.value)} placeholder="District" />
                      </div>
                    )}
                    {linkDetail.isPersonalClub && (
                      <div>
                        <Label>Club</Label>
                        <Input value={personalClub} onChange={e => setPersonalClub(e.target.value)} placeholder="Club" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* D) Offline Payment Details */}
        <Card>
          <CardHeader><CardTitle>Payment Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Transaction Type *</Label>
                <Select value={transactionType} onValueChange={setTransactionType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEFT">NEFT</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Transaction ID / Reference</Label>
                <Input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="Transaction reference" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Given To</Label>
                <Input value={givenTo} onChange={e => setGivenTo(e.target.value)} placeholder="Person who received payment" />
              </div>
              <div>
                <Label>Payment Date</Label>
                <DateField value={paymentDate} onChange={setPaymentDate} />
              </div>
            </div>
            {(transactionType === "NEFT" || transactionType === "Cheque") && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Bank Name</Label>
                  <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name" />
                </div>
                {transactionType === "Cheque" && (
                  <div>
                    <Label>Cheque Number</Label>
                    <Input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} placeholder="Cheque number" />
                  </div>
                )}
              </div>
            )}
            <div>
              <Label>Remark</Label>
              <Textarea value={paymentRemark} onChange={e => setPaymentRemark(e.target.value)} rows={3} placeholder="Additional notes" />
            </div>
            <div>
              <Label>Attachment (receipt/proof) {!existingAttachment && "*"}</Label>
              {existingAttachment && (
                <div className="flex items-center gap-2 mb-2 p-2 bg-muted rounded">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm flex-1 truncate">{existingAttachment.split("/").pop()}</span>
                  <button type="button" onClick={() => setPreviewAttachment(`${API_BASE_URL}/${existingAttachment}`)} className="text-blue-600 hover:text-blue-800">
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              )}
              <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf" onChange={e => setAttachment(e.target.files?.[0] || null)} />
              <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, JPG, JPEG, PNG, GIF, WEBP</p>
              {existingAttachment && !attachment && <p className="text-xs text-muted-foreground mt-1">Current attachment will be kept if no new file selected.</p>}
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
              <Label>Send receipt email to member</Label>
            </div>
          </CardContent>
        </Card>

        {/* E) Submit */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" asChild>
            <Link href={`/settings/event-payment-links/${linkId}/members`}>Cancel</Link>
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <RotaryLoader size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {isEditMode ? "Update Payment" : "Record Payment"}
          </Button>
        </div>
        {/* Attachment Preview */}
        <Dialog open={!!previewAttachment} onOpenChange={() => setPreviewAttachment(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Attachment Preview</DialogTitle></DialogHeader>
            {previewAttachment && (
              previewAttachment.toLowerCase().endsWith(".pdf") ? (
                <iframe src={previewAttachment} className="w-full h-[500px] rounded" />
              ) : (
                <img src={previewAttachment} alt="Attachment" className="w-full max-h-[500px] object-contain rounded" />
              )
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}

export default function OfflinePaymentPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>}>
      <OfflinePaymentContent />
    </Suspense>
  );
}
