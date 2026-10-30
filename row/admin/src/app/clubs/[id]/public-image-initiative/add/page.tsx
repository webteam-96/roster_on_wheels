"use client";

import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { AreaOfFocus, Funding, OngoingProject, ProjectPhotoInput } from "@/types/project";
import {
  getClub,
  getModules,
  getAreasOfFocus,
  getFunding,
  getOngoingProjects,
  createProject,
  uploadProjectImage,
  getCurrentRotaryYear,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import {
  ArrowLeft, Upload, X, Star, Info, Search,
  FileText, MapPin, Target, IndianRupee, Camera, Send,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RecipientBadge from "@/components/RecipientBadge";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";

import { currencySymbol } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

const TOP_MESSAGE = "Please post all the Public Image Initiatives executed by your club. The content posted here will be displayed in District website, Club Monthly Report & ROW integrated Club website.";

const ONGOING_INFO = `Ongoing Project

If your club has a Hospital, Dialysis Center, Education Institute etc. and your club keeps adding beneficiaries to this existing project, it is an ongoing project. It's a lifetime project and not a project for the particular year.

Repeat Project

Any Repeat project that you have conducted before in the same Rotary year under the same or any other area of focus falls under this category.
E.g.: You have conducted mask distribution today at a railway station and tomorrow the same activity is conducted in another place or you have done one tree plantation in one village last month and you are conducted one more in another village this month, it is a repeat project.

These are just examples. Please upload similar projects conducted under this criteria.`;

interface PhotoItem {
  file?: File;
  imagePath: string;
  description: string;
  isPrimary: boolean;
  uploading?: boolean;
}

/* -- Section wrapper with icon + title -- */
function Section({ icon: Icon, title, children, number }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  number: number;
}) {
  return (
    <div className="relative bg-white rounded-[20px] border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-primary/5 border-b">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
          {number}
        </div>
        <Icon className="h-5 w-5 text-primary shrink-0" />
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* -- Radio pill component -- */
function RadioPill({ name, checked, onChange, label }: {
  name: string; value?: string; checked: boolean; onChange: () => void; label: string;
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium
        ${checked
          ? "border-primary bg-primary/5 text-primary ring-1 ring-primary/20"
          : "border-muted-foreground/20 hover:border-primary/40 text-muted-foreground hover:text-foreground"
        }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center transition-all
        ${checked ? "border-primary" : "border-muted-foreground/40"}`}>
        {checked && <div className="h-2 w-2 rounded-full bg-primary" />}
      </div>
      {label}
    </label>
  );
}

/* -- Required label helper -- */
function Req({ children, hint, optional }: { children: React.ReactNode; hint?: string; optional?: boolean }) {
  return (
    <Label className="text-sm font-medium">
      {children}{!optional && <span className="text-destructive ml-0.5">*</span>}
      {optional && <span className="text-xs text-muted-foreground font-normal ml-1">(optional)</span>}
      {hint && <span className="text-xs text-muted-foreground ml-1.5">{hint}</span>}
    </Label>
  );
}

export default function PublicImageInitiativeAddPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const moduleKey = "public_image_initiative";
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

  // Masters
  const [areasOfFocus, setAreasOfFocus] = useState<AreaOfFocus[]>([]);
  const [fundingList, setFundingList] = useState<Funding[]>([]);
  const [ongoingProjects, setOngoingProjects] = useState<OngoingProject[]>([]);
  // Scope "Select Existing" search to the CURRENT rotary year. V1 avenue Add has no yearId in URL.
  const [currentYearId, setCurrentYearId] = useState<number | undefined>(undefined);

  // Ongoing info dialog
  const [showOngoingInfo, setShowOngoingInfo] = useState(false);

  // Form state
  const [projectType, setProjectType] = useState<"" | "one_time" | "ongoing_repeat">("");
  const [ongoingSubType, setOngoingSubType] = useState<"" | "new" | "existing">("");
  const [ongoingGroupTitle, setOngoingGroupTitle] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);
  const [ongoingSearch, setOngoingSearch] = useState("");

  const [isJointProject, setIsJointProject] = useState<boolean | null>(null);
  const [coHostName, setCoHostName] = useState("");
  const [clubRole, setClubRole] = useState<"" | "lead" | "co_host">("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  const [selectedAofId, setSelectedAofId] = useState<string>("");
  const [otherAreaOfFocus, setOtherAreaOfFocus] = useState("");

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
  const [manHours, setManHours] = useState("");
  const [rotariansInvolved, setRotariansInvolved] = useState("");
  const [rotaractorsInvolved, setRotaractorsInvolved] = useState("");
  const [rccInvolved, setRccInvolved] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [showProjectSuccess, setShowProjectSuccess] = useState(false);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const photoCrop = useImageCropQueue();

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

  // Init
  useEffect(() => {
    async function init() {
      try {
        const [club, modules, funding] = await Promise.all([
          getClub(clubId),
          getModules(),
          getFunding(),
        ]);
        setClubName(club.clubName);
        const mod = modules.find(m => m.moduleKey === moduleKey);
        if (mod) {
          setModuleId(mod.id);
          const aof = await getAreasOfFocus(mod.id);
          setAreasOfFocus(aof.filter(a => a.isActive));
        }
        setFundingList(funding.filter(f => f.isActive));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  // Resolve the current rotary year once — scopes ongoing search to this year only.
  useEffect(() => {
    let cancelled = false;
    getCurrentRotaryYear()
      .then((y) => { if (!cancelled) setCurrentYearId(y.id); })
      .catch(() => { /* leave undefined → API falls back to multi-year UNION (graceful) */ });
    return () => { cancelled = true; };
  }, []);

  // Fetch ongoing projects for search — scoped to current rotary year.
  useEffect(() => {
    if (projectType !== "ongoing_repeat" || ongoingSubType !== "existing" || !moduleId) return;
    async function fetchOngoing() {
      try {
        setOngoingProjects(await getOngoingProjects(clubId, moduleId!, ongoingSearch || undefined, currentYearId));
      } catch { setOngoingProjects([]); }
    }
    fetchOngoing();
  }, [projectType, ongoingSubType, moduleId, clubId, ongoingSearch, currentYearId]);

  const handleProjectTypeChange = (val: string) => {
    if (val === "ongoing_repeat") {
      setShowOngoingInfo(true);
    }
    setProjectType(val as "" | "one_time" | "ongoing_repeat");
    setOngoingSubType("");
    setIsJointProject(null);
    setClubRole("");
  };

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
      if (updated.length > 0 && !updated.some(p => p.isPrimary)) {
        updated[0].isPrimary = true;
      }
      return updated;
    });
  };

  const setPrimaryPhoto = (index: number) => {
    setPhotos(prev =>
      prev.map((p, i) => ({ ...p, isPrimary: i === index }))
    );
  };

  const updatePhotoDescription = (index: number, desc: string) => {
    setPhotos(prev =>
      prev.map((p, i) => i === index ? { ...p, description: desc } : p)
    );
  };

  const handleSave = async () => {
    // Validation -- all fields mandatory
    if (!projectType) { setErrorMessage("Please select a Project Type."); return; }
    if (projectType === "ongoing_repeat" && !ongoingSubType) { setErrorMessage("Please select Create New or Select Existing for Ongoing/Repeat project."); return; }
    if (projectType === "ongoing_repeat" && ongoingSubType === "new" && !ongoingGroupTitle.trim()) { setErrorMessage("Ongoing/Repeat project title is required."); return; }
    if (projectType === "ongoing_repeat" && ongoingSubType === "existing" && !selectedParentId) { setErrorMessage("Please select an existing ongoing project."); return; }
    if (isJointProject === null) { setErrorMessage("Please select whether this is a joint project."); return; }
    if (isJointProject && !coHostName.trim()) { setErrorMessage("Co-host name is required for joint projects."); return; }
    if (isJointProject && !clubRole) { setErrorMessage("Please select your Club Role."); return; }
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!description.trim()) { setErrorMessage("Description is required."); return; }
    if (description.trim().length > 1000) { setErrorMessage("Description must be 1000 characters or less."); return; }
    if (!location.trim()) { setErrorMessage("Location is required."); return; }
    if (!projectDate) { setErrorMessage("Project date is required."); return; }
    if (new Date(projectDate) > new Date()) { setErrorMessage("Project date cannot be in the future."); return; }
    // Classification validation
    if (!selectedAofId) { setErrorMessage("Category is required."); return; }
    if (isOthersAof && !otherAreaOfFocus.trim()) { setErrorMessage("Please specify the Category."); return; }
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
    if (!manHours) { setErrorMessage("Man Hours is required."); return; }
    if (!rotariansInvolved) { setErrorMessage("Rotarians Involved is required."); return; }
    if (photos.length === 0) { setErrorMessage("At least 1 photo is required."); return; }
    if (photos.some(p => p.uploading)) { setErrorMessage("Please wait for photos to finish uploading."); return; }
    if (!moduleId) { setErrorMessage("Module not found."); return; }

    // Build save data
    const photoInputs: ProjectPhotoInput[] = photos.map((p, i) => ({
      imagePath: p.imagePath,
      description: p.description || null,
      isPrimary: p.isPrimary,
      sortOrder: i,
    }));

    const saveData: Record<string, unknown> = {
      moduleId,
      projectType: projectType as "one_time" | "ongoing_repeat",
      parentProjectId: projectType === "ongoing_repeat" && ongoingSubType === "existing" ? selectedParentId : null,
      ongoingGroupTitle: projectType === "ongoing_repeat" ? (ongoingSubType === "new" ? ongoingGroupTitle : ongoingSearch || null) : null,
      isJointProject: isJointProject === true,
      coHostName: isJointProject === true ? coHostName : null,
      clubRole: isJointProject === true ? (clubRole || null) : null,
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      areaOfFocusId: isOthersAof ? null : (selectedAofId ? Number(selectedAofId) : null),
      otherAreaOfFocus: isOthersAof ? otherAreaOfFocus : null,
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
      directBeneficiaries: null,
      manHours: manHours ? Number(manHours) : null,
      rotariansInvolved: rotariansInvolved ? Number(rotariansInvolved) : null,
      rotaractorsInvolved: rotaractorsInvolved ? Number(rotaractorsInvolved) : null,
      rccInvolved: rccInvolved ? Number(rccInvolved) : null,
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
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <ProtectedRoute>
      <div className="space-y-5 max-w-4xl mx-auto pb-10">
        {/* -- Header -- */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={returnUrl || `/clubs/${clubId}/public-image-initiative`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Public Image Initiative` : "Public Image Initiative"}
              </h2>
              <p className="text-muted-foreground text-base">Add new project</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
            <Send className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Save Project"}
          </Button>
        </div>

        {/* -- Top message -- */}
        <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-800">
          <Info className="h-5 w-5 shrink-0 mt-0.5" />
          <p>{TOP_MESSAGE}</p>
        </div>

        {/* -- 1. Project Type -- */}
        <Section icon={FileText} title="Project Type" number={1}>
          <div className="space-y-5">
            <div>
              <Req>Select Project Type</Req>
              <div className="flex flex-wrap gap-3 mt-2">
                <RadioPill name="projectType" value="one_time" checked={projectType === "one_time"} onChange={() => handleProjectTypeChange("one_time")} label="One Time Project" />
                <RadioPill name="projectType" value="ongoing_repeat" checked={projectType === "ongoing_repeat"} onChange={() => handleProjectTypeChange("ongoing_repeat")} label="Ongoing / Repeat Project" />
              </div>
            </div>

            {/* Ongoing sub-options */}
            {projectType === "ongoing_repeat" && (
              <div className="space-y-4 pl-5 border-l-2 border-primary/30 ml-2">
                <div>
                  <Req>Ongoing/Repeat Type</Req>
                  <div className="flex flex-wrap gap-3 mt-2">
                    <RadioPill name="ongoingSubType" value="new" checked={ongoingSubType === "new"} onChange={() => { setOngoingSubType("new"); setIsJointProject(null); setClubRole(""); }} label="Create New" />
                    <RadioPill name="ongoingSubType" value="existing" checked={ongoingSubType === "existing"} onChange={() => { setOngoingSubType("existing"); setIsJointProject(null); setClubRole(""); }} label="Select Existing" />
                  </div>
                </div>

                {ongoingSubType === "new" && (
                  <div className="space-y-1.5">
                    <Req>Title of Ongoing/Repeat Project</Req>
                    <Input
                      value={ongoingGroupTitle}
                      onChange={(e) => setOngoingGroupTitle(e.target.value)}
                      placeholder="Enter ongoing/repeat project title"
                    />
                  </div>
                )}

                {ongoingSubType === "existing" && (
                  <div className="space-y-2">
                    <Req>Search Existing Project</Req>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={ongoingSearch}
                        onChange={(e) => { setOngoingSearch(e.target.value); setSelectedParentId(null); }}
                        placeholder="Type to search existing projects..."
                        className="pl-9"
                      />
                      {ongoingSearch && (
                        <button onClick={() => { setOngoingSearch(""); setSelectedParentId(null); }} className="absolute right-3 top-1/2 -translate-y-1/2">
                          <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </button>
                      )}
                    </div>
                    {ongoingSearch && ongoingProjects.length > 0 && !selectedParentId && (
                      <div className="border rounded-lg max-h-48 overflow-y-auto shadow-sm">
                        {ongoingProjects.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setSelectedParentId(p.id); setOngoingSearch(p.title); }}
                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-primary/5 transition-colors border-b last:border-b-0"
                          >
                            {p.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {ongoingSearch && ongoingProjects.length === 0 && !selectedParentId && (
                      <p className="text-sm text-muted-foreground">No matching projects found.</p>
                    )}
                    {selectedParentId && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                        <div className="h-2 w-2 rounded-full bg-green-500" />
                        <span className="text-sm text-green-700 font-medium">Selected: {ongoingSearch}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Joint Project -- show after one_time selected, or after ongoing sub-type selected */}
            {(projectType === "one_time" || (projectType === "ongoing_repeat" && ongoingSubType)) && (
              <div className="space-y-4 pt-4 border-t border-dashed">
                <div>
                  <Req>Is this a joint project with any other Rotary Club / Organisation?</Req>
                  <div className="flex flex-wrap gap-3 mt-2">
                    <RadioPill name="jointProject" value="yes" checked={isJointProject === true} onChange={() => setIsJointProject(true)} label="Yes" />
                    <RadioPill name="jointProject" value="no" checked={isJointProject === false} onChange={() => setIsJointProject(false)} label="No" />
                  </div>
                </div>

                {isJointProject === true && (
                  <div className="space-y-4 pl-5 border-l-2 border-primary/30 ml-2">
                    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800">
                      <Info className="h-4 w-4 shrink-0 mt-0.5" />
                      <p>Project uploaded by co-host Rotary club will be displayed only in the club monthly report &amp; club website (If subscribed through ROW)</p>
                    </div>
                    <div className="space-y-1.5">
                      <Req>Name of Co-host Rotary Club / Partner Organisation</Req>
                      <Input value={coHostName} onChange={(e) => setCoHostName(e.target.value)} placeholder="Enter co-host name" />
                    </div>
                    <div>
                      <Req>Your Club Role</Req>
                      <div className="flex flex-wrap gap-3 mt-2">
                        <RadioPill name="clubRole" value="lead" checked={clubRole === "lead"} onChange={() => setClubRole("lead")} label="Lead Club" />
                        <RadioPill name="clubRole" value="co_host" checked={clubRole === "co_host"} onChange={() => setClubRole("co_host")} label="Co-Host Club" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* -- 2. Project Details -- */}
        <Section icon={MapPin} title="Project Details" number={2}>
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

        {/* -- 3. Classification -- */}
        <Section icon={Target} title="Category" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Req>Category</Req>
              <Select value={selectedAofId} onValueChange={setSelectedAofId}>
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
          </div>
        </Section>

        {/* -- 4. Financial & Impact -- */}
        <Section icon={IndianRupee} title="Financial & Impact" number={4}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Req>Project Cost (&#8377;)</Req>
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
                      onChange={(e) => setHostClubsDistricts(e.target.value)} placeholder="e.g., RC Chicago, RC Paris" />
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
                      onChange={(e) => setCsrCompanyName(e.target.value)} placeholder="e.g., ABC Industries Ltd" />
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

        {/* -- 5. Photos -- */}
        <Section icon={Camera} title="Photos" number={5}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Upload 1-5 photos. First photo is set as primary by default.</p>
              {photos.length < 5 && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.gif,.webp"
                    multiple
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" />Upload
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP &middot; up to 5 MB &middot; auto-compressed if larger</p>
                </div>
              )}
            </div>

            {photos.length === 0 && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center py-10 border-2 border-dashed rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
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
                      <div className="h-36 flex items-center justify-center">
                        <RotaryLoader size="sm" />
                      </div>
                    ) : (
                      <div className="relative">
                        <img
                          src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${photo.imagePath}`}
                          alt={`Photo ${index + 1}`}
                          className="h-36 w-full object-contain"
                        />
                        {photo.isPrimary && (
                          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-medium shadow">
                            <Star className="h-3 w-3 fill-white" />Primary
                          </div>
                        )}
                        <button
                          onClick={() => removePhoto(index)}
                          className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="p-3 space-y-2">
                      <Textarea
                        value={photo.description}
                        onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(index, e.target.value); }}
                        placeholder="Photo description (max 500 chars)"
                        rows={3}
                        maxLength={500}
                        className="text-sm resize-none"
                      />
                      <p className="text-xs text-muted-foreground text-right">{photo.description.length}/500</p>
                      {!photo.isPrimary && (
                        <button
                          onClick={() => setPrimaryPhoto(index)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-amber-500 transition-colors"
                        >
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

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="accent-primary h-4 w-4"
            />
            <span className="text-sm font-medium">Send Email notification</span>
            {sendEmail && <RecipientBadge scope="club" clubId={clubId} />}
          </label>

          <div className="flex gap-3">
            <Button variant="outline" asChild>
              <Link href={returnUrl || `/clubs/${clubId}/public-image-initiative`}>Cancel</Link>
            </Button>
            <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
              <Send className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Project"}
            </Button>
          </div>
        </div>

        {/* -- Ongoing Info Dialog -- */}
        <Dialog open={showOngoingInfo} onOpenChange={setShowOngoingInfo}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Ongoing / Repeat Projects</DialogTitle>
              <DialogDescription>Understanding ongoing and repeat projects</DialogDescription>
            </DialogHeader>
            <div className="whitespace-pre-line text-sm text-muted-foreground py-2">
              {ONGOING_INFO}
            </div>
            <Button onClick={() => setShowOngoingInfo(false)} className="w-full">Close</Button>
          </DialogContent>
        </Dialog>

        {/* -- Project Success Dialog -- */}
        <Dialog open={showProjectSuccess} onOpenChange={() => {}}>
          <DialogContent className="max-w-lg [&>button.absolute]:hidden" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Project Saved Successfully</DialogTitle>
              <DialogDescription className="sr-only">Project save confirmation</DialogDescription>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-3 py-2">
              <p className="font-medium text-foreground">Dear Club Leader,</p>
              <p>
                You have successfully added a project in ROW. You can check after 10 minutes.
              </p>
              <p>
                Thank you,<br />
                <span className="font-medium text-foreground">Team ROW</span>
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setShowProjectSuccess(false);
                router.push(returnUrl || `/clubs/${clubId}/public-image-initiative`);
              }}
            >
              OK
            </Button>
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
