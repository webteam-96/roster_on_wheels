"use client";

/**
 * Community Service v2 — Add Project.
 *
 * No dedicated v1 page existed; v1 served Community Service via the unified
 * /clubs/[id]/projects/add?module=community_service page. The same field set,
 * API calls and validation rules are preserved here under module=community_service.
 *
 * Unlike sibling service-avenue v2 pages (vocational, international,
 * new-generation), community_service in v1 supports the FULL form:
 *   - Project Type (One Time / Ongoing-Repeat with Create New / Select Existing)
 *   - Joint Project (Yes/No → coHostName + clubRole pills)
 *   - Area of Focus classification
 * All three are restored here so v2 has no regression vs v1 for this module.
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, Star, Info, MapPin, Target, IndianRupee, Coins, DollarSign, Camera, FileText, Search,
} from "@/components/icons";
import ClassificationAssist from "@/components/projects/ClassificationAssist";
import { consumeProjectSwitchDraft } from "@/lib/projectDraft";
import {
  getClub,
  getModules,
  getAreasOfFocus,
  type ClassificationSearchResult,
  getFunding,
  getOngoingProjects,
  getCurrentRotaryYear,
  createProject,
  uploadProjectImage,
} from "@/services/api";
import { AreaOfFocus, Funding, OngoingProject, ProjectPhotoInput } from "@/types/project";
import { currencyOptions, getCurrencySymbol, resolveClubDefaultCurrency, moneyIconName } from "@/lib/currency";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RecipientBadge from "@/components/RecipientBadge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled } from "@/lib/addToOrg";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";

import { defaultCurrency } from "@/lib/appFormat";
// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

// Test-club gate: BOT (RI Flow-Bot) UI shows only for club 2765. Hardcoded for
// now so it's a one-line grep when expanding to more clubs.

const TOP_MESSAGE = "Please post all the Community Services executed by your club. The content posted here will be displayed in ROW Website, District website, Club Monthly Report & ROW integrated Club website.";

const AGREE_MESSAGE = `The data I will enter is for a Community service project conducted by my club that has benefitted my community. E.g., Heart Surgeries, Tree Plantation, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

// Locked module key for this v2 avenue.
const MODULE_KEY = "community_service";

const ONGOING_INFO = `Ongoing Project

If your club has a Hospital, Dialysis Center, Education Institute etc. and your club keeps adding beneficiaries to this existing project, it is an ongoing project. It's a lifetime project and not a project for the particular year.

Repeat Project

Any Repeat project that you have conducted before in the same Rotary year under the same or any other area of focus falls under this category.
E.g.: You have conducted mask distribution today at a railway station and tomorrow the same activity is conducted in another place or you have done one tree plantation in one village last month and you are conducted one more in another village this month, it is a repeat project.

These are just examples. Please upload similar projects conducted under this criteria.`;

interface PhotoItem {
  id: string;
  file?: File;
  imagePath: string;
  description: string;
  isPrimary: boolean;
  uploading: boolean;
  previewUrl?: string;
}

function FieldLabel({
  children, hint, dot, required = true,
}: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      {/* The coloured bullet means "you must fill this" - an optional field gets none
          (user 2026-10-05). */}
      {required && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* Radio pill matching v1 visual */
function RadioPill({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border-2 cursor-pointer transition-all text-xs font-medium
        ${checked
          ? "border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-200"
          : "border-slate-200 hover:border-blue-300 text-slate-600 hover:text-slate-800"
        }`}
    >
      <input type="radio" checked={checked} onChange={onChange} className="sr-only" />
      <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all
        ${checked ? "border-blue-600" : "border-slate-300"}`}>
        {checked && <div className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
      </div>
      {label}
    </label>
  );
}

// The rupee glyph is India's - Sri Lanka and Nepal get a neutral coin (user 2026-10-05).
function moneyIcon(code?: string | null) {
  const which = moneyIconName(code);
  return which === "dollar" ? DollarSign : Coins;
}

export default function CommunityServiceV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave, navigateAfterCancel } = useV2ReturnTo(`/clubs/${clubId}/community-service/v2`);

  // Page-load "I Agree" gate (parity with v1 listing-page dialog before navigating to Add).
  const [agreementOpen, setAgreementOpen] = useState(false); // gate now lives on the listing page (before navigation)
  const handleAgree = () => setAgreementOpen(false);
  const handleAgreeCancel = () => navigateAfterCancel();

  const [clubName, setClubName] = useState("");
  const [moduleId, setModuleId] = useState<number | null>(null);
  // Classification is locked until the user clicks "Auto-Suggest Classification" (which also fires
  // the AI). While locked, the dropdowns below are greyed and the smart search is disabled.
  const [classUnlocked, setClassUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Masters
  const [areasOfFocus, setAreasOfFocus] = useState<AreaOfFocus[]>([]);
  const [fundingList, setFundingList] = useState<Funding[]>([]);
  const [ongoingProjects, setOngoingProjects] = useState<OngoingProject[]>([]);
  // Current Rotary year — scopes the "Select Existing" search to this year only (avoids cross-year duplicates).
  const [currentYearId, setCurrentYearId] = useState<number | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getCurrentRotaryYear()
      .then((y) => { if (!cancelled) setCurrentYearId(y.id); })
      .catch(() => { /* leave undefined → API falls back to multi-year UNION (graceful) */ });
    return () => { cancelled = true; };
  }, []);

  // Ongoing info dialog (shown when user picks Ongoing/Repeat)
  const [showOngoingInfo, setShowOngoingInfo] = useState(false);

  // Project Type + Ongoing sub-flow
  const [projectType, setProjectType] = useState<"" | "one_time" | "ongoing_repeat">("");
  const [ongoingSubType, setOngoingSubType] = useState<"" | "new" | "existing">("");
  const [ongoingGroupTitle, setOngoingGroupTitle] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);
  const [ongoingSearch, setOngoingSearch] = useState("");

  // Joint Project
  const [isJointProject, setIsJointProject] = useState<boolean | null>(null);
  const [coHostName, setCoHostName] = useState("");
  const [clubRole, setClubRole] = useState<"" | "lead" | "co_host">("");

  // Form state — mirrors v1 community_service field set
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  const [selectedAofId, setSelectedAofId] = useState<string>("");
  const [otherAreaOfFocus, setOtherAreaOfFocus] = useState("");


  const [projectDate, setProjectDate] = useState("");
  const [projectCost, setProjectCost] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency());
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
  const photoInputRef = useRef<HTMLInputElement>(null);

  // RI Flow-Bot extension state (enabled for all clubs).
  // installed: null = checking, true = ready, false = not installed.
  const installed = useExtensionStatus();
  const isBotEnabled = isFlowBotEnabled(clubId);
  // Install prompt (extension NOT detected) — shown once on load, dismissible.
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const installDismissedRef = useRef(false);

  // Surface the install prompt once the extension check resolves to "not installed"
  // (only for the test club, and not while the "I Agree" gate is still up).
  useEffect(() => {
    if (isBotEnabled && installed === false && !installDismissedRef.current && !agreementOpen) {
      setShowInstallPrompt(true);
    }
  }, [installed, isBotEnabled, agreementOpen]);

  const dismissInstallPrompt = () => {
    installDismissedRef.current = true;
    setShowInstallPrompt(false);
  };

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

  useEffect(() => {
    async function init() {
      try {
        const [club, modules, funding] = await Promise.all([
          getClub(clubId),
          getModules(),
          getFunding(),
        ]);
        setClubName(club.clubName);
        setCurrency(resolveClubDefaultCurrency(club));
        const mod = modules.find((m) => m.moduleKey === MODULE_KEY);
        if (mod) {
          setModuleId(mod.id);
          const aof = await getAreasOfFocus(mod.id);
          setAreasOfFocus(aof.filter((a) => a.isActive));
        }
        setFundingList(funding.filter((f) => f.isActive));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  // One pick (smart-search result or AI suggestion) sets the Area of Focus.
  const applyClassification = (r: ClassificationSearchResult) => {
    setSelectedAofId(String(r.areaOfFocusId));
  };

  // Carry-over draft for a cross-module "switch": everything this form has filled so far. The target
  // module's Add page reads the keys it recognises and preselects the AI-suggested classification.
  const buildSwitchDraft = (): Record<string, unknown> => ({
    title, description, location, projectDate, projectCost, selectedFundingId,
    directBeneficiaries, manHours, rotariansInvolved, rotaractorsInvolved,
    projectType, ongoingSubType, ongoingGroupTitle, isJointProject, coHostName, clubRole,
    globalGrantNumber, amountSanctioned, amountReceived, amountSpent,
    hostClubsDistricts, globalPartnerClubsDistricts, csrCompanyName, sendEmail,
    photos: photos.filter((p) => p.imagePath && !p.uploading)
      .map((p) => ({ imagePath: p.imagePath, description: p.description, isPrimary: p.isPrimary })),
  });

  // Hydrate from an incoming cross-module switch draft (this page is also a switch TARGET). Runs once.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    const draft = consumeProjectSwitchDraft(MODULE_KEY);
    if (!draft) return;
    hydratedRef.current = true;
    const f = draft.fields;
    const str = (k: string) => (f[k] == null ? "" : String(f[k]));
    if (f.title != null) setTitle(str("title"));
    if (f.description != null) setDescription(str("description"));
    if (f.location != null) setLocation(str("location"));
    if (f.projectDate != null) setProjectDate(str("projectDate"));
    if (f.projectCost != null) setProjectCost(str("projectCost"));
    if (f.selectedFundingId != null) setSelectedFundingId(str("selectedFundingId"));
    if (f.directBeneficiaries != null) setDirectBeneficiaries(str("directBeneficiaries"));
    if (f.manHours != null) setManHours(str("manHours"));
    if (f.rotariansInvolved != null) setRotariansInvolved(str("rotariansInvolved"));
    if (f.rotaractorsInvolved != null) setRotaractorsInvolved(str("rotaractorsInvolved"));
    if (f.rccInvolved != null) setRccInvolved(str("rccInvolved"));
    if (f.projectType === "one_time" || f.projectType === "ongoing_repeat") setProjectType(f.projectType);
    if (f.ongoingSubType === "new" || f.ongoingSubType === "existing") setOngoingSubType(f.ongoingSubType);
    if (f.ongoingGroupTitle != null) setOngoingGroupTitle(str("ongoingGroupTitle"));
    if (typeof f.isJointProject === "boolean") setIsJointProject(f.isJointProject);
    if (f.coHostName != null) setCoHostName(str("coHostName"));
    if (f.clubRole === "lead" || f.clubRole === "co_host") setClubRole(f.clubRole);
    if (f.globalGrantNumber != null) setGlobalGrantNumber(str("globalGrantNumber"));
    if (f.amountSanctioned != null) setAmountSanctioned(str("amountSanctioned"));
    if (f.amountReceived != null) setAmountReceived(str("amountReceived"));
    if (f.amountSpent != null) setAmountSpent(str("amountSpent"));
    if (f.hostClubsDistricts != null) setHostClubsDistricts(str("hostClubsDistricts"));
    if (f.globalPartnerClubsDistricts != null) setGlobalPartnerClubsDistricts(str("globalPartnerClubsDistricts"));
    if (f.csrCompanyName != null) setCsrCompanyName(str("csrCompanyName"));
    if (typeof f.sendEmail === "boolean") setSendEmail(f.sendEmail);
    if (Array.isArray(f.photos)) {
      setPhotos((f.photos as Array<{ imagePath: string; description?: string; isPrimary?: boolean }>)
        .filter((p) => p?.imagePath)
        .map((p, i) => ({
          id: `draft-${i}`, imagePath: p.imagePath, description: p.description ?? "",
          isPrimary: !!p.isPrimary, uploading: false,
        })));
    }
    setSelectedAofId(String(draft.suggested.areaOfFocusId));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch ongoing projects for the "Select Existing" search
  useEffect(() => {
    if (projectType !== "ongoing_repeat" || ongoingSubType !== "existing" || !moduleId) return;
    let cancelled = false;
    async function fetchOngoing() {
      try {
        const list = await getOngoingProjects(clubId, moduleId!, ongoingSearch || undefined, currentYearId);
        if (!cancelled) setOngoingProjects(list);
      } catch {
        if (!cancelled) setOngoingProjects([]);
      }
    }
    fetchOngoing();
    return () => { cancelled = true; };
  }, [projectType, ongoingSubType, moduleId, clubId, ongoingSearch, currentYearId]);

  const handleProjectTypeChange = (val: "one_time" | "ongoing_repeat") => {
    if (val === "ongoing_repeat") setShowOngoingInfo(true);
    setProjectType(val);
    setOngoingSubType("");
    setIsJointProject(null);
    setClubRole("");
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 5 - photos.length - photoCrop.pending;
    const toAdd = Array.from(files).slice(0, Math.max(0, remaining));

    const accepted: File[] = [];
    for (const file of toAdd) {
      // 5MB cap matches v1 (projects/add/page.tsx line 354). Helper text still
      // shows "max 10 MB" to mirror v1, but enforcement is 5MB.
      if (file.size > 5 * 1024 * 1024) {
        setErrorMessage(`${file.name} exceeds 5MB limit.`);
        continue;
      }
      accepted.push(file);
    }
    e.target.value = "";
    // Queue the selection for the crop dialog — nothing uploads until each
    // photo is confirmed there, one after another.
    const queueErrors = await photoCrop.enqueue(accepted);
    if (queueErrors.length > 0) setErrorMessage(queueErrors[0]);
  };

  const handleCropSave = (blob: Blob) =>
    photoCrop.commit(async () => {
      const file = new File([blob], `project-photo-${Date.now()}.png`, { type: "image/png" });
      const id = Math.random().toString(36).substring(7);
      const previewUrl = URL.createObjectURL(blob);
      setPhotos((prev) => [...prev, {
        id, file, imagePath: "", description: "",
        isPrimary: prev.length === 0,
        uploading: true, previewUrl,
      }]);

      try {
        const result = await uploadProjectImage(clubId, file, undefined, undefined, true);
        setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, imagePath: result.path, uploading: false } : p));
      } catch (err: unknown) {
        setPhotos((prev) => prev.filter((p) => p.id !== id));
        const e = err as { message?: string; response?: { data?: { message?: string } } };
        setErrorMessage(e?.message || e?.response?.data?.message || "Failed to upload photo.");
      }
    });

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      if (updated.length > 0 && !updated.some((p) => p.isPrimary)) {
        updated[0].isPrimary = true;
      }
      return updated;
    });
  };

  const setPrimaryPhoto = (id: string) => {
    setPhotos((prev) => prev.map((p) => ({ ...p, isPrimary: p.id === id })));
  };

  const updatePhotoDescription = (id: string, desc: string) => {
    setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, description: desc } : p));
  };

  const handleSave = async () => {
    // Project Type validations
    if (!projectType) { setErrorMessage("Please select a Project Type."); return; }
    if (projectType === "ongoing_repeat" && !ongoingSubType) { setErrorMessage("Please select Create New or Select Existing for Ongoing/Repeat project."); return; }
    if (projectType === "ongoing_repeat" && ongoingSubType === "new" && !ongoingGroupTitle.trim()) { setErrorMessage("Ongoing/Repeat project title is required."); return; }
    if (projectType === "ongoing_repeat" && ongoingSubType === "existing" && !selectedParentId) { setErrorMessage("Please select an existing ongoing project."); return; }
    // Joint Project validations
    if (isJointProject === null) { setErrorMessage("Please select whether this is a joint project."); return; }
    if (isJointProject && !coHostName.trim()) { setErrorMessage("Co-host name is required for joint projects."); return; }
    if (isJointProject && !clubRole) { setErrorMessage("Please select your Club Role."); return; }
    // Remaining field validations
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!description.trim()) { setErrorMessage("Description is required."); return; }
    if (description.trim().length > 1000) { setErrorMessage("Description must be 1000 characters or less."); return; }
    if (!location.trim()) { setErrorMessage("Location is required."); return; }
    if (!selectedAofId) { setErrorMessage("Area of Focus is required."); return; }
    if (isOthersAof && !otherAreaOfFocus.trim()) { setErrorMessage("Please specify the Area of Focus."); return; }
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
    if (photos.some((p) => p.uploading)) { setErrorMessage("Please wait for photos to finish uploading."); return; }
    if (!moduleId) { setErrorMessage("Module not found."); return; }

    const photoInputs: ProjectPhotoInput[] = photos.map((p, i) => ({
      imagePath: p.imagePath,
      description: p.description || null,
      isPrimary: p.isPrimary,
      sortOrder: i,
    }));

    const saveData: Record<string, unknown> = {
      moduleId,
      projectType,
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
      currency,
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
      navigateAfterSave();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to create project.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <RotaryLoader size="lg" />
        </div>
      </ProtectedRoute>
    );
  }

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Add Community Service Project"
        pageSubtitle="Create a new community service initiative"
        activeNavHref="/club-admin-dashboard/service-projects-and-public-image"
      >
      <V2FormShell
        title="Add Community Service Project"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/community-service/v2`}
        saving={saving}
        saveLabel="Save Project"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Project Type */}
        <SectionCard number={1} icon={FileText} title="Project Type" dot="bg-blue-600">
          <div className="space-y-4">
            <div>
              <FieldLabel dot="bg-blue-500">Select Project Type</FieldLabel>
              <div className="flex flex-wrap gap-2.5">
                <RadioPill checked={projectType === "one_time"} onChange={() => handleProjectTypeChange("one_time")} label="One Time Project" />
                <RadioPill checked={projectType === "ongoing_repeat"} onChange={() => handleProjectTypeChange("ongoing_repeat")} label="Ongoing / Repeat Project" />
              </div>
            </div>

            {/* Ongoing sub-options */}
            {projectType === "ongoing_repeat" && (
              <div className="space-y-4 pl-4 border-l-2 border-blue-300 ml-1">
                <div>
                  <FieldLabel dot="bg-blue-500">Ongoing/Repeat Type</FieldLabel>
                  <div className="flex flex-wrap gap-2.5">
                    <RadioPill checked={ongoingSubType === "new"} onChange={() => { setOngoingSubType("new"); setIsJointProject(null); setClubRole(""); }} label="Create New" />
                    <RadioPill checked={ongoingSubType === "existing"} onChange={() => { setOngoingSubType("existing"); setIsJointProject(null); setClubRole(""); }} label="Select Existing" />
                  </div>
                </div>

                {ongoingSubType === "new" && (
                  <div>
                    <FieldLabel dot="bg-blue-500">Title of Ongoing/Repeat Project</FieldLabel>
                    <input
                      type="text"
                      value={ongoingGroupTitle}
                      onChange={(e) => setOngoingGroupTitle(e.target.value)}
                      placeholder="Enter ongoing/repeat project title"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                {ongoingSubType === "existing" && (
                  <div className="space-y-2">
                    <FieldLabel dot="bg-blue-500">Search Existing Project</FieldLabel>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        value={ongoingSearch}
                        onChange={(e) => { setOngoingSearch(e.target.value); setSelectedParentId(null); }}
                        placeholder="Type to search existing projects..."
                        className="w-full pl-9 pr-9 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {ongoingSearch && (
                        <button type="button" onClick={() => { setOngoingSearch(""); setSelectedParentId(null); }} className="absolute right-3 top-1/2 -translate-y-1/2">
                          <X className="h-4 w-4 text-slate-400 hover:text-slate-700" />
                        </button>
                      )}
                    </div>
                    {ongoingSearch && ongoingProjects.length > 0 && !selectedParentId && (
                      <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto bg-white">
                        {ongoingProjects.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { setSelectedParentId(p.id); setOngoingSearch(p.title); }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b last:border-b-0 border-slate-100"
                          >
                            {p.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {ongoingSearch && ongoingProjects.length === 0 && !selectedParentId && (
                      <p className="text-xs text-slate-500">No matching projects found.</p>
                    )}
                    {selectedParentId && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="text-xs text-emerald-700 font-medium">Selected: {ongoingSearch}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Joint Project — show after one_time selected, or after ongoing sub-type selected */}
            {(projectType === "one_time" || (projectType === "ongoing_repeat" && ongoingSubType)) && (
              <div className="space-y-4 pt-3 border-t border-dashed border-slate-200">
                <div>
                  <FieldLabel dot="bg-blue-500">Is this a joint project with any other Rotary Club / Organisation?</FieldLabel>
                  <div className="flex flex-wrap gap-2.5">
                    <RadioPill checked={isJointProject === true} onChange={() => setIsJointProject(true)} label="Yes" />
                    <RadioPill checked={isJointProject === false} onChange={() => setIsJointProject(false)} label="No" />
                  </div>
                </div>

                {isJointProject === true && (
                  <div className="space-y-3 pl-4 border-l-2 border-blue-300 ml-1">
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <p>Project uploaded by co-host Rotary club will be displayed only in the club monthly report &amp; club website (If subscribed through ROW)</p>
                    </div>
                    <div>
                      <FieldLabel dot="bg-blue-500">Name of Co-host Rotary Club / Partner Organisation</FieldLabel>
                      <input
                        type="text"
                        value={coHostName}
                        onChange={(e) => setCoHostName(e.target.value)}
                        placeholder="Enter co-host name"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <FieldLabel dot="bg-blue-500">Your Club Role</FieldLabel>
                      <div className="flex flex-wrap gap-2.5">
                        <RadioPill checked={clubRole === "lead"} onChange={() => setClubRole("lead")} label="Lead Club" />
                        <RadioPill checked={clubRole === "co_host"} onChange={() => setClubRole("co_host")} label="Co-Host Club" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        {/* 2. Project Details */}
        <SectionCard number={2} icon={MapPin} title="Project Details" dot="bg-emerald-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 50 chars)" dot="bg-emerald-500">Title</FieldLabel>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Project title"
                maxLength={50}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 1000 chars)" dot="bg-emerald-500">Description</FieldLabel>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the project, its objectives, and impact…"
                rows={4}
                maxLength={1000}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500">Location of Project</FieldLabel>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, Venue, etc."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500">Date of Project</FieldLabel>
              <DateField value={projectDate} onChange={setProjectDate} max={todayStr} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>
        </SectionCard>

        {/* 3. Classification: Area of Focus */}
        <SectionCard number={3} icon={Target} title="Area of Focus" dot="bg-violet-600">
          <ClassificationAssist
            clubId={clubId}
            moduleId={moduleId}
            moduleKey={MODULE_KEY}
            title={title}
            description={description}
            onApply={applyClassification}
            selectedAreaId={selectedAofId}
            enableCrossModule
            buildSwitchDraft={buildSwitchDraft}
            unlocked={classUnlocked}
            onUnlock={() => setClassUnlocked(true)}
          />

          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${classUnlocked ? "" : "opacity-50 pointer-events-none select-none"}`}>
            <div>
              <FieldLabel dot="bg-violet-500">Area of Focus</FieldLabel>
              <select
                value={selectedAofId}
                onChange={(e) => setSelectedAofId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Select</option>
                {areasOfFocus.map((a) => (
                  <option key={a.id} value={String(a.id)}>{a.name}</option>
                ))}
                {!areasOfFocus.some((a) => (a.name || "").trim().toLowerCase() === "others") && (
                  <option value="others">Others</option>
                )}
              </select>
              {isOthersAof && (
                <input
                  type="text"
                  value={otherAreaOfFocus}
                  onChange={(e) => setOtherAreaOfFocus(e.target.value)}
                  placeholder="Specify area of focus"
                  className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              )}
            </div>
          </div>
        </SectionCard>

        {/* 4. Financial & Impact */}
        <SectionCard number={4} icon={moneyIcon(currency)} title="Financial & Impact" dot="bg-amber-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <FieldLabel dot="bg-amber-500">Currency</FieldLabel>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {currencyOptions().map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel dot="bg-amber-500">Project Cost ({getCurrencySymbol(currency)})</FieldLabel>
              <input
                type="number"
                value={projectCost}
                onChange={(e) => setProjectCost(e.target.value)}
                placeholder="0"
                min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-amber-500">Funding</FieldLabel>
              <select
                value={selectedFundingId}
                onChange={(e) => handleFundingChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">Select</option>
                {fundingList.map((f) => (
                  <option key={f.id} value={String(f.id)}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Funding-conditional: Global Grant fields */}
            {showGlobalGrantBlock && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border-l-4 border-amber-500 bg-amber-50/40 rounded-md p-4">
                <h4 className="text-sm font-semibold text-amber-700">Global Grant Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel dot="bg-amber-500" required={false}>Global Grant Number</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={globalGrantNumber}
                      onChange={(e) => setGlobalGrantNumber(onlyDigits(e.target.value))} placeholder="e.g., 2434521"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500" required={false}>Amount Sanctioned ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500" required={false}>Amount Received ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500" required={false}>Amount spent till date ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountSpent}
                      onChange={(e) => setAmountSpent(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-amber-500">Host Clubs/Districts</FieldLabel>
                    <input type="text" value={hostClubsDistricts}
                      onChange={(e) => setHostClubsDistricts(e.target.value)} placeholder="e.g., RC Chicago, RC Paris"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-amber-500">Global Partner Clubs/Districts</FieldLabel>
                    <input type="text" value={globalPartnerClubsDistricts}
                      onChange={(e) => setGlobalPartnerClubsDistricts(e.target.value)} placeholder="e.g., RC Tokyo"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                </div>
              </div>
            )}

            {/* Funding-conditional: CSR fields */}
            {showCsrBlock && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border-l-4 border-amber-500 bg-amber-50/40 rounded-md p-4">
                <h4 className="text-sm font-semibold text-amber-700">CSR Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-amber-500">Name of the CSR Company</FieldLabel>
                    <input type="text" value={csrCompanyName}
                      onChange={(e) => setCsrCompanyName(e.target.value)} placeholder="e.g., ABC Industries Ltd"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500">Amount Sanctioned ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500">Amount Received ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                </div>
              </div>
            )}

            <div>
              <FieldLabel dot="bg-amber-500">Direct Beneficiaries</FieldLabel>
              <input
                type="number"
                value={directBeneficiaries}
                onChange={(e) => setDirectBeneficiaries(e.target.value)}
                placeholder="0"
                min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <FieldLabel hint="(Rotarians x Hours)" dot="bg-amber-500">Man Hours</FieldLabel>
              <input
                type="number"
                value={manHours}
                onChange={(e) => setManHours(e.target.value)}
                placeholder="0"
                min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-amber-500">Rotarians Involved</FieldLabel>
              <input
                type="number"
                value={rotariansInvolved}
                onChange={(e) => setRotariansInvolved(e.target.value)}
                placeholder="0"
                min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-amber-500" required={false}>Rotaractors Involved</FieldLabel>
              <input
                type="number"
                value={rotaractorsInvolved}
                onChange={(e) => setRotaractorsInvolved(e.target.value)}
                placeholder="0"
                min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-amber-500" required={false}>RCC Involved</FieldLabel>
              <input
                type="number"
                value={rccInvolved}
                onChange={(e) => setRccInvolved(e.target.value)}
                placeholder="0"
                min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        </SectionCard>

        {/* 5. Photos */}
        <SectionCard number={5} icon={Camera} title="Photos" dot="bg-rose-600">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <FieldLabel dot="bg-rose-500">Upload Photos (1 mandatory, max 5)</FieldLabel>
              <span className="text-xs text-slate-500">{photos.length}/5</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group rounded-lg overflow-hidden border border-slate-200 bg-muted/30">
                  <div className="aspect-square relative">
                    {photo.previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.previewUrl} alt="" className="w-full h-full object-contain" />
                    )}
                    {photo.uploading && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <RotaryLoader size="sm" />
                      </div>
                    )}
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => setPrimaryPhoto(photo.id)}
                        className={`p-1 rounded-full ${photo.isPrimary ? "bg-amber-400 text-amber-900" : "bg-black/50 text-white hover:bg-amber-400 hover:text-amber-900"}`}>
                        <Star className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => removePhoto(photo.id)} className="p-1 rounded-full bg-black/50 text-white hover:bg-rose-500">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {photo.isPrimary && (
                      <div className="absolute bottom-0 left-0 right-0 bg-amber-400/90 text-amber-900 text-[10px] font-bold text-center py-0.5">PRIMARY</div>
                    )}
                  </div>
                  <div className="p-2">
                    <textarea
                      value={photo.description}
                      onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(photo.id, e.target.value); }}
                      placeholder="Photo description (max 500 chars)"
                      rows={2}
                      maxLength={500}
                      className="w-full px-2 py-1 text-xs border border-slate-200 rounded resize-none focus:outline-none focus:ring-1 focus:ring-rose-400"
                    />
                    <p className="text-[10px] text-slate-400 text-right">{photo.description.length}/500</p>
                  </div>
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-lg aspect-square flex flex-col items-center justify-center gap-1 text-slate-500 hover:border-rose-300 hover:text-rose-700"
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">Add Photo</span>
                </button>
              )}
            </div>
            <input ref={photoInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" multiple onChange={handlePhotoSelect} />
            <p className="text-xs text-slate-400">JPG, JPEG, PNG, GIF, WEBP · up to 5 MB · auto-compressed if larger</p>
          </div>
        </SectionCard>

        <div className="rounded-xl border border-slate-200 p-4">
          <label className="flex items-center gap-2.5 cursor-pointer select-none mt-2">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-blue-600 h-4 w-4" />
            <span className="text-sm font-medium text-slate-700">Send Email notification</span>
            {sendEmail && <RecipientBadge scope="club" clubId={clubId} />}
          </label>
        </div>

        {/* Ongoing Info Dialog */}
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
            <Button className="w-full" onClick={() => { setShowProjectSuccess(false); setSuccessMessage(null); navigateAfterSave(); }}>OK</Button>
          </DialogContent>
        </Dialog>

        <SuccessAlert open={!!successMessage && !showProjectSuccess} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
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
      </V2FormShell>

      {/* Page-load "I Agree" disclaimer (ported from v1 listing page) */}
      <Dialog open={agreementOpen} onOpenChange={(o) => !o && handleAgreeCancel()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="text-blue-600" size={20} />
              I Agree
            </DialogTitle>
          </DialogHeader>
          <div className="whitespace-pre-line text-sm text-slate-700">
            {AGREE_MESSAGE}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleAgreeCancel}>Cancel</Button>
            <Button onClick={handleAgree}>I Agree & Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
