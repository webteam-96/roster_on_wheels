"use client";

/**
 * Field state, photo handling, validation and the save payload shared by the one-time service-project
 * add and edit pages (Vocational, International, New Generation). Moved verbatim from those pages; the
 * few places where the modules differed are read from the module config.
 */

import { useRef, useState } from "react";
import { type ClassificationSearchResult } from "@/services/api";
import { AreaOfFocus, Funding, ProjectPhotoInput } from "@/types/project";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";
import { defaultCurrency } from "@/lib/appFormat";
import type { ServiceFormConfig } from "./config";

export type PhotoItem = {
  id: string;
  file?: File;
  imagePath: string;
  description: string;
  isPrimary: boolean;
  uploading: boolean;
  previewUrl?: string;
};

export const onlyDigits = (v: string) => v.replace(/\D/g, "");

const classifyFunding = (name?: string | null): "global_grant" | "csr" | "" => {
  if (!name) return "";
  const n = name.trim().toLowerCase();
  if (n.includes("global grant")) return "global_grant";
  if (n === "csr" || n.startsWith("csr ") || n.includes(" csr") || n.includes("(csr)")) return "csr";
  return "";
};

// Frozen-month redirect (from Club Monthly Report): clamps the project date to the rotary month.
function frozenRange(frozenMonth: string | null) {
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
  return { frozenDateMin, frozenDateMax };
}

export function useServiceProjectFields(
  cfg: ServiceFormConfig,
  frozenMonth: string | null,
  upload: (file: File) => Promise<{ path: string }>,
) {
  const { frozenDateMin, frozenDateMax } = frozenRange(frozenMonth);

  const [clubName, setClubName] = useState("");
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showProjectSuccess, setShowProjectSuccess] = useState(false);

  // Masters — Area of Focus surfaced as "Category" (v1 label)
  const [areasOfFocus, setAreasOfFocus] = useState<AreaOfFocus[]>([]);
  const [fundingList, setFundingList] = useState<Funding[]>([]);

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

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const photoCrop = useImageCropQueue();
  const photoInputRef = useRef<HTMLInputElement>(null);

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

  const isOthersAof = selectedAofId === "others";

  // One pick (smart-search result or AI suggestion) sets the "Category" (= areaOfFocusId).
  const applyClassification = (r: ClassificationSearchResult) => {
    setSelectedAofId(String(r.areaOfFocusId));
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 5 - photos.length - photoCrop.pending;
    const toAdd = Array.from(files).slice(0, Math.max(0, remaining));

    let accepted: File[] = toAdd;
    if (cfg.maxPhotoMb != null) {
      accepted = [];
      for (const file of toAdd) {
        if (file.size > cfg.maxPhotoMb * 1024 * 1024) {
          setErrorMessage(`${file.name} exceeds ${cfg.maxPhotoMb}MB limit.`);
          continue;
        }
        accepted.push(file);
      }
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
        const result = await upload(file);
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

  /** First failing rule's message, in the pages' original order; null when the form is valid. */
  const validate = (mode: "add" | "edit"): string | null => {
    if (!title.trim()) return "Title is required.";
    if (title.trim().length > 50) return "Title must be 50 characters or less.";
    if (!description.trim()) return "Description is required.";
    if (description.trim().length > 1000) return "Description must be 1000 characters or less.";
    if (!location.trim()) return "Location is required.";
    if (!selectedAofId) return "Category is required.";
    if (isOthersAof && !otherAreaOfFocus.trim()) return "Please specify the Category.";
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
    if (cfg.requireRotaractors && !rotaractorsInvolved) return "Rotaractors Involved is required.";
    if (photos.length === 0) return "At least 1 photo is required.";
    if (photos.some((p) => p.uploading)) return "Please wait for photos to finish uploading.";
    if (mode === "add" && !moduleId) return "Module not found.";
    return null;
  };

  /** Save body; the add page sends moduleId first, the edit page does not send it. */
  const buildSaveData = (mode: "add" | "edit"): Record<string, unknown> => {
    const photoInputs: ProjectPhotoInput[] = photos.map((p, i) => ({
      imagePath: p.imagePath,
      description: p.description || null,
      isPrimary: p.isPrimary,
      sortOrder: i,
    }));
    return {
      ...(mode === "add" ? { moduleId } : {}),
      projectType: "one_time",
      isJointProject: false,
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
  };

  return {
    frozenMonth, frozenDateMin, frozenDateMax,
    clubName, setClubName, moduleId, setModuleId, loading, setLoading, saving, setSaving,
    errorMessage, setErrorMessage, showProjectSuccess, setShowProjectSuccess,
    areasOfFocus, setAreasOfFocus, fundingList, setFundingList,
    title, setTitle, description, setDescription, location, setLocation,
    selectedAofId, setSelectedAofId, otherAreaOfFocus, setOtherAreaOfFocus,
    projectDate, setProjectDate, projectCost, setProjectCost, currency, setCurrency,
    selectedFundingId, setSelectedFundingId,
    globalGrantNumber, setGlobalGrantNumber, amountSanctioned, setAmountSanctioned,
    amountReceived, setAmountReceived, amountSpent, setAmountSpent,
    hostClubsDistricts, setHostClubsDistricts, globalPartnerClubsDistricts, setGlobalPartnerClubsDistricts,
    csrCompanyName, setCsrCompanyName, directBeneficiaries, setDirectBeneficiaries, manHours, setManHours,
    rotariansInvolved, setRotariansInvolved, rotaractorsInvolved, setRotaractorsInvolved, rccInvolved, setRccInvolved,
    sendEmail, setSendEmail,
    photos, setPhotos, photoCrop, photoInputRef,
    showGlobalGrantBlock, showCsrBlock, handleFundingChange, isOthersAof, applyClassification,
    handlePhotoSelect, handleCropSave, removePhoto, setPrimaryPhoto, updatePhotoDescription,
    validate, buildSaveData,
  };
}

export type ServiceProjectFields = ReturnType<typeof useServiceProjectFields>;
