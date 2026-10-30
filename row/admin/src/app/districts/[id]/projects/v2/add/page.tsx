"use client";

/**
 * District Projects V2 — Add Project.
 *
 * Same data semantics as v1 (src/app/districts/[id]/projects/add/page.tsx):
 * every field, every API call, every validation rule preserved verbatim.
 * Only the chrome changes — wrapped in DistrictAdminShell + V2FormShell with
 * the dot-accented section cards used by every other v2 form.
 *
 * v2 reads ONLY `?returnTo=` for cancel + post-save navigation. Default
 * fallback = /districts/{districtId}/projects/v2.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, FileText, Image as ImageIcon, Info, Users, IndianRupee, Landmark,
} from "@/components/icons";
import {
  getDistrict,
  createDistrictProject,
  uploadDistrictProjectPhoto,
  getModules,
  getAreasOfFocus,
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

import { currencySymbol } from "@/lib/appFormat";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

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
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
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

export default function DistrictProjectsV2AddPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const districtId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/districts/${districtId}/projects/v2`);

  const [districtName, setDistrictName] = useState("");
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [areaOfFocusId, setAreaOfFocusId] = useState("");
  const [otherAreaOfFocus, setOtherAreaOfFocus] = useState("");
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
  const [fundings, setFundings] = useState<Lookup[]>([]);

  const [photos, setPhotos] = useState<{ path: string; preview: string; description: string }[]>([]);
  const [uploading, setUploading] = useState(false);
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
        setFundings(funding.filter((f: Lookup) => f.isActive));
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
      // Add mode: strict=true — enforce dimension/size rules for newly-added photos.
      const res = await uploadDistrictProjectPhoto(districtId, file, true);
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
    if (!TEXT_INPUT_REGEX.test(title)) { setErrorMessage("Title cannot contain emoji."); return; }
    if (description && !TEXT_INPUT_REGEX.test(description)) { setErrorMessage("Description cannot contain emoji."); return; }
    if (description && description.length > 1000) { setErrorMessage("Description must be 1000 characters or less."); return; }
    if (!projectDate) { setErrorMessage("Date is required."); return; }
    if (!areaOfFocusId) { setErrorMessage("Area of Focus is required."); return; }
    if (isOthersAof && !otherAreaOfFocus.trim()) { setErrorMessage("Please specify the Area of Focus."); return; }
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
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        areaOfFocusId: isOthersAof ? null : (Number(areaOfFocusId) || null),
        otherAreaOfFocus: isOthersAof ? otherAreaOfFocus.trim() : null,
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
      });
      setSuccessMessage("Project created successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="Add District Project"
        activeNavHref="/district-admin-dashboard/foundation"
      >
        <div className="mb-4">
          <DistrictFoundationTabBar />
        </div>
        <V2FormShell
          title="Add District Project"
          subtitle={districtName}
          defaultBack={`/districts/${districtId}/projects/v2`}
          saving={saving}
          saveLabel="Save Project"
          saveTone="bg-[#17458F] text-[#F7F9FC] hover:bg-[#12376F]"
          onSave={handleSave}
          banner={
            <div className="flex items-start gap-2 text-blue-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{TOP_MESSAGE}</span>
            </div>
          }
        >
          {/* 1. Project Details */}
          <SectionCard number={1} icon={FileText} title="Project Details" dot="bg-[#17458F]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 50 chars)" dot="bg-[#17458F]">Title</FieldLabel>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Project title"
                  maxLength={50}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 1000 chars)" dot="bg-[#17458F]" required={false}>Description</FieldLabel>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Project description"
                  rows={4}
                  maxLength={1000}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42] resize-y"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-[#17458F]" required={false}>Location of the Project</FieldLabel>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Location"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]">Area of Focus</FieldLabel>
                <select
                  value={areaOfFocusId}
                  onChange={(e) => setAreaOfFocusId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
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
                    className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                )}
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]">Date</FieldLabel>
                <DateField value={projectDate} onChange={setProjectDate} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]" required={false}>Project Cost ({currencySymbol()})</FieldLabel>
                <input
                  type="number"
                  value={projectCost}
                  onChange={(e) => setProjectCost(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-[#17458F]" required={false}>Funding</FieldLabel>
                <select
                  value={fundingId}
                  onChange={(e) => handleFundingChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                >
                  <option value="">Select</option>
                  {fundings.map((f) => (
                    <option key={f.id} value={String(f.id)}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </SectionCard>

          {/* 2. Funding-conditional: Global Grant */}
          {showGlobalGrantBlock && (
            <SectionCard number={2} icon={Landmark} title="Global Grant Details" dot="bg-[#17458F]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel dot="bg-[#17458F]">Global Grant Number</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={globalGrantNumber}
                    onChange={(e) => setGlobalGrantNumber(onlyDigits(e.target.value))}
                    placeholder="e.g., 2434521"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-[#17458F]">Amount Sanctioned ({currencySymbol()})</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountSanctioned}
                    onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-[#17458F]">Amount Received ({currencySymbol()})</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-[#17458F]">Amount spent till date ({currencySymbol()})</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountSpent}
                    onChange={(e) => setAmountSpent(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel dot="bg-[#17458F]">Host Clubs/Districts</FieldLabel>
                  <input
                    type="text"
                    value={hostClubsDistricts}
                    onChange={(e) => setHostClubsDistricts(e.target.value)}
                    placeholder="e.g., RC Chicago, RC Paris"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel dot="bg-[#17458F]">Global Partner Clubs/Districts</FieldLabel>
                  <input
                    type="text"
                    value={globalPartnerClubsDistricts}
                    onChange={(e) => setGlobalPartnerClubsDistricts(e.target.value)}
                    placeholder="e.g., RC Tokyo"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {/* 2. Funding-conditional: CSR */}
          {showCsrBlock && (
            <SectionCard number={2} icon={IndianRupee} title="CSR Details" dot="bg-[#17458F]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <FieldLabel dot="bg-[#17458F]">Name of the CSR Company</FieldLabel>
                  <input
                    type="text"
                    value={csrCompanyName}
                    onChange={(e) => setCsrCompanyName(e.target.value)}
                    placeholder="e.g., ABC Industries Ltd"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-[#17458F]">Amount Sanctioned ({currencySymbol()})</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountSanctioned}
                    onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                <div>
                  <FieldLabel dot="bg-[#17458F]">Amount Received ({currencySymbol()})</FieldLabel>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(onlyDigits(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
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
            dot="bg-[#17458F]"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <FieldLabel dot="bg-[#17458F]" required={false}>Direct Beneficiaries</FieldLabel>
                <input
                  type="number"
                  value={directBeneficiaries}
                  onChange={(e) => setDirectBeneficiaries(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]" required={false}>Man Hours</FieldLabel>
                <input
                  type="number"
                  value={manHours}
                  onChange={(e) => setManHours(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]" required={false}>Rotarians Involved</FieldLabel>
                <input
                  type="number"
                  value={rotariansInvolved}
                  onChange={(e) => setRotariansInvolved(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]" required={false}>Rotaractors Involved</FieldLabel>
                <input
                  type="number"
                  value={rotaractorsInvolved}
                  onChange={(e) => setRotaractorsInvolved(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]" required={false}>RCC Involved</FieldLabel>
                <input
                  type="number"
                  value={rccInvolved}
                  onChange={(e) => setRccInvolved(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
            </div>
          </SectionCard>

          {/* 4. Photos */}
          <SectionCard
            number={showGlobalGrantBlock || showCsrBlock ? 4 : 3}
            icon={ImageIcon}
            title="Photos (max 5, at least 1 required)"
            dot="bg-[#17458F]"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="relative w-full h-40 group bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.preview || `${API_URL}${photo.path}`}
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
                      className="w-full px-2 h-10 py-0 text-xs border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42] resize-none"
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
            description={successMessage || "Project created successfully."}
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
