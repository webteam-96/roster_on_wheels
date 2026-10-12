"use client";

/**
 * District Projects V2 — Edit Project.
 *
 * Same data semantics as v1 (src/app/districts/[id]/projects/[projectId]/edit/page.tsx):
 * every field, every API call, every validation rule preserved verbatim
 * (including the year-crossing move confirmation flow via moveDistrictProject
 * and the strict=false upload mode for legacy photos). Only the chrome
 * changes — wrapped in DistrictAdminShell + V2FormShell with the dot-accented
 * section cards used by every other v2 form.
 *
 * v2 reads ONLY `?returnTo=` for cancel + post-save navigation. Default
 * fallback = /districts/{districtId}/projects/v2.
 * `?yearId=` is still consumed (independent from returnTo) to identify which
 * year table the project lives in.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams } from "next/navigation";
import {
  Upload, X, FileText, Image as ImageIcon, Info, Users, IndianRupee, Landmark,
} from "lucide-react";
import {
  getDistrict,
  getDistrictProjectDetail,
  updateDistrictProject,
  moveDistrictProject,
  uploadDistrictProjectPhoto,
  getModules,
  getAreasOfFocus,
  getCategories,
  getSubCategories,
  getFunding,
} from "@/services/api";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictFoundationTabBar from "@/components/dashboard/DistrictFoundationTabBar";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const ENGLISH_ONLY_REGEX = /^[a-zA-Z0-9\s.,!?;:'"()\-&@#%+=/]*$/;

const TOP_MESSAGE =
  "Please post all the Projects executed by your District. The content posted here will be displayed on the District website.";

function FieldLabel({
  children, hint, dot, required = true,
}: {
  children: React.ReactNode; hint?: string; dot: string; required?: boolean;
}) {
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
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// Inline mirror of useSyncClubIdFromUrl for district scope.
function useSyncDistrictIdFromUrl(): void {
  const params = useParams();
  const rawId = params?.id;
  const urlDistrictId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedDistrictId, selectScope } = useAuth();

  useEffect(() => {
    if (
      Number.isFinite(urlDistrictId) &&
      urlDistrictId > 0 &&
      urlDistrictId !== selectedDistrictId
    ) {
      selectScope({ districtId: urlDistrictId });
    }
  }, [urlDistrictId, selectedDistrictId, selectScope]);
}

interface Lookup { id: number; name: string; isActive?: boolean; }

export default function DistrictProjectsV2EditPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const projectId = Number(params.projectId);
  const yearId = Number(searchParams.get("yearId")) || 0;
  const { navigateAfterSave } = useV2ReturnTo(`/districts/${districtId}/projects/v2`);

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

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

  const [areasOfFocus, setAreasOfFocus] = useState<Lookup[]>([]);
  const [categories, setCategories] = useState<Lookup[]>([]);
  const [subCategories, setSubCategories] = useState<Lookup[]>([]);
  const [fundings, setFundings] = useState<Lookup[]>([]);

  const [photos, setPhotos] = useState<{ path: string; preview: string; description: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [initLoaded, setInitLoaded] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getDistrict(districtId)
      .then((d) => setDistrictName(`District ${d.districtNumber}`))
      .catch(() => {});
  }, [districtId]);

  useEffect(() => {
    async function loadLookups() {
      try {
        const [modules, funding] = await Promise.all([getModules(), getFunding()]);
        setFundings(funding);
        const mod = modules.find((m: { moduleKey: string; id: number }) => m.moduleKey === "community_service");
        if (mod) {
          const aof = await getAreasOfFocus(mod.id);
          setAreasOfFocus(aof);
        }
      } catch {}
    }
    loadLookups();
  }, []);

  const isOthersAof =
    areaOfFocusId === "others" ||
    areasOfFocus.find((a) => String(a.id) === areaOfFocusId)?.name?.toLowerCase() === "others";
  const isOthersCat =
    categoryId === "others" ||
    categories.find((c) => String(c.id) === categoryId)?.name?.toLowerCase() === "others";
  const isOthersSubCat =
    subCategoryId === "others" ||
    subCategories.find((s) => String(s.id) === subCategoryId)?.name?.toLowerCase() === "others";

  useEffect(() => {
    if (!initLoaded && areaOfFocusId && areaOfFocusId !== "others") {
      getCategories(Number(areaOfFocusId)).then(setCategories).catch(() => {});
    }
    if (initLoaded && areaOfFocusId && areaOfFocusId !== "others") {
      getCategories(Number(areaOfFocusId)).then(setCategories).catch(() => {});
      setCategoryId("");
      setSubCategoryId("");
    }
    if (areaOfFocusId === "others") {
      setCategories([]);
      setCategoryId("");
      setSubCategoryId("");
    }
  }, [areaOfFocusId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!initLoaded && categoryId && categoryId !== "others") {
      getSubCategories(Number(categoryId)).then(setSubCategories).catch(() => {});
    }
    if (initLoaded && categoryId && categoryId !== "others") {
      getSubCategories(Number(categoryId)).then(setSubCategories).catch(() => {});
      setSubCategoryId("");
    }
    if (categoryId === "others") {
      setSubCategories([]);
      setSubCategoryId("");
    }
  }, [categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function load() {
      try {
        const res = await getDistrictProjectDetail(districtId, yearId, projectId);
        const p = res.project;
        setTitle(p.title || "");
        setDescription(p.description || "");
        setLocation(p.location || "");
        if (p.otherAreaOfFocus) { setAreaOfFocusId("others"); setOtherAreaOfFocus(p.otherAreaOfFocus); }
        else if (p.areaOfFocusId) setAreaOfFocusId(String(p.areaOfFocusId));
        if (p.otherCategory) { setCategoryId("others"); setOtherCategory(p.otherCategory); }
        else if (p.categoryId) setCategoryId(String(p.categoryId));
        if (p.otherSubCategory) { setSubCategoryId("others"); setOtherSubCategory(p.otherSubCategory); }
        else if (p.subCategoryId) setSubCategoryId(String(p.subCategoryId));
        // Slice the raw ISO string instead of round-tripping through Date/UTC.
        // In IST (UTC+5:30), `new Date("2026-07-01T00:00:00").toISOString()`
        // shifts to "2026-06-30T18:30:00Z" → split gives 30 Jun. Slicing the
        // first 10 chars of whatever the API returns ("YYYY-MM-DD…") preserves
        // the calendar date regardless of timezone.
        if (p.projectDate) setProjectDate(String(p.projectDate).slice(0, 10));
        if (p.projectCost) setProjectCost(String(p.projectCost));
        if (p.fundingId) setFundingId(String(p.fundingId));
        if (p.globalGrantNumber) setGlobalGrantNumber(String(p.globalGrantNumber));
        if (p.amountSanctioned != null) setAmountSanctioned(String(p.amountSanctioned));
        if (p.amountReceived != null) setAmountReceived(String(p.amountReceived));
        if (p.amountSpent != null) setAmountSpent(String(p.amountSpent));
        if (p.hostClubsDistricts) setHostClubsDistricts(p.hostClubsDistricts);
        if (p.globalPartnerClubsDistricts) setGlobalPartnerClubsDistricts(p.globalPartnerClubsDistricts);
        if (p.csrCompanyName) setCsrCompanyName(p.csrCompanyName);
        if (p.directBeneficiaries) setDirectBeneficiaries(String(p.directBeneficiaries));
        if (p.manHours) setManHours(String(p.manHours));
        if (p.rotariansInvolved) setRotariansInvolved(String(p.rotariansInvolved));
        if (p.rotaractorsInvolved) setRotaractorsInvolved(String(p.rotaractorsInvolved));
        if (p.rccInvolved) setRccInvolved(String(p.rccInvolved));
        if (res.photos) {
          setPhotos(
            res.photos.map((ph: { imagePath: string; description?: string | null }) => ({
              path: ph.imagePath,
              preview: `${API_URL}${ph.imagePath}`,
              description: ph.description || "",
            }))
          );
        }
        // Same pattern as v1: give the cascading lookup effects time to fire
        // with initLoaded=false before flipping the flag on.
        setTimeout(() => setInitLoaded(true), 500);
      } catch {
        setErrorMessage("Failed to load project.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [districtId, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setGlobalGrantNumber("");
    setAmountSanctioned("");
    setAmountReceived("");
    setAmountSpent("");
    setHostClubsDistricts("");
    setGlobalPartnerClubsDistricts("");
    setCsrCompanyName("");
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || photos.length >= 5) return;
    setUploading(true);
    try {
      // Edit mode: strict=false so existing/older photos remain editable
      // without 1200×800 enforcement.
      const res = await uploadDistrictProjectPhoto(districtId, file, false);
      setPhotos((prev) => [...prev, { path: res.path, preview: URL.createObjectURL(file), description: "" }]);
    } catch (err: unknown) {
      const e2 = err as { message?: string; response?: { data?: { message?: string } } };
      setErrorMessage(e2?.message || e2?.response?.data?.message || "Failed to upload photo.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const updatePhotoDescription = (idx: number, value: string) =>
    setPhotos((prev) => prev.map((p, i) => (i === idx ? { ...p, description: value } : p)));

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!ENGLISH_ONLY_REGEX.test(title)) { setErrorMessage("Title must be in English only."); return; }
    if (description && !ENGLISH_ONLY_REGEX.test(description)) { setErrorMessage("Description must be in English only."); return; }
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

    const saveData = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      areaOfFocusId: isOthersAof ? null : (Number(areaOfFocusId) || null),
      otherAreaOfFocus: isOthersAof ? otherAreaOfFocus.trim() : null,
      categoryId: isOthersCat ? null : (Number(categoryId) || null),
      otherCategory: isOthersCat ? otherCategory.trim() : null,
      subCategoryId: isOthersSubCat ? null : (subCategoryId ? Number(subCategoryId) : null),
      otherSubCategory: isOthersSubCat ? otherSubCategory.trim() : null,
      projectDate,
      projectCost: projectCost ? Number(projectCost) : null,
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
      photos: photos.map((p, i) => ({
        imagePath: p.path,
        description: p.description.trim() || null,
        isPrimary: i === 0,
        sortOrder: i,
      })),
    };

    setSaving(true);
    try {
      const moveInfo = await updateDistrictProject(districtId, yearId, projectId, saveData);
      if (moveInfo) {
        if (window.confirm(moveInfo.message)) {
          const moved = await moveDistrictProject(districtId, moveInfo.fromYearId, projectId, saveData);
          window.alert(`Project moved to ${moved.newYearLabel}.`);
          navigateAfterSave();
        }
        setSaving(false);
        return;
      }
      setSuccessMessage("Project updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Edit District Project"
          activeNavHref="/district-admin-dashboard/foundation"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="Edit District Project"
        activeNavHref="/district-admin-dashboard/foundation"
      >
        <div className="mb-4">
          <DistrictFoundationTabBar />
        </div>
        <V2FormShell
          title="Edit District Project"
          subtitle={districtName}
          defaultBack={`/districts/${districtId}/projects/v2`}
          saving={saving}
          saveLabel="Update Project"
          saveTone="bg-[#F7A81B] text-[#1e3a5f] hover:bg-[#e69a10]"
          onSave={handleSave}
          banner={
            <div className="flex items-start gap-2 text-blue-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{TOP_MESSAGE}</span>
            </div>
          }
        >
          {/* 1. Project Details */}
          <SectionCard number={1} icon={FileText} title="Project Details" dot="bg-blue-600">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel hint="(English only, max 50 chars)" dot="bg-blue-500">Title</FieldLabel>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={50}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel hint="(English only, max 1000 chars)" dot="bg-blue-500" required={false}>Description</FieldLabel>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-blue-500" required={false}>Location</FieldLabel>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-blue-500">Area of Focus</FieldLabel>
                <select
                  value={areaOfFocusId}
                  onChange={(e) => setAreaOfFocusId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select</option>
                  {areasOfFocus.map((a) => (
                    <option key={a.id} value={String(a.id)}>{a.name}</option>
                  ))}
                </select>
                {isOthersAof && (
                  <input
                    type="text"
                    value={otherAreaOfFocus}
                    onChange={(e) => setOtherAreaOfFocus(e.target.value)}
                    placeholder="Specify Area of Focus"
                    className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
              <div>
                <FieldLabel dot="bg-blue-500">Category</FieldLabel>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={isOthersAof || !areaOfFocusId}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">{isOthersAof ? "N/A" : "Select"}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
                {isOthersCat && (
                  <input
                    type="text"
                    value={otherCategory}
                    onChange={(e) => setOtherCategory(e.target.value)}
                    placeholder="Specify Category"
                    className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-blue-500" required={false}>Sub Category</FieldLabel>
                <select
                  value={subCategoryId}
                  onChange={(e) => setSubCategoryId(e.target.value)}
                  disabled={isOthersAof || isOthersCat || !categoryId}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">{isOthersAof || isOthersCat ? "N/A" : "Select"}</option>
                  {subCategories.map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  ))}
                  {!isOthersAof && !isOthersCat && <option value="others">Others</option>}
                </select>
                {isOthersSubCat && (
                  <input
                    type="text"
                    value={otherSubCategory}
                    onChange={(e) => setOtherSubCategory(e.target.value)}
                    placeholder="Specify Sub Category"
                    className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
              <div>
                <FieldLabel dot="bg-blue-500">Date</FieldLabel>
                <DateField value={projectDate} onChange={setProjectDate} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <FieldLabel dot="bg-blue-500" required={false}>Project Cost (₹)</FieldLabel>
                <input
                  type="number"
                  value={projectCost}
                  onChange={(e) => setProjectCost(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-blue-500" required={false}>Funding</FieldLabel>
                <select
                  value={fundingId}
                  onChange={(e) => handleFundingChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select</option>
                  {fundings
                    .filter((f) => f.isActive || String(f.id) === fundingId)
                    .map((f) => (
                      <option key={f.id} value={String(f.id)}>{f.name}</option>
                    ))}
                </select>
              </div>
            </div>
          </SectionCard>

          {/* 2. Funding-conditional: Global Grant */}
          {showGlobalGrantBlock && (
            <SectionCard number={2} icon={Landmark} title="Global Grant Details" dot="bg-violet-600">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel dot="bg-violet-500">Global Grant Number</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={globalGrantNumber}
                    onChange={(e) => setGlobalGrantNumber(onlyDigits(e.target.value))}
                    placeholder="e.g., 2434521"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-violet-500">Amount Sanctioned (₹)</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountSanctioned}
                    onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-violet-500">Amount Received (₹)</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-violet-500">Amount spent till date (₹)</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountSpent}
                    onChange={(e) => setAmountSpent(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel dot="bg-violet-500">Host Clubs/Districts</FieldLabel>
                  <input
                    type="text"
                    value={hostClubsDistricts}
                    onChange={(e) => setHostClubsDistricts(e.target.value)}
                    placeholder="e.g., RC Pune, RC Mumbai"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel dot="bg-violet-500">Global Partner Clubs/Districts</FieldLabel>
                  <input
                    type="text"
                    value={globalPartnerClubsDistricts}
                    onChange={(e) => setGlobalPartnerClubsDistricts(e.target.value)}
                    placeholder="e.g., RC Tokyo"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {/* 2. Funding-conditional: CSR */}
          {showCsrBlock && (
            <SectionCard number={2} icon={IndianRupee} title="CSR Details" dot="bg-amber-600">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <FieldLabel dot="bg-amber-500">Name of the CSR Company</FieldLabel>
                  <input
                    type="text"
                    value={csrCompanyName}
                    onChange={(e) => setCsrCompanyName(e.target.value)}
                    placeholder="e.g., ABC Industries Pvt Ltd"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-amber-500">Amount Sanctioned (₹)</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountSanctioned}
                    onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-amber-500">Amount Received (₹)</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {/* 3. Impact */}
          <SectionCard
            number={showGlobalGrantBlock || showCsrBlock ? 3 : 2}
            icon={Users}
            title="Impact"
            dot="bg-emerald-600"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <FieldLabel dot="bg-emerald-500" required={false}>Direct Beneficiaries</FieldLabel>
                <input
                  type="number"
                  value={directBeneficiaries}
                  onChange={(e) => setDirectBeneficiaries(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-emerald-500" required={false}>Man Hours</FieldLabel>
                <input
                  type="number"
                  value={manHours}
                  onChange={(e) => setManHours(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-emerald-500" required={false}>Rotarians Involved</FieldLabel>
                <input
                  type="number"
                  value={rotariansInvolved}
                  onChange={(e) => setRotariansInvolved(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-emerald-500" required={false}>Rotaractors Involved</FieldLabel>
                <input
                  type="number"
                  value={rotaractorsInvolved}
                  onChange={(e) => setRotaractorsInvolved(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-emerald-500" required={false}>RCC Involved</FieldLabel>
                <input
                  type="number"
                  value={rccInvolved}
                  onChange={(e) => setRccInvolved(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </SectionCard>

          {/* 4. Photos */}
          <SectionCard
            number={showGlobalGrantBlock || showCsrBlock ? 4 : 3}
            icon={ImageIcon}
            title="Photos (max 5, at least 1 required)"
            dot="bg-rose-600"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="relative w-full h-40 group bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.preview}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600"
                      aria-label="Remove photo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="p-3 space-y-2">
                    <textarea
                      value={photo.description}
                      onChange={(e) => {
                        if (e.target.value.length <= 500) updatePhotoDescription(idx, e.target.value);
                      }}
                      placeholder="Photo description (max 500 chars)"
                      rows={3}
                      maxLength={500}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                    />
                    <p className="text-[10px] text-slate-400 text-right">{photo.description.length}/500</p>
                  </div>
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploading}
                  className="border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-rose-300 hover:bg-slate-50 transition-colors h-40 text-slate-500"
                >
                  {uploading ? (
                    <RotaryLoader size="sm" />
                  ) : (
                    <>
                      <Upload className="h-6 w-6" />
                      <span className="text-xs mt-1">Upload</span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp"
                className="hidden"
                onChange={handlePhotoUpload}
                disabled={uploading}
              />
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Allowed: JPG, JPEG, PNG, GIF, WEBP · up to 5 MB · auto-compressed if larger
            </p>
          </SectionCard>

          <SuccessAlert
            open={showSuccessDialog}
            title="Saved"
            description={successMessage || "Project updated successfully."}
            onOk={() => {
              setShowSuccessDialog(false);
              setSuccessMessage(null);
              navigateAfterSave();
            }}
          />
          <ErrorAlert
            open={!!errorMessage}
            title="Error"
            description={errorMessage || ""}
            onOk={() => setErrorMessage(null)}
          />
        </V2FormShell>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
