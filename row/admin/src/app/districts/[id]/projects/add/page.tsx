"use client";
import { useState, useEffect } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import { getDistrict, createDistrictProject, uploadDistrictProjectPhoto, getModules, getAreasOfFocus, getCategories, getSubCategories, getFunding } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Upload, X, Send, Info } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { currencySymbol } from "@/lib/appFormat";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function DistrictProjectAddPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const [districtName, setDistrictName] = useState("");
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [areaOfFocusId, setAreaOfFocusId] = useState("");
  const [otherAreaOfFocus, setOtherAreaOfFocus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [otherCategory, setOtherCategory] = useState("");
  const [subCategoryId, setSubCategoryId] = useState("");
  const [otherSubCategory, setOtherSubCategory] = useState("");
  const [projectDate, setProjectDate] = useState("");
  const [projectCost, setProjectCost] = useState("");
  const [fundingId, setFundingId] = useState("");
  // Funding-conditional fields (Global Grant / CSR) — mirror club Community Service.
  const [globalGrantNumber, setGlobalGrantNumber] = useState("");
  const [amountSanctioned, setAmountSanctioned] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [amountSpent, setAmountSpent] = useState("");
  const [hostClubsDistricts, setHostClubsDistricts] = useState("");
  const [globalPartnerClubsDistricts, setGlobalPartnerClubsDistricts] = useState("");
  const [csrCompanyName, setCsrCompanyName] = useState("");
  const [directBeneficiaries, setDirectBeneficiaries] = useState("");
  const [manHours, setManHours] = useState("");
  const [rotariansInvolved, setRotariansInvolved] = useState("");
  const [rotaractorsInvolved, setRotaractorsInvolved] = useState("");
  const [rccInvolved, setRccInvolved] = useState("");

  const [areasOfFocus, setAreasOfFocus] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subCategories, setSubCategories] = useState<any[]>([]);
  const [fundings, setFundings] = useState<any[]>([]);

  const [photos, setPhotos] = useState<{ path: string; preview: string; description: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { getDistrict(districtId).then(d => setDistrictName(`District ${d.districtNumber}`)).catch(() => {}); }, [districtId]);
  useEffect(() => {
    async function loadLookups() {
      try {
        const [modules, funding] = await Promise.all([getModules(), getFunding()]);
        setFundings(funding.filter((f: any) => f.isActive));
        const mod = modules.find((m: any) => m.moduleKey === "community_service");
        if (mod) { const aof = await getAreasOfFocus(mod.id); setAreasOfFocus(aof); }
      } catch {}
    }
    loadLookups();
  }, []);
  const isOthersAof = areaOfFocusId === "others" || areasOfFocus.find(a => String(a.id) === areaOfFocusId)?.name?.toLowerCase() === "others";
  const isOthersCat = categoryId === "others" || categories.find(c => String(c.id) === categoryId)?.name?.toLowerCase() === "others";
  const isOthersSubCat = subCategoryId === "others" || subCategories.find(s => String(s.id) === subCategoryId)?.name?.toLowerCase() === "others";

  useEffect(() => { if (areaOfFocusId && areaOfFocusId !== "others") getCategories(Number(areaOfFocusId)).then(setCategories).catch(() => {}); else setCategories([]); setCategoryId(""); setSubCategoryId(""); setOtherCategory(""); setOtherSubCategory(""); }, [areaOfFocusId]);
  useEffect(() => { if (categoryId && categoryId !== "others") getSubCategories(Number(categoryId)).then(setSubCategories).catch(() => {}); else setSubCategories([]); setSubCategoryId(""); setOtherSubCategory(""); }, [categoryId]);

  // ── Funding classifier — matches funding name to "global_grant" / "csr" / "" ──
  const onlyDigits = (v: string) => v.replace(/[^0-9]/g, "");
  const classifyFunding = (name?: string | null): "global_grant" | "csr" | "" => {
    if (!name) return "";
    const n = name.trim().toLowerCase();
    if (n.includes("global grant")) return "global_grant";
    if (n === "csr" || n.startsWith("csr ") || n.includes(" csr") || n.includes("(csr)")) return "csr";
    return "";
  };
  const selectedFundingName = fundings.find((f) => String(f.id) === fundingId)?.name ?? "";
  const fundingClass = classifyFunding(selectedFundingName);
  const showGlobalGrantBlock = fundingClass === "global_grant";
  const showCsrBlock = fundingClass === "csr";

  // When funding option changes, wipe all conditional fields (never carry stale values).
  const handleFundingChange = (newId: string) => {
    setFundingId(newId);
    setGlobalGrantNumber(""); setAmountSanctioned(""); setAmountReceived(""); setAmountSpent("");
    setHostClubsDistricts(""); setGlobalPartnerClubsDistricts(""); setCsrCompanyName("");
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || photos.length >= 5) return;
    setUploading(true);
    try {
      const res = await uploadDistrictProjectPhoto(districtId, file, true);
      setPhotos(prev => [...prev, { path: res.path, preview: URL.createObjectURL(file), description: "" }]);
    } catch (err: any) { setErrorMessage(err?.message || err?.response?.data?.message || "Failed to upload photo."); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const removePhoto = (idx: number) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  const updatePhotoDescription = (idx: number, value: string) =>
    setPhotos(prev => prev.map((p, i) => (i === idx ? { ...p, description: value } : p)));

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!TEXT_INPUT_REGEX.test(title)) { setErrorMessage("Title cannot contain emoji."); return; }
    if (description && !TEXT_INPUT_REGEX.test(description)) { setErrorMessage("Description cannot contain emoji."); return; }
    if (description && description.length > 1000) { setErrorMessage("Description must be 1000 characters or less."); return; }
    if (!projectDate) { setErrorMessage("Date is required."); return; }
    if (!areaOfFocusId) { setErrorMessage("Area of Focus is required."); return; }
    if (isOthersAof && !otherAreaOfFocus.trim()) { setErrorMessage("Please specify the Area of Focus."); return; }
    if (!isOthersAof && !categoryId) { setErrorMessage("Category is required."); return; }
    if (isOthersCat && !otherCategory.trim()) { setErrorMessage("Please specify the Category."); return; }
    // Funding-conditional validation (mirrors backend)
    if (showGlobalGrantBlock) {
      if (!globalGrantNumber.trim()) { setErrorMessage("Global Grant Number is required for Global Grant."); return; }
      if (!amountSanctioned) { setErrorMessage("Amount Sanctioned is required for Global Grant."); return; }
      if (!amountReceived) { setErrorMessage("Amount Received is required for Global Grant."); return; }
      if (!amountSpent) { setErrorMessage("Amount Spent Till Date is required for Global Grant."); return; }
      if (!hostClubsDistricts.trim()) { setErrorMessage("Host Clubs/Districts is required for Global Grant."); return; }
      if (!globalPartnerClubsDistricts.trim()) { setErrorMessage("Global Partner Clubs/Districts is required for Global Grant."); return; }
    }
    if (showCsrBlock) {
      if (!csrCompanyName.trim()) { setErrorMessage("Name of the CSR Company is required for CSR."); return; }
      if (!amountSanctioned) { setErrorMessage("Amount Sanctioned is required for CSR."); return; }
      if (!amountReceived) { setErrorMessage("Amount Received is required for CSR."); return; }
    }
    if (photos.length === 0) { setErrorMessage("At least one photo is required."); return; }

    setSaving(true);
    try {
      await createDistrictProject(districtId, {
        title: title.trim(), description: description.trim() || null, location: location.trim() || null,
        areaOfFocusId: isOthersAof ? null : (Number(areaOfFocusId) || null),
        otherAreaOfFocus: isOthersAof ? otherAreaOfFocus.trim() : null,
        categoryId: isOthersCat ? null : (Number(categoryId) || null),
        otherCategory: isOthersCat ? otherCategory.trim() : null,
        subCategoryId: isOthersSubCat ? null : (subCategoryId ? Number(subCategoryId) : null),
        otherSubCategory: isOthersSubCat ? otherSubCategory.trim() : null,
        projectDate, projectCost: projectCost ? Number(projectCost) : null,
        fundingId: fundingId ? Number(fundingId) : null,
        // Funding-conditional fields. Backend also nulls out non-applicable ones as a safety net.
        globalGrantNumber: showGlobalGrantBlock ? (globalGrantNumber.trim() || null) : null,
        amountSanctioned: (showGlobalGrantBlock || showCsrBlock) && amountSanctioned ? Number(amountSanctioned) : null,
        amountReceived: (showGlobalGrantBlock || showCsrBlock) && amountReceived ? Number(amountReceived) : null,
        amountSpent: showGlobalGrantBlock && amountSpent ? Number(amountSpent) : null,
        hostClubsDistricts: showGlobalGrantBlock ? (hostClubsDistricts.trim() || null) : null,
        globalPartnerClubsDistricts: showGlobalGrantBlock ? (globalPartnerClubsDistricts.trim() || null) : null,
        csrCompanyName: showCsrBlock ? (csrCompanyName.trim() || null) : null,
        directBeneficiaries: directBeneficiaries ? Number(directBeneficiaries) : null,
        manHours: manHours ? Number(manHours) : null,
        rotariansInvolved: rotariansInvolved ? Number(rotariansInvolved) : null,
        rotaractorsInvolved: rotaractorsInvolved ? Number(rotaractorsInvolved) : null,
        rccInvolved: rccInvolved ? Number(rccInvolved) : null,
        photos: photos.map((p, i) => ({ imagePath: p.path, description: p.description.trim() || null, isPrimary: i === 0, sortOrder: i })),
      });
      setSuccessMessage("Project created successfully.");
      setTimeout(() => router.push(`/districts/${districtId}/projects`), 2000);
    } catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to save."); }
    finally { setSaving(false); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl mx-auto">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(`/districts/${districtId}/projects`)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/projects`}><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Add District Project</h2>
            <p className="text-muted-foreground">{districtName}</p>
          </div>
        </div>

        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>Please post all the Projects executed by your District. The content posted here will be displayed on the District website.</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Project Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Title <span className="text-destructive">*</span> <span className="text-muted-foreground text-xs">(max 50 chars)</span></Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={50} placeholder="Project title" />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>
            <div className="space-y-2">
              <Label>Description <span className="text-muted-foreground text-xs">(max 1000 chars)</span></Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={4} placeholder="Project description" />
              <p className="text-xs text-muted-foreground text-right">{description.length}/1000</p>
            </div>
            <div className="space-y-2">
              <Label>Location of the Project</Label>
              <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Area of Focus <span className="text-destructive">*</span></Label>
                <Select value={areaOfFocusId} onValueChange={setAreaOfFocusId}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {areasOfFocus.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {isOthersAof && <Input value={otherAreaOfFocus} onChange={e => setOtherAreaOfFocus(e.target.value)} placeholder="Specify Area of Focus" className="mt-2" />}
              </div>
              <div className="space-y-2">
                <Label>Category <span className="text-destructive">*</span></Label>
                <Select value={categoryId} onValueChange={setCategoryId} disabled={isOthersAof || !areaOfFocusId}>
                  <SelectTrigger><SelectValue placeholder={isOthersAof ? "N/A" : "Select"} /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {isOthersCat && <Input value={otherCategory} onChange={e => setOtherCategory(e.target.value)} placeholder="Specify Category" className="mt-2" />}
              </div>
              <div className="space-y-2">
                <Label>Sub Category</Label>
                <Select value={subCategoryId} onValueChange={setSubCategoryId} disabled={isOthersAof || isOthersCat || !categoryId}>
                  <SelectTrigger><SelectValue placeholder={isOthersAof || isOthersCat ? "N/A" : "Select"} /></SelectTrigger>
                  <SelectContent>
                    {subCategories.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {isOthersSubCat && <Input value={otherSubCategory} onChange={e => setOtherSubCategory(e.target.value)} placeholder="Specify Sub Category" className="mt-2" />}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Date <span className="text-destructive">*</span></Label><DateField value={projectDate} onChange={setProjectDate} /></div>
              <div className="space-y-2"><Label>Project Cost ({currencySymbol()})</Label><Input type="number" value={projectCost} onChange={e => setProjectCost(e.target.value)} placeholder="0" /></div>
              <div className="space-y-2">
                <Label>Funding</Label>
                <Select value={fundingId} onValueChange={handleFundingChange}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{fundings.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {/* Funding-conditional: Global Grant fields */}
            {showGlobalGrantBlock && (
              <div className="space-y-3 border-l-4 border-primary bg-primary/5 rounded-md p-4">
                <h4 className="text-sm font-semibold text-primary">Global Grant Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Global Grant Number <span className="text-destructive">*</span></Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={globalGrantNumber} onChange={e => setGlobalGrantNumber(onlyDigits(e.target.value))} placeholder="e.g., 2434521" />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount Sanctioned ({currencySymbol()}) <span className="text-destructive">*</span></Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned} onChange={e => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount Received ({currencySymbol()}) <span className="text-destructive">*</span></Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountReceived} onChange={e => setAmountReceived(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount spent till date ({currencySymbol()}) <span className="text-destructive">*</span></Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSpent} onChange={e => setAmountSpent(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Host Clubs/Districts <span className="text-destructive">*</span></Label>
                    <Input value={hostClubsDistricts} onChange={e => setHostClubsDistricts(e.target.value)} placeholder="e.g., RC Chicago, RC Paris" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Global Partner Clubs/Districts <span className="text-destructive">*</span></Label>
                    <Input value={globalPartnerClubsDistricts} onChange={e => setGlobalPartnerClubsDistricts(e.target.value)} placeholder="e.g., RC Tokyo" />
                  </div>
                </div>
              </div>
            )}

            {/* Funding-conditional: CSR fields */}
            {showCsrBlock && (
              <div className="space-y-3 border-l-4 border-primary bg-primary/5 rounded-md p-4">
                <h4 className="text-sm font-semibold text-primary">CSR Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Name of the CSR Company <span className="text-destructive">*</span></Label>
                    <Input value={csrCompanyName} onChange={e => setCsrCompanyName(e.target.value)} placeholder="e.g., ABC Industries Ltd" />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount Sanctioned ({currencySymbol()}) <span className="text-destructive">*</span></Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned} onChange={e => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount Received ({currencySymbol()}) <span className="text-destructive">*</span></Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountReceived} onChange={e => setAmountReceived(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2"><Label>Direct Beneficiaries</Label><Input type="number" value={directBeneficiaries} onChange={e => setDirectBeneficiaries(e.target.value)} placeholder="0" /></div>
              <div className="space-y-2"><Label>Man Hours</Label><Input type="number" value={manHours} onChange={e => setManHours(e.target.value)} placeholder="0" /></div>
              <div className="space-y-2"><Label>Rotarians Involved</Label><Input type="number" value={rotariansInvolved} onChange={e => setRotariansInvolved(e.target.value)} placeholder="0" /></div>
              <div className="space-y-2"><Label>Rotaractors Involved</Label><Input type="number" value={rotaractorsInvolved} onChange={e => setRotaractorsInvolved(e.target.value)} placeholder="0" /></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2"><Label>Direct Beneficiaries</Label><Input type="number" value={directBeneficiaries} onChange={e => setDirectBeneficiaries(e.target.value)} placeholder="0" /></div>
              <div className="space-y-2"><Label>Man Hours</Label><Input type="number" value={manHours} onChange={e => setManHours(e.target.value)} placeholder="0" /></div>
              <div className="space-y-2"><Label>Rotarians Involved</Label><Input type="number" value={rotariansInvolved} onChange={e => setRotariansInvolved(e.target.value)} placeholder="0" /></div>
              <div className="space-y-2"><Label>RCC Involved</Label><Input type="number" value={rccInvolved} onChange={e => setRccInvolved(e.target.value)} placeholder="0" /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Photos <span className="text-destructive">*</span> <span className="text-muted-foreground text-sm font-normal">(Maximum 5 Photos, at least 1 mandatory)</span></CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo, idx) => (
                <div key={idx} className="border rounded-lg overflow-hidden">
                  <div className="relative w-full h-40 group bg-muted">
                    <img src={photo.preview || `${API_URL}${photo.path}`} alt="" className="w-full h-full object-contain" />
                    <button onClick={() => removePhoto(idx)} className="absolute top-1 right-1 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
                  </div>
                  <div className="p-3 space-y-2">
                    <Textarea
                      value={photo.description}
                      onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(idx, e.target.value); }}
                      placeholder="Photo description (max 500 chars)"
                      rows={3}
                      maxLength={500}
                      className="text-sm resize-none"
                    />
                    <p className="text-xs text-muted-foreground text-right">{photo.description.length}/500</p>
                  </div>
                </div>
              ))}
              {photos.length < 5 && (
                <label className="border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors h-40">
                  {uploading ? <RotaryLoader size="sm" /> : <><Upload className="h-6 w-6 text-muted-foreground" /><span className="text-xs text-muted-foreground mt-1">Upload</span></>}
                  <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
                </label>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP &middot; up to 5 MB &middot; auto-compressed if larger</p>
          </CardContent>
        </Card>

        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg">
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Save Project</>}
          </Button>
        </div>
      </div>
    </ProtectedRoute>
  );
}
