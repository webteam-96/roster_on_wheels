"use client";

/** Data loading, switch-draft carry-over and create for the one-time service-project v2 Add pages. */

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  getClub,
  getModules,
  getAreasOfFocus,
  getFunding,
  createProject,
  uploadProjectImage,
} from "@/services/api";
import { consumeProjectSwitchDraft } from "@/lib/projectDraft";
import { resolveClubDefaultCurrency } from "@/lib/currency";
import { useV2ReturnTo } from "@/components/v2/V2FormShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled } from "@/lib/addToOrg";
import type { ServiceFormConfig } from "./config";
import { useServiceProjectFields } from "./useServiceProjectFields";

export function useServiceProjectAdd(cfg: ServiceFormConfig) {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { navigateAfterSave, navigateAfterCancel } = useV2ReturnTo(`/clubs/${clubId}/${cfg.slug}/v2`);

  // Page-load "I Agree" gate (parity with v1 listing-page dialog before navigating to Add).
  const [agreementOpen, setAgreementOpen] = useState(false); // gate now lives on the listing page (before navigation)
  const handleAgree = () => setAgreementOpen(false);
  const handleAgreeCancel = () => navigateAfterCancel();

  const f = useServiceProjectFields(cfg, searchParams.get("frozenMonth"),
    (file) => uploadProjectImage(clubId, file, undefined, undefined, true));
  const {
    setErrorMessage, setLoading, setSaving, setClubName, setCurrency, setModuleId, setAreasOfFocus, setFundingList,
  } = f;

  // Classification is locked until "Auto-Suggest Classification" is pressed (which also fires the AI).
  const [classUnlocked, setClassUnlocked] = useState(false);

  // RI Flow-Bot extension state (enabled for all clubs).
  // installed: null = checking, true = ready, false = not installed.
  const installed = useExtensionStatus();
  const isBotEnabled = isFlowBotEnabled(clubId);
  // Install prompt (extension NOT detected) — shown once on load, dismissible.
  const [, setShowInstallPrompt] = useState(false);
  const installDismissedRef = useRef(false);

  useEffect(() => {
    if (isBotEnabled && installed === false && !installDismissedRef.current && !agreementOpen) {
      setShowInstallPrompt(true);
    }
  }, [installed, isBotEnabled, agreementOpen]);

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
        const mod = modules.find((m) => m.moduleKey === cfg.moduleKey);
        if (mod) {
          setModuleId(mod.id);
          const aof = await getAreasOfFocus(mod.id);
          setAreasOfFocus(aof.filter((a) => a.isActive));
        }
        setFundingList(funding.filter((x) => x.isActive));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carry-over draft for a cross-module "switch": everything this form has filled so far. The target
  // module's Add page reads the keys it recognises and preselects the AI-suggested classification.
  const buildSwitchDraft = (): Record<string, unknown> => ({
    title: f.title, description: f.description, location: f.location, projectDate: f.projectDate,
    projectCost: f.projectCost, selectedFundingId: f.selectedFundingId,
    directBeneficiaries: f.directBeneficiaries, manHours: f.manHours,
    rotariansInvolved: f.rotariansInvolved, rotaractorsInvolved: f.rotaractorsInvolved,
    globalGrantNumber: f.globalGrantNumber, amountSanctioned: f.amountSanctioned,
    amountReceived: f.amountReceived, amountSpent: f.amountSpent,
    hostClubsDistricts: f.hostClubsDistricts, globalPartnerClubsDistricts: f.globalPartnerClubsDistricts,
    csrCompanyName: f.csrCompanyName, sendEmail: f.sendEmail,
    photos: f.photos.filter((p) => p.imagePath && !p.uploading)
      .map((p) => ({ imagePath: p.imagePath, description: p.description, isPrimary: p.isPrimary })),
  });

  // Hydrate from an incoming cross-module switch draft (this page is also a switch TARGET). Runs once.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    const draft = consumeProjectSwitchDraft(cfg.moduleKey);
    if (!draft) return;
    hydratedRef.current = true;
    const d = draft.fields;
    const str = (k: string) => (d[k] == null ? "" : String(d[k]));
    if (d.title != null) f.setTitle(str("title"));
    if (d.description != null) f.setDescription(str("description"));
    if (d.location != null) f.setLocation(str("location"));
    if (d.projectDate != null) f.setProjectDate(str("projectDate"));
    if (d.projectCost != null) f.setProjectCost(str("projectCost"));
    if (d.selectedFundingId != null) f.setSelectedFundingId(str("selectedFundingId"));
    if (d.directBeneficiaries != null) f.setDirectBeneficiaries(str("directBeneficiaries"));
    if (d.manHours != null) f.setManHours(str("manHours"));
    if (d.rotariansInvolved != null) f.setRotariansInvolved(str("rotariansInvolved"));
    if (d.rotaractorsInvolved != null) f.setRotaractorsInvolved(str("rotaractorsInvolved"));
    if (d.rccInvolved != null) f.setRccInvolved(str("rccInvolved"));
    if (d.globalGrantNumber != null) f.setGlobalGrantNumber(str("globalGrantNumber"));
    if (d.amountSanctioned != null) f.setAmountSanctioned(str("amountSanctioned"));
    if (d.amountReceived != null) f.setAmountReceived(str("amountReceived"));
    if (d.amountSpent != null) f.setAmountSpent(str("amountSpent"));
    if (d.hostClubsDistricts != null) f.setHostClubsDistricts(str("hostClubsDistricts"));
    if (d.globalPartnerClubsDistricts != null) f.setGlobalPartnerClubsDistricts(str("globalPartnerClubsDistricts"));
    if (d.csrCompanyName != null) f.setCsrCompanyName(str("csrCompanyName"));
    if (typeof d.sendEmail === "boolean") f.setSendEmail(d.sendEmail);
    if (Array.isArray(d.photos)) {
      f.setPhotos((d.photos as Array<{ imagePath: string; description?: string; isPrimary?: boolean }>)
        .filter((p) => p?.imagePath)
        .map((p, i) => ({
          id: `draft-${i}`, imagePath: p.imagePath, description: p.description ?? "",
          isPrimary: !!p.isPrimary, uploading: false,
        })));
    }
    // Area of focus → "Category" dropdown.
    f.setSelectedAofId(String(draft.suggested.areaOfFocusId));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const err = f.validate("add");
    if (err) { setErrorMessage(err); return; }
    const saveData = f.buildSaveData("add");
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

  return {
    ...f, clubId, navigateAfterSave, agreementOpen, handleAgree, handleAgreeCancel,
    classUnlocked, unlockClassification: () => setClassUnlocked(true), buildSwitchDraft, handleSave,
  };
}
