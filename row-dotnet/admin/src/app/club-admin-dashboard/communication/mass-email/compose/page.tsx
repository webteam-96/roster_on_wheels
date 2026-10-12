"use client";

/**
 * Club Admin · Communication → Mass Email → Compose (V2, inside the club-admin shell).
 * Same club-scoped recipient logic as the V1 compose, rebuilt in the V2 dashboard:
 * clubId from useAuth().selectedClubId, Back/Discard/Save return to ?returnTo=
 * (the Communication → Mass Email tab).
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createMassEmail, updateMassEmail, sendMassEmail, getMassEmailDetail, getClub,
  getSubGroups, getSubGroupClubMembers, getClubSubGroupAvailableYears,
  getMassEmailRecipientCount, getClubCreditBalance,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import RichTextEditor from "@/components/RichTextEditor";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save, Send, Loader2, X, Search, Mail } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

interface SubGroupOption { id: number; groupName: string; memberCount: number; }
interface MemberOption { memberId: number; memberName: string; email: string; }

export default function ClubAdminComposeMassEmailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { selectedClubId, isSuperAdmin, isAdmin } = useAuth();
  const clubId = selectedClubId ?? 0;
  const editId = searchParams.get("editId") ? Number(searchParams.get("editId")) : null;
  const returnTo = searchParams.get("returnTo") || "/club-admin-dashboard/communication?tab=massemail";

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  const [recipientType, setRecipientType] = useState("1");
  const [selectedSubgroupIds, setSelectedSubgroupIds] = useState<Set<number>>(new Set());
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(new Set());
  const [fromName, setFromName] = useState("");
  const [replyName, setReplyName] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const [rotaryYears, setRotaryYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [subgroups, setSubgroups] = useState<SubGroupOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [recipientCount, setRecipientCount] = useState({ totalMembers: 0, membersWithEmail: 0 });
  const [creditBalance, setCreditBalance] = useState<any>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => { if (clubId) getClub(clubId).then((c) => setClubName(c.clubName)).catch(() => {}); }, [clubId]);

  useEffect(() => {
    if (!clubId) return;
    getClubSubGroupAvailableYears(clubId).then((years) => {
      setRotaryYears(years.map((y: any) => ({ id: y.id, yearLabel: y.yearLabel, isCurrent: false })));
      if (years.length > 0) setSelectedYearId(String(years[0].id));
    }).catch(() => {});
  }, [clubId]);

  useEffect(() => {
    if (!selectedYearId || !clubId) return;
    getSubGroups(clubId, Number(selectedYearId))
      .then((groups) => setSubgroups(groups.map((g: any) => ({ id: g.id, groupName: g.groupName, memberCount: g.memberCount }))))
      .catch(() => setSubgroups([]));
  }, [clubId, selectedYearId]);

  useEffect(() => {
    if (recipientType !== "3" || !clubId) return;
    setLoadingMembers(true);
    getSubGroupClubMembers(clubId)
      .then((res) => setMembers(res.map((m: any) => ({ memberId: m.memberId, memberName: m.memberName, email: m.email || "" }))))
      .catch(() => {})
      .finally(() => setLoadingMembers(false));
  }, [clubId, recipientType]);

  useEffect(() => {
    if (!editId || !clubId) return;
    getMassEmailDetail(clubId, editId).then((detail) => {
      setRecipientType(String(detail.recipientType));
      if (detail.subgroupIds) setSelectedSubgroupIds(new Set(detail.subgroupIds));
      else if (detail.fkSubgroupId) setSelectedSubgroupIds(new Set([detail.fkSubgroupId]));
      if (detail.recipientType === 3 && detail.recipients) setSelectedMemberIds(new Set(detail.recipients.map((r: any) => r.memberId)));
      setFromName(detail.fromName || ""); setReplyName(detail.replyName || ""); setReplyEmail(detail.replyEmail || "");
      setSubject(detail.subject || ""); setEmailBody(detail.emailBody || "");
    }).catch(() => setErrorMessage("Failed to load email details.")).finally(() => setLoading(false));
  }, [clubId, editId]);

  const fetchRecipientCount = useCallback(async () => {
    if (!clubId) return;
    try {
      const p: Record<string, any> = { recipientType: Number(recipientType) };
      if (recipientType === "2" && selectedSubgroupIds.size > 0) p.subgroupIds = Array.from(selectedSubgroupIds).join(",");
      if (recipientType === "3" && selectedMemberIds.size > 0) p.memberIds = Array.from(selectedMemberIds).join(",");
      setRecipientCount(await getMassEmailRecipientCount(clubId, p));
    } catch { /* ignore */ }
  }, [clubId, recipientType, selectedSubgroupIds, selectedMemberIds]);
  useEffect(() => { fetchRecipientCount(); }, [fetchRecipientCount]);

  useEffect(() => { if (clubId) getClubCreditBalance(clubId).then(setCreditBalance).catch(() => {}); }, [clubId]);

  const insufficientCredits = creditBalance && recipientCount.membersWithEmail > creditBalance.emailRemaining;
  // Quill renders an empty document as "<p><br></p>" — strip tags to detect a
  // genuinely empty body so the "required" check isn't fooled by the markup.
  const bodyIsEmpty = !emailBody || emailBody.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim() === "";

  const handleSave = async (asDraft: boolean) => {
    if (!fromName.trim() || !subject.trim()) { setErrorMessage("From Name and Subject are required."); return; }
    if (bodyIsEmpty) { setErrorMessage("Email Body is required."); return; }
    setSaving(true);
    try {
      const data = {
        recipientType: Number(recipientType),
        subgroupIds: recipientType === "2" ? Array.from(selectedSubgroupIds) : null,
        memberIds: recipientType === "3" ? Array.from(selectedMemberIds) : null,
        fromName: fromName.trim(), replyName: replyName.trim() || null, replyEmail: replyEmail.trim() || null,
        subject: subject.trim(), emailBody, saveAsDraft: asDraft,
      };
      let createdId: number | null = null;
      if (editId) { await updateMassEmail(clubId, editId, data); createdId = editId; }
      else { createdId = (await createMassEmail(clubId, data)).id; }
      if (!asDraft && createdId) {
        try { await sendMassEmail(clubId, createdId); setSuccessMessage("Email is being sent."); }
        catch (sendErr: any) { setErrorMessage(sendErr?.response?.data?.message || "Email saved but failed to send. Retry from the list."); setSaving(false); return; }
      } else { setSuccessMessage(editId ? "Email updated successfully." : "Email saved as draft."); }
    } catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to save email."); }
    setSaving(false);
  };

  const toggleMember = (memberId: number) => setSelectedMemberIds((prev) => {
    const next = new Set(prev); next.has(memberId) ? next.delete(memberId) : next.add(memberId); return next;
  });
  const filteredMembers = members.filter((m) => !memberSearch || m.memberName.toLowerCase().includes(memberSearch.toLowerCase()) || m.email.toLowerCase().includes(memberSearch.toLowerCase()));

  if (!clubId) return null;
  if (loading) return <RotaryLoader />;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => router.push(returnTo)} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f]"><Mail size={20} /></div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-[#1e3a5f]">{editId ? "Edit Mass Email" : "Compose Mass Email"}</h2>
              <p className="text-slate-500 text-sm mt-0.5">{clubName}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Recipients</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2">
              {[{ value: "1", label: "All Members" }, { value: "2", label: "Subgroup" }, { value: "3", label: "Select Members" }].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="recipientType" value={opt.value} checked={recipientType === opt.value}
                    onChange={() => { setRecipientType(opt.value); setSelectedSubgroupIds(new Set()); setSelectedMemberIds(new Set()); }} className="accent-[#1e3a5f]" />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>

            {recipientType === "2" && (
              <div className="space-y-3">
                <select value={selectedYearId} onChange={(e) => { setSelectedYearId(e.target.value); setSelectedSubgroupIds(new Set()); }}
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm w-full md:w-64">
                  {rotaryYears.map((y) => <option key={y.id} value={String(y.id)}>{y.yearLabel}</option>)}
                </select>
                <div className="max-h-60 overflow-y-auto border rounded-md divide-y">
                  {subgroups.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">No subgroups found for this year</div>
                  ) : subgroups.map((sg) => (
                    <label key={sg.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                      <Checkbox checked={selectedSubgroupIds.has(sg.id)} onCheckedChange={() => setSelectedSubgroupIds((prev) => {
                        const next = new Set(prev); next.has(sg.id) ? next.delete(sg.id) : next.add(sg.id); return next; })} />
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium">{sg.groupName}</p><p className="text-xs text-muted-foreground">{sg.memberCount} members</p></div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {recipientType === "3" && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Search members..." className="pl-10" />
                </div>
                {loadingMembers ? (
                  <div className="text-center py-4 text-muted-foreground">Loading members...</div>
                ) : (
                  <div className="max-h-60 overflow-y-auto border rounded-md divide-y">
                    {filteredMembers.map((m) => (
                      <label key={m.memberId} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                        <Checkbox checked={selectedMemberIds.has(m.memberId)} onCheckedChange={() => toggleMember(m.memberId)} />
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{m.memberName}</p><p className="text-xs text-muted-foreground truncate">{m.email || "No email"}</p></div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="text-sm text-muted-foreground">{recipientCount.totalMembers} member{recipientCount.totalMembers !== 1 ? "s" : ""} selected ({recipientCount.membersWithEmail} have email)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Email Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>From Name *</Label><Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="e.g. Rotary Club of..." /></div>
              <div className="space-y-2"><Label>Sender Email</Label><Input value="support@example.org" disabled className="bg-muted" /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Reply Name</Label><Input value={replyName} onChange={(e) => setReplyName(e.target.value)} placeholder="Optional" /></div>
              <div className="space-y-2"><Label>Reply Email</Label><Input type="email" value={replyEmail} onChange={(e) => setReplyEmail(e.target.value)} placeholder="Optional" /></div>
            </div>
            <div className="space-y-2"><Label>Subject *</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" /></div>
            <div className="space-y-2"><Label>Email Body *</Label><RichTextEditor value={emailBody} onChange={setEmailBody} placeholder="Write your email content here..." /></div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {insufficientCredits && (
              <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-800">
                Insufficient email credits ({creditBalance?.emailRemaining || 0} available / {recipientCount.membersWithEmail} needed). You can save as draft.
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => handleSave(true)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save as Draft
              </Button>
              <Button onClick={() => handleSave(false)} disabled={saving || insufficientCredits || recipientCount.membersWithEmail === 0} className="bg-[#1e3a5f] hover:bg-[#152a44] text-white">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}Send to {recipientCount.membersWithEmail} member{recipientCount.membersWithEmail !== 1 ? "s" : ""}
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={() => router.push(returnTo)}><X className="h-4 w-4 mr-2" />Discard</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => { setSuccessMessage(null); router.push(returnTo); }} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
