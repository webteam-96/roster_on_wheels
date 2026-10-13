"use client";

import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { AreaOfFocus, Category, Funding, ProjectPhotoInput } from "@/types/project";
import {
  getClub,
  getModules,
  getAreasOfFocus,
  getCategories,
  getFunding,
  createProject,
  uploadProjectImage,
  checkClubHasModerator,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import {
  ArrowLeft, Upload, X, Star, Info,
  MapPin, Target, IndianRupee, Camera, Send,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import WhatsAppRecipientBadge from "@/components/WhatsAppRecipientBadge";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";

import { currencySymbol } from "@/lib/appFormat";
// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

const TOP_MESSAGE = "Please post all the New Generation services executed by your club. The content posted here will be displayed in District website, Club Monthly Report & ROW integrated Club website.";

interface PhotoItem {
  file?: File;
  imagePath: string;
  description: string;
  isPrimary: boolean;
  uploading?: boolean;
}

function Section({ icon: Icon, title, children, number }: {
  icon: React.ElementType; title: string; children: React.ReactNode; number: number;
}) {
  return (
    <div className="relative bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-r from-primary/5 to-transparent border-b">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">{number}</div>
        <Icon className="h-5 w-5 text-primary shrink-0" />
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Req({ children, hint, optional }: { children: React.ReactNode; hint?: string; optional?: boolean }) {
  return (
    <Label className="text-sm font-medium">
      {children}{!optional && <span className="text-destructive ml-0.5">*</span>}
      {optional && <span className="text-xs text-muted-foreground font-normal ml-1">(optional)</span>}
      {hint && <span className="text-xs text-muted-foreground ml-1.5">{hint}</span>}
    </Label>
  );
}

export default function NewGenerationServiceAddPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const returnUrl = searchParams.get("returnUrl");
  const frozenMonth = searchParams.get("frozenMonth");

  // Compute frozen date range if redirected from monthly report
  const frozenDateMin = frozenMonth ? (() => {
    const m = Number(frozenMonth);
    const now = new Date();
    const y = m >= 7 ? (now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1) : (now.getMonth() + 1 >= 7 ? now.getFullYear() + 1 : now.getFullYear());
    return `${y}-${String(m).padStart(2, "0")}-01`;
  })() : undefined;
  const frozenDateMax = frozenMonth ? (() => {
    const m = Number(frozenMonth);
    const now = new Date();
    const y = m >= 7 ? (now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1) : (now.getMonth() + 1 >= 7 ? now.getFullYear() + 1 : now.getFullYear());
    const lastDay = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  })() : undefined;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [clubName, setClubName] = useState("");
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Masters — Area of Focus renamed to "Category", Category renamed to "Sub Category"
  const [areasOfFocus, setAreasOfFocus] = useState<AreaOfFocus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fundingList, setFundingList] = useState<Funding[]>([]);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  // "Category" = Area of Focus data, "Sub Category" = Category data
  const [selectedAofId, setSelectedAofId] = useState<string>("");
  const [otherAreaOfFocus, setOtherAreaOfFocus] = useState("");
  const [selectedCatId, setSelectedCatId] = useState<string>("");
  const [otherCategory, setOtherCategory] = useState("");

  const [projectDate, setProjectDate] = useState("");
  const [projectCost, setProjectCost] = useState("");
  const [selectedFundingId, setSelectedFundingId] = useState<string>("");
  // Funding-conditional fields (Global Grant / CSR). Cleared when funding option changes.
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
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [showProjectSuccess, setShowProjectSuccess] = useState(false);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const photoCrop = useImageCropQueue();

  // Moderator approval
  const [hasModerator, setHasModerator] = useState(false);
  const [moderatorName, setModeratorName] = useState<string | null>(null);
  const [showModeratorConfirm, setShowModeratorConfirm] = useState(false);
  const moderatorConfirmedRef = useRef(false);

  // ── Funding classifier — drives conditional Global Grant / CSR field block ──
  const classifyFunding = (name?: string | null): "global_grant" | "csr" | "" => {
    if (!name) return "";
    const n = name.trim().toLowerCase();
    if (n.includes("global grant")) return "global_grant";
    if (n === "csr" || n.startsWith("csr ") || n.includes(" csr") || n.includes("(csr)")) return "csr";
    return "";
  };
  const selectedFundingName = fundingList.find((f) => String(f.id) === selectedFundingId)?.name ?? "";
  const fundingClass = classifyFunding(selectedFundingName);
  const showGlobalGrantBlock = fundingClass === "global_grant";
  const showCsrBlock = fundingClass === "csr";
  const handleFundingChange = (newId: string) => {
    setSelectedFundingId(newId);
    setGlobalGrantNumber("");
    setAmountSanctioned("");
    setAmountReceived("");
    setAmountSpent("");
    setHostClubsDistricts("");
    setGlobalPartnerClubsDistricts("");
    setCsrCompanyName("");
  };
  const onlyDigits = (v: string) => v.replace(/\D/g, "");

  const isOthersAof = selectedAofId === "others";
  const isOthersCat = selectedCatId === "others";

  useEffect(() => {
    async function init() {
      try {
        const [club, modules, funding] = await Promise.all([
          getClub(clubId),
          getModules(),
          getFunding(),
        ]);
        setClubName(club.clubName);
        const mod = modules.find(m => m.moduleKey === "new_generation_service");
        if (mod) {
          setModuleId(mod.id);
          const aof = await getAreasOfFocus(mod.id);
          setAreasOfFocus(aof.filter(a => a.isActive));
        }
        setFundingList(funding.filter(f => f.isActive));
        checkClubHasModerator(clubId).then(r => { setHasModerator(r.hasModerator); setModeratorName(r.moderatorName); }).catch(() => {});
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  // Fetch "Sub Category" (= categories) when "Category" (= area of focus) changes
  useEffect(() => {
    if (!selectedAofId || selectedAofId === "others") {
      setCategories([]);
      setSelectedCatId("");
      return;
    }
    async function fetchCats() {
      try {
        const cats = await getCategories(Number(selectedAofId));
        setCategories(cats.filter(c => c.isActive));
      } catch { setCategories([]); }
    }
    fetchCats();
  }, [selectedAofId]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    if (photos.length + photoCrop.pending + files.length > 5) {
      setErrorMessage("Maximum 5 photos allowed.");
      return;
    }

    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 5 * 1024 * 1024) {
        setErrorMessage(`${file.name} exceeds 5MB limit.`);
        continue;
      }
      accepted.push(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    // Queue the selection for the crop dialog — nothing uploads until each
    // photo is confirmed there, one after another.
    const queueErrors = await photoCrop.enqueue(accepted);
    if (queueErrors.length > 0) setErrorMessage(queueErrors[0]);
  };

  const handleCropSave = (blob: Blob) =>
    photoCrop.commit(async () => {
      const name = photoCrop.current?.name ?? "photo";
      const file = new File([blob], `project-photo-${Date.now()}.png`, { type: "image/png" });
      setPhotos(prev => [...prev, { file, imagePath: "", description: "", isPrimary: prev.length === 0, uploading: true }]);
      try {
        const result = await uploadProjectImage(clubId, file, undefined, undefined, true);
        setPhotos(prev => prev.map(p => p.file === file ? { ...p, imagePath: result.path, uploading: false } : p));
      } catch (err: any) {
        setPhotos(prev => prev.filter(p => p.file !== file));
        setErrorMessage(`${name}: ${err?.message || err?.response?.data?.message || "Failed to upload photo."}`);
      }
    });

  const removePhoto = (index: number) => {
    setPhotos(prev => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length > 0 && !updated.some(p => p.isPrimary)) updated[0].isPrimary = true;
      return updated;
    });
  };

  const setPrimaryPhoto = (index: number) => {
    setPhotos(prev => prev.map((p, i) => ({ ...p, isPrimary: i === index })));
  };

  const updatePhotoDescription = (index: number, desc: string) => {
    setPhotos(prev => prev.map((p, i) => i === index ? { ...p, description: desc } : p));
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!description.trim()) { setErrorMessage("Description is required."); return; }
    if (description.trim().length > 1000) { setErrorMessage("Description must be 1000 characters or less."); return; }
    if (!location.trim()) { setErrorMessage("Location is required."); return; }
    if (!selectedAofId) { setErrorMessage("Category is required."); return; }
    if (isOthersAof && !otherAreaOfFocus.trim()) { setErrorMessage("Please specify the Category."); return; }
    if (!isOthersAof && categories.length > 0 && !selectedCatId) { setErrorMessage("Sub Category is required."); return; }
    if (isOthersCat && !otherCategory.trim()) { setErrorMessage("Please specify the Sub Category."); return; }
    if (!projectDate) { setErrorMessage("Date is required."); return; }
    if (new Date(projectDate) > new Date()) { setErrorMessage("Date cannot be in the future."); return; }
    if (!projectCost) { setErrorMessage("Project Cost is required."); return; }
    if (!selectedFundingId) { setErrorMessage("Funding is required."); return; }
    if (showGlobalGrantBlock) {
      if (!hostClubsDistricts.trim()) { setErrorMessage("Host Clubs/Districts is required for Global Grant."); return; }
      if (!globalPartnerClubsDistricts.trim()) { setErrorMessage("Global Partner Clubs/Districts is required for Global Grant."); return; }
    }
    if (showCsrBlock) {
      if (!csrCompanyName.trim()) { setErrorMessage("Name of the CSR Company is required for CSR."); return; }
      if (!amountSanctioned) { setErrorMessage("Amount Sanctioned is required for CSR."); return; }
      if (!amountReceived) { setErrorMessage("Amount Received is required for CSR."); return; }
    }
    if (!directBeneficiaries) { setErrorMessage("Direct Beneficiaries is required."); return; }
    if (!manHours) { setErrorMessage("Man Hours is required."); return; }
    if (!rotariansInvolved) { setErrorMessage("Rotarians Involved is required."); return; }
    if (photos.length === 0) { setErrorMessage("At least 1 photo is required."); return; }
    if (photos.some(p => p.uploading)) { setErrorMessage("Please wait for photos to finish uploading."); return; }
    if (!moduleId) { setErrorMessage("Module not found."); return; }

    if (hasModerator && !moderatorConfirmedRef.current) {
      setShowModeratorConfirm(true);
      return;
    }
    moderatorConfirmedRef.current = false;

    const photoInputs: ProjectPhotoInput[] = photos.map((p, i) => ({
      imagePath: p.imagePath, description: p.description || null, isPrimary: p.isPrimary, sortOrder: i,
    }));

    const saveData: Record<string, unknown> = {
      moduleId,
      projectType: "one_time",
      isJointProject: false,
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      areaOfFocusId: isOthersAof ? null : (selectedAofId ? Number(selectedAofId) : null),
      otherAreaOfFocus: isOthersAof ? otherAreaOfFocus : null,
      categoryId: isOthersCat ? null : (selectedCatId ? Number(selectedCatId) : null),
      otherCategory: isOthersCat ? otherCategory : null,
      projectDate,
      projectCost: projectCost ? Number(projectCost) : null,
      fundingId: selectedFundingId ? Number(selectedFundingId) : null,
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
      sendWhatsapp,
      sendEmail,
      photos: photoInputs,
    };

    await doSaveProject(saveData);
  };

  const doSaveProject = async (saveData: Record<string, unknown>) => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await createProject(clubId, saveData as any);
      setShowProjectSuccess(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to create project.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;
  }

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <ProtectedRoute>
      <div className="space-y-5 max-w-4xl mx-auto pb-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={returnUrl || `/clubs/${clubId}/new-generation-service`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - New Generation Service` : "New Generation Service"}
              </h2>
              <p className="text-muted-foreground text-base">Add new project</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
            <Send className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save Project"}
          </Button>
        </div>

        {/* Top message */}
        <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-800">
          <Info className="h-5 w-5 shrink-0 mt-0.5" />
          <p>{TOP_MESSAGE}</p>
        </div>

        {/* 1. Project Details */}
        <Section icon={MapPin} title="Project Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Req hint="(max 50 chars)">Title</Req>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project title" maxLength={50} />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Req hint="(max 1000 chars)">Description</Req>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the project, its objectives, and impact..." rows={4} maxLength={1000} />
              <p className="text-xs text-muted-foreground text-right">{description.length}/1000</p>
            </div>
            <div className="space-y-1.5">
              <Req>Location of Project</Req>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, Venue, etc." />
            </div>
            <div className="space-y-1.5">
              <Req>Date of Project</Req>
              <DateField value={projectDate} onChange={setProjectDate} max={frozenMonth ? frozenDateMax : todayStr} min={frozenMonth ? frozenDateMin : undefined} />
            </div>
          </div>
        </Section>

        {/* 2. Classification — renamed labels */}
        <Section icon={Target} title="Category" number={2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Req>Category</Req>
              <Select value={selectedAofId} onValueChange={(v) => { setSelectedAofId(v); setSelectedCatId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {areasOfFocus.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                  {!areasOfFocus.some(a => (a.name || "").trim().toLowerCase() === "others") && (
                    <SelectItem value="others">Others</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {isOthersAof && (
                <Input value={otherAreaOfFocus} onChange={(e) => setOtherAreaOfFocus(e.target.value)} placeholder="Specify category" className="mt-2" />
              )}
            </div>
            <div className="space-y-1.5">
              {categories.length > 0 ? <Req>Sub Category</Req> : <Label className="text-sm font-medium">Sub Category</Label>}
              <Select value={selectedCatId} onValueChange={setSelectedCatId} disabled={isOthersAof || categories.length === 0}>
                <SelectTrigger><SelectValue placeholder={isOthersAof ? "N/A" : "Select"} /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                  {!categories.some(c => (c.name || "").trim().toLowerCase() === "others") && (
                    <SelectItem value="others">Others</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {isOthersCat && (
                <Input value={otherCategory} onChange={(e) => setOtherCategory(e.target.value)} placeholder="Specify sub category" className="mt-2" />
              )}
            </div>
          </div>
        </Section>

        {/* 3. Financial & Impact */}
        <Section icon={IndianRupee} title="Financial & Impact" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Req>Project Cost ({currencySymbol()})</Req>
              <Input type="number" value={projectCost} onChange={(e) => setProjectCost(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <Req>Funding</Req>
              <Select value={selectedFundingId} onValueChange={handleFundingChange}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {fundingList.map(f => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Funding-conditional: Global Grant fields */}
            {showGlobalGrantBlock && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border-l-4 border-primary bg-primary/5 rounded-md p-4 mt-1">
                <h4 className="text-sm font-semibold text-primary">Global Grant Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Global Grant Number</Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={globalGrantNumber}
                      onChange={(e) => setGlobalGrantNumber(onlyDigits(e.target.value))} placeholder="e.g., 2434521" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount Sanctioned ({currencySymbol()})</Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount Received ({currencySymbol()})</Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount spent till date ({currencySymbol()})</Label>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSpent}
                      onChange={(e) => setAmountSpent(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Req>Host Clubs/Districts</Req>
                    <Input type="text" value={hostClubsDistricts}
                      onChange={(e) => setHostClubsDistricts(e.target.value)} placeholder="e.g., RC Pune, RC Mumbai" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Req>Global Partner Clubs/Districts</Req>
                    <Input type="text" value={globalPartnerClubsDistricts}
                      onChange={(e) => setGlobalPartnerClubsDistricts(e.target.value)} placeholder="e.g., RC Tokyo" />
                  </div>
                </div>
              </div>
            )}

            {/* Funding-conditional: CSR fields */}
            {showCsrBlock && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border-l-4 border-primary bg-primary/5 rounded-md p-4 mt-1">
                <h4 className="text-sm font-semibold text-primary">CSR Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <Req>Name of the CSR Company</Req>
                    <Input type="text" value={csrCompanyName}
                      onChange={(e) => setCsrCompanyName(e.target.value)} placeholder="e.g., ABC Industries Pvt Ltd" />
                  </div>
                  <div className="space-y-1.5">
                    <Req>Amount Sanctioned ({currencySymbol()})</Req>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-1.5">
                    <Req>Amount Received ({currencySymbol()})</Req>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Req>Direct Beneficiaries</Req>
              <Input type="number" value={directBeneficiaries} onChange={(e) => setDirectBeneficiaries(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <Req hint="(Rotarians x Hours)">Man Hours</Req>
              <Input type="number" value={manHours} onChange={(e) => setManHours(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <Req>Rotarians Involved</Req>
              <Input type="number" value={rotariansInvolved} onChange={(e) => setRotariansInvolved(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <Req optional>Rotaractors Involved</Req>
              <Input type="number" value={rotaractorsInvolved} onChange={(e) => setRotaractorsInvolved(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <Req optional>RCC Involved</Req>
              <Input type="number" value={rccInvolved} onChange={(e) => setRccInvolved(e.target.value)} placeholder="0" min="0" />
            </div>
          </div>
        </Section>

        {/* 4. Photos */}
        <Section icon={Camera} title="Photos" number={4}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Upload 1-5 photos. First photo is set as primary by default.</p>
              {photos.length < 5 && (
                <div>
                  <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" multiple onChange={handlePhotoUpload} className="hidden" />
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" />Upload
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP &middot; up to 5 MB &middot; auto-compressed if larger</p>
                </div>
              )}
            </div>
            {photos.length === 0 && (
              <div onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center py-10 border-2 border-dashed rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors">
                <Camera className="h-10 w-10 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">Click to upload photos</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Allowed: JPG, JPEG, PNG, GIF, WEBP &middot; up to 5 MB &middot; auto-compressed if larger</p>
              </div>
            )}
            {photos.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {photos.map((photo, index) => (
                  <div key={index} className="relative group rounded-xl border overflow-hidden bg-muted/30">
                    {photo.uploading ? (
                      <div className="h-36 flex items-center justify-center"><RotaryLoader size="sm" /></div>
                    ) : (
                      <div className="relative">
                        <img src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${photo.imagePath}`} alt={`Photo ${index + 1}`} className="h-36 w-full object-contain" />
                        {photo.isPrimary && (
                          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-medium shadow">
                            <Star className="h-3 w-3 fill-white" />Primary
                          </div>
                        )}
                        <button onClick={() => removePhoto(index)} className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="p-3 space-y-2">
                      <Textarea value={photo.description} onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(index, e.target.value); }} placeholder="Photo description (max 500 chars)" rows={3} maxLength={500} className="text-sm resize-none" />
                      <p className="text-xs text-muted-foreground text-right">{photo.description.length}/500</p>
                      {!photo.isPrimary && (
                        <button onClick={() => setPrimaryPhoto(index)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-amber-500 transition-colors">
                          <Star className="h-3 w-3" />Set as primary
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* WhatsApp + Bottom Save */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={sendWhatsapp} onChange={(e) => setSendWhatsapp(e.target.checked)} className="accent-primary h-4 w-4" />
            <span className="text-sm font-medium">Send WhatsApp notification</span>
            {sendWhatsapp && <WhatsAppRecipientBadge scope="club" clubId={clubId} />}
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-primary h-4 w-4" />
            <span className="text-sm font-medium">Send Email notification</span>
            {sendEmail && <WhatsAppRecipientBadge scope="club" clubId={clubId} channel="email" />}
          </label>
          <div className="flex gap-3">
            <Button variant="outline" asChild>
              <Link href={returnUrl || `/clubs/${clubId}/new-generation-service`}>Cancel</Link>
            </Button>
            <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
              <Send className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save Project"}
            </Button>
          </div>
        </div>
        {sendWhatsapp && hasModerator && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2">
            Note: This project will go for approval to moderator. WhatsApp will be sent after moderator approves.
          </p>
        )}
        {sendEmail && hasModerator && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2">
            Note: This project will go for approval to moderator. Email will be sent after moderator approves.
          </p>
        )}

        {/* Project Success Dialog */}
        <Dialog open={showProjectSuccess} onOpenChange={() => {}}>
          <DialogContent className="max-w-lg [&>button.absolute]:hidden" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Project Saved Successfully</DialogTitle>
              <DialogDescription className="sr-only">Project save confirmation</DialogDescription>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-3 py-2">
              <p className="font-medium text-foreground">Dear Club Leader,</p>
              <p>You have successfully added a project in ROW. You can check after 10 minutes.</p>
              <p>Thank you,<br /><span className="font-medium text-foreground">Team ROW</span></p>
            </div>
            <Button className="w-full" onClick={() => { setShowProjectSuccess(false); router.push(returnUrl || `/clubs/${clubId}/new-generation-service`); }}>OK</Button>
          </DialogContent>
        </Dialog>

        {/* Moderator Approval Confirmation */}
        <Dialog open={showModeratorConfirm} onOpenChange={setShowModeratorConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Project Approval Required</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This club has a moderator <strong>{moderatorName}</strong> assigned. Your project will be submitted for approval and will be visible only after the moderator approves it.
              </p>
              <p className="text-sm text-muted-foreground">Do you want to continue?</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowModeratorConfirm(false)}>Cancel</Button>
              <Button onClick={() => { moderatorConfirmedRef.current = true; setShowModeratorConfirm(false); handleSave(); }}>Submit for Approval</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ImageCropDialog
          open={photoCrop.open}
          imageSrc={photoCrop.current?.dataUrl ?? null}
          aspect={PROJECT_PHOTO_ASPECT}
          allowOrientation
          maxOutputWidth={PROJECT_PHOTO_MAX_WIDTH}
          title={photoCrop.pending > 1 ? `Crop Photo (${photoCrop.pending} left)` : "Crop Photo"}
          saving={photoCrop.saving}
          onCancel={photoCrop.skip}
          onSave={handleCropSave}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
