"use client";

/**
 * Public Image Initiative v2 — Edit Project.
 *
 * Same data semantics as the v1 edit page: every field, every API call (incl.
 * the cross-year move flow), every validation rule is preserved verbatim.
 * Only the visual presentation differs (V2FormShell wrapper, dot-accented
 * section headers, sticky save bar).
 *
 * Project Type section is rendered disabled to match v1 (type cannot change
 * after creation — only the back-end ID determines the parent linkage).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`. yearId comes from
 * a normal query param (?yearId=) since the API requires it.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Upload, X, Star, Info, FileText, MapPin, Target, IndianRupee, Coins, DollarSign, Camera, Search,
} from "lucide-react";
import {
  getClub,
  getModules,
  getAreasOfFocus,
  getCategories,
  getFunding,
  getOngoingProjects,
  getProject,
  updateProject,
  moveProject,
  uploadProjectImage,
  checkClubHasModerator,
  type ClassificationSearchResult,
} from "@/services/api";
import ClassificationAssist from "@/components/projects/ClassificationAssist";
import {
  AreaOfFocus, Category, Funding, OngoingProject, ProjectPhotoInput,
} from "@/types/project";
import { currencyOptions, getCurrencySymbol, moneyIconName } from "@/lib/currency";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import AlertModal from "@/components/AlertModal";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";

import { defaultCurrency } from "@/lib/appFormat";
// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

const MODULE_KEY = "public_image_initiative";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const TOP_MESSAGE = "Please post all the Public Image Initiatives executed by your club. The content posted here will be displayed in District website, Club Monthly Report & ROW integrated Club website.";

const ONGOING_INFO = `Ongoing Project

If your club has a Hospital, Dialysis Center, Education Institute etc. and your club keeps adding beneficiaries to this existing project, it is an ongoing project. It's a lifetime project and not a project for the particular year.

Repeat Project

Any Repeat project that you have conducted before in the same Rotary year under the same or any other area of focus falls under this category.
E.g.: You have conducted mask distribution today at a railway station and tomorrow the same activity is conducted in another place or you have done one tree plantation in one village last month and you are conducted one more in another village this month, it is a repeat project.

These are just examples. Please upload similar projects conducted under this criteria.`;

type PhotoItem = {
  id: string;
  file?: File;
  imagePath: string;
  description: string;
  isPrimary: boolean;
  uploading: boolean;
  previewUrl?: string;
};

function FieldLabel({ children, hint, dot, required = true }: {
  children: React.ReactNode; hint?: string; dot: string; required?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      {/* The coloured bullet means "you must fill this" - an optional field gets none
          (user 2026-10-05). */}
      {required && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      <label className="text-xs font-semibold text-slate-700">
        {children}{required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children, locked,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode; locked?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {locked && <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400">read-only</span>}
      </div>
      <div className={`p-4 ${locked ? "opacity-60 pointer-events-none" : ""}`}>{children}</div>
    </div>
  );
}

function RadioPill({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <label
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all text-sm font-medium
        ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}
        ${checked
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-slate-200 text-slate-600 hover:border-blue-300 hover:text-slate-800"
        }`}
    >
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} className="sr-only" />
      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${checked ? "border-blue-500" : "border-slate-400"}`}>
        {checked && <div className="h-2 w-2 rounded-full bg-blue-500" />}
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

export default function PublicImageInitiativeV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const projectId = Number(params.projectId);
  const yearId = Number(searchParams.get("yearId") || searchParams.get("frozenYearId")) || 0;
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/public-image-initiative/v2`);
  const returnTo = searchParams.get("returnTo") || "";

  // Cross-link from Club Monthly Report: locks the project date to the
  // selected month (parity with v1 edit page).
  const frozenMonth = searchParams.get("frozenMonth");
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

  // Masters
  const [areasOfFocus, setAreasOfFocus] = useState<AreaOfFocus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fundingList, setFundingList] = useState<Funding[]>([]);
  const [ongoingProjects, setOngoingProjects] = useState<OngoingProject[]>([]);

  const [showOngoingInfo, setShowOngoingInfo] = useState(false);
  const [initDone, setInitDone] = useState(false);

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
  const [selectedCatId, setSelectedCatId] = useState<string>("");
  const [otherCategory, setOtherCategory] = useState("");

  const [projectDate, setProjectDate] = useState("");
  const [projectCost, setProjectCost] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency());
  const [selectedFundingId, setSelectedFundingId] = useState<string>("");
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
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const photoCrop = useImageCropQueue();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const [hasModerator, setHasModerator] = useState(false);
  const [moderatorName, setModeratorName] = useState<string | null>(null);
  const [showModeratorConfirm, setShowModeratorConfirm] = useState(false);
  const moderatorConfirmedRef = useRef(false);

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

  // One pick (smart-search result or AI suggestion) sets the two classification ids
  // this module exposes (Area of Focus + Category; there is no sub-category level here).
  const applyClassification = (r: ClassificationSearchResult) => {
    setSelectedAofId(String(r.areaOfFocusId));
    setSelectedCatId(r.categoryId ? String(r.categoryId) : "");
  };

  // Init: load project + masters and pre-fill
  useEffect(() => {
    async function init() {
      try {
        const [club, modules, funding, project] = await Promise.all([
          getClub(clubId),
          getModules(),
          getFunding(),
          getProject(clubId, yearId, projectId),
        ]);
        setClubName(club.clubName);
        const mod = modules.find((m) => m.moduleKey === MODULE_KEY);
        if (mod) {
          setModuleId(mod.id);
          const aof = await getAreasOfFocus(mod.id);
          setAreasOfFocus(aof.filter((a) => a.isActive));
        }
        setFundingList(funding.filter((f) => f.isActive));

        setProjectType(project.projectType as "" | "one_time" | "ongoing_repeat");
        if (project.projectType === "ongoing_repeat") {
          const isChild = project.parentProjectId != null && project.parentProjectId > 0;
          setOngoingSubType(isChild ? "existing" : "new");
          if (project.ongoingGroupTitle) setOngoingGroupTitle(project.ongoingGroupTitle);
          if (isChild) {
            setSelectedParentId(project.parentProjectId);
            if (project.ongoingGroupTitle) {
              setOngoingSearch(project.ongoingGroupTitle);
            } else {
              try {
                const parent = await getProject(clubId, yearId, project.parentProjectId!);
                setOngoingSearch(parent.ongoingGroupTitle || parent.title || "");
              } catch {
                setOngoingSearch("");
              }
            }
          }
        }
        setIsJointProject(project.isJointProject);
        setCoHostName(project.coHostName || "");
        setClubRole((project.clubRole || "") as "" | "lead" | "co_host");
        setTitle(project.title);
        setDescription(project.description || "");
        setLocation(project.location || "");

        if (project.areaOfFocusId) {
          setSelectedAofId(String(project.areaOfFocusId));
          const cats = await getCategories(project.areaOfFocusId);
          setCategories(cats.filter((c) => c.isActive));
          if (project.categoryId) {
            setSelectedCatId(String(project.categoryId));
          } else if (project.otherCategory) {
            setSelectedCatId("others");
          }
        } else if (project.otherAreaOfFocus) {
          setSelectedAofId("others");
        }
        setOtherAreaOfFocus(project.otherAreaOfFocus || "");
        setOtherCategory(project.otherCategory || "");

        setProjectDate(project.projectDate ? project.projectDate.split("T")[0] : "");
        setProjectCost(project.projectCost != null ? String(project.projectCost) : "");
        setCurrency(project.currency || defaultCurrency());
        if (project.fundingId) setSelectedFundingId(String(project.fundingId));
        setGlobalGrantNumber(project.globalGrantNumber || "");
        setAmountSanctioned(project.amountSanctioned != null ? String(project.amountSanctioned) : "");
        setAmountReceived(project.amountReceived != null ? String(project.amountReceived) : "");
        setAmountSpent(project.amountSpent != null ? String(project.amountSpent) : "");
        setHostClubsDistricts(project.hostClubsDistricts || "");
        setGlobalPartnerClubsDistricts(project.globalPartnerClubsDistricts || "");
        setCsrCompanyName(project.csrCompanyName || "");
        setManHours(project.manHours != null ? String(project.manHours) : "");
        setRotariansInvolved(project.rotariansInvolved != null ? String(project.rotariansInvolved) : "");
        setRotaractorsInvolved(project.rotaractorsInvolved != null ? String(project.rotaractorsInvolved) : "");
        setRccInvolved(project.rccInvolved != null ? String(project.rccInvolved) : "");
        setSendWhatsapp(project.sendWhatsapp);
        setSendEmail(project.sendEmail ?? false);

        setPhotos(project.photos.map((p) => ({
          id: String(p.id),
          imagePath: p.imagePath,
          description: p.description || "",
          isPrimary: p.isPrimary,
          uploading: false,
          previewUrl: `${API_URL}${p.imagePath}`,
        })));

        checkClubHasModerator(clubId).then((r) => { setHasModerator(r.hasModerator); setModeratorName(r.moderatorName); }).catch(() => {});

        setInitDone(true);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to load project.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, projectId, yearId]);

  // Fetch categories when area of focus changes (skip during init)
  useEffect(() => {
    if (!initDone) return;
    if (!selectedAofId || selectedAofId === "others") {
      setCategories([]);
      setSelectedCatId("");
      return;
    }
    async function fetchCats() {
      try {
        const cats = await getCategories(Number(selectedAofId));
        setCategories(cats.filter((c) => c.isActive));
      } catch { setCategories([]); }
    }
    fetchCats();
  }, [selectedAofId, initDone]);

  // Fetch ongoing projects for search — scoped to THIS year.
  useEffect(() => {
    if (projectType !== "ongoing_repeat" || ongoingSubType !== "existing" || !moduleId) return;
    async function fetchOngoing() {
      try {
        setOngoingProjects(await getOngoingProjects(clubId, moduleId!, ongoingSearch || undefined, yearId || undefined));
      } catch { setOngoingProjects([]); }
    }
    fetchOngoing();
  }, [projectType, ongoingSubType, moduleId, clubId, ongoingSearch, yearId]);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 5 - photos.length - photoCrop.pending;
    const toAdd = Array.from(files).slice(0, Math.max(0, remaining));

    const accepted: File[] = [];
    for (const file of toAdd) {
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
      const name = photoCrop.current?.name ?? "photo";
      const file = new File([blob], `project-photo-${Date.now()}.png`, { type: "image/png" });
      const id = Math.random().toString(36).substring(7);
      const previewUrl = URL.createObjectURL(blob);
      setPhotos((prev) => [...prev, {
        id, file, imagePath: "", description: "",
        isPrimary: prev.length === 0,
        uploading: true, previewUrl,
      }]);

      try {
        const result = await uploadProjectImage(clubId, file, projectId, yearId);
        setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, imagePath: result.path, uploading: false } : p));
      } catch (err: unknown) {
        setPhotos((prev) => prev.filter((p) => p.id !== id));
        const e = err as { message?: string; response?: { data?: { message?: string } } };
        setErrorMessage(`${name}: ${e?.message || e?.response?.data?.message || "Failed to upload photo."}`);
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
    if (!selectedAofId) { setErrorMessage("Category is required."); return; }
    if (isOthersAof && !otherAreaOfFocus.trim()) { setErrorMessage("Please specify the Category."); return; }
    if (!isOthersAof && categories.length > 0 && !selectedCatId) { setErrorMessage("Sub Category is required."); return; }
    if (isOthersCat && !otherCategory.trim()) { setErrorMessage("Please specify the Sub Category."); return; }
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
    if (photos.some((p) => p.uploading)) { setErrorMessage("Please wait for photos to finish uploading."); return; }

    if (hasModerator && !moderatorConfirmedRef.current) {
      setShowModeratorConfirm(true);
      return;
    }
    moderatorConfirmedRef.current = false;

    const photoInputs: ProjectPhotoInput[] = photos.map((p, i) => ({
      imagePath: p.imagePath,
      description: p.description || null,
      isPrimary: p.isPrimary,
      sortOrder: i,
    }));

    const saveData: Record<string, unknown> = {
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
      categoryId: isOthersCat ? null : (selectedCatId ? Number(selectedCatId) : null),
      otherCategory: isOthersCat ? otherCategory : null,
      subCategoryId: null,
      otherSubCategory: null,
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
      directBeneficiaries: null,
      manHours: manHours ? Number(manHours) : null,
      rotariansInvolved: rotariansInvolved ? Number(rotariansInvolved) : null,
      rotaractorsInvolved: rotaractorsInvolved ? Number(rotaractorsInvolved) : null,
      rccInvolved: rccInvolved ? Number(rccInvolved) : null,
      sendWhatsapp,
      sendEmail,
      photos: photoInputs,
    };

    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const moveInfo = await updateProject(clubId, yearId, projectId, saveData as any);
      if (moveInfo) {
        if (window.confirm(moveInfo.message)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const moved = await moveProject(clubId, moveInfo.fromYearId, projectId, saveData as any);
          window.alert(`Project moved to ${moved.newYearLabel}.`);
          // Honor ?returnTo= if the user arrived from the dashboard or
          // another caller — falls back to the v2 listing otherwise.
          router.push(returnTo || `/clubs/${clubId}/public-image-initiative/v2`);
        }
        setSaving(false);
        return;
      }
      setSuccessMessage("Project updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update project.");
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
        pageTitle="Edit Public Image Initiative"
        pageSubtitle="Update public image initiative details"
        activeNavHref="/club-admin-dashboard/service-projects-and-public-image"
      >
      <V2FormShell
        title="Edit Public Image Initiative"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/public-image-initiative/v2`}
        saving={saving}
        saveLabel="Update Project"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Project Type (locked on edit, matching v1) */}
        <SectionCard number={1} icon={FileText} title="Project Type" dot="bg-blue-600" locked>
          <FieldLabel dot="bg-blue-500">Select Project Type</FieldLabel>
          <div className="flex flex-wrap gap-2 mt-1">
            <RadioPill disabled checked={projectType === "one_time"} onChange={() => {}} label="One Time Project" />
            <RadioPill disabled checked={projectType === "ongoing_repeat"} onChange={() => {}} label="Ongoing / Repeat Project" />
          </div>

          {projectType === "ongoing_repeat" && (
            <div className="space-y-4 mt-4 pl-5 border-l-2 border-blue-200 ml-2">
              <div>
                <FieldLabel dot="bg-blue-500">Ongoing/Repeat Type</FieldLabel>
                <div className="flex flex-wrap gap-2 mt-1">
                  <RadioPill disabled checked={ongoingSubType === "new"} onChange={() => {}} label="Create New" />
                  <RadioPill disabled checked={ongoingSubType === "existing"} onChange={() => {}} label="Select Existing" />
                </div>
              </div>

              {ongoingSubType === "new" && (
                <div>
                  <FieldLabel dot="bg-blue-500">Title of Ongoing/Repeat Project</FieldLabel>
                  <input
                    type="text"
                    value={ongoingGroupTitle}
                    onChange={(e) => setOngoingGroupTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              )}

              {ongoingSubType === "existing" && (
                <div>
                  <FieldLabel dot="bg-blue-500">Search Existing Project</FieldLabel>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={ongoingSearch}
                      onChange={(e) => { setOngoingSearch(e.target.value); setSelectedParentId(null); }}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                  </div>
                  {ongoingSearch && ongoingProjects.length > 0 && !selectedParentId && (
                    <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto shadow-sm mt-1">
                      {ongoingProjects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setSelectedParentId(p.id); setOngoingSearch(p.title); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0 border-slate-100"
                        >
                          {p.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedParentId && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg mt-1">
                      <div className="h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="text-sm text-emerald-700 font-medium">Selected: {ongoingSearch}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {(projectType === "one_time" || (projectType === "ongoing_repeat" && ongoingSubType)) && (
            <div className="mt-4 pt-4 border-t border-dashed border-slate-200">
              <FieldLabel dot="bg-blue-500">Is this a joint project with any other Rotary Club / Organisation?</FieldLabel>
              <div className="flex flex-wrap gap-2 mt-1">
                <RadioPill disabled checked={isJointProject === true} onChange={() => {}} label="Yes" />
                <RadioPill disabled checked={isJointProject === false} onChange={() => {}} label="No" />
              </div>

              {isJointProject === true && (
                <div className="mt-4 pl-5 border-l-2 border-blue-200 ml-2 space-y-3">
                  <div>
                    <FieldLabel dot="bg-blue-500">Name of Co-host Rotary Club / Partner Organisation</FieldLabel>
                    <input type="text" value={coHostName} onChange={(e) => setCoHostName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-blue-500">Your Club Role</FieldLabel>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <RadioPill disabled checked={clubRole === "lead"} onChange={() => {}} label="Lead Club" />
                      <RadioPill disabled checked={clubRole === "co_host"} onChange={() => {}} label="Co-Host Club" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* 2. Project Details */}
        <SectionCard number={2} icon={MapPin} title="Project Details" dot="bg-violet-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 50 chars)" dot="bg-violet-500">Title</FieldLabel>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Project title"
                maxLength={50}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 1000 chars)" dot="bg-violet-500">Description</FieldLabel>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the project, its objectives, and impact…"
                rows={4}
                maxLength={1000}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
            </div>
            <div>
              <FieldLabel dot="bg-violet-500">Location of Project</FieldLabel>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-violet-500">Date of Project</FieldLabel>
              <DateField value={projectDate} onChange={setProjectDate} max={frozenMonth ? frozenDateMax : todayStr} min={frozenMonth ? frozenDateMin : undefined} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
          </div>
        </SectionCard>

        {/* 3. Classification */}
        <SectionCard number={3} icon={Target} title="Category" dot="bg-amber-600">
          <ClassificationAssist
            clubId={clubId}
            moduleId={moduleId}
            moduleKey={MODULE_KEY}
            title={title}
            description={description}
            onApply={applyClassification}
            selectedSubCatId={selectedCatId}
            enableCrossModule={false}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel dot="bg-amber-500">Category</FieldLabel>
              <select
                value={selectedAofId}
                onChange={(e) => { setSelectedAofId(e.target.value); setSelectedCatId(""); }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                  placeholder="Specify category"
                  className="w-full mt-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              )}
            </div>
            <div>
              <FieldLabel dot="bg-amber-500" required={categories.length > 0}>Sub Category</FieldLabel>
              <select
                value={selectedCatId}
                onChange={(e) => setSelectedCatId(e.target.value)}
                disabled={isOthersAof || categories.length === 0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{isOthersAof ? "N/A" : "Select"}</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
                {!categories.some((c) => (c.name || "").trim().toLowerCase() === "others") && (
                  <option value="others">Others</option>
                )}
              </select>
              {isOthersCat && (
                <input
                  type="text"
                  value={otherCategory}
                  onChange={(e) => setOtherCategory(e.target.value)}
                  placeholder="Specify sub category"
                  className="w-full mt-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              )}
            </div>
          </div>
        </SectionCard>

        {/* 4. Financial & Impact */}
        <SectionCard number={4} icon={moneyIcon(currency)} title="Financial & Impact" dot="bg-emerald-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <FieldLabel dot="bg-emerald-500">Currency</FieldLabel>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {currencyOptions().map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500">Project Cost ({getCurrencySymbol(currency)})</FieldLabel>
              <input
                type="number"
                value={projectCost}
                onChange={(e) => setProjectCost(e.target.value)}
                placeholder="0"
                min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500">Funding</FieldLabel>
              <select
                value={selectedFundingId}
                onChange={(e) => handleFundingChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Select</option>
                {fundingList.map((f) => (
                  <option key={f.id} value={String(f.id)}>{f.name}</option>
                ))}
              </select>
            </div>

            {showGlobalGrantBlock && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border-l-4 border-emerald-500 bg-emerald-50/40 rounded-md p-4">
                <h4 className="text-sm font-semibold text-emerald-700">Global Grant Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <FieldLabel dot="bg-emerald-500" required={false}>Global Grant Number</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={globalGrantNumber}
                      onChange={(e) => setGlobalGrantNumber(onlyDigits(e.target.value))} placeholder="e.g., 2434521"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-emerald-500" required={false}>Amount Sanctioned ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-emerald-500" required={false}>Amount Received ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-emerald-500" required={false}>Amount spent till date ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountSpent}
                      onChange={(e) => setAmountSpent(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-emerald-500">Host Clubs/Districts</FieldLabel>
                    <input type="text" value={hostClubsDistricts}
                      onChange={(e) => setHostClubsDistricts(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-emerald-500">Global Partner Clubs/Districts</FieldLabel>
                    <input type="text" value={globalPartnerClubsDistricts}
                      onChange={(e) => setGlobalPartnerClubsDistricts(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                </div>
              </div>
            )}

            {showCsrBlock && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border-l-4 border-emerald-500 bg-emerald-50/40 rounded-md p-4">
                <h4 className="text-sm font-semibold text-emerald-700">CSR Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-emerald-500">Name of the CSR Company</FieldLabel>
                    <input type="text" value={csrCompanyName}
                      onChange={(e) => setCsrCompanyName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-emerald-500">Amount Sanctioned ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <FieldLabel dot="bg-emerald-500">Amount Received ({getCurrencySymbol(currency)})</FieldLabel>
                    <input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                </div>
              </div>
            )}

            <div>
              <FieldLabel hint="(Rotarians x Hours)" dot="bg-emerald-500">Man Hours</FieldLabel>
              <input type="number" value={manHours} onChange={(e) => setManHours(e.target.value)} placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500">Rotarians Involved</FieldLabel>
              <input type="number" value={rotariansInvolved} onChange={(e) => setRotariansInvolved(e.target.value)} placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500" required={false}>Rotaractors Involved</FieldLabel>
              <input type="number" value={rotaractorsInvolved} onChange={(e) => setRotaractorsInvolved(e.target.value)} placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500" required={false}>RCC Involved</FieldLabel>
              <input type="number" value={rccInvolved} onChange={(e) => setRccInvolved(e.target.value)} placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group rounded-lg overflow-hidden border border-slate-200">
                  <div className="aspect-square">
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
                  <textarea
                    value={photo.description}
                    onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(photo.id, e.target.value); }}
                    placeholder="Photo description (max 500 chars)"
                    rows={2}
                    maxLength={500}
                    className="w-full px-2 py-1.5 text-xs border-t border-slate-200 resize-none focus:outline-none"
                  />
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-lg aspect-square flex flex-col items-center justify-center gap-1 text-slate-500 hover:border-rose-300 hover:text-rose-700"
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">Add Photo</span>
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" multiple onChange={handlePhotoSelect} />
            <p className="text-xs text-slate-400">JPG, JPEG, PNG, GIF, WEBP &middot; max 10 MB</p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sendWhatsapp}
                onChange={(e) => setSendWhatsapp(e.target.checked)}
                className="accent-blue-600 h-4 w-4"
              />
              <span className="text-sm font-medium text-slate-700">Send WhatsApp notification</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="accent-blue-600 h-4 w-4"
              />
              <span className="text-sm font-medium text-slate-700">Send Email notification</span>
            </label>
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
          </div>
        </SectionCard>

        {/* Ongoing info dialog */}
        <AlertModal
          open={showOngoingInfo}
          onOpenChange={(o) => !o && setShowOngoingInfo(false)}
          icon={Info}
          iconClassName="text-blue-500"
          title="Ongoing / Repeat Projects"
          description={
            <div className="whitespace-pre-line text-sm text-muted-foreground">
              {ONGOING_INFO}
            </div>
          }
          confirmLabel="Close"
          onConfirm={() => setShowOngoingInfo(false)}
          cancelLabel=""
          onCancel={() => setShowOngoingInfo(false)}
        />

        {/* Moderator confirm dialog */}
        <AlertModal
          open={showModeratorConfirm}
          onOpenChange={(o) => !o && setShowModeratorConfirm(false)}
          icon={Info}
          iconClassName="text-blue-500"
          title="Project Approval Required"
          description={
            <>
              <p>This club has a moderator <strong>{moderatorName}</strong> assigned. Your updated project will be re-submitted for approval.</p>
              <p className="mt-2">Do you want to continue?</p>
            </>
          }
          confirmLabel="Submit for Approval"
          onConfirm={() => { moderatorConfirmedRef.current = true; setShowModeratorConfirm(false); handleSave(); }}
          cancelLabel="Cancel"
          onCancel={() => setShowModeratorConfirm(false)}
        />

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Project updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
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
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
