"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { plainActivities } from "@/components/goal-flow/common";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useClubGoalPercents } from "@/components/awards/GoalAchievement";
import {
  getRotaryYears,
  getCitationAvailableYears,
  getDistrictAwardsConfig,
  setDistrictAwardsConfig,
  getCitationCategoriesByDistrict,
  createCitationCategory,
  updateCitationCategory,
  deleteCitationCategory,
  getCitationDescription,
  saveCitationDescription,
  getCitationAutoQuestions,
  createCitationAutoQuestion,
  updateCitationAutoQuestion,
  deleteCitationAutoQuestion,
  getCitationActivities,
  getCitationMeetingTypes,
  getCitationAreaOfFocus,
  getCitationManualCriteria,
  createCitationManualCriteria,
  updateCitationManualCriteria,
  deleteCitationManualCriteria,
  getCitationClubPoints,
  getAwardsClearStatus,
  clearAwardsPoints,
  restoreAwardsPoints,
  type AwardsClearStatus,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import { SelectItem } from "@/components/ui/select";
import { CITATION_DESC_MAX_CHARS, citationPlainTextLength, BonusFieldsInner, RCC_PREFIX } from "./districtAwardsParts";

export type DistrictAwardsModuleProps = { districtId: number; rotarySections?: string[]; fetchEntryLabels?: boolean; rccPointsTab?: boolean };

export function useDistrictAwards({ districtId, rotarySections, fetchEntryLabels, rccPointsTab }: DistrictAwardsModuleProps) {
  const fe = !!fetchEntryLabels;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSuperAdmin, isAdmin, user } = useAuth();
  const canManage = isSuperAdmin || isAdmin;
  // Year-wise rights. Folded into canEdit below rather than canManage, because
  // the year is not known this early — canManage is only ever used to build it.
  const { years: rotaryYears } = useRotaryYears();
  const rights = useMemo(
    () => districtYearRights(user?.scopedRoles, districtId),
    [user?.scopedRoles, districtId],
  );
  const editableYears = heldYearLabels(rights, rotaryYears.map((y) => ({ id: y.id, label: y.yearLabel })));
  const initialTab = searchParams.get("tab") || "categories";

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // District Awards activation (per district+year). Default DISABLED — a SuperAdmin must enable it.
  // When disabled, clubs are read-only (enforced on the API); configuring categories/questions is
  // always allowed. The disabled notice names the District + Year.
  const [awardsEnabled, setAwardsEnabled] = useState(true);
  const [togglingAwards, setTogglingAwards] = useState(false);
  // SuperAdmin-only "Clear all clubs points" (+ Restore) for this district+year.
  const [clearStatus, setClearStatus] = useState<AwardsClearStatus | null>(null);
  const [clearing, setClearing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  // Year — follows the GLOBAL rotary year (?yearId= in the URL). Add/edit/delete
  // are allowed for the CURRENT and FUTURE years, but NOT past years.
  const [allYears, setAllYears] = useState<any[]>([]);
  const [yearsMeta, setYearsMeta] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [currentYearId, setCurrentYearId] = useState<number | null>(null);
  const isCurrentYear = selectedYearId === currentYearId;
  // Each club's Goal Setting % next to its award points - view only (user 2026-11-10).
  const clubGoals = useClubGoalPercents(districtId, selectedYearId);
  // Start-year from a "2025-26" label; used to classify selected vs current year.
  const startYearOf = (y: any): number => { const m = /(\d{4})/.exec(String(y?.yearLabel || y?.YearLabel || "")); return m ? Number(m[1]) : 0; };
  const selMeta = yearsMeta.find((y: any) => y.id === selectedYearId);
  const curMeta = yearsMeta.find((y: any) => y.isCurrent);
  const isPastYear = !!(selMeta && curMeta && startYearOf(selMeta) < startYearOf(curMeta));
  // Edit permission: manager AND not a past year (current + future allowed)
  // AND an admin for the year on screen. Awards categories, questions and
  // criteria are stored per district + year, so the year decides.
  const holdsSelectedYear = canEditYear(rights, selectedYearId ?? undefined, isSuperAdmin);
  const canEdit = canManage && !isPastYear && holdsSelectedYear;

  // Categories
  const [categories, setCategories] = useState<any[]>([]);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<any>(null);
  const [catName, setCatName] = useState("");
  const [catSort, setCatSort] = useState("0");
  const [catSaving, setCatSaving] = useState(false);
  const [deleteCat, setDeleteCat] = useState<any>(null);

  // Description
  const [descHtml, setDescHtml] = useState("");
  const [descSaving, setDescSaving] = useState(false);

  // Auto Questions
  const [autoQuestions, setAutoQuestions] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [autoDialogOpen, setAutoDialogOpen] = useState(false);
  const [editingAuto, setEditingAuto] = useState<any>(null);
  const [autoForm, setAutoForm] = useState<any>({ categoryId: "", activityId: "", points: "", perUnit: "1", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "", sortOrder: "0", subItems: [] });
  const [autoSaving, setAutoSaving] = useState(false);
  const [deleteAuto, setDeleteAuto] = useState<any>(null);

  // Sub-item helpers for auto
  const [meetingTypes, setMeetingTypes] = useState<any[]>([]);
  const [subItemData, setSubItemData] = useState<Record<number, any>>({});

  // Manual
  const [manualCriteria, setManualCriteria] = useState<any[]>([]);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [editingManual, setEditingManual] = useState<any>(null);
  const [manualForm, setManualForm] = useState<any>({ categoryId: "", criteriaName: "", sortOrder: "0", subCriteria: [] });
  const [manualSaving, setManualSaving] = useState(false);
  const [deleteManual, setDeleteManual] = useState<any>(null);

  // District Goals (rotarySections, user 2026-11-17): the 4 Rotary.org sections are the district's default
  // categories - created for the year when missing (once per district + year), shown without Edit / Delete.
  const [catsLoadedFor, setCatsLoadedFor] = useState<number | null>(null);
  const seededRef = useRef<string | null>(null);
  const isRotarySection = (name: string) =>
    !!rotarySections?.some((n) => n.toLowerCase() === (name || "").trim().toLowerCase());
  useEffect(() => {
    if (!rotarySections || !canEdit || !selectedYearId || catsLoadedFor !== selectedYearId) return;
    const key = `${districtId}-${selectedYearId}`;
    if (seededRef.current === key) return;
    const missing = rotarySections.filter((n) => !categories.some((c: any) => (c.categoryName || "").trim().toLowerCase() === n.toLowerCase()));
    seededRef.current = key;
    if (missing.length === 0) return;
    (async () => {
      for (const n of missing) {
        try { await createCitationCategory(districtId, { yearId: selectedYearId, categoryName: n, sortOrder: rotarySections.indexOf(n) + 1 }); }
        catch { /* shown again next time the page opens */ }
      }
      fetchCategories();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotarySections, canEdit, selectedYearId, catsLoadedFor, categories, districtId]);

  // Rotary.org sections the district has no category for yet (shown first in the Category dropdown).
  const missingSections = (rotarySections ?? []).filter(
    (n) => !categories.some((c: any) => (c.categoryName || "").trim().toLowerCase() === n.toLowerCase()));
  const sectionItems = missingSections.map((n) => <SelectItem key={RCC_PREFIX + n} value={RCC_PREFIX + n}>{n}</SelectItem>);
  // The chosen category id; a Rotary.org section not yet a category is created first.
  const resolveCategoryId = async (value: string): Promise<number> => {
    if (!value.startsWith(RCC_PREFIX)) return Number(value);
    const name = value.slice(RCC_PREFIX.length);
    const res: any = await createCitationCategory(districtId, { yearId: selectedYearId, categoryName: name, sortOrder: (rotarySections ?? []).indexOf(name) + 1 });
    fetchCategories();
    return Number(res?.id);
  };
  const categoryNameOf = (value: string) => value.startsWith(RCC_PREFIX) ? value.slice(RCC_PREFIX.length)
    : categories.find((c: any) => String(c.id) === value)?.categoryName || "";

  // Club Points
  const [clubPoints, setClubPoints] = useState<any[]>([]);
  const [clubPointsLoading, setClubPointsLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [viewingClubId, setViewingClubId] = useState<number | null>(null);
  const [downloadingClubId, setDownloadingClubId] = useState<number | null>(null);
  // Inline club-citation view (instead of navigating away — keeps the page's KPI
  // cards + tab bar mounted so only this panel refreshes, no full-page flash).
  const [viewClub, setViewClub] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [years, avYears] = await Promise.all([getRotaryYears(), getCitationAvailableYears(districtId)]);
        const current = years.find((y: any) => y.isCurrent);
        setCurrentYearId(current?.id || null);
        setYearsMeta(years);
        const list: any[] = [...avYears];
        if (current && !list.find((y: any) => y.id === current.id)) list.unshift(current);
        if (list.length === 0) list.push(...(current ? [current] : years.slice(0, 1)));
        setAllYears(list);
        // Follow the GLOBAL rotary year from the URL (?yearId=) when present & valid;
        // otherwise default to the current year.
        const urlY = Number(searchParams.get("yearId")) || 0;
        const validUrlY = urlY && years.some((y: any) => y.id === urlY) ? urlY : null;
        setSelectedYearId(validUrlY ?? (current?.id ?? (list[0]?.id ?? null)));
      } catch { setErrorMessage("Failed to load."); }
      finally { setLoading(false); }
    })();
  }, [districtId]);

  // Not offered (user 2026-11-18): Annual Fund (16) / PolioPlus (17) are RCC goals; CSR with RFI (22) / New Clubs (23) are district-only (Disha).
  useEffect(() => { getCitationActivities().then((a: any[]) => setActivities(plainActivities(a.filter((x) => ![16, 17, 22, 23].includes(x.id))))).catch(() => {}); getCitationMeetingTypes().then(setMeetingTypes).catch(() => {}); }, []);

  // Follow the global rotary year: when the URL ?yearId= changes, switch to it.
  useEffect(() => {
    const urlY = Number(searchParams.get("yearId")) || 0;
    if (urlY && yearsMeta.some((y: any) => y.id === urlY) && urlY !== selectedYearId) setSelectedYearId(urlY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, yearsMeta]);

  useEffect(() => {
    if (!selectedYearId) return;
    if (activeTab === "categories") fetchCategories();
    if (activeTab === "description") fetchDescription();
    if (activeTab === "auto") fetchAutoQuestions();
    if (activeTab === "manual") fetchManualCriteria();
    if (activeTab === "club_points") fetchClubPoints();
    // Always fetch all so KPI tile counts display real values.
    if (categories.length === 0) fetchCategories();
    if (autoQuestions.length === 0) fetchAutoQuestions();
    if (manualCriteria.length === 0) fetchManualCriteria();
    if (clubPoints.length === 0) fetchClubPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYearId, activeTab]);

  const fetchCategories = async () => { try { setCategories(await getCitationCategoriesByDistrict(districtId, selectedYearId!)); setCatsLoadedFor(selectedYearId); } catch {} };
  const fetchDescription = async () => { try { const d = await getCitationDescription(districtId, selectedYearId!); setDescHtml(d.descriptionHtml || ""); } catch {} };
  const fetchAutoQuestions = async () => { try { setAutoQuestions(plainActivities(await getCitationAutoQuestions(districtId, selectedYearId!))); } catch {} };
  const fetchManualCriteria = async () => { try { setManualCriteria(await getCitationManualCriteria(districtId, selectedYearId!)); } catch {} };
  const fetchClubPoints = async () => { setClubPointsLoading(true); try { setClubPoints(await getCitationClubPoints(districtId, selectedYearId!)); } catch {} finally { setClubPointsLoading(false); } };

  // Load the District Awards activation flag whenever the district / selected year changes.
  useEffect(() => {
    let cancelled = false;
    if (!districtId || !selectedYearId) return;
    getDistrictAwardsConfig(districtId, selectedYearId)
      .then((c) => { if (!cancelled) setAwardsEnabled(c.isEnabled); })
      .catch(() => { if (!cancelled) setAwardsEnabled(true); });
    return () => { cancelled = true; };
  }, [districtId, selectedYearId]);

  // SuperAdmin-only: flip the activation flag for this district+year.
  const toggleAwards = async (next: boolean) => {
    if (!isSuperAdmin || !selectedYearId) return;
    setTogglingAwards(true);
    try {
      await setDistrictAwardsConfig(districtId, selectedYearId, next);
      setAwardsEnabled(next);
      setSuccessMessage(next ? "District Awards enabled: clubs can enter points." : "District Awards disabled: clubs are now read-only.");
    } catch {
      setErrorMessage("Failed to update District Awards status.");
    } finally {
      setTogglingAwards(false);
    }
  };

  // SuperAdmin-only: load the Clear/Restore status for this district+year.
  useEffect(() => {
    if (!isSuperAdmin || !districtId || !selectedYearId) { setClearStatus(null); return; }
    let cancelled = false;
    getAwardsClearStatus(districtId, selectedYearId)
      .then((s) => { if (!cancelled) setClearStatus(s); })
      .catch(() => { if (!cancelled) setClearStatus(null); });
    return () => { cancelled = true; };
  }, [isSuperAdmin, districtId, selectedYearId]);

  const refreshClearStatus = () => {
    if (!isSuperAdmin || !selectedYearId) return;
    getAwardsClearStatus(districtId, selectedYearId).then(setClearStatus).catch(() => {});
  };

  // Clear ALL clubs' district-award points for this district+year (backup + email + soft-delete, server-side).
  const doClearPoints = async () => {
    if (!selectedYearId) return;
    setClearing(true);
    try {
      const r = await clearAwardsPoints(districtId, selectedYearId);
      setShowClearConfirm(false);
      setSuccessMessage(`${r.message}${(r.emailedTo?.length ?? 0) > 0 ? ` Emailed to: ${r.emailedTo.join(", ")}.` : " (No DG / District Admin email was found to notify.)"}`);
      refreshClearStatus();
      fetchClubPoints();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to clear club points.");
    } finally { setClearing(false); }
  };

  // Restore the most recent cleared batch for this district+year.
  const doRestorePoints = async () => {
    if (!selectedYearId) return;
    setRestoring(true);
    try {
      const r = await restoreAwardsPoints(districtId, selectedYearId);
      setShowRestoreConfirm(false);
      setSuccessMessage(r.message);
      refreshClearStatus();
      fetchClubPoints();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to restore club points.");
    } finally { setRestoring(false); }
  };

  // ── Categories CRUD ──
  const openAddCat = () => { setEditingCat(null); setCatName(""); setCatSort("0"); setCatDialogOpen(true); };
  const openEditCat = (c: any) => { setEditingCat(c); setCatName(c.categoryName); setCatSort(String(c.sortOrder)); setCatDialogOpen(true); };
  const handleSaveCat = async () => {
    if (!catName.trim()) { setErrorMessage("Category name is required."); return; }
    setCatSaving(true);
    try {
      if (editingCat) await updateCitationCategory(districtId, editingCat.id, { categoryName: catName, sortOrder: Number(catSort) });
      else await createCitationCategory(districtId, { yearId: selectedYearId, categoryName: catName, sortOrder: Number(catSort) });
      setCatDialogOpen(false); fetchCategories(); setSuccessMessage(editingCat ? "Updated." : "Created.");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
    finally { setCatSaving(false); }
  };
  const handleDeleteCat = async () => {
    if (!deleteCat) return;
    try { await deleteCitationCategory(districtId, deleteCat.id); fetchCategories(); setSuccessMessage("Deleted."); }
    catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
    setDeleteCat(null);
  };

  // ── Description ──
  const handleSaveDesc = async () => {
    if (citationPlainTextLength(descHtml) > CITATION_DESC_MAX_CHARS) {
      setErrorMessage(`Description exceeds the ${CITATION_DESC_MAX_CHARS} character limit. Please shorten it.`);
      return;
    }
    setDescSaving(true);
    try { await saveCitationDescription(districtId, { yearId: selectedYearId, descriptionHtml: descHtml }); setSuccessMessage("Description saved."); }
    catch { setErrorMessage("Failed."); }
    finally { setDescSaving(false); }
  };

  // ── Auto Questions CRUD ──
  const openAddAuto = () => { setEditingAuto(null); setAutoForm({ categoryId: "", activityId: "", points: "", perUnit: "1", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "", sortOrder: "0", subItems: [] }); setAutoDialogOpen(true); };
  const openEditAuto = async (q: any) => {
    setEditingAuto(q);
    const subs = (q.subItems || []).map((s: any) => ({
      ...s,
      points: String(s.points),
      bonusPoints: String(s.bonusPoints || ""),
      minBonus: String(s.minBonus || ""),
      maxBonus: String(s.maxBonus || ""),
      isBonus: !!s.isBonus,
    }));
    setAutoForm({
      categoryId: String(q.categoryId), activityId: String(q.activityId),
      points: String(q.points), perUnit: String(q.perUnit || 1), isBonus: !!q.isBonus, bonusPoints: String(q.bonusPoints || ""), minBonus: String(q.minBonus || ""), maxBonus: String(q.maxBonus || ""),
      sortOrder: String(q.sortOrder), subItems: subs
    });
    setSubItemData({});
    setAutoDialogOpen(true);

    const actId = String(q.activityId);
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      if (sub.subItemType && sub.subItemType !== "meeting_type") {
        await loadAofList(i, actId);
      }
    }
  };
  const handleSaveAuto = async () => {
    if (!autoForm.categoryId || !autoForm.activityId) { setErrorMessage("Category and Activity required."); return; }
    for (let i = 0; i < autoForm.subItems.length; i++) {
      const s = autoForm.subItems[i];
      if (!s.subItemId && s.subItemType !== "meeting_type") { setErrorMessage(`Sub Item #${i + 1}: Please select a value.`); return; }
      if (s.subItemType === "meeting_type" && !s.subItemName) { setErrorMessage(`Sub Item #${i + 1}: Please select a Meeting Type.`); return; }
      if (!s.points || Number(s.points) <= 0) { setErrorMessage(`Sub Item #${i + 1}: Points is required.`); return; }
    }
    setAutoSaving(true);
    try {
      const payload = {
        yearId: selectedYearId, categoryId: await resolveCategoryId(autoForm.categoryId), activityId: Number(autoForm.activityId),
        points: Number(autoForm.points) || 0, perUnit: Math.max(1, Number(autoForm.perUnit) || 1), isBonus: autoForm.isBonus, bonusPoints: Number(autoForm.bonusPoints) || 0,
        minBonus: Number(autoForm.minBonus) || 0, maxBonus: Number(autoForm.maxBonus) || 0, sortOrder: Number(autoForm.sortOrder) || 0,
        subItems: autoForm.subItems.map((s: any) => ({ id: s.id || 0, subItemType: s.subItemType, subItemId: s.subItemId || null, subItemName: s.subItemName || null,
          points: Number(s.points) || 0, isBonus: s.isBonus, bonusPoints: Number(s.bonusPoints) || 0, minBonus: Number(s.minBonus) || 0, maxBonus: Number(s.maxBonus) || 0 }))
      };
      if (editingAuto) await updateCitationAutoQuestion(districtId, editingAuto.id, payload);
      else await createCitationAutoQuestion(districtId, payload);
      setAutoDialogOpen(false); fetchAutoQuestions(); setSuccessMessage(editingAuto ? "Updated." : "Created.");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
    finally { setAutoSaving(false); }
  };
  const handleDeleteAuto = async () => {
    if (!deleteAuto) return;
    try { await deleteCitationAutoQuestion(districtId, deleteAuto.id); fetchAutoQuestions(); setSuccessMessage("Deleted."); }
    catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
    setDeleteAuto(null);
  };

  const getModuleKeyFromActivity = (actName: string) => {
    const n = actName.toLowerCase();
    if (n.includes("community")) return "community_service";
    if (n.includes("vocational")) return "vocational_service";
    if (n.includes("international")) return "international_service";
    if (n.includes("new generation")) return "new_generation_service";
    if (n.includes("public image")) return "public_image_initiative";
    return "";
  };

  const loadAofList = async (index: number, activityId: string) => {
    const act = activities.find((a: any) => String(a.id) === activityId);
    if (!act) return;
    const moduleKey = getModuleKeyFromActivity(act.activityName);
    try {
      const list = await getCitationAreaOfFocus(moduleKey);
      setSubItemData(prev => ({ ...prev, [index]: { aofList: list } }));
    } catch {}
  };

  const addAutoSubItem = () => setAutoForm((p: any) => ({ ...p, subItems: [...p.subItems, { subItemType: "", subItemId: null, subItemName: "", points: "", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "" }] }));
  const removeAutoSubItem = (i: number) => {
    setAutoForm((p: any) => ({ ...p, subItems: p.subItems.filter((_: any, idx: number) => idx !== i) }));
    // subItemData is keyed by row index and holds each row's dropdown option list (aofList).
    // Removing row `i` shifts every later row down by one, so re-key the map to match —
    // otherwise the shifted rows read the wrong (or missing) option lists and their dropdowns blank out.
    setSubItemData(prev => {
      const next: Record<number, any> = {};
      Object.keys(prev).forEach(k => {
        const idx = Number(k);
        if (idx < i) next[idx] = prev[idx];
        else if (idx > i) next[idx - 1] = prev[idx];
        // idx === i is the removed row — dropped.
      });
      return next;
    });
  };
  const updateAutoSubItem = (i: number, field: string, value: any) => setAutoForm((p: any) => ({ ...p, subItems: p.subItems.map((s: any, idx: number) => idx === i ? { ...s, [field]: value } : s) }));

  // ── Manual Criteria CRUD ──
  const openAddManual = () => { setEditingManual(null); setManualForm({ categoryId: "", sortOrder: "0", subCriteria: [] }); setManualDialogOpen(true); };
  const normalizeManualAnswerType = (raw: any, hasOptions: boolean): "number" | "yesno" | "choose_one" | "text" => {
    const r = String(raw ?? "").toLowerCase().trim().replace(/[\s_\-/]/g, "");
    if (r === "text") return "text";   // District Goals only (user 2026-11-16)
    if (r === "yesno" || r === "yn" || r === "boolean" || r === "bool" || r === "yes" || r === "no") return "yesno";
    if (r === "chooseone" || r === "choose" || r === "select" || r === "option" || r === "options" || r === "radio" || hasOptions) return "choose_one";
    return "number";
  };

  const openEditManual = (mc: any) => {
    setEditingManual(mc);
    setManualForm({
      categoryId: String(mc.categoryId), sortOrder: String(mc.sortOrder),
      subCriteria: (mc.subCriteria || []).map((sc: any) => ({
        id: sc.id || 0,   // kept so an edit updates the row in place (club answers stay linked) - user 2026-11-17
        subCriteriaTitle: sc.subCriteriaTitle || "",
        answerType: normalizeManualAnswerType(sc.answerType, Array.isArray(sc.options) && sc.options.length > 0),
        points: String(sc.points || ""), isBonus: !!sc.isBonus, bonusPoints: String(sc.bonusPoints || ""), minBonus: String(sc.minBonus || ""), maxBonus: String(sc.maxBonus || ""),
        remark: sc.remark || "", sortOrder: String(sc.sortOrder || "0"),
        options: (sc.options || []).map((o: any) => ({ id: o.id || 0, optionText: o.optionText, optionPoints: String(o.optionPoints || ""), sortOrder: String(o.sortOrder || "0") }))
      }))
    });
    setManualDialogOpen(true);
  };
  const handleSaveManual = async () => {
    if (!manualForm.categoryId) { setErrorMessage("Category is required."); return; }
    for (let i = 0; i < manualForm.subCriteria.length; i++) {
      const sc = manualForm.subCriteria[i];
      if (!sc.subCriteriaTitle?.trim()) { setErrorMessage(`Sub Criteria #${i + 1}: Title is required.`); return; }
      if (!rotarySections && (sc.answerType === "number" || sc.answerType === "yesno") && (!sc.points || Number(sc.points) <= 0)) { setErrorMessage(`Sub Criteria #${i + 1}: Points is required.`); return; }
      if (sc.answerType === "choose_one") {
        if (sc.options.length === 0) { setErrorMessage(`Sub Criteria #${i + 1}: Add at least one option.`); return; }
        for (let j = 0; j < sc.options.length; j++) {
          if (!sc.options[j].optionText?.trim()) { setErrorMessage(`Sub Criteria #${i + 1}, Option #${j + 1}: Text is required.`); return; }
        }
      }
    }
    setManualSaving(true);
    try {
      const payload = {
        yearId: selectedYearId, criteriaName: categoryNameOf(manualForm.categoryId), categoryId: await resolveCategoryId(manualForm.categoryId), sortOrder: Number(manualForm.sortOrder) || 0,
        subCriteria: manualForm.subCriteria.map((sc: any) => ({
          id: sc.id || 0, subCriteriaTitle: sc.subCriteriaTitle, answerType: sc.answerType,
          points: Number(sc.points) || 0, isBonus: sc.isBonus, bonusPoints: Number(sc.bonusPoints) || 0, minBonus: Number(sc.minBonus) || 0, maxBonus: Number(sc.maxBonus) || 0,
          remark: sc.remark, sortOrder: Number(sc.sortOrder) || 0,
          options: sc.answerType === "choose_one" ? sc.options.map((o: any) => ({ id: o.id || 0, optionText: o.optionText, optionPoints: Number(o.optionPoints) || 0, sortOrder: Number(o.sortOrder) || 0 })) : []
        }))
      };
      if (editingManual) await updateCitationManualCriteria(districtId, editingManual.id, payload);
      else await createCitationManualCriteria(districtId, payload);
      setManualDialogOpen(false); fetchManualCriteria(); setSuccessMessage(editingManual ? "Updated." : "Created.");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
    finally { setManualSaving(false); }
  };
  const handleDeleteManual = async () => {
    if (!deleteManual) return;
    try { await deleteCitationManualCriteria(districtId, deleteManual.id); fetchManualCriteria(); setSuccessMessage("Deleted."); }
    catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
    setDeleteManual(null);
  };

  const newBlankSub = () => ({ subCriteriaTitle: "", answerType: "number", points: "", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "", remark: "", sortOrder: "0", options: [] });
  const addManualSub = () => setManualForm((p: any) => ({ ...p, subCriteria: [...p.subCriteria, newBlankSub()] }));
  // Insert a new blank sub-criteria immediately AFTER row i, so an admin can add one BETWEEN existing
  // sub-criteria instead of only appending to the end (then reordering).
  const insertManualSubAfter = (i: number) => setManualForm((p: any) => {
    const arr = [...p.subCriteria];
    arr.splice(i + 1, 0, newBlankSub());
    return { ...p, subCriteria: arr };
  });
  const removeManualSub = (i: number) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.filter((_: any, idx: number) => idx !== i) }));
  const updateManualSub = (i: number, field: string, value: any) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.map((sc: any, idx: number) => idx === i ? { ...sc, [field]: value } : sc) }));
  const addManualOption = (subIdx: number) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.map((sc: any, i: number) => i === subIdx ? { ...sc, options: [...sc.options, { optionText: "", optionPoints: "", sortOrder: "0" }] } : sc) }));
  const removeManualOption = (subIdx: number, optIdx: number) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.map((sc: any, i: number) => i === subIdx ? { ...sc, options: sc.options.filter((_: any, j: number) => j !== optIdx) } : sc) }));
  const updateManualOption = (subIdx: number, optIdx: number, field: string, value: any) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.map((sc: any, i: number) => i === subIdx ? { ...sc, options: sc.options.map((o: any, j: number) => j === optIdx ? { ...o, [field]: value } : o) } : sc) }));

  const BonusFields = BonusFieldsInner;
  return {
    districtId, rotarySections, fetchEntryLabels, rccPointsTab, fe, router, pathname, searchParams, isSuperAdmin, isAdmin, user, canManage, rotaryYears, rights, editableYears, initialTab, loading, setLoading, activeTab, setActiveTab, successMessage, setSuccessMessage, errorMessage, setErrorMessage, awardsEnabled, setAwardsEnabled, togglingAwards, setTogglingAwards, clearStatus, setClearStatus, clearing, setClearing, restoring, setRestoring, showClearConfirm, setShowClearConfirm, showRestoreConfirm, setShowRestoreConfirm, allYears, setAllYears, yearsMeta, setYearsMeta, selectedYearId, setSelectedYearId, currentYearId, setCurrentYearId, isCurrentYear, clubGoals, startYearOf, selMeta, curMeta, isPastYear, holdsSelectedYear, canEdit, categories, setCategories, catDialogOpen, setCatDialogOpen, editingCat, setEditingCat, catName, setCatName, catSort, setCatSort, catSaving, setCatSaving, deleteCat, setDeleteCat, descHtml, setDescHtml, descSaving, setDescSaving, autoQuestions, setAutoQuestions, activities, setActivities, autoDialogOpen, setAutoDialogOpen, editingAuto, setEditingAuto, autoForm, setAutoForm, autoSaving, setAutoSaving, deleteAuto, setDeleteAuto, meetingTypes, setMeetingTypes, subItemData, setSubItemData, manualCriteria, setManualCriteria, manualDialogOpen, setManualDialogOpen, editingManual, setEditingManual, manualForm, setManualForm, manualSaving, setManualSaving, deleteManual, setDeleteManual, catsLoadedFor, setCatsLoadedFor, seededRef, isRotarySection, missingSections, sectionItems, resolveCategoryId, categoryNameOf, clubPoints, setClubPoints, clubPointsLoading, setClubPointsLoading, downloading, setDownloading, viewingClubId, setViewingClubId, downloadingClubId, setDownloadingClubId, viewClub, setViewClub, fetchCategories, fetchDescription, fetchAutoQuestions, fetchManualCriteria, fetchClubPoints, toggleAwards, refreshClearStatus, doClearPoints, doRestorePoints, openAddCat, openEditCat, handleSaveCat, handleDeleteCat, handleSaveDesc, openAddAuto, openEditAuto, handleSaveAuto, handleDeleteAuto, getModuleKeyFromActivity, loadAofList, addAutoSubItem, removeAutoSubItem, updateAutoSubItem, openAddManual, normalizeManualAnswerType, openEditManual, handleSaveManual, handleDeleteManual, newBlankSub, addManualSub, insertManualSubAfter, removeManualSub, updateManualSub, addManualOption, removeManualOption, updateManualOption, BonusFields,
  };
}

export type DistrictAwardsModuleState = ReturnType<typeof useDistrictAwards>;
