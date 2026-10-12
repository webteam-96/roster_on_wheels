"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getZones, getDistricts,
  getRiDirectorMassEmail, createRiDirectorMassEmail, updateRiDirectorMassEmail,
  getRiDirectorSubGroups, getRiDirectorSubGroupYears,
  sendRiDirectorMassEmail, getRiDirectorCreditBalance, getRiDirectorRecipientCount,
} from "@/services/api";
import AlertModal from "@/components/AlertModal";
import { AlertTriangle, Send } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save, Users2, Mail } from "lucide-react";
// Note: AlertTriangle, Send are imported above
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

type RecipientType = 1 | 2 | 3 | 4;

export default function RiMassEmailCompose({ emailId }: { emailId?: number }) {
  const router = useRouter();
  const isEdit = !!emailId;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const [recipientType, setRecipientType] = useState<RecipientType>(1);
  const [zoneIds, setZoneIds] = useState<number[]>([]);
  const [districtIds, setDistrictIds] = useState<number[]>([]);
  const [subgroupIds, setSubgroupIds] = useState<number[]>([]);
  const [subgroupYearId, setSubgroupYearId] = useState<number | null>(null);

  const [fromName, setFromName] = useState("");
  const [replyName, setReplyName] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [zones, setZones] = useState<{ id: number; name: string }[]>([]);
  const [districts, setDistricts] = useState<{ id: number; number: string }[]>([]);
  const [years, setYears] = useState<{ id: number; label: string; isCurrent: boolean }[]>([]);
  const [subgroups, setSubgroups] = useState<{ id: number; groupName: string; memberCount: number }[]>([]);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sendConfirm, setSendConfirm] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number>(0);
  const [emailBalance, setEmailBalance] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const z = await getZones(1, 1000, undefined, 1);
        setZones(z.items.map((x: any) => ({ id: x.id, name: x.zoneName })));
      } catch {}
      try {
        const d = await getDistricts(1, 1000, undefined, 1);
        setDistricts(d.items.map((x: any) => ({ id: x.id, number: x.districtNumber })).sort((a: any, b: any) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true })));
      } catch {}
      try {
        const y = await getRiDirectorSubGroupYears();
        const list = y.map(x => ({ id: x.id, label: x.yearLabel, isCurrent: x.isCurrent }));
        setYears(list);
        const cur = list.find(x => x.isCurrent) ?? list[0];
        if (cur) setSubgroupYearId(cur.id);
      } catch {}
    })();
  }, []);

  // Load subgroups when year changes
  useEffect(() => {
    if (recipientType !== 4 || !subgroupYearId) { setSubgroups([]); return; }
    (async () => {
      try { setSubgroups(await getRiDirectorSubGroups(subgroupYearId)); }
      catch { setSubgroups([]); }
    })();
  }, [recipientType, subgroupYearId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const d = await getRiDirectorMassEmail(emailId!);
        setRecipientType(d.recipientType as RecipientType);
        const parseIds = (s: string | null | undefined): number[] => !s ? [] : s.split(",").map((x: string) => parseInt(x.trim())).filter((x: number) => !isNaN(x));
        setZoneIds(parseIds(d.recipientZoneIds));
        setDistrictIds(parseIds(d.recipientDistrictIds));
        setSubgroupIds(parseIds(d.recipientSubgroupIds));
        setFromName(d.fromName || "");
        setReplyName(d.replyName || "");
        setReplyEmail(d.replyEmail || "");
        setSubject(d.subject || "");
        setBody(d.emailBody || "");
      } catch { setErrorMessage("Failed to load mass email."); }
      finally { setLoading(false); }
    })();
  }, [isEdit, emailId]);

  const toggle = (arr: number[], setArr: (v: number[]) => void, id: number) => {
    setArr(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };

  const validate = (): boolean => {
    if (!subject.trim()) { setErrorMessage("Subject is required."); return false; }
    if (!fromName.trim()) { setErrorMessage("From Name is required."); return false; }
    if (recipientType === 2 && zoneIds.length === 0) { setErrorMessage("Select at least one zone."); return false; }
    if (recipientType === 3 && districtIds.length === 0) { setErrorMessage("Select at least one district."); return false; }
    if (recipientType === 4 && subgroupIds.length === 0) { setErrorMessage("Select at least one sub group."); return false; }
    return true;
  };

  const buildPayload = () => ({
    recipientType,
    zoneIds: recipientType === 2 ? zoneIds : [],
    districtIds: recipientType === 3 ? districtIds : [],
    subgroupIds: recipientType === 4 ? subgroupIds : [],
    memberIds: [],
    fromName: fromName.trim(),
    replyName: replyName.trim() || null,
    replyEmail: replyEmail.trim() || null,
    subject: subject.trim(),
    emailBody: body.trim() || null,
    saveAsDraft: true,
  });

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEdit) { await updateRiDirectorMassEmail(emailId!, payload); setSuccessMessage("Mass email updated."); }
      else { await createRiDirectorMassEmail(payload); setSuccessMessage("Mass email saved as draft."); }
      setTimeout(() => router.push("/ri-director/mass-emails"), 1500);
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to save."); }
    finally { setSaving(false); }
  };

  const openSendConfirm = async () => {
    if (!validate()) return;
    // Calculate recipient count and balance for the dialog
    try {
      const target = recipientType === 2 ? "zones" : recipientType === 3 ? "districts" : recipientType === 4 ? "subgroups" : "all";
      const count = await getRiDirectorRecipientCount(
        "email",
        target as any,
        recipientType === 2 ? zoneIds : [],
        recipientType === 3 ? districtIds : [],
        recipientType === 4 ? subgroupIds : []
      );
      const bal = await getRiDirectorCreditBalance();
      setRecipientCount(count);
      setEmailBalance(bal.emailBalance);
      setSendConfirm(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to check recipients/credits. Please try again.");
    }
  };

  const handleSaveAndSend = async () => {
    if (emailBalance !== null && recipientCount > emailBalance) {
      setSendConfirm(false);
      setErrorMessage(`Insufficient Email credits. Required: ${recipientCount}, Available: ${emailBalance}.`);
      return;
    }
    if (recipientCount === 0) {
      setSendConfirm(false);
      setErrorMessage("No recipients found for the selected filter.");
      return;
    }

    setSaving(true);
    setSendConfirm(false);
    try {
      const payload = buildPayload();
      let id: number;
      if (isEdit) {
        await updateRiDirectorMassEmail(emailId!, payload);
        id = emailId!;
      } else {
        const res = await createRiDirectorMassEmail(payload);
        id = res.id;
      }
      await sendRiDirectorMassEmail(id);
      setSuccessMessage("Mass email is being sent.");
      setTimeout(() => router.push("/ri-director/mass-emails"), 1500);
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to send."); }
    finally { setSaving(false); }
  };

  if (loading) return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href="/ri-director/mass-emails"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">{isEdit ? "Edit" : "Compose"} Mass Email</h2>
            <p className="text-muted-foreground">RI Director</p>
          </div>
        </div>

        {/* Recipients */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Users2 className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Recipients</h3>
            </div>
            <div className="flex flex-wrap gap-4">
              {[
                { v: 1, label: "All Members" },
                { v: 2, label: "By Zones" },
                { v: 3, label: "By Districts" },
                { v: 4, label: "By Sub Groups" },
              ].map(o => (
                <label key={o.v} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={recipientType === o.v} onChange={() => setRecipientType(o.v as RecipientType)} className="h-4 w-4" />
                  <span className="text-sm font-medium">{o.label}</span>
                </label>
              ))}
            </div>

            {recipientType === 2 && (
              <div className="border rounded-md p-3 max-h-40 overflow-auto bg-muted/30">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {zones.map(z => (
                    <label key={z.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={zoneIds.includes(z.id)} onChange={() => toggle(zoneIds, setZoneIds, z.id)} className="h-4 w-4" />
                      <span>{z.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {recipientType === 3 && (
              <div className="border rounded-md p-3 max-h-40 overflow-auto bg-muted/30">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {districts.map(d => (
                    <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={districtIds.includes(d.id)} onChange={() => toggle(districtIds, setDistrictIds, d.id)} className="h-4 w-4" />
                      <span>{d.number}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {recipientType === 4 && (
              years.length === 0 ? (
                <div className="border rounded-md p-3 bg-amber-50 text-amber-800 text-sm">
                  No sub groups created yet. Please create sub groups first before selecting this option.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Year:</span>
                    <Select value={subgroupYearId ? String(subgroupYearId) : ""} onValueChange={(v) => { setSubgroupYearId(Number(v)); setSubgroupIds([]); }}>
                      <SelectTrigger className="w-48"><SelectValue placeholder="Select year" /></SelectTrigger>
                      <SelectContent>
                        {years.map(y => <SelectItem key={y.id} value={String(y.id)}>{y.label}{y.isCurrent ? " (Current)" : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="border rounded-md p-3 max-h-48 overflow-auto bg-muted/30">
                    {subgroups.length === 0 ? <p className="text-xs text-muted-foreground">No sub groups for this year.</p> : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {subgroups.map(s => (
                          <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={subgroupIds.includes(s.id)} onChange={() => toggle(subgroupIds, setSubgroupIds, s.id)} className="h-4 w-4" />
                            <span>{s.groupName} <span className="text-muted-foreground">({s.memberCount})</span></span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
          </CardContent>
        </Card>

        {/* Email */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Email Content</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="font-semibold text-sm">From Name <span className="text-destructive">*</span></Label>
                <Input value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label className="font-semibold text-sm">Reply To Name</Label>
                <Input value={replyName} onChange={(e) => setReplyName(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="font-semibold text-sm">Reply To Email</Label>
                <Input type="email" value={replyEmail} onChange={(e) => setReplyEmail(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="font-semibold text-sm">Subject <span className="text-destructive">*</span></Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="font-semibold text-sm">Body</Label>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder="Email body (HTML supported)..." />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 pb-8">
          <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button variant="outline" onClick={handleSave} disabled={saving} size="lg">
            {saving ? <RotaryLoader size="sm" /> : <><Save className="mr-2 h-4 w-4" />Save as Draft</>}
          </Button>
          <Button onClick={openSendConfirm} disabled={saving} size="lg">
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Send Now</>}
          </Button>
        </div>

        <AlertModal
          open={sendConfirm}
          onOpenChange={(o) => !o && setSendConfirm(false)}
          icon={emailBalance !== null && recipientCount > emailBalance ? AlertTriangle : Send}
          iconClassName={emailBalance !== null && recipientCount > emailBalance ? "text-destructive" : "text-primary"}
          title="Send Mass Email"
          description={
            <div className="space-y-2">
              <p>Send to <span className="font-semibold">{recipientCount}</span> recipient(s)?</p>
              <div className="text-sm border-t pt-2 space-y-1">
                <div>Required Email credits: <span className="font-semibold">{recipientCount}</span></div>
                <div>Available balance: <span className={`font-semibold ${emailBalance !== null && recipientCount > emailBalance ? "text-destructive" : "text-green-700"}`}>{emailBalance === null ? "..." : emailBalance}</span></div>
                {emailBalance !== null && recipientCount > emailBalance && (
                  <div className="text-destructive font-medium mt-1">⚠️ Insufficient credits. Send blocked.</div>
                )}
                {recipientCount === 0 && (
                  <div className="text-destructive font-medium mt-1">⚠️ No recipients found for your selection.</div>
                )}
              </div>
            </div>
          }
          confirmLabel="Save & Send"
          onConfirm={handleSaveAndSend}
          cancelLabel="Cancel"
          onCancel={() => setSendConfirm(false)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push("/ri-director/mass-emails")} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
