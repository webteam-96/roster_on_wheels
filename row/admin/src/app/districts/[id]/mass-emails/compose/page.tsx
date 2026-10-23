"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  createDistrictMassEmail, updateDistrictMassEmail, sendDistrictMassEmail, getDistrictMassEmailDetail,
  getDistrict, getDistrictClubs, getDistrictSubGroups, getDistrictSubGroupAvailableYears,
  getDistrictMassEmailRecipientCount, getClubCreditBalance,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save, Send, Loader2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import ComposeComms from "@/components/comms/ComposeComms";

interface ClubOption { id: number; clubName: string; }
interface SubGroupOption { id: number; groupName: string; memberCount: number; }

function DistrictComposeContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const editId = searchParams.get("editId") ? Number(searchParams.get("editId")) : null;

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  // Recipients
  const [recipientType, setRecipientType] = useState("1"); // 1=All, 2=Clubs, 3=Subgroups
  const [selectedClubIds, setSelectedClubIds] = useState<Set<number>>(new Set());
  const [selectedSubgroupIds, setSelectedSubgroupIds] = useState<Set<number>>(new Set());

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

  // Recipient count
  const [recipientCount, setRecipientCount] = useState({ totalMembers: 0, membersWithEmail: 0 });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load district info
  useEffect(() => {
    getDistrict(districtId).then(d => setDistrictName(`District ${d.districtNumber}`)).catch(() => {});
  }, [districtId]);

  // Load clubs
  useEffect(() => {
    getDistrictClubs(districtId).then(res => setClubs(res.map((c: any) => ({ id: c.id, clubName: c.clubName })))).catch(() => {});
  }, [districtId]);

  // Load rotary years
  useEffect(() => {
    async function load() {
      try {
        const years = await getDistrictSubGroupAvailableYears(districtId);
        setRotaryYears(years.map((y: any) => ({ id: y.id, yearLabel: y.yearLabel, isCurrent: false })));
        if (years.length > 0) setSelectedYearId(String(years[0].id));
      } catch {}
    }
    load();
  }, [districtId]);

  // Load subgroups when year changes
  useEffect(() => {
    if (!selectedYearId) return;
    async function load() {
      try {
        const groups = await getDistrictSubGroups(districtId, Number(selectedYearId));
        setSubgroups(groups.map((g: any) => ({ id: g.id, groupName: g.groupName, memberCount: g.memberCount || 0 })));
      } catch { setSubgroups([]); }
    }
    load();
  }, [districtId, selectedYearId]);

  // Load edit data
  useEffect(() => {
    if (!editId) return;
    async function loadEmail() {
      try {
        const detail = await getDistrictMassEmailDetail(districtId, editId!);
        setRecipientType(String(detail.recipientType));
        if (detail.clubIds) setSelectedClubIds(new Set(detail.clubIds));
        if (detail.subgroupIds) setSelectedSubgroupIds(new Set(detail.subgroupIds));
        else if (detail.fkSubgroupId) setSelectedSubgroupIds(new Set([detail.fkSubgroupId]));
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

  // Fetch recipient count
  const fetchRecipientCount = useCallback(async () => {
    try {
      const p: Record<string, any> = { recipientType: Number(recipientType) };
      if (recipientType === "2" && selectedClubIds.size > 0) p.clubIds = Array.from(selectedClubIds).join(",");
      if (recipientType === "3" && selectedSubgroupIds.size > 0) p.subgroupIds = Array.from(selectedSubgroupIds).join(",");
      const res = await getDistrictMassEmailRecipientCount(districtId, p);
      setRecipientCount(res);
    } catch {}
  }, [districtId, recipientType, selectedClubIds, selectedSubgroupIds]);

  useEffect(() => { fetchRecipientCount(); }, [fetchRecipientCount]);

  const handleSave = async (asDraft: boolean) => {
    if (!fromName.trim() || !subject.trim()) { setErrorMessage("From Name and Subject are required."); return; }
    if (!emailBody.trim()) { setErrorMessage("Email Body is required."); return; }

    setSaving(true);
    try {
      const data = {
        recipientType: Number(recipientType),
        clubIds: recipientType === "2" ? Array.from(selectedClubIds) : null,
        subgroupIds: recipientType === "3" ? Array.from(selectedSubgroupIds) : null,
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

      setTimeout(() => router.push(`/districts/${districtId}/mass-emails`), 1500);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save email.");
    }
    setSaving(false);
  };

  const toggleClub = (id: number) => setSelectedClubIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSubgroup = (id: number) => setSelectedSubgroupIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (loading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" asChild>
          <Link href={`/districts/${districtId}/mass-emails`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">{editId ? "Edit Mass Email" : "Compose Mass Email"}</h2>
          <p className="text-muted-foreground text-base">{districtName}</p>
        </div>
      </div>

      {/* Recipients */}
      <Card>
        <CardHeader><CardTitle>Select Recipients</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            {[
              { value: "1", label: "All Members" },
              { value: "2", label: "Clubs" },
              { value: "3", label: "Subgroups" },
            ].map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="recipientType" value={opt.value}
                  checked={recipientType === opt.value}
                  onChange={() => { setRecipientType(opt.value); setSelectedClubIds(new Set()); setSelectedSubgroupIds(new Set()); }}
                  className="accent-primary" />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>

          {/* Clubs multi-select */}
          {recipientType === "2" && (
            <div className="max-h-60 overflow-y-auto border rounded-md divide-y">
              {clubs.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">No clubs found</div>
              ) : clubs.map(c => (
                <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                  <Checkbox checked={selectedClubIds.has(c.id)} onCheckedChange={() => toggleClub(c.id)} />
                  <p className="text-sm font-medium">{c.clubName}</p>
                </label>
              ))}
            </div>
          )}

          {/* Subgroups multi-select with year dropdown */}
          {recipientType === "3" && (
            <div className="space-y-3">
              <select value={selectedYearId} onChange={e => { setSelectedYearId(e.target.value); setSelectedSubgroupIds(new Set()); }}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm w-full md:w-64">
                {rotaryYears.map(y => <option key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</option>)}
              </select>
              <div className="max-h-60 overflow-y-auto border rounded-md divide-y">
                {subgroups.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">No subgroups found for this year</div>
                ) : subgroups.map(sg => (
                  <label key={sg.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={selectedSubgroupIds.has(sg.id)} onCheckedChange={() => toggleSubgroup(sg.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{sg.groupName}</p>
                      <p className="text-xs text-muted-foreground">{sg.memberCount} members</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {recipientCount.totalMembers} member{recipientCount.totalMembers !== 1 ? "s" : ""} selected ({recipientCount.membersWithEmail} have email)
          </p>
        </CardContent>
      </Card>

      {/* Email Details */}
      <Card>
        <CardHeader><CardTitle>Email Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Name *</Label>
              <Input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="e.g. Rotary District..." />
            </div>
            <div className="space-y-2">
              <Label>Sender Email</Label>
              <Input value="support@example.org" disabled className="bg-muted" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Reply Name</Label>
              <Input value={replyName} onChange={e => setReplyName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Reply Email</Label>
              <Input value={replyEmail} onChange={e => setReplyEmail(e.target.value)} placeholder="Optional" type="email" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Subject *</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject" />
          </div>
          <div className="space-y-2">
            <Label>Email Body *</Label>
            <Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={8} placeholder="Email content..." />
          </div>
          {commsOn && <ComposeComms scope="districts" ownerId={districtId} templateKey={templateKey} onTemplateKey={setTemplateKey} needed={recipientCount.membersWithEmail} />}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between pb-8">
        <Button variant="ghost" onClick={() => router.push(`/districts/${districtId}/mass-emails`)}>
          <ArrowLeft className="h-4 w-4 mr-2" />Discard
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleSave(true)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save as Draft
          </Button>
          <Button onClick={() => handleSave(false)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Send to {recipientCount.membersWithEmail} members
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DistrictComposeMassEmailPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>}>
        <DistrictComposeContent />
      </Suspense>
    </ProtectedRoute>
  );
}
