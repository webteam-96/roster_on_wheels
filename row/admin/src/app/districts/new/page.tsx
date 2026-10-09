"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createDistrict, uploadDistrictLogo, getZones, getZone } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Camera } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getPhotoUrl } from "@/services/api";
import { ZoneListItem } from "@/types/zone";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/constants/countries";
import { CURRENCY_OPTIONS } from "@/lib/currency";

function NewDistrictForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramZoneId = searchParams.get("zoneId");
  const backUrl = paramZoneId ? `/zones/${paramZoneId}/districts` : "/districts";
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [districtNumber, setDistrictNumber] = useState("");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [zoneId, setZoneId] = useState<string>(paramZoneId || "");
  const [zoneName, setZoneName] = useState("");
  const [zones, setZones] = useState<ZoneListItem[]>([]);
  const [country, setCountry] = useState<string>(DEFAULT_COUNTRY);
  const [defaultCurrency, setDefaultCurrency] = useState<string>("INR");
  const [showSuccess, setShowSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (paramZoneId) {
      (async () => {
        try {
          const z = await getZone(parseInt(paramZoneId));
          setZoneName(z.zoneName);
        } catch { /* ignore */ }
      })();
    } else {
      (async () => {
        try {
          const result = await getZones(1, 1000, undefined, 1);
          setZones(result.items);
        } catch { /* ignore */ }
      })();
    }
  }, [paramZoneId]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadDistrictLogo(file);
      setLogoPath(result.path);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to upload logo.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (!zoneId) missing.push("Zone");
    if (!districtNumber.trim()) missing.push("District Number");
    if (missing.length > 0) {
      setErrorMessage(`Please fill in: ${missing.join(", ")}.`);
      return;
    }
    setLoading(true);
    try {
      await createDistrict({
        districtNumber: districtNumber.trim(),
        districtLogoPath: logoPath,
        isActive,
        fkZoneId: zoneId ? parseInt(zoneId) : null,
        country: country || DEFAULT_COUNTRY,
        defaultCurrency,
      });
      setShowSuccess(true);
    } catch (err) {
      const message = err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message || "Failed to create district."
        : "Failed to create district.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h3 className="text-lg font-semibold">Access Denied</h3>
        <p className="text-muted-foreground mt-2">Only SuperAdmin can create districts.</p>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href={backUrl}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">New District</h2>
              <p className="text-muted-foreground text-base">Create a new Rotary district</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(backUrl)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <RotaryLoader size="sm" />}
              Create District
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>District Details</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3">
                <div className="relative h-24 w-24 overflow-hidden rounded-full bg-primary/5 border-2 border-dashed border-primary/30">
                  {logoPath ? (
                    <Image src={getPhotoUrl(logoPath)} alt="Logo" fill className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Camera className="h-10 w-10" />
                    </div>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <RotaryLoader size="sm" />
                    </div>
                  )}
                </div>
                <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" id="logo-upload" onChange={handleLogoUpload} />
                <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById("logo-upload")?.click()} disabled={uploading}>
                  <Camera className="mr-2 h-4 w-4" />
                  {logoPath ? "Change Logo" : "Upload Logo"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
              </div>

              <div className="grid gap-4 max-w-md mx-auto">
                <div className="space-y-2">
                  <Label htmlFor="zone">Zone<span className="text-destructive ml-1">*</span></Label>
                  {paramZoneId ? (
                    <Input value={zoneName} disabled className="bg-muted" />
                  ) : (
                    <Select value={zoneId} onValueChange={setZoneId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a zone" />
                      </SelectTrigger>
                      <SelectContent>
                        {zones.map((zone) => (
                          <SelectItem key={zone.id} value={String(zone.id)}>
                            {zone.zoneName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">Zone is required</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">Country<span className="text-destructive ml-1">*</span></Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a country" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Defaults to India</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultCurrency">Default Currency</Label>
                  <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a default currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((c) => (
                        <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Pre-selected on project-add forms for clubs in this district</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="districtNumber">District Number<span className="text-destructive ml-1">*</span></Label>
                  <Input id="districtNumber" value={districtNumber} onChange={(e) => setDistrictNumber(e.target.value)} placeholder="e.g., 3131" required />
                  <p className="text-xs text-muted-foreground">District Number is required</p>
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
                  <Label htmlFor="isActive">Active</Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
      <SuccessAlert open={showSuccess} title="District Created" description="District created successfully." onOk={() => router.push(backUrl)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </>
  );
}

export default function NewDistrictPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}>
        <NewDistrictForm />
      </Suspense>
    </ProtectedRoute>
  );
}
