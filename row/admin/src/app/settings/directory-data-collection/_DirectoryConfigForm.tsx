"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Save } from "lucide-react";
import {
  getRotaryYears, getDistricts,
  getDirectoryFieldMetadata, getDirectoryConfig,
  createDirectoryConfig, updateDirectoryConfig,
  DirectoryFieldSection,
} from "@/services/api";
import { RotaryYear } from "@/types/rotaryYear";

type DistrictOpt = { id: number; districtNumber: string };

interface Props { mode: "create" | "edit"; configId?: number; }

export default function DirectoryConfigForm({ mode, configId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [years, setYears] = useState<RotaryYear[]>([]);
  const [districts, setDistricts] = useState<DistrictOpt[]>([]);
  const [sections, setSections] = useState<DirectoryFieldSection[]>([]);

  const [districtId, setDistrictId] = useState<string>("");
  const [yearId, setYearId] = useState<string>("");
  const [firstContactName, setFirstContactName] = useState("");
  const [firstContactMobile, setFirstContactMobile] = useState("");
  const [secondContactName, setSecondContactName] = useState("");
  const [secondContactMobile, setSecondContactMobile] = useState("");
  // Admin-proxy passwords for the public ?fetch=admin URL flow. Blank = no change on edit.
  // Indicator booleans come back from server so the form can show "(set)" / "(not set)".
  const [firstContactPassword, setFirstContactPassword] = useState("");
  const [secondContactPassword, setSecondContactPassword] = useState("");
  const [isFirstContactPasswordSet, setIsFirstContactPasswordSet] = useState(false);
  const [isSecondContactPasswordSet, setIsSecondContactPasswordSet] = useState(false);
  // Per-district notification toggles — default ON (send). Gate reminders + post-submit confirmation (never OTP).
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsapp, setSendWhatsapp] = useState(true);

  const [dcSet, setDcSet] = useState<Set<string>>(new Set());
  const [bodSet, setBodSet] = useState<Set<string>>(new Set());
  const [memberSet, setMemberSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const [ys, ds, secs] = await Promise.all([
          getRotaryYears(),
          getDistricts(1, 1000),
          getDirectoryFieldMetadata(),
        ]);
        setYears(ys);
        setDistricts((ds.items ?? []).map((d: any) => ({ id: d.id, districtNumber: d.districtNumber })).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
        setSections(secs);

        if (mode === "edit" && configId) {
          const cfg = await getDirectoryConfig(configId);
          setDistrictId(String(cfg.districtId));
          setYearId(String(cfg.yearId));
          setFirstContactName(cfg.firstContactName ?? "");
          setFirstContactMobile(cfg.firstContactMobile ?? "");
          setSecondContactName(cfg.secondContactName ?? "");
          setSecondContactMobile(cfg.secondContactMobile ?? "");
          setIsFirstContactPasswordSet(Boolean(cfg.isFirstContactPasswordSet));
          setIsSecondContactPasswordSet(Boolean(cfg.isSecondContactPasswordSet));
          setSendEmail(cfg.sendEmail == null ? true : !!cfg.sendEmail);
          setSendWhatsapp(cfg.sendWhatsapp == null ? true : !!cfg.sendWhatsapp);
          setDcSet(new Set(cfg.dcFields ?? []));
          setBodSet(new Set(cfg.bodFields ?? []));
          setMemberSet(new Set(cfg.memberFields ?? []));
        }
      } catch (e: any) {
        setError(e?.response?.data?.message ?? "Failed to load form data");
      } finally {
        setLoading(false);
      }
    })();
  }, [mode, configId]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const allKeys = useMemo(() => sections.flatMap((s) => s.fields.map((f) => f.key)), [sections]);

  const selectAll = (setter: (s: Set<string>) => void) => setter(new Set(allKeys));
  const clearAll = (setter: (s: Set<string>) => void) => setter(new Set());

  const submit = async () => {
    if (!districtId || !yearId) { setError("District and Year are required"); return; }
    if (!firstContactName.trim() || !firstContactMobile.trim()) {
      setError("First Contact Name and First Contact Mobile are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        districtId: Number(districtId),
        yearId: Number(yearId),
        firstContactName: firstContactName || undefined,
        firstContactMobile: firstContactMobile || undefined,
        // Send only when typed (else server keeps existing hash on edit). On create, blank = no password set yet.
        firstContactPassword: firstContactPassword || undefined,
        secondContactName: secondContactName || undefined,
        secondContactMobile: secondContactMobile || undefined,
        secondContactPassword: secondContactPassword || undefined,
        dcFields: Array.from(dcSet),
        bodFields: Array.from(bodSet),
        memberFields: Array.from(memberSet),
        sendEmail,
        sendWhatsapp,
      };
      if (mode === "create") {
        await createDirectoryConfig(payload);
        setSuccess("Configuration saved");
      } else if (configId) {
        await updateDirectoryConfig(configId, payload);
        setSuccess("Configuration updated");
      }
      setTimeout(() => router.push("/settings/directory-data-collection"), 600);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Save failed");
    } finally { setSaving(false); }
  };

  if (loading) return <ProtectedRoute><RotaryLoader /></ProtectedRoute>;

  const renderGroup = (title: string, set: Set<string>, setter: (s: Set<string>) => void) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title} — select fields</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => selectAll(setter)}>Select All</Button>
          <Button size="sm" variant="outline" onClick={() => clearAll(setter)}>Clear All</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sections.map((section) => (
          <div key={section.section}>
            <div className="text-sm font-semibold text-primary mb-2">{section.section}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {section.fields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={set.has(f.key)} onCheckedChange={() => toggle(set, setter, f.key)} />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings/directory-data-collection"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {mode === "create" ? "Add Directory Config" : "Edit Directory Config"}
            </h2>
            <p className="text-muted-foreground text-base">Set fields for DC, BOD, and Members</p>
          </div>
          <Button onClick={submit} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />{saving ? "Saving..." : "Save"}
          </Button>
        </div>

        <SuccessAlert open={!!success} title="Success" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error ?? ""} onOk={() => setError(null)} />

        <Card>
          <CardHeader><CardTitle className="text-lg">Basic Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="mb-1 block">District *</Label>
              <Select value={districtId} onValueChange={setDistrictId} disabled={mode === "edit"}>
                <SelectTrigger><SelectValue placeholder="Select District" /></SelectTrigger>
                <SelectContent>
                  {districts.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">Rotary Year *</Label>
              <Select value={yearId} onValueChange={setYearId} disabled={mode === "edit"}>
                <SelectTrigger><SelectValue placeholder="Select Year" /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Row 1: First Name (left) | Second Name (right) */}
            <div>
              <Label className="mb-1 block">First Contact Name <span className="text-red-500">*</span></Label>
              <Input value={firstContactName} onChange={(e) => setFirstContactName(e.target.value)} placeholder="e.g. Rtn Rohit Kakar" />
            </div>
            <div>
              <Label className="mb-1 block">Second Contact Name</Label>
              <Input value={secondContactName} onChange={(e) => setSecondContactName(e.target.value)} placeholder="Optional" />
            </div>
            {/* Row 2: First Mobile (left) | Second Mobile (right) */}
            <div>
              <Label className="mb-1 block">First Contact Mobile <span className="text-red-500">*</span></Label>
              <Input value={firstContactMobile} onChange={(e) => setFirstContactMobile(e.target.value)} placeholder="e.g. 7700900123" />
            </div>
            <div>
              <Label className="mb-1 block">Second Contact Mobile</Label>
              <Input value={secondContactMobile} onChange={(e) => setSecondContactMobile(e.target.value)} placeholder="Optional" />
            </div>
            {/* Row 3: First Password (left) | Second Password (right) */}
            <div>
              <Label className="mb-1 block">
                First Contact Password
                {mode === "edit" && (
                  <span className={`ml-2 text-xs ${isFirstContactPasswordSet ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {isFirstContactPasswordSet ? "(set — leave blank to keep)" : "(not set)"}
                  </span>
                )}
              </Label>
              <Input
                type="password"
                value={firstContactPassword}
                onChange={(e) => setFirstContactPassword(e.target.value)}
                placeholder={mode === "edit" && isFirstContactPasswordSet ? "Leave blank to keep current" : "Set a password"}
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label className="mb-1 block">
                Second Contact Password
                {mode === "edit" && (
                  <span className={`ml-2 text-xs ${isSecondContactPasswordSet ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {isSecondContactPasswordSet ? "(set — leave blank to keep)" : "(not set)"}
                  </span>
                )}
              </Label>
              <Input
                type="password"
                value={secondContactPassword}
                onChange={(e) => setSecondContactPassword(e.target.value)}
                placeholder={mode === "edit" && isSecondContactPasswordSet ? "Leave blank to keep current" : "Set a password"}
                autoComplete="new-password"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controls the reminder &amp; post-submit confirmation messages for this district. OTP is always sent regardless of these.
              </p>
            </div>
            <label className="flex w-fit items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm font-medium">Send Email</span>
            </label>
            <label className="flex w-fit items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sendWhatsapp}
                onChange={(e) => setSendWhatsapp(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm font-medium">Send WhatsApp</span>
            </label>
          </CardContent>
        </Card>

        {renderGroup("District Committee (DC)", dcSet, setDcSet)}
        {renderGroup("BOD (Club President & Secretary)", bodSet, setBodSet)}
        {renderGroup("Members", memberSet, setMemberSet)}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />{saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </ProtectedRoute>
  );
}
