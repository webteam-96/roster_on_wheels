"use client";

/**
 * V2 — Mass Email compose / edit under the District Admin dashboard shell.
 * ---------------------------------------------------------------------------
 * Additive port of the V1 compose
 *   (src/app/districts/[id]/mass-emails/compose/page.tsx)
 * with V2 conventions:
 *   - districtId from useAuth().selectedDistrictId (no /districts/[id] param).
 *   - Reads ?editId= (edit a draft) and ?returnTo= (+ ?yearId= passthrough).
 *   - Save Draft / Save & Send / Cancel all land on returnTo || the Mass Email
 *     listing, with ?yearId= preserved.
 *   - Body is the shared RichTextEditor (react-quill-new) — full toolbar with
 *     font/size, bold/italic/underline, colour, alignment, lists, link and image.
 *     The image button inlines a base64 data-URI (no upload endpoint); Brevo sends
 *     the editor HTML as-is via htmlContent.
 *   - Design palette: navy #17458f, gold #F7A81B, slate borders/text.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createDistrictMassEmail, updateDistrictMassEmail, sendDistrictMassEmail,
  getDistrictMassEmailDetail, getDistrict, getDistrictClubs, getDistrictSubGroups,
  getDistrictSubGroupAvailableYears, getDistrictMassEmailRecipientCount,
  getDistrictCreditBalance, getRotaryYears, getMassEmailSenderInfo,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import ComposeComms from "@/components/comms/ComposeComms";
import { ArrowLeft, Save, Send, Loader2, Users } from "@/components/icons";
import RichTextEditor from "@/components/RichTextEditor";
import { useFeatureOn } from "@/components/FeatureGate";
import ContactGroupPicker from "@/components/contacts/ContactGroupPicker";
import { CONTACTS_FEATURE } from "@/lib/contacts";

import { appLocale } from "@/lib/appFormat";
const BASE = "/district-admin-dashboard/quick-links/mass-email";

function withSearch(base: string, extra: Record<string, string | null | undefined>) {
  const p = new URLSearchParams();
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

interface ClubOption { id: number; clubName: string; }
interface SubGroupOption { id: number; groupName: string; memberCount: number; }

export default function DistrictAdminMassEmailComposePage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const yearId = searchParams.get("yearId");
  const editId = searchParams.get("editId") ? Number(searchParams.get("editId")) : null;

  const goBack = () => router.push(withSearch(returnTo || BASE, { yearId }));

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  // Recipients
  const [recipientType, setRecipientType] = useState("1"); // 1=All, 2=Clubs, 3=Subgroups
  const [selectedClubIds, setSelectedClubIds] = useState<Set<number>>(new Set());
  const [selectedSubgroupIds, setSelectedSubgroupIds] = useState<Set<number>>(new Set());
  // Recipient type 4: the district's contact groups (non-members), while the contacts_growth feature is on.
  const contactsOn = useFeatureOn(CONTACTS_FEATURE);
  const [selectedContactGroupIds, setSelectedContactGroupIds] = useState<Set<number>>(new Set());

  // Email fields
  const [fromName, setFromName] = useState("");
  const [replyName, setReplyName] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const commsOn = useFeatureLoadedOn("communication"); // N5: allowance instead of credits, language versions
  const [templateKey, setTemplateKey] = useState("");

  // Lookups
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [rotaryYears, setRotaryYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [subgroups, setSubgroups] = useState<SubGroupOption[]>([]);

  const [recipientCount, setRecipientCount] = useState({ totalMembers: 0, membersWithEmail: 0 });
  // Email credit balance — Send is blocked when membersWithEmail exceeds emailRemaining.
  // Save Draft still works because the backend only deducts credits at send-time.
  const [emailRemaining, setEmailRemaining] = useState<number | null>(null);
  // Sender email fetched from API so the compose UI always shows the exact
  // From-address Brevo will use (configured server-side, not hardcoded).
  const [senderEmail, setSenderEmail] = useState<string>("support@example.org");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!districtId) return;
    getDistrict(districtId).then((d) => setDistrictName(`District ${d.districtNumber}`)).catch(() => {});
  }, [districtId]);

  useEffect(() => {
    if (!districtId) return;
    getDistrictClubs(districtId).then((res) => setClubs(res.map((c: any) => ({ id: c.id, clubName: c.clubName })))).catch(() => {});
  }, [districtId]);

  useEffect(() => {
    if (!districtId) return;
    // Load subgroup-available years for the dropdown, and default the
    // selection to the CURRENT rotary year (found via getRotaryYears) if
    // that year exists in the available list — otherwise fall back to the
    // first available year. This means when the admin picks the "Subgroups"
    // radio, the current-year subgroups appear straight away.
    async function load() {
      try {
        const [years, allYears] = await Promise.all([
          getDistrictSubGroupAvailableYears(districtId),
          getRotaryYears().catch(() => []),
        ]);
        setRotaryYears(years.map((y: any) => ({ id: y.id, yearLabel: y.yearLabel })));
        if (years.length > 0) {
          const currentYear = allYears.find((y: any) => y.isCurrent);
          const currentInAvailable = currentYear && years.some((y: any) => y.id === currentYear.id);
          setSelectedYearId(String(currentInAvailable ? currentYear.id : years[0].id));
        }
      } catch {}
    }
    load();
  }, [districtId]);

  // Fetch district email credit balance so we can validate before
  // sending. Server-side check exists too (throws "Insufficient Email
  // credits…"); this just makes the UX obvious rather than surprising the
  // admin at Send-time.
  useEffect(() => {
    if (!districtId) return;
    getDistrictCreditBalance(districtId)
      .then((b: any) => setEmailRemaining(Number(b.emailRemaining ?? 0)))
      .catch(() => setEmailRemaining(null));
  }, [districtId]);

  useEffect(() => {
    getMassEmailSenderInfo()
      .then((r) => { if (r?.senderEmail) setSenderEmail(r.senderEmail); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!districtId || !selectedYearId) return;
    async function load() {
      try {
        const groups = await getDistrictSubGroups(districtId, Number(selectedYearId));
        setSubgroups(groups.map((g: any) => ({ id: g.id, groupName: g.groupName, memberCount: g.memberCount || 0 })));
      } catch { setSubgroups([]); }
    }
    load();
  }, [districtId, selectedYearId]);

  useEffect(() => {
    if (!districtId || !editId) return;
    async function loadEmail() {
      try {
        const detail = await getDistrictMassEmailDetail(districtId, editId!);
        setRecipientType(String(detail.recipientType));
        if (detail.clubIds) setSelectedClubIds(new Set(detail.clubIds));
        if (detail.subgroupIds) setSelectedSubgroupIds(new Set(detail.subgroupIds));
        else if (detail.fkSubgroupId) setSelectedSubgroupIds(new Set([detail.fkSubgroupId]));
        if (detail.recipientType === 4) setSelectedContactGroupIds(new Set(detail.contactGroupIds ?? []));
        setFromName(detail.fromName || "");
        setReplyName(detail.replyName || "");
        setReplyEmail(detail.replyEmail || "");
        setSubject(detail.subject || "");
        setEmailBody(detail.emailBody || "");
        setTemplateKey(detail.templateKey || "");
      } catch { setErrorMessage("Failed to load email details."); }
      setLoading(false);
    }
    loadEmail();
  }, [districtId, editId]);

  const fetchRecipientCount = useCallback(async () => {
    if (!districtId) return;
    try {
      const p: Record<string, any> = { recipientType: Number(recipientType) };
      if (recipientType === "2" && selectedClubIds.size > 0) p.clubIds = Array.from(selectedClubIds).join(",");
      if (recipientType === "3" && selectedSubgroupIds.size > 0) p.subgroupIds = Array.from(selectedSubgroupIds).join(",");
      if (recipientType === "4" && selectedContactGroupIds.size > 0) p.contactGroupIds = Array.from(selectedContactGroupIds).join(",");
      const res = await getDistrictMassEmailRecipientCount(districtId, p);
      setRecipientCount(res);
    } catch {}
  }, [districtId, recipientType, selectedClubIds, selectedSubgroupIds, selectedContactGroupIds]);

  useEffect(() => { fetchRecipientCount(); }, [fetchRecipientCount]);

  // Insufficient when we're actually going to send AND we know the balance
  // AND the number of email-having members exceeds what's left in the wallet.
  // Save Draft always allowed — no credits deducted.
  const insufficientCredits =
    !commsOn && emailRemaining !== null && recipientCount.membersWithEmail > emailRemaining;

  const handleSave = async (asDraft: boolean) => {
    if (!fromName.trim() || !subject.trim()) { setErrorMessage("From Name and Subject are required."); return; }
    if (!emailBody.trim() || emailBody === "<p><br></p>") { setErrorMessage("Email Body is required."); return; }
    if (!asDraft) {
      if (recipientCount.membersWithEmail === 0) {
        setErrorMessage("No recipients with an email address in the current selection.");
        return;
      }
      if (insufficientCredits) {
        setErrorMessage(
          `Insufficient email credits. Need ${recipientCount.membersWithEmail} credit(s), only ${emailRemaining} available. Please top up the wallet or narrow the recipient list.`
        );
        return;
      }
    }

    setSaving(true);
    try {
      const data = {
        recipientType: Number(recipientType),
        clubIds: recipientType === "2" ? Array.from(selectedClubIds) : null,
        subgroupIds: recipientType === "3" ? Array.from(selectedSubgroupIds) : null,
        contactGroupIds: recipientType === "4" ? Array.from(selectedContactGroupIds) : null,
        fromName: fromName.trim(),
        replyName: replyName.trim() || null,
        replyEmail: replyEmail.trim() || null,
        subject: subject.trim(),
        emailBody,
        saveAsDraft: asDraft,
        templateKey: templateKey || null,
      };

      let createdId: number | null = null;
      if (editId) {
        await updateDistrictMassEmail(districtId, editId, data);
        createdId = editId;
      } else {
        const result = await createDistrictMassEmail(districtId, data);
        createdId = result.id;
      }

      if (!asDraft && createdId) {
        try {
          await sendDistrictMassEmail(districtId, createdId);
          setSuccessMessage("Email is being sent.");
        } catch (sendErr: any) {
          setErrorMessage(sendErr?.response?.data?.message || "Email saved but failed to send.");
          setSaving(false);
          return;
        }
      } else {
        setSuccessMessage(editId ? "Email updated." : "Email saved as draft.");
      }

      setTimeout(goBack, 1200);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save email.");
    }
    setSaving(false);
  };

  const toggleClub = (id: number) => setSelectedClubIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSubgroup = (id: number) => setSelectedSubgroupIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!districtId) return null;
  if (loading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl mx-auto">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={goBack}
            className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink">{editId ? "Edit Mass Email" : "Compose Mass Email"}</h2>
            <p className="text-slate-500 text-sm mt-0.5">{districtName}</p>
          </div>
        </div>

        {/* Recipients */}
        <div className="rounded-2xl border border-slate-200 shadow-sm bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-azure/5">
            <h3 className="text-sm font-semibold text-slate-800">Select Recipients</h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex flex-col gap-2">
              {[
                { value: "1", label: "All Members" },
                { value: "2", label: "Clubs" },
                { value: "3", label: "Subgroups" },
                ...(contactsOn ? [{ value: "4", label: "Contact groups (non-members)" }] : []),
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="recipientType"
                    value={opt.value}
                    checked={recipientType === opt.value}
                    onChange={() => { setRecipientType(opt.value); setSelectedClubIds(new Set()); setSelectedSubgroupIds(new Set()); setSelectedContactGroupIds(new Set()); }}
                    className="accent-azure"
                  />
                  <span className="text-sm text-slate-700">{opt.label}</span>
                </label>
              ))}
            </div>

            {recipientType === "2" && (
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {clubs.length === 0 ? (
                  <div className="text-center py-4 text-slate-500 text-sm">No clubs found</div>
                ) : clubs.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                    <Checkbox checked={selectedClubIds.has(c.id)} onCheckedChange={() => toggleClub(c.id)} />
                    <p className="text-sm font-medium text-slate-700">{c.clubName}</p>
                  </label>
                ))}
              </div>
            )}

            {recipientType === "3" && (
              <div className="space-y-3">
                <select
                  value={selectedYearId}
                  onChange={(e) => { setSelectedYearId(e.target.value); setSelectedSubgroupIds(new Set()); }}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm w-full md:w-64 focus:outline-none focus:border-azure focus:ring-2 focus:ring-azure/20"
                >
                  {rotaryYears.map((y) => <option key={y.id} value={String(y.id)}>{y.yearLabel}</option>)}
                </select>
                <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {subgroups.length === 0 ? (
                    <div className="text-center py-4 text-slate-500 text-sm">No subgroups found for this year</div>
                  ) : subgroups.map((sg) => (
                    <label key={sg.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                      <Checkbox checked={selectedSubgroupIds.has(sg.id)} onCheckedChange={() => toggleSubgroup(sg.id)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700">{sg.groupName}</p>
                        <p className="text-xs text-slate-400">{sg.memberCount} members</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {recipientType === "4" && (
              <ContactGroupPicker scope="districts" ownerId={districtId} selected={selectedContactGroupIds} onChange={setSelectedContactGroupIds} />
            )}

            <div className="flex items-center gap-2 rounded-lg bg-azure/5 px-3 py-2 text-sm text-slate-700">
              <Users size={15} className="text-ink" />
              Estimated recipients:{" "}
              <span className="font-semibold text-ink">
                {recipientCount.membersWithEmail}
              </span>
            </div>

            {emailRemaining !== null && (
              <div
                className={
                  "flex items-center justify-between rounded-lg px-3 py-2 text-sm border " +
                  (insufficientCredits
                    ? "bg-red-50 border-red-200 text-red-800"
                    : "bg-emerald-50 border-emerald-200 text-emerald-800")
                }
              >
                <span>
                  Email credits remaining:{" "}
                  <span className="font-semibold">{emailRemaining.toLocaleString(appLocale())}</span>
                </span>
                <span className="text-xs">
                  {insufficientCredits
                    ? `Need ${recipientCount.membersWithEmail - emailRemaining} more to send`
                    : `${(emailRemaining - recipientCount.membersWithEmail).toLocaleString(appLocale())} credits will remain after send`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Email Details */}
        <div className="rounded-2xl border border-slate-200 shadow-sm bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-azure/5">
            <h3 className="text-sm font-semibold text-slate-800">Email Details</h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">From Name *</Label>
                <Input className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="e.g. Rotary District..." />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Sender Email</Label>
                <Input value={senderEmail} disabled className="bg-slate-50 border-slate-200" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Reply Name</Label>
                <Input className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20" value={replyName} onChange={(e) => setReplyName(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Reply Email</Label>
                <Input className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20" value={replyEmail} onChange={(e) => setReplyEmail(e.target.value)} placeholder="Optional" type="email" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">Subject *</Label>
              <Input className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">Email Body *</Label>
              <RichTextEditor value={emailBody} onChange={setEmailBody} placeholder="Write your email content here..." />
            </div>
            {commsOn && <ComposeComms scope="districts" ownerId={districtId} templateKey={templateKey} onTemplateKey={setTemplateKey} needed={recipientCount.membersWithEmail} />}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pb-8">
          <Button variant="ghost" onClick={goBack} className="text-slate-600 hover:text-slate-800 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4 mr-2" />Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="border-slate-200 text-slate-700 hover:bg-slate-50" onClick={() => handleSave(true)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Draft
            </Button>
            <Button
              className="bg-azure hover:bg-mint-ink text-white"
              onClick={() => handleSave(false)}
              disabled={saving || insufficientCredits || recipientCount.membersWithEmail === 0}
              title={
                insufficientCredits
                  ? `Insufficient email credits. Need ${recipientCount.membersWithEmail} but only ${emailRemaining} available.`
                  : recipientCount.membersWithEmail === 0
                  ? "No recipients with an email address."
                  : undefined
              }
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Save &amp; Send
            </Button>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
