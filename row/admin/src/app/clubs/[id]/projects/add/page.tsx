"use client";

import SectionCard from "@/components/form/SectionCard";
import RadioPill from "@/components/form/RadioPill";
import FieldLabel from "@/components/form/FieldLabel";
import { Card } from "@/components/ui/card";
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
import { Upload, X, Star, Info, Search, FileText, MapPin, Target, IndianRupee, Camera, Send } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RecipientBadge from "@/components/RecipientBadge";
import AddToOrgStatus from "@/components/AddToOrgStatus";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, triggerAddToOrg, type OrgExport, type FundingClass } from "@/lib/addToOrg";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";

import { currencySymbol } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { ClearButton, LinkButton, MenuItemButton, RemoveBadgeButton } from "@/components/ui/text-buttons"
// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

// Test-club gate: BOT (RI Flow-Bot) UI shows only for club 2765 AND only for
// the community_service avenue. Hardcoded so it's a one-line grep when
// expanding to more clubs.
const BOT_ALLOWED_MODULE = "community_service";
// API origin for building full photo URLs handed to the Add-to-Org extension.
const ADD_TO_ORG_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const MODULE_LABELS: Record<string, string> = {
  club_service: "Club Service",
  community_service: "Community Service",
  vocational_service: "Vocational Service",
  international_service: "International Service",
  new_generation_service: "New Generation Service",
  public_image_initiative: "Public Image Initiative",
};

const TOP_MESSAGES: Record<string, string> = {
  community_service: "Please post all the Community Services executed by your club. The content posted here will be displayed in ROW Website, District website, Club Monthly Report & ROW integrated Club website.",
  club_service: "",
  vocational_service: "",
  international_service: "",
  new_generation_service: "",
  public_image_initiative: "",
};

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

/* ── Section wrapper with icon + title ── */

/* ── Radio pill component ── */

/* ── Required label helper ── */

export default function AddProjectPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const moduleKey = searchParams.get("module") || "community_service";
  const returnUrl = searchParams.get("returnUrl");
  const frozenMonth = searchParams.get("frozenMonth");
  // yearId from URL — scopes the "Select Existing" search to this year only.
  const urlYearId = Number(searchParams.get("yearId")) || undefined;

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
  const [directBeneficiaries, setDirectBeneficiaries] = useState("");
  const [manHours, setManHours] = useState("");
  const [rotariansInvolved, setRotariansInvolved] = useState("");
  const [rotaractorsInvolved, setRotaractorsInvolved] = useState("");
  const [rccInvolved, setRccInvolved] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [showProjectSuccess, setShowProjectSuccess] = useState(false);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const photoCrop = useImageCropQueue();

  const moduleLabel = MODULE_LABELS[moduleKey] || "Projects";
  const topMessage = TOP_MESSAGES[moduleKey];
  const isClubService = moduleKey === "club_service";

  // ── Funding classifier — matches funding name to "global_grant" / "csr" / "" ──
  // Drives conditional rendering of the extra field block under Funding.
  // RI Flow-Bot extension state (all clubs, community_service module only).
  const installed = useExtensionStatus();
  const addToOrgAfterSaveRef = useRef(false);
  const isBotEnabled = isFlowBotEnabled(clubId) && moduleKey === BOT_ALLOWED_MODULE;

  // 5-way funding class for the Add-to-Org extension export (broader than
  // classifyFunding below, which only drives the conditional UI). Mirrors the
  // extension's FundingClass enum so the extension can map to the right SPC grant path.
  const classifyFundingClass = (name?: string | null): FundingClass => {
    const n = (name || "").trim().toLowerCase();
    if (!n) return "";
    if (n.includes("global grant")) return "global_grant";
    if (n.includes("district grant")) return "district_grant";
    if (n === "csr" || n.startsWith("csr ") || n.includes(" csr") || n.includes("(csr)")) return "csr";
    if (n.includes("self funded") || n === "self" || n.includes("self-funded")) return "self";
    return "other";
  };

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

  // When funding option changes, wipe all 7 conditional fields (per spec — never carry stale values).
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

  // Allow only digits in amount / number inputs (no letters, no decimals — whole numbers only per spec)
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
          // Only fetch areas of focus for non-club_service modules
          if (moduleKey !== "club_service") {
            const aof = await getAreasOfFocus(mod.id);
            setAreasOfFocus(aof.filter(a => a.isActive));
          }
        }
        setFundingList(funding.filter(f => f.isActive));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, moduleKey]);

  // Fetch ongoing projects for search
  useEffect(() => {
    if (projectType !== "ongoing_repeat" || ongoingSubType !== "existing" || !moduleId) return;
    async function fetchOngoing() {
      try {
        // Pass yearId so the API scopes to the current year's table only — avoids duplicates from other year tables.
        setOngoingProjects(await getOngoingProjects(clubId, moduleId!, ongoingSearch || undefined, urlYearId));
      } catch { setOngoingProjects([]); }
    }
    fetchOngoing();
  }, [projectType, ongoingSubType, moduleId, clubId, ongoingSearch, urlYearId]);

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
    // Validation — all fields mandatory
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
    // Classification validation — skip for Club Service
    if (!isClubService) {
      if (!selectedAofId) { setErrorMessage("Area of Focus is required."); return; }
      if (isOthersAof && !otherAreaOfFocus.trim()) { setErrorMessage("Please specify the Area of Focus."); return; }
    }
    if (!projectCost) { setErrorMessage("Project Cost is required."); return; }
    if (!selectedFundingId) { setErrorMessage("Funding is required."); return; }
    // Funding-conditional validation (mirrors backend)
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
      // Funding-conditional fields. Backend nulls out non-applicable ones based on funding name as a safety net.
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
      sendEmail,
      photos: photoInputs,
    };

    await doSaveProject(saveData);
  };

  const doSaveProject = async (saveData: Record<string, unknown>) => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await createProject(clubId, saveData as any);

      // RI Flow-Bot: when user clicked "Submit & Add to Org", skip the success
      // dialog (the extension needs the page to stay) and hand the project off.
      if (addToOrgAfterSaveRef.current) {
        addToOrgAfterSaveRef.current = false;
        setSuccessMessage("Project saved: opening Add to Org…");
        triggerAddToOrg(result?.id ?? null, buildOrgExport(), clubId);
      } else {
        setShowProjectSuccess(true);
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to create project.");
    } finally {
      setSaving(false);
    }
  };

  // Build the project export the Add-to-Org extension consumes. V1 page handles
  // all avenues, but BOT is gated to community_service only — so avenue is hardcoded.
  const buildOrgExport = (): OrgExport => ({
    title: title.trim(),
    description: description.trim(),
    meta: { avenue: "Community Service" },
    classification: {
      areaOfFocus: isOthersAof
        ? otherAreaOfFocus
        : (areasOfFocus.find((a) => String(a.id) === selectedAofId)?.name || ""),
    },
    locationText: location.trim(),
    dateOfProject: projectDate,
    projectType: projectType === "one_time" ? "One Time Project" : "Ongoing / Repeat Project",
    projectCostINR: projectCost ? Number(projectCost) : 0,
    funding: selectedFundingName,
    financial: {
      fundingClass: classifyFundingClass(selectedFundingName),
      globalGrantNumber: showGlobalGrantBlock ? (globalGrantNumber.trim() || null) : null,
      amountSanctionedINR: (showGlobalGrantBlock || showCsrBlock) && amountSanctioned ? Number(amountSanctioned) : null,
      amountReceivedINR: (showGlobalGrantBlock || showCsrBlock) && amountReceived ? Number(amountReceived) : null,
      amountSpentINR: showGlobalGrantBlock && amountSpent ? Number(amountSpent) : null,
      hostClubsDistricts: showGlobalGrantBlock ? (hostClubsDistricts.trim() || null) : null,
      globalPartnerClubsDistricts: showGlobalGrantBlock ? (globalPartnerClubsDistricts.trim() || null) : null,
      csrCompanyName: showCsrBlock ? (csrCompanyName.trim() || null) : null,
    },
    directBeneficiaries: Number(directBeneficiaries) || 0,
    manHours: Number(manHours) || 0,
    rotariansInvolved: Number(rotariansInvolved) || 0,
    rotaractorsInvolved: Number(rotaractorsInvolved) || 0,
    rccInvolved: Number(rccInvolved) || 0,
    photos: photos.map((p) => ({
      url: `${ADD_TO_ORG_API_URL}${p.imagePath}`,
      isPrimary: p.isPrimary,
      caption: p.description || "",
    })),
  });

  // "Submit & Add to Org": run the normal save, then hand the project to the extension.
  const handleSubmitAndAddToOrg = () => {
    addToOrgAfterSaveRef.current = true;
    handleSave();
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
      <div className="space-y-5 max-w-4xl">
        {/* ── Header ── */}
        <PageHeader
          title={clubName ? `${clubName} - ${moduleLabel}` : moduleLabel}
          description="Add new project"
          back={returnUrl || `/clubs/${clubId}/projects?module=${moduleKey}`}
          actions={
            <>
<Button onClick={handleSave} disabled={saving} size="lg">
            <Send className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Save Project"}
          </Button>
            </>
          }
        />

        {/* ── Top message ── */}
        {topMessage && (
          <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-800">
            <Info className="h-5 w-5 shrink-0 mt-0.5" />
            <p>{topMessage}</p>
          </div>
        )}

        {/* ── 1. Project Type ── */}
        <SectionCard icon={FileText} title="Project Type" number={1}>
          <div className="space-y-5">
            <div>
              <FieldLabel required>Select Project Type</FieldLabel>
              <div className="flex flex-wrap gap-3 mt-2">
                <RadioPill name="projectType" value="one_time" checked={projectType === "one_time"} onChange={() => handleProjectTypeChange("one_time")} label="One Time Project" />
                <RadioPill name="projectType" value="ongoing_repeat" checked={projectType === "ongoing_repeat"} onChange={() => handleProjectTypeChange("ongoing_repeat")} label="Ongoing / Repeat Project" />
              </div>
            </div>

            {/* Ongoing sub-options */}
            {projectType === "ongoing_repeat" && (
              <div className="space-y-4 pl-5 border-l-2 border-primary/30 ml-2">
                <div>
                  <FieldLabel required>Ongoing/Repeat Type</FieldLabel>
                  <div className="flex flex-wrap gap-3 mt-2">
                    <RadioPill name="ongoingSubType" value="new" checked={ongoingSubType === "new"} onChange={() => { setOngoingSubType("new"); setIsJointProject(null); setClubRole(""); }} label="Create New" />
                    <RadioPill name="ongoingSubType" value="existing" checked={ongoingSubType === "existing"} onChange={() => { setOngoingSubType("existing"); setIsJointProject(null); setClubRole(""); }} label="Select Existing" />
                  </div>
                </div>

                {ongoingSubType === "new" && (
                  <div className="space-y-1.5">
                    <FieldLabel required>Title of Ongoing/Repeat Project</FieldLabel>
                    <Input
                      value={ongoingGroupTitle}
                      onChange={(e) => setOngoingGroupTitle(e.target.value)}
                      placeholder="Enter ongoing/repeat project title"
                    />
                  </div>
                )}

                {ongoingSubType === "existing" && (
                  <div className="space-y-2">
                    <FieldLabel required>Search Existing Project</FieldLabel>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={ongoingSearch}
                        onChange={(e) => { setOngoingSearch(e.target.value); setSelectedParentId(null); }}
                        placeholder="Type to search existing projects..."
                        className="pl-9"
                      />
                      {ongoingSearch && (
                        <ClearButton onClick={() => { setOngoingSearch(""); setSelectedParentId(null); }} aria-label="Clear search" />
                      )}
                    </div>
                    {ongoingSearch && ongoingProjects.length > 0 && !selectedParentId && (
                      <div className="border rounded-lg max-h-48 overflow-y-auto shadow-sm">
                        {ongoingProjects.map((p) => (
                          <MenuItemButton
                            key={p.id}
                            onClick={() => { setSelectedParentId(p.id); setOngoingSearch(p.title); }}
                            className="border-b last:border-b-0">
                            {p.title}
                          </MenuItemButton>
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

            {/* Joint Project — show after one_time selected, or after ongoing sub-type selected */}
            {(projectType === "one_time" || (projectType === "ongoing_repeat" && ongoingSubType)) && (
              <div className="space-y-4 pt-4 border-t border-dashed">
                <div>
                  <FieldLabel required>Is this a joint project with any other Rotary Club / Organisation?</FieldLabel>
                  <div className="flex flex-wrap gap-3 mt-2">
                    <RadioPill name="jointProject" value="yes" checked={isJointProject === true} onChange={() => setIsJointProject(true)} label="Yes" />
                    <RadioPill name="jointProject" value="no" checked={isJointProject === false} onChange={() => setIsJointProject(false)} label="No" />
                  </div>
                </div>

                {isJointProject === true && (
                  <div className="space-y-4 pl-5 border-l-2 border-primary/30 ml-2">
                    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800">
                      <Info className="h-4 w-4 shrink-0 mt-0.5" />
                      <p>Project uploaded by co-host Rotary club will be displayed only in the club monthly report & club website (If subscribed through ROW)</p>
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel required>Name of Co-host Rotary Club / Partner Organisation</FieldLabel>
                      <Input value={coHostName} onChange={(e) => setCoHostName(e.target.value)} placeholder="Enter co-host name" />
                    </div>
                    <div>
                      <FieldLabel required>Your Club Role</FieldLabel>
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
        </SectionCard>

        {/* ── 2. Project Details ── */}
        <SectionCard icon={MapPin} title="Project Details" number={2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel required hint="(max 50 chars)">Title</FieldLabel>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project title" maxLength={50} />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel required hint="(max 1000 chars)">Description</FieldLabel>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the project, its objectives, and impact..." rows={4} maxLength={1000} />
              <p className="text-xs text-muted-foreground text-right">{description.length}/1000</p>
            </div>

            <div className="space-y-1.5">
              <FieldLabel required>Location of Project</FieldLabel>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, Venue, etc." />
            </div>

            <div className="space-y-1.5">
              <FieldLabel required>Date of Project</FieldLabel>
              <DateField value={projectDate} onChange={setProjectDate} max={frozenMonth ? frozenDateMax : todayStr} min={frozenMonth ? frozenDateMin : undefined} />
            </div>
          </div>
        </SectionCard>

        {/* ── 3. Classification (hidden for Club Service) ── */}
        {!isClubService && (
        <SectionCard icon={Target} title="Area of Focus" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <FieldLabel required>Area of Focus</FieldLabel>
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
                <Input value={otherAreaOfFocus} onChange={(e) => setOtherAreaOfFocus(e.target.value)} placeholder="Specify area of focus" className="mt-2" />
              )}
            </div>
          </div>
        </SectionCard>
        )}

        {/* ── 4. Financial & Impact ── */}
        <SectionCard icon={IndianRupee} title="Financial & Impact" number={isClubService ? 3 : 4}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <FieldLabel required>Project Cost ({currencySymbol()})</FieldLabel>
              <Input type="number" value={projectCost} onChange={(e) => setProjectCost(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>Funding</FieldLabel>
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
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border border-primary/30 bg-primary/5 rounded-md p-4 mt-1">
                <h4 className="row-h3">Global Grant Details</h4>
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
                    <FieldLabel required>Host Clubs/Districts</FieldLabel>
                    <Input type="text" value={hostClubsDistricts}
                      onChange={(e) => setHostClubsDistricts(e.target.value)} placeholder="e.g., RC Chicago, RC Paris" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <FieldLabel required>Global Partner Clubs/Districts</FieldLabel>
                    <Input type="text" value={globalPartnerClubsDistricts}
                      onChange={(e) => setGlobalPartnerClubsDistricts(e.target.value)} placeholder="e.g., RC Tokyo" />
                  </div>
                </div>
              </div>
            )}

            {/* Funding-conditional: CSR fields */}
            {showCsrBlock && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border border-primary/30 bg-primary/5 rounded-md p-4 mt-1">
                <h4 className="row-h3">CSR Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <FieldLabel required>Name of the CSR Company</FieldLabel>
                    <Input type="text" value={csrCompanyName}
                      onChange={(e) => setCsrCompanyName(e.target.value)} placeholder="e.g., ABC Industries Ltd" />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel required>Amount Sanctioned ({currencySymbol()})</FieldLabel>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel required>Amount Received ({currencySymbol()})</FieldLabel>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <FieldLabel required>Direct Beneficiaries</FieldLabel>
              <Input type="number" value={directBeneficiaries} onChange={(e) => setDirectBeneficiaries(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required hint="(Rotarians x Hours)">Man Hours</FieldLabel>
              <Input type="number" value={manHours} onChange={(e) => setManHours(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>Rotarians Involved</FieldLabel>
              <Input type="number" value={rotariansInvolved} onChange={(e) => setRotariansInvolved(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required optional>Rotaractors Involved</FieldLabel>
              <Input type="number" value={rotaractorsInvolved} onChange={(e) => setRotaractorsInvolved(e.target.value)} placeholder="0" min="0" />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required optional>RCC Involved</FieldLabel>
              <Input type="number" value={rccInvolved} onChange={(e) => setRccInvolved(e.target.value)} placeholder="0" min="0" />
            </div>
          </div>
        </SectionCard>

        {/* ── 5. Photos ── */}
        <SectionCard icon={Camera} title="Photos" number={isClubService ? 4 : 5}>
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
                <p className="text-xs text-muted-foreground mt-1">Allowed: JPG, JPEG, PNG, GIF, WEBP &middot; up to 5 MB &middot; auto-compressed if larger</p>
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
                          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500 text-white text-xs font-medium shadow">
                            <Star className="h-3 w-3 fill-white" />Primary
                          </div>
                        )}
                        <RemoveBadgeButton
                          onClick={() => removePhoto(index)}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="Remove photo" />
                      </div>
                    )}
                    <div className="p-3 space-y-2">
                      <Textarea
                        value={photo.description}
                        onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(index, e.target.value); }}
                        placeholder="Photo description (max 500 chars)"
                        rows={3}
                        maxLength={500}
                        className="resize-none"
                      />
                      <p className="text-xs text-muted-foreground text-right">{photo.description.length}/500</p>
                      {!photo.isPrimary && (
                        <LinkButton
                          onClick={() => setPrimaryPhoto(index)}
                          tone="muted" size="sm">
                          <Star className="h-3 w-3" />Set as primary
                        </LinkButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

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

          {/* RI Flow-Bot status — visible only for test club + community service. */}
          {isBotEnabled && (
            <div className="mb-2">
              <AddToOrgStatus installed={installed} />
            </div>
          )}

          <div className="flex flex-wrap gap-3 items-center">
            <Button variant="outline" asChild>
              <Link href={returnUrl || `/clubs/${clubId}/projects?module=${moduleKey}`}>Cancel</Link>
            </Button>
            {/* RI Flow-Bot button — disabled while extension is checking / missing. */}
            {isBotEnabled && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSubmitAndAddToOrg}
                disabled={saving || installed !== true}
              >
                Submit &amp; Add to Org
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving} size="lg">
              <Send className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Project"}
            </Button>
          </div>
        </div>

        {/* ── Ongoing Info Dialog ── */}
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

        {/* ── Project Success Dialog ── */}
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
                router.push(returnUrl || `/clubs/${clubId}/projects?module=${moduleKey}`);
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
