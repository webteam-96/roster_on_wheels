"use client";

/**
 * New Generation Service v2 — Add Project.
 *
 * Same data semantics as the v1 add page: every field, every API call, every
 * validation rule is preserved verbatim. Only the visual presentation differs
 * (V2FormShell wrapper, dot-accented section headers, sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
  Upload, X, Star, Info, Camera, MapPin, Target, IndianRupee, Users,
} from "lucide-react";
import ClassificationAssist from "@/components/projects/ClassificationAssist";
import { consumeProjectSwitchDraft } from "@/lib/projectDraft";
import {
  getClub,
  getModules,
  getAreasOfFocus,
  getCategories,
  getFunding,
  createProject,
  uploadProjectImage,
  checkClubHasModerator,
  type ClassificationSearchResult,
} from "@/services/api";
import { AreaOfFocus, Category, Funding, ProjectPhotoInput } from "@/types/project";
import { CURRENCY_OPTIONS, getCurrencySymbol, resolveClubDefaultCurrency } from "@/lib/currency";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import WhatsAppRecipientBadge from "@/components/WhatsAppRecipientBadge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import AddToOrgConfirmDialog from "@/components/AddToOrgConfirmDialog";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, triggerAddToOrg, fileToDataUrl, type OrgExport, type FundingClass } from "@/lib/addToOrg";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";

// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

// Test-club gate: BOT (RI Flow-Bot) UI shows only for club 2765. Hardcoded for
// now so it's a one-line grep when expanding to more clubs.
// API origin for building full photo URLs handed to the Add-to-Org extension.
const ADD_TO_ORG_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const TOP_MESSAGE = "Please post all the New Generation services executed by your club. The content posted here will be displayed in District website, Club Monthly Report & Rotary Zones 4, 5, 6, 7 & 8 integrated Club website.";

const AGREE_MESSAGE = `The data I will enter is for a New generation Service Project conducted by my club that has benefitted my community. E.g., Formation of an Interact Club, Formation of a Rotaract Club, etc.

Please Note: The content posted here will be displayed on the Rotary Zones 4, 5, 6, 7 & 8 Website, District Website, Club Monthly Report & Rotary Zones 4, 5, 6, 7 & 8 Integrated Club Website`;

// Locked module key for this v2 avenue.
const MODULE_KEY = "new_generation_service";

type PhotoItem = {
  id: string;
  file?: File;
  imagePath: string;
  description: string;
  isPrimary: boolean;
  uploading: boolean;
  previewUrl?: string;
};

function FieldLabel({
  children, hint, dot, required = true,
}: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
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
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function NewGenerationServiceV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const { navigateAfterSave, navigateAfterCancel } = useV2ReturnTo(`/clubs/${clubId}/new-generation-service/v2`);

  // Page-load "I Agree" gate (parity with v1 listing-page dialog before navigating to Add).
  const [agreementOpen, setAgreementOpen] = useState(false); // gate now lives on the listing page (before navigation)
  const handleAgree = () => setAgreementOpen(false);
  const handleAgreeCancel = () => navigateAfterCancel();

  // Frozen-month support: when arriving from a Club Monthly Report `add` link
  // we clamp the date picker to that month (parity with v1 add page) so the
  // user cannot pick a date outside the report's frozen month — preserving
  // the monthly-report-to-projects integration that v2 had dropped.
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

  const [clubName, setClubName] = useState("");
  const [moduleId, setModuleId] = useState<number | null>(null);
  // Classification is locked until "Auto-Suggest Classification" is pressed (which also fires the AI).
  const [classUnlocked, setClassUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Masters — Area of Focus renamed to "Category", Category renamed to "Sub Category"
  const [areasOfFocus, setAreasOfFocus] = useState<AreaOfFocus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fundingList, setFundingList] = useState<Funding[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  const [selectedAofId, setSelectedAofId] = useState<string>("");
  const [otherAreaOfFocus, setOtherAreaOfFocus] = useState("");
  const [selectedCatId, setSelectedCatId] = useState<string>("");
  const [otherCategory, setOtherCategory] = useState("");

  const [projectDate, setProjectDate] = useState("");
  const [projectCost, setProjectCost] = useState("");
  const [currency, setCurrency] = useState("INR");
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

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const photoCrop = useImageCropQueue();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [showProjectSuccess, setShowProjectSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Moderator approval
  const [hasModerator, setHasModerator] = useState(false);
  const [moderatorName, setModeratorName] = useState<string | null>(null);
  const [showModeratorConfirm, setShowModeratorConfirm] = useState(false);
  const moderatorConfirmedRef = useRef(false);

  // RI Flow-Bot extension state (enabled for all clubs).
  // installed: null = checking, true = ready, false = not installed.
  const installed = useExtensionStatus();
  const isBotEnabled = isFlowBotEnabled(clubId);
  // Install prompt (extension NOT detected) — shown once on load, dismissible.
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const installDismissedRef = useRef(false);
  // Post-save "Add To Rotary Org" prompt (extension detected + moderator flow).
  const [showAddToOrgPrompt, setShowAddToOrgPrompt] = useState(false);
  const savedProjectIdRef = useRef<number | null>(null);

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

  // "Add To Rotary Org" (post-save dialog): close synchronously, then hand the
  // saved project to the extension. The deferred trigger guarantees the dialog is
  // unmounted (body pointer-events restored) before the extension's in-page UI shows.
  const handleAddToOrgConfirm = async () => {
    setShowAddToOrgPrompt(false);
    const payload = await buildOrgExport();
    const id = savedProjectIdRef.current;
    setTimeout(() => triggerAddToOrg(id, payload, clubId), 0);
  };
  // "Cancel" (post-save dialog): project is already saved → go to the club's
  // Service Projects & Public Image dashboard.
  const handleAddToOrgCancel = () => {
    setShowAddToOrgPrompt(false);
    router.push("/club-admin-dashboard/service-projects-and-public-image");
  };

  // ── Funding classifier — drives conditional Global Grant / CSR field block ──
  const classifyFunding = (name?: string | null): "global_grant" | "csr" | "" => {
    if (!name) return "";
    const n = name.trim().toLowerCase();
    if (n.includes("global grant")) return "global_grant";
    if (n === "csr" || n.startsWith("csr ") || n.includes(" csr") || n.includes("(csr)")) return "csr";
    return "";
  };
  // 5-way funding class for the Add-to-Org extension export (broader than
  // classifyFunding above, which only drives the conditional UI). Mirrors the
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
          getClub(clubId), getModules(), getFunding(),
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
        checkClubHasModerator(clubId).then((r) => {
          setHasModerator(r.hasModerator);
          setModeratorName(r.moderatorName);
        }).catch(() => {});
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
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
        setCategories(cats.filter((c) => c.isActive));
      } catch { setCategories([]); }
    }
    fetchCats();
  }, [selectedAofId]);

  // One pick (smart-search result or AI suggestion) sets both classification ids. This avenue is
  // 2-level (Category → Sub Category, mapped to areaOfFocusId → categoryId); there is no third level.
  const applyClassification = (r: ClassificationSearchResult) => {
    setSelectedAofId(String(r.areaOfFocusId));
    setSelectedCatId(r.categoryId ? String(r.categoryId) : "");
  };

  // Carry-over draft for a cross-module "switch": everything this form has filled so far. The target
  // module's Add page reads the keys it recognises and preselects the AI-suggested classification.
  const buildSwitchDraft = (): Record<string, unknown> => ({
    title, description, location, projectDate, projectCost, selectedFundingId,
    directBeneficiaries, manHours, rotariansInvolved, rotaractorsInvolved,
    globalGrantNumber, amountSanctioned, amountReceived, amountSpent,
    hostClubsDistricts, globalPartnerClubsDistricts, csrCompanyName, sendWhatsapp, sendEmail,
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
    if (f.globalGrantNumber != null) setGlobalGrantNumber(str("globalGrantNumber"));
    if (f.amountSanctioned != null) setAmountSanctioned(str("amountSanctioned"));
    if (f.amountReceived != null) setAmountReceived(str("amountReceived"));
    if (f.amountSpent != null) setAmountSpent(str("amountSpent"));
    if (f.hostClubsDistricts != null) setHostClubsDistricts(str("hostClubsDistricts"));
    if (f.globalPartnerClubsDistricts != null) setGlobalPartnerClubsDistricts(str("globalPartnerClubsDistricts"));
    if (f.csrCompanyName != null) setCsrCompanyName(str("csrCompanyName"));
    if (typeof f.sendWhatsapp === "boolean") setSendWhatsapp(f.sendWhatsapp);
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
    setSelectedCatId(draft.suggested.categoryId ? String(draft.suggested.categoryId) : "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 5 - photos.length - photoCrop.pending;
    const toAdd = Array.from(files).slice(0, Math.max(0, remaining));

    const accepted = toAdd;
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

  const validate = (): string | null => {
    if (!title.trim()) return "Title is required.";
    if (title.trim().length > 50) return "Title must be 50 characters or less.";
    if (!description.trim()) return "Description is required.";
    if (description.trim().length > 1000) return "Description must be 1000 characters or less.";
    if (!location.trim()) return "Location is required.";
    if (!selectedAofId) return "Category is required.";
    if (isOthersAof && !otherAreaOfFocus.trim()) return "Please specify the Category.";
    if (!isOthersAof && categories.length > 0 && !selectedCatId) return "Sub Category is required.";
    if (isOthersCat && !otherCategory.trim()) return "Please specify the Sub Category.";
    if (!projectDate) return "Date is required.";
    if (new Date(projectDate) > new Date()) return "Date cannot be in the future.";
    if (!projectCost) return "Project Cost is required.";
    if (!selectedFundingId) return "Funding is required.";
    if (showGlobalGrantBlock) {
      if (!hostClubsDistricts.trim()) return "Host Clubs/Districts is required for Global Grant.";
      if (!globalPartnerClubsDistricts.trim()) return "Global Partner Clubs/Districts is required for Global Grant.";
    }
    if (showCsrBlock) {
      if (!csrCompanyName.trim()) return "Name of the CSR Company is required for CSR.";
      if (!amountSanctioned) return "Amount Sanctioned is required for CSR.";
      if (!amountReceived) return "Amount Received is required for CSR.";
    }
    if (!directBeneficiaries) return "Direct Beneficiaries is required.";
    if (!manHours) return "Man Hours is required.";
    if (!rotariansInvolved) return "Rotarians Involved is required.";
    if (!rotaractorsInvolved) return "Rotaractors Involved is required.";
    if (photos.length === 0) return "At least 1 photo is required.";
    if (photos.some((p) => p.uploading)) return "Please wait for photos to finish uploading.";
    if (!moduleId) return "Module not found.";
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setErrorMessage(err); return; }

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
      sendWhatsapp,
      sendEmail,
      photos: photoInputs,
    };

    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await createProject(clubId, saveData as any);
      // RI Flow-Bot: after a moderator-approval save on the test club, offer to
      // also add the project to Rotary Org — but ONLY when the extension is present
      // (non-moderator clubs just save; the prompt never appears for them).
      if (isBotEnabled && hasModerator && installed === true) {
        savedProjectIdRef.current = result?.id ?? null;
        setShowAddToOrgPrompt(true);
      } else {
        // Return to the page the user came from immediately on save/submit-for-approval
        // (no blocking success modal).
        navigateAfterSave();
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to create project.");
    } finally {
      setSaving(false);
    }
  };

  // Build the project export the Add-to-Org extension consumes (resolved names +
  // full photo URLs). This avenue has a 2-level classification (Category →
  // Sub Category, mapped to areaOfFocusId → categoryId); there is no third level.
  const buildOrgExport = async (): Promise<OrgExport> => ({
    title: title.trim(),
    description: description.trim(),
    meta: { avenue: "New Generation Service" },
    classification: {
      areaOfFocus: isOthersAof
        ? otherAreaOfFocus
        : (areasOfFocus.find((a) => String(a.id) === selectedAofId)?.name || ""),
      category: isOthersCat
        ? otherCategory
        : (categories.find((c) => String(c.id) === selectedCatId)?.name || ""),
      subCategory: "",
    },
    locationText: location.trim(),
    dateOfProject: projectDate,
    projectType: "One Time Project",
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
    photos: await Promise.all(photos.map(async (p) => ({
      // Embed the in-memory file bytes as a data: URL. The stored imagePath points at
      // /tempdocument/, which the backend MOVES on save (→ 404), so a URL here is stale.
      url: p.file ? await fileToDataUrl(p.file) : `${ADD_TO_ORG_API_URL}${p.imagePath}`,
      isPrimary: p.isPrimary,
      caption: p.description || "",
    }))),
  });

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
        pageTitle="Add New Generation Service Project"
        pageSubtitle="Create a new new-generation service initiative"
        activeNavHref="/club-admin-dashboard/service-projects-and-public-image"
      >
      <V2FormShell
        title="Add New Generation Service Project"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/new-generation-service/v2`}
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
        {/* 1. Project Details */}
        <SectionCard number={1} icon={MapPin} title="Project Details" dot="bg-blue-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 50 chars)" dot="bg-blue-500">Title</FieldLabel>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Project title"
                maxLength={50}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 1000 chars)" dot="bg-blue-500">Description</FieldLabel>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the project, its objectives, and impact…"
                rows={4}
                maxLength={1000}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
            </div>
            <div>
              <FieldLabel dot="bg-blue-500">Location of Project</FieldLabel>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, Venue, etc."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-blue-500">Date of Project</FieldLabel>
              <DateField value={projectDate} onChange={setProjectDate} max={frozenMonth ? frozenDateMax : todayStr} min={frozenMonth ? frozenDateMin : undefined} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </SectionCard>

        {/* 2. Classification */}
        <SectionCard number={2} icon={Target} title="Category" dot="bg-violet-600">
          <ClassificationAssist
            clubId={clubId}
            moduleId={moduleId}
            moduleKey={MODULE_KEY}
            title={title}
            description={description}
            onApply={applyClassification}
            selectedSubCatId={selectedCatId}
            enableCrossModule
            buildSwitchDraft={buildSwitchDraft}
            unlocked={classUnlocked}
            onUnlock={() => setClassUnlocked(true)}
          />
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${classUnlocked ? "" : "opacity-50 pointer-events-none select-none"}`}>
            <div>
              <FieldLabel dot="bg-violet-500">Category</FieldLabel>
              <select
                value={selectedAofId}
                onChange={(e) => { setSelectedAofId(e.target.value); setSelectedCatId(""); }}
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
                  placeholder="Specify category"
                  className="w-full mt-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              )}
            </div>
            <div>
              {categories.length > 0 ? (
                <FieldLabel dot="bg-violet-500">Sub Category</FieldLabel>
              ) : (
                <FieldLabel dot="bg-violet-500" required={false}>Sub Category</FieldLabel>
              )}
              <select
                value={selectedCatId}
                onChange={(e) => setSelectedCatId(e.target.value)}
                disabled={isOthersAof || categories.length === 0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{isOthersAof ? "N/A" : "Select"}</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
                {categories.length > 0 && !categories.some((c) => (c.name || "").trim().toLowerCase() === "others") && (
                  <option value="others">Others</option>
                )}
              </select>
              {isOthersCat && (
                <input
                  type="text"
                  value={otherCategory}
                  onChange={(e) => setOtherCategory(e.target.value)}
                  placeholder="Specify sub category"
                  className="w-full mt-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              )}
            </div>
          </div>
        </SectionCard>

        {/* 3. Financial & Impact */}
        <SectionCard number={3} icon={IndianRupee} title="Financial & Impact" dot="bg-amber-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <FieldLabel dot="bg-amber-500">Currency</FieldLabel>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {CURRENCY_OPTIONS.map((c) => (
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
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border-l-4 border-amber-500 bg-amber-50/40 rounded-md p-4 mt-1">
                <h4 className="text-sm font-semibold text-amber-700">Global Grant Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel dot="bg-amber-500" required={false}>Global Grant Number</FieldLabel>
                    <input
                      inputMode="numeric" pattern="[0-9]*" value={globalGrantNumber}
                      onChange={(e) => setGlobalGrantNumber(onlyDigits(e.target.value))}
                      placeholder="e.g., 2434521"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500" required={false}>Amount Sanctioned ({getCurrencySymbol(currency)})</FieldLabel>
                    <input
                      inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500" required={false}>Amount Received ({getCurrencySymbol(currency)})</FieldLabel>
                    <input
                      inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500" required={false}>Amount spent till date ({getCurrencySymbol(currency)})</FieldLabel>
                    <input
                      inputMode="numeric" pattern="[0-9]*" value={amountSpent}
                      onChange={(e) => setAmountSpent(onlyDigits(e.target.value))}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-amber-500">Host Clubs/Districts</FieldLabel>
                    <input
                      type="text" value={hostClubsDistricts}
                      onChange={(e) => setHostClubsDistricts(e.target.value)}
                      placeholder="e.g., RC Pune, RC Mumbai"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-amber-500">Global Partner Clubs/Districts</FieldLabel>
                    <input
                      type="text" value={globalPartnerClubsDistricts}
                      onChange={(e) => setGlobalPartnerClubsDistricts(e.target.value)}
                      placeholder="e.g., RC Tokyo"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Funding-conditional: CSR fields */}
            {showCsrBlock && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-3 border-l-4 border-amber-500 bg-amber-50/40 rounded-md p-4 mt-1">
                <h4 className="text-sm font-semibold text-amber-700">CSR Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <FieldLabel dot="bg-amber-500">Name of the CSR Company</FieldLabel>
                    <input
                      type="text" value={csrCompanyName}
                      onChange={(e) => setCsrCompanyName(e.target.value)}
                      placeholder="e.g., ABC Industries Pvt Ltd"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500">Amount Sanctioned ({getCurrencySymbol(currency)})</FieldLabel>
                    <input
                      inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-amber-500">Amount Received ({getCurrencySymbol(currency)})</FieldLabel>
                    <input
                      inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <FieldLabel dot="bg-emerald-500">Direct Beneficiaries</FieldLabel>
              <input
                type="number" value={directBeneficiaries}
                onChange={(e) => setDirectBeneficiaries(e.target.value)}
                placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <FieldLabel hint="(Rotarians x Hours)" dot="bg-emerald-500">Man Hours</FieldLabel>
              <input
                type="number" value={manHours}
                onChange={(e) => setManHours(e.target.value)}
                placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500">Rotarians Involved</FieldLabel>
              <input
                type="number" value={rotariansInvolved}
                onChange={(e) => setRotariansInvolved(e.target.value)}
                placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500" required={false}>Rotaractors Involved</FieldLabel>
              <input
                type="number" value={rotaractorsInvolved}
                onChange={(e) => setRotaractorsInvolved(e.target.value)}
                placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500" required={false}>RCC Involved</FieldLabel>
              <input
                type="number" value={rccInvolved}
                onChange={(e) => setRccInvolved(e.target.value)}
                placeholder="0" min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </SectionCard>

        {/* 4. Photos */}
        <SectionCard number={4} icon={Camera} title="Photos" dot="bg-rose-600">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <FieldLabel dot="bg-rose-500">Upload Photos (1 mandatory, max 5)</FieldLabel>
              <span className="text-xs text-slate-500">{photos.length}/5</span>
            </div>
            {photos.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {photos.map((photo) => (
                  <div key={photo.id} className="relative group rounded-xl border border-slate-200 overflow-hidden bg-slate-50/50">
                    <div className="relative aspect-video">
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
                        <button
                          type="button" onClick={() => setPrimaryPhoto(photo.id)}
                          className={`p-1 rounded-full ${photo.isPrimary ? "bg-amber-400 text-amber-900" : "bg-black/50 text-white hover:bg-amber-400 hover:text-amber-900"}`}
                          aria-label="Set primary"
                        >
                          <Star className="h-3 w-3" />
                        </button>
                        <button
                          type="button" onClick={() => removePhoto(photo.id)}
                          className="p-1 rounded-full bg-black/50 text-white hover:bg-rose-500"
                          aria-label="Remove photo"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      {photo.isPrimary && (
                        <div className="absolute bottom-0 left-0 right-0 bg-amber-400/90 text-amber-900 text-[10px] font-bold text-center py-0.5">PRIMARY</div>
                      )}
                    </div>
                    <div className="p-2 space-y-1">
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
              </div>
            )}
            {photos.length < 5 && (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 rounded-lg py-6 flex flex-col items-center justify-center gap-1 text-slate-500 hover:border-rose-300 hover:text-rose-700"
              >
                <Upload className="h-5 w-5" />
                <span className="text-xs font-medium">Add Photo</span>
              </button>
            )}
            <input ref={photoInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" multiple onChange={handlePhotoSelect} />
            <p className="text-xs text-slate-400">JPG, JPEG, PNG, GIF, WEBP · up to 5 MB · auto-compressed if larger</p>
          </div>
        </SectionCard>

        {/* 5. WhatsApp */}
        <SectionCard number={5} icon={Users} title="Notify Members" dot="bg-emerald-600">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sendWhatsapp}
              onChange={(e) => setSendWhatsapp(e.target.checked)}
              className="accent-emerald-600 h-4 w-4"
            />
            <span className="text-sm font-medium text-slate-700">Send WhatsApp notification</span>
            {sendWhatsapp && <WhatsAppRecipientBadge scope="club" clubId={clubId} />}
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer select-none mt-2">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="accent-emerald-600 h-4 w-4"
            />
            <span className="text-sm font-medium text-slate-700">Send Email notification</span>
            {sendEmail && <WhatsAppRecipientBadge scope="club" clubId={clubId} channel="email" />}
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
        </SectionCard>

        {/* Project Success Dialog */}
        <Dialog open={showProjectSuccess} onOpenChange={() => {}}>
          <DialogContent className="max-w-lg [&>button.absolute]:hidden" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Project Saved Successfully</DialogTitle>
              <DialogDescription className="sr-only">Project save confirmation</DialogDescription>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-3 py-2">
              <p className="font-medium text-foreground">Dear Club Leader,</p>
              <p>You have successfully added a project in Rotary Zones 4, 5, 6, 7 &amp; 8. You can check after 10 minutes.</p>
              <p>Thank you,<br /><span className="font-medium text-foreground">Team Rotary Zones 4, 5, 6, 7 &amp; 8</span></p>
            </div>
            <Button className="w-full" onClick={() => { setShowProjectSuccess(false); navigateAfterSave(); }}>OK</Button>
          </DialogContent>
        </Dialog>

        {/* Moderator Approval Confirmation */}
        <Dialog open={showModeratorConfirm} onOpenChange={setShowModeratorConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Project Approval Required</DialogTitle>
              <DialogDescription className="sr-only">Moderator approval confirmation</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This club has a moderator <strong>{moderatorName}</strong> assigned. Your project will be submitted for approval and will be visible only after the moderator approves it.
              </p>
              <p className="text-sm text-muted-foreground">Do you want to continue?</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowModeratorConfirm(false)}>Cancel</Button>
              <Button onClick={() => { moderatorConfirmedRef.current = true; setShowModeratorConfirm(false); handleSave(); }}>
                Submit for Approval
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* RI Flow-Bot (test club only): install prompt + post-save "Add To Rotary Org" */}
        {isBotEnabled && (
          <>
            <AddToOrgConfirmDialog open={showAddToOrgPrompt} onCancel={handleAddToOrgCancel} onConfirm={handleAddToOrgConfirm} />
          </>
        )}

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
