"use client";

import { Suspense, useState, useEffect } from "react";
import DateField from "@/components/DateField";
import { useRouter, useSearchParams } from "next/navigation";
import { createClub, uploadClubLogo, getDistricts, getDistrict, getPhotoUrl } from "@/services/api";
import { DistrictListItem } from "@/types/district";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { MEETING_DAYS } from "@/lib/constants";
import { ArrowLeft, Camera, MapPin } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import MapPicker from "@/components/MapPicker";

function NewClubForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramDistrictId = searchParams.get("districtId");
  const backUrl = paramDistrictId ? `/districts/${paramDistrictId}/clubs` : "/clubs";
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [districts, setDistricts] = useState<DistrictListItem[]>([]);
  const [districtNumber, setDistrictNumber] = useState("");

  const [form, setForm] = useState({
    fkDistrictId: paramDistrictId ? parseInt(paramDistrictId) : 0, clubRotaryId: "", clubName: "",
    clubCharterDate: "", clubLogoPath: null as string | null, clubWebsite: "",
    meetingDay: "", meetingFromTime: "", meetingToTime: "", meetingAddress: "",
    country: "", state: "", city: "", pincode: "",
    latitude: null as number | null, longitude: null as number | null,
    activeFromDate: "", activeToDate: "",
    isAutomaticMeetingReminder: true, isFamilyLogin: false, isActive: true,
  });
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    if (paramDistrictId) {
      (async () => {
        try {
          const d = await getDistrict(parseInt(paramDistrictId));
          setDistrictNumber(d.districtNumber);
        } catch { /* ignore */ }
      })();
    } else {
      (async () => {
        try {
          const result = await getDistricts(1, 100);
          setDistricts([...result.items].sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
        } catch { /* ignore */ }
      })();
    }
  }, [paramDistrictId]);

  const updateForm = (field: string, value: unknown) => setForm(prev => ({ ...prev, [field]: value }));

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadClubLogo(file);
      updateForm("clubLogoPath", result.path);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to upload logo.");
    } finally { setUploading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (!form.fkDistrictId) missing.push("District");
    if (!form.clubRotaryId.trim()) missing.push("Club Rotary ID");
    if (!form.clubName.trim()) missing.push("Club Name");
    if (!form.clubCharterDate) missing.push("Charter Date");
    if (!form.meetingDay) missing.push("Meeting Day");
    if (!form.meetingFromTime) missing.push("From Time");
    if (!form.meetingToTime) missing.push("To Time");
    if (!form.meetingAddress.trim()) missing.push("Meeting Address");
    if (!form.country.trim()) missing.push("Country");
    if (!form.state) missing.push("State");
    if (!form.city.trim()) missing.push("City");
    if (!form.activeFromDate) missing.push("Active From Date");
    if (!form.activeToDate) missing.push("Active To Date");
    if (missing.length > 0) {
      setErrorMessage(`Please fill in: ${missing.join(", ")}.`);
      return;
    }
    setLoading(true);
    try {
      await createClub({
        ...form,
        clubCharterDate: form.clubCharterDate || null,
        meetingFromTime: form.meetingFromTime || null,
        meetingToTime: form.meetingToTime || null,
        activeFromDate: form.activeFromDate || null,
        activeToDate: form.activeToDate || null,
      });
      setShowSuccess(true);
    } catch (err) {
      const message = err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message || "Failed to create club."
        : "Failed to create club.";
      setErrorMessage(message);
    } finally { setLoading(false); }
  };

  if (!isSuperAdmin) {
    return <div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3><p className="text-muted-foreground mt-2">Only SuperAdmin can create clubs.</p></div>;
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild><Link href={backUrl}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div><h2 className="text-2xl font-bold tracking-tight text-primary">New Club</h2><p className="text-muted-foreground text-base">Create a new Rotary club</p></div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(backUrl)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading && <RotaryLoader size="sm" />}Create Club</Button>
          </div>
        </div>

        <Tabs defaultValue="basic" className="space-y-4">
          <TabsList><TabsTrigger value="basic">Basic Info</TabsTrigger><TabsTrigger value="meeting">Meeting</TabsTrigger><TabsTrigger value="location">Location</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList>

          <TabsContent value="basic">
            <Card><CardHeader><CardTitle>Basic Information</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                <div className="relative h-24 w-24 overflow-hidden rounded-full bg-primary/5 border-2 border-dashed border-primary/30">
                  {form.clubLogoPath ? <Image src={getPhotoUrl(form.clubLogoPath)} alt="Logo" fill className="object-cover" unoptimized /> : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Camera className="h-10 w-10" /></div>}
                  {uploading && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><RotaryLoader size="sm" /></div>}
                </div>
                <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" id="club-logo" onChange={handleLogoUpload} />
                <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById("club-logo")?.click()} disabled={uploading}><Camera className="mr-2 h-4 w-4" />{form.clubLogoPath ? "Change" : "Upload"} Logo</Button>
                <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>District<span className="text-destructive ml-1">*</span></Label>
                  {paramDistrictId ? (
                    <Input value={districtNumber ? `District ${districtNumber}` : ""} disabled className="bg-muted" />
                  ) : (
                    <Select value={form.fkDistrictId ? String(form.fkDistrictId) : ""} onValueChange={(v) => updateForm("fkDistrictId", parseInt(v))}><SelectTrigger><SelectValue placeholder="Select district" /></SelectTrigger><SelectContent>{districts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}</SelectContent></Select>
                  )}
                  <p className="text-xs text-muted-foreground">District is required</p>
                </div>
                <div className="space-y-2"><Label>Club Rotary ID<span className="text-destructive ml-1">*</span></Label><Input value={form.clubRotaryId} onChange={(e) => updateForm("clubRotaryId", e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g., 12345" required /><p className="text-xs text-muted-foreground">Club Rotary ID is required</p></div>
                <div className="space-y-2 sm:col-span-2"><Label>Club Name<span className="text-destructive ml-1">*</span></Label><Input value={form.clubName} onChange={(e) => updateForm("clubName", e.target.value.replace(/[^a-zA-Z\s]/g, ""))} placeholder="Rotary Club of..." required /><p className="text-xs text-muted-foreground">Club Name is required</p></div>
                <div className="space-y-2"><Label>Charter Date<span className="text-destructive ml-1">*</span></Label><DateField value={form.clubCharterDate} onChange={(v: string) => updateForm("clubCharterDate", v)} required /><p className="text-xs text-muted-foreground">Charter Date is required</p></div>
                <div className="space-y-2"><Label>Website</Label><Input value={form.clubWebsite} onChange={(e) => updateForm("clubWebsite", e.target.value)} placeholder="https://..." /></div>
              </div>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="meeting">
            <Card><CardHeader><CardTitle>Meeting Details</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Meeting Day<span className="text-destructive ml-1">*</span></Label>
                  <Select value={form.meetingDay} onValueChange={(v) => updateForm("meetingDay", v)}><SelectTrigger><SelectValue placeholder="Select day" /></SelectTrigger><SelectContent>{MEETING_DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
                  <p className="text-xs text-muted-foreground">Meeting Day is required</p>
                </div>
                <div className="space-y-2"><Label>From Time<span className="text-destructive ml-1">*</span></Label><Input type="time" value={form.meetingFromTime} onChange={(e) => updateForm("meetingFromTime", e.target.value)} required /><p className="text-xs text-muted-foreground">From Time is required</p></div>
                <div className="space-y-2"><Label>To Time<span className="text-destructive ml-1">*</span></Label><Input type="time" value={form.meetingToTime} onChange={(e) => updateForm("meetingToTime", e.target.value)} required /><p className="text-xs text-muted-foreground">To Time is required</p></div>
                <div className="space-y-2 sm:col-span-2"><Label>Meeting Address<span className="text-destructive ml-1">*</span></Label><Textarea value={form.meetingAddress} onChange={(e) => updateForm("meetingAddress", e.target.value)} rows={3} required /><p className="text-xs text-muted-foreground">Meeting Address is required</p></div>
              </div>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="location">
            <Card><CardHeader><CardTitle>Location</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Country<span className="text-destructive ml-1">*</span></Label><Input value={form.country} onChange={(e) => updateForm("country", e.target.value)} required /><p className="text-xs text-muted-foreground">Country is required</p></div>
                <div className="space-y-2"><Label>State<span className="text-destructive ml-1">*</span></Label>
                  <Input value={form.state} onChange={(e) => updateForm("state", e.target.value)} required placeholder="Enter state" />
                  <p className="text-xs text-muted-foreground">State is required</p>
                </div>
                <div className="space-y-2"><Label>City<span className="text-destructive ml-1">*</span></Label><Input value={form.city} onChange={(e) => updateForm("city", e.target.value)} required /><p className="text-xs text-muted-foreground">City is required</p></div>
                <div className="space-y-2"><Label>Postal code</Label><Input value={form.pincode} onChange={(e) => updateForm("pincode", e.target.value)} maxLength={12} /><p className="text-xs text-muted-foreground">Optional</p></div>
              </div>
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <Label className="text-base">Map Coordinates</Label>
                    <p className="text-xs text-muted-foreground">Used by mobile &quot;Near me&quot; search. Set by clicking the Pick on Map button.</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setMapOpen(true)}><MapPin className="mr-2 h-4 w-4" />Pick on Map</Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Latitude</Label><Input type="number" step="0.0000001" value={form.latitude ?? ""} onChange={(e) => updateForm("latitude", e.target.value === "" ? null : parseFloat(e.target.value))} placeholder="e.g., 48.8566" /></div>
                  <div className="space-y-2"><Label>Longitude</Label><Input type="number" step="0.0000001" value={form.longitude ?? ""} onChange={(e) => updateForm("longitude", e.target.value === "" ? null : parseFloat(e.target.value))} placeholder="e.g., 2.3522" /></div>
                </div>
              </div>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card><CardHeader><CardTitle>Settings</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Active From Date<span className="text-destructive ml-1">*</span></Label><DateField value={form.activeFromDate} onChange={(v: string) => updateForm("activeFromDate", v)} required /><p className="text-xs text-muted-foreground">Active From Date is required</p></div>
                <div className="space-y-2"><Label>Active To Date<span className="text-destructive ml-1">*</span></Label><DateField value={form.activeToDate} onChange={(v: string) => updateForm("activeToDate", v)} required /><p className="text-xs text-muted-foreground">Active To Date is required</p></div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2"><input type="checkbox" id="autoReminder" checked={form.isAutomaticMeetingReminder} onChange={(e) => updateForm("isAutomaticMeetingReminder", e.target.checked)} className="h-4 w-4" /><Label htmlFor="autoReminder">Automatic Meeting Reminder</Label></div>
                <div className="flex items-center gap-2"><input type="checkbox" id="familyLogin" checked={form.isFamilyLogin} onChange={(e) => updateForm("isFamilyLogin", e.target.checked)} className="h-4 w-4" /><Label htmlFor="familyLogin">Family Login</Label></div>
                <div className="flex items-center gap-2"><input type="checkbox" id="isActive" checked={form.isActive} onChange={(e) => updateForm("isActive", e.target.checked)} className="h-4 w-4" /><Label htmlFor="isActive">Active</Label></div>
              </div>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </form>
      <MapPicker
        open={mapOpen}
        onOpenChange={setMapOpen}
        initialLat={form.latitude}
        initialLng={form.longitude}
        onConfirm={(lat, lng) => {
          updateForm("latitude", lat);
          updateForm("longitude", lng);
        }}
      />
      <SuccessAlert open={showSuccess} title="Club Created" description="Club created successfully." onOk={() => router.push(backUrl)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </>
  );
}

export default function NewClubPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}>
        <NewClubForm />
      </Suspense>
    </ProtectedRoute>
  );
}
