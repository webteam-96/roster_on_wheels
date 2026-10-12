"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  createMassEmail, updateMassEmail, sendMassEmail, getMassEmailDetail, getClub,
  getSubGroups, getSubGroupClubMembers, getClubSubGroupAvailableYears,
  getMassEmailRecipientCount, getClubCreditBalance,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save, Send, Loader2, X, Search } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

interface SubGroupOption { id: number; groupName: string; memberCount: number; }
interface MemberOption { memberId: number; memberName: string; email: string; }

export default function ComposeMassEmailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const editId = searchParams.get("editId") ? Number(searchParams.get("editId")) : null;
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [recipientType, setRecipientType] = useState("1");
  const [selectedSubgroupIds, setSelectedSubgroupIds] = useState<Set<number>>(new Set());
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(new Set());
  const [fromName, setFromName] = useState("");
  const [replyName, setReplyName] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // Lookups
  const [rotaryYears, setRotaryYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [subgroups, setSubgroups] = useState<SubGroupOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Recipient count
  const [recipientCount, setRecipientCount] = useState({ totalMembers: 0, membersWithEmail: 0 });

  // Credits
  const [creditBalance, setCreditBalance] = useState<any>(null);

  // Alerts
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load club info
  useEffect(() => {
    async function loadClub() {
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
      } catch { /* ignore */ }
    }
    loadClub();
  }, [clubId]);

  // Load only years that have subgroup data
  useEffect(() => {
    async function loadYears() {
      try {
        const years = await getClubSubGroupAvailableYears(clubId);
        setRotaryYears(years.map((y: any) => ({ id: y.id, yearLabel: y.yearLabel, isCurrent: false })));
        if (years.length > 0) setSelectedYearId(String(years[0].id));
      } catch {}
    }
    loadYears();
  }, [clubId]);

  // Load subgroups when year changes
  useEffect(() => {
    if (!selectedYearId) return;
    async function loadSubgroups() {
      try {
        const groups = await getSubGroups(clubId, Number(selectedYearId));
        setSubgroups(groups.map((g: any) => ({ id: g.id, groupName: g.groupName, memberCount: g.memberCount })));
      } catch { setSubgroups([]); }
    }
    loadSubgroups();
  }, [clubId, selectedYearId]);

  // Load members for manual selection
  useEffect(() => {
    if (recipientType !== "3") return;
    async function loadMembers() {
      setLoadingMembers(true);
      try {
        const res = await getSubGroupClubMembers(clubId);
        setMembers(res.map((m: any) => ({ memberId: m.memberId, memberName: m.memberName, email: m.email || "" })));
      } catch { /* ignore */ }
      setLoadingMembers(false);
    }
    loadMembers();
  }, [clubId, recipientType]);

  // Load edit data
  useEffect(() => {
    if (!editId) return;
    async function loadEmail() {
      try {
        const detail = await getMassEmailDetail(clubId, editId!);
        setRecipientType(String(detail.recipientType));
        if (detail.subgroupIds) setSelectedSubgroupIds(new Set(detail.subgroupIds));
        else if (detail.fkSubgroupId) setSelectedSubgroupIds(new Set([detail.fkSubgroupId]));
        if (detail.recipientType === 3 && detail.recipients) {
          setSelectedMemberIds(new Set(detail.recipients.map((r: any) => r.memberId)));
        }
        setFromName(detail.fromName || "");
        setReplyName(detail.replyName || "");
        setReplyEmail(detail.replyEmail || "");
        setSubject(detail.subject || "");
        setEmailBody(detail.emailBody || "");
      } catch (err: any) {
        setErrorMessage("Failed to load email details.");
      }
      setLoading(false);
    }
    loadEmail();
  }, [clubId, editId]);

  // Load recipient count
  const fetchRecipientCount = useCallback(async () => {
    try {
      const p: Record<string, any> = { recipientType: Number(recipientType) };
      if (recipientType === "2" && selectedSubgroupIds.size > 0) p.subgroupIds = Array.from(selectedSubgroupIds).join(",");
      if (recipientType === "3" && selectedMemberIds.size > 0) {
        p.memberIds = Array.from(selectedMemberIds).join(",");
      }
      const res = await getMassEmailRecipientCount(clubId, p);
      setRecipientCount(res);
    } catch { /* ignore */ }
  }, [clubId, recipientType, selectedSubgroupIds, selectedMemberIds]);

  useEffect(() => { fetchRecipientCount(); }, [fetchRecipientCount]);

  // Load credit balance
  useEffect(() => {
    async function loadBalance() {
      try {
        const res = await getClubCreditBalance(clubId);
        setCreditBalance(res);
      } catch { /* ignore */ }
    }
    loadBalance();
  }, [clubId]);

  const insufficientCredits = creditBalance && recipientCount.membersWithEmail > creditBalance.emailRemaining;

  const handleSave = async (asDraft: boolean) => {
    if (!fromName.trim() || !subject.trim()) {
      setErrorMessage("From Name and Subject are required.");
      return;
    }
    if (!emailBody.trim()) {
      setErrorMessage("Email Body is required.");
      return;
    }

    setSaving(true);
    try {
      const data = {
        recipientType: Number(recipientType),
        subgroupIds: recipientType === "2" ? Array.from(selectedSubgroupIds) : null,
        memberIds: recipientType === "3" ? Array.from(selectedMemberIds) : null,
        fromName: fromName.trim(),
        replyName: replyName.trim() || null,
        replyEmail: replyEmail.trim() || null,
        subject: subject.trim(),
        emailBody: emailBody,
        saveAsDraft: asDraft,
      };

      let createdId: number | null = null;
      if (editId) {
        await updateMassEmail(clubId, editId, data);
        createdId = editId;
      } else {
        const result = await createMassEmail(clubId, data);
        createdId = result.id;
      }

      if (!asDraft && createdId) {
        // Trigger send after saving
        try {
          await sendMassEmail(clubId, createdId);
          setSuccessMessage("Email is being sent.");
        } catch (sendErr: any) {
          setErrorMessage(sendErr?.response?.data?.message || "Email saved but failed to send. You can retry from the listing.");
          setSaving(false);
          return;
        }
      } else {
        setSuccessMessage(editId ? "Email updated successfully." : "Email saved as draft.");
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save email.");
    }
    setSaving(false);
  };

  const toggleMember = (memberId: number) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const filteredMembers = members.filter(
    (m) => !memberSearch || m.memberName.toLowerCase().includes(memberSearch.toLowerCase()) || m.email.toLowerCase().includes(memberSearch.toLowerCase())
  );

  if (loading) return <RotaryLoader />;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/mass-emails`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {editId ? "Edit Mass Email" : "Compose Mass Email"}
            </h2>
            <p className="text-muted-foreground text-base">{clubName}</p>
          </div>
        </div>

        {/* Section 1: Recipients */}
        <Card>
          <CardHeader><CardTitle>Recipients</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2">
              {[
                { value: "1", label: "All Members" },
                { value: "2", label: "Subgroup" },
                { value: "3", label: "Select Members" },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio" name="recipientType" value={opt.value}
                    checked={recipientType === opt.value}
                    onChange={() => { setRecipientType(opt.value); setSelectedSubgroupIds(new Set()); setSelectedMemberIds(new Set()); }}
                    className="accent-primary"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>

            {recipientType === "2" && (
              <div className="space-y-3">
              <select value={selectedYearId} onChange={e => { setSelectedYearId(e.target.value); setSelectedSubgroupIds(new Set()); }}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm w-full md:w-64">
                {rotaryYears.map(y => <option key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</option>)}
              </select>
              <div className="max-h-60 overflow-y-auto border rounded-md divide-y">
                {subgroups.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">No subgroups found for this year</div>
                ) : subgroups.map((sg) => (
                  <label key={sg.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={selectedSubgroupIds.has(sg.id)}
                      onCheckedChange={() => {
                        setSelectedSubgroupIds(prev => {
                          const next = new Set(prev);
                          if (next.has(sg.id)) next.delete(sg.id); else next.add(sg.id);
                          return next;
                        });
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{sg.groupName}</p>
                      <p className="text-xs text-muted-foreground">{sg.memberCount} members</p>
                    </div>
                  </label>
                ))}
              </div>
              </div>
            )}

            {recipientType === "3" && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search members..." className="pl-10"
                  />
                </div>
                {loadingMembers ? (
                  <div className="text-center py-4 text-muted-foreground">Loading members...</div>
                ) : (
                  <div className="max-h-60 overflow-y-auto border rounded-md divide-y">
                    {filteredMembers.map((m) => (
                      <label key={m.memberId} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                        <Checkbox
                          checked={selectedMemberIds.has(m.memberId)}
                          onCheckedChange={() => toggleMember(m.memberId)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.memberName}</p>
                          <p className="text-xs text-muted-foreground truncate">{m.email || "No email"}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {recipientCount.totalMembers} member{recipientCount.totalMembers !== 1 ? "s" : ""} selected ({recipientCount.membersWithEmail} have email)
            </p>
          </CardContent>
        </Card>

        {/* Section 2: Email Details */}
        <Card>
          <CardHeader><CardTitle>Email Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Name *</Label>
                <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="e.g. Rotary Club of..." />
              </div>
              <div className="space-y-2">
                <Label>Sender Email</Label>
                <Input value="support@example.org" disabled className="bg-muted" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Reply Name</Label>
                <Input value={replyName} onChange={(e) => setReplyName(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Reply Email</Label>
                <Input type="email" value={replyEmail} onChange={(e) => setReplyEmail(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
            </div>
            <div className="space-y-2">
              <Label>Email Body *</Label>
              <Textarea
                value={emailBody} onChange={(e) => setEmailBody(e.target.value)}
                placeholder="Write your email content here..."
                rows={10}
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Actions */}
        <Card>
          <CardContent className="pt-6">
            {insufficientCredits && (
              <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-800">
                Insufficient email credits ({creditBalance?.emailRemaining || 0} available / {recipientCount.membersWithEmail} needed). You can save as draft.
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => handleSave(true)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save as Draft
              </Button>
              <Button
                onClick={() => handleSave(false)}
                disabled={saving || insufficientCredits || recipientCount.membersWithEmail === 0}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Send to {recipientCount.membersWithEmail} member{recipientCount.membersWithEmail !== 1 ? "s" : ""}
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={() => router.push(`/clubs/${clubId}/mass-emails`)}>
                <X className="h-4 w-4 mr-2" />
                Discard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <SuccessAlert
        open={!!successMessage}
        title="Success"
        description={successMessage || ""}
        onOk={() => { setSuccessMessage(null); router.push(`/clubs/${clubId}/mass-emails`); }}
      />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
