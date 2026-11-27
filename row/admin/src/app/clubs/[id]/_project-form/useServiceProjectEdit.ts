"use client";

/** Project load (with optional year probing), pre-fill and update/move for the one-time service-project v2 Edit pages. */

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getClub,
  getModules,
  getAreasOfFocus,
  getFunding,
  getProject,
  getProjectYears,
  updateProject,
  moveProject,
  uploadProjectImage,
} from "@/services/api";
import { defaultCurrency } from "@/lib/appFormat";
import { useV2ReturnTo } from "@/components/v2/V2FormShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import type { ServiceFormConfig } from "./config";
import { useServiceProjectFields } from "./useServiceProjectFields";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

type Project = Awaited<ReturnType<typeof getProject>>;

export function useServiceProjectEdit(cfg: ServiceFormConfig) {
  useSyncClubIdFromUrl();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const projectId = Number(params.projectId);
  const initialYearId = Number(searchParams.get("yearId") || searchParams.get("frozenYearId")) || 0;
  // Only modules with cfg.probeYears ever change this (when the caller did not pass a yearId).
  const [yearId, setYearId] = useState<number>(initialYearId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/${cfg.slug}/v2`);

  const f = useServiceProjectFields(cfg, searchParams.get("frozenMonth"),
    (file) => uploadProjectImage(clubId, file, projectId, yearId));
  const { setErrorMessage, setLoading, setSaving, setShowProjectSuccess } = f;

  const prefill = (project: Project) => {
    f.setTitle(project.title || "");
    f.setDescription(project.description || "");
    f.setLocation(project.location || "");

    if (project.areaOfFocusId) {
      f.setSelectedAofId(String(project.areaOfFocusId));
    } else if (project.otherAreaOfFocus) {
      f.setSelectedAofId("others");
    }
    f.setOtherAreaOfFocus(project.otherAreaOfFocus || "");

    f.setProjectDate(project.projectDate ? project.projectDate.split("T")[0] : "");
    f.setProjectCost(project.projectCost != null ? String(project.projectCost) : "");
    f.setCurrency(project.currency || defaultCurrency());
    if (project.fundingId) f.setSelectedFundingId(String(project.fundingId));
    // Pre-fill funding-conditional fields
    f.setGlobalGrantNumber(project.globalGrantNumber || "");
    f.setAmountSanctioned(project.amountSanctioned != null ? String(project.amountSanctioned) : "");
    f.setAmountReceived(project.amountReceived != null ? String(project.amountReceived) : "");
    f.setAmountSpent(project.amountSpent != null ? String(project.amountSpent) : "");
    f.setHostClubsDistricts(project.hostClubsDistricts || "");
    f.setGlobalPartnerClubsDistricts(project.globalPartnerClubsDistricts || "");
    f.setCsrCompanyName(project.csrCompanyName || "");
    f.setDirectBeneficiaries(project.directBeneficiaries != null ? String(project.directBeneficiaries) : "");
    f.setManHours(project.manHours != null ? String(project.manHours) : "");
    f.setRotariansInvolved(project.rotariansInvolved != null ? String(project.rotariansInvolved) : "");
    f.setRotaractorsInvolved(project.rotaractorsInvolved != null ? String(project.rotaractorsInvolved) : "");
    f.setRccInvolved(project.rccInvolved != null ? String(project.rccInvolved) : "");
    f.setSendEmail(project.sendEmail ?? false);

    f.setPhotos((project.photos || []).map((p) => ({
      id: String(p.id),
      imagePath: p.imagePath,
      description: p.description || "",
      isPrimary: p.isPrimary,
      uploading: false,
      previewUrl: `${API_URL}${p.imagePath}`,
    })));
  };

  // Loads club, modules and funding together with the project (yearId from the URL).
  const loadWithUrlYear = async () => {
    const [club, modules, funding, project] = await Promise.all([
      getClub(clubId),
      getModules(),
      getFunding(),
      getProject(clubId, initialYearId, projectId),
    ]);
    f.setClubName(club.clubName);
    const mod = modules.find((m) => m.moduleKey === cfg.moduleKey);
    if (mod) {
      f.setModuleId(mod.id);
      const aof = await getAreasOfFocus(mod.id);
      f.setAreasOfFocus(aof.filter((a) => a.isActive));
    }
    f.setFundingList(funding.filter((x) => x.isActive));
    return project;
  };

  // Resolves yearId when the caller (e.g. Club Admin Dashboard) didn't pass one: tries the project's
  // years in turn, current year first; the first one that returns the project wins.
  const loadProbingYears = async () => {
    const [club, modules, funding] = await Promise.all([
      getClub(clubId),
      getModules(),
      getFunding(),
    ]);
    f.setClubName(club.clubName);
    const mod = modules.find((m) => m.moduleKey === cfg.moduleKey);
    let resolvedYearId = initialYearId;
    let project: Project | null = null;

    if (mod) {
      f.setModuleId(mod.id);
      const aof = await getAreasOfFocus(mod.id);
      f.setAreasOfFocus(aof.filter((a) => a.isActive));

      if (resolvedYearId > 0) {
        project = await getProject(clubId, resolvedYearId, projectId);
      } else {
        const years = await getProjectYears(clubId, mod.id);
        const ordered = [
          ...years.filter((y) => y.isCurrent),
          ...years.filter((y) => !y.isCurrent),
        ];
        for (const y of ordered) {
          try {
            project = await getProject(clubId, y.id, projectId);
            resolvedYearId = y.id;
            break;
          } catch {
            // Project not in this year-wise table — try the next year.
          }
        }
        if (!project) {
          throw new Error("Project not found in any rotary year for this club.");
        }
        setYearId(resolvedYearId);
      }
    } else {
      // Module lookup failed — fall back to original behavior so error surfaces in the same way.
      project = await getProject(clubId, resolvedYearId, projectId);
    }
    f.setFundingList(funding.filter((x) => x.isActive));

    if (!project) {
      throw new Error("Failed to load project.");
    }
    return project;
  };

  useEffect(() => {
    async function init() {
      try {
        const project = await (cfg.probeYears ? loadProbingYears() : loadWithUrlYear());
        prefill(project);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to load project.");
      } finally {
        setLoading(false);
      }
    }
    init();
    // initialYearId comes from the URL once; a probed yearId is stored in state by init() itself.
  }, [clubId, projectId, initialYearId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const err = f.validate("edit");
    if (err) { setErrorMessage(err); return; }
    const saveData = f.buildSaveData("edit");
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const moveInfo = await updateProject(clubId, yearId, projectId, saveData as any);
      if (moveInfo) {
        if (window.confirm(moveInfo.message)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const moved = await moveProject(clubId, moveInfo.fromYearId, projectId, saveData as any);
          window.alert(`Project moved to ${moved.newYearLabel}.`);
          if (cfg.moveGoesToListing) router.push(`/clubs/${clubId}/${cfg.slug}/v2`);
          else navigateAfterSave();
        }
        setSaving(false);
        return;
      }
      setShowProjectSuccess(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update project.");
    } finally {
      setSaving(false);
    }
  };

  return { ...f, clubId, navigateAfterSave, handleSave };
}
