"use client";

/**
 * DistrictAwardsModule — reusable full District Awards admin module.
 *
 * Renders the 5-tab management UI (Categories, Description, Auto Questions,
 * Manual Questions, Club Points) that used to live in the V2 standalone page.
 * Now consumed by both:
 *   - /districts/[id]/citation/v2  (standalone admin page with SectionHeader)
 *   - /district-admin-dashboard/egovernance  (District Awards sub-tab)
 *
 * Does NOT render an outer page header or back navigation — the host page
 * owns those. It DOES own the year picker, the 4-KPI strip, the tab bar,
 * all tab bodies, and all dialogs.
 *
 * Integer-only inputs (step="1" + intOnly strip) and integer-only displays
 * (fmtInt / Math.round) — no decimals anywhere.
 */

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import "react-quill-new/dist/quill.snow.css";
import { fileTimestamp } from "@/lib/dateUtils";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const CITATION_DESC_MAX_CHARS = 1000;
const citationQuillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link", "clean"],
  ],
};

function citationPlainTextLength(html: string): number {
  if (typeof window === "undefined" || !html) return 0;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").length;
}

import {
  getRotaryYears, getCitationAvailableYears,
  getDistrictAwardsConfig, setDistrictAwardsConfig,
  getCitationCategoriesByDistrict, createCitationCategory, updateCitationCategory, deleteCitationCategory,
  getCitationDescription, saveCitationDescription,
  getCitationAutoQuestions, createCitationAutoQuestion, updateCitationAutoQuestion, deleteCitationAutoQuestion,
  getCitationActivities, getCitationMeetingTypes, getCitationAreaOfFocus, getCitationCategories as getCitationAofCategories, getCitationSubCategories,
  getCitationManualCriteria, createCitationManualCriteria, updateCitationManualCriteria, deleteCitationManualCriteria,
  getCitationClubPoints, downloadCitationClubReport, downloadCitationSingleClubReport,
  getAwardsClearStatus, clearAwardsPoints, restoreAwardsPoints, type AwardsClearStatus,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Plus, Pencil, Trash2, Save, AlertTriangle, FolderOpen, Download, Trophy, Eye, FileText, Sparkles, ClipboardList, ListChecks, ArrowLeft, RotateCcw } from "lucide-react";
import { ClubCitationV2View } from "@/app/clubs/[id]/citation/v2/view";
import RotaryLoader from "@/components/RotaryLoader";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, ROTARY_BLUE } from "@/components/dashboard/formatters";

// Integer-only onChange guard for number inputs.
const intOnly = (v: string) => v.replace(/[.,]/g, "").replace(/[^\d-]/g, "");

function BonusFieldsInner({ form, setField }: { form: any; setField: (f: string, v: any) => void }) {
  return (
    <div className="space-y-2 pl-4 border-l-2 border-amber-200">
      <div className="flex items-center gap-2">
        <Switch checked={form.isBonus} onCheckedChange={v => setField("isBonus", v)} /><Label className="text-sm">Bonus</Label>
      </div>
      {form.isBonus && (
        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-xs">Bonus Points</Label><Input type="number" step="1" value={form.bonusPoints} onChange={e => setField("bonusPoints", intOnly(e.target.value))} /></div>
          <div><Label className="text-xs">Min for Bonus</Label><Input type="number" step="1" value={form.minBonus} onChange={e => setField("minBonus", intOnly(e.target.value))} /></div>
          <div><Label className="text-xs">Max for Bonus</Label><Input type="number" step="1" value={form.maxBonus} onChange={e => setField("maxBonus", intOnly(e.target.value))} /></div>
        </div>
      )}
    </div>
  );
}

export default function DistrictAwardsModule({ districtId }: { districtId: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;
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
  // Start-year from a "2025-26" label; used to classify selected vs current year.
  const startYearOf = (y: any): number => { const m = /(\d{4})/.exec(String(y?.yearLabel || y?.YearLabel || "")); return m ? Number(m[1]) : 0; };
  const selMeta = yearsMeta.find((y: any) => y.id === selectedYearId);
  const curMeta = yearsMeta.find((y: any) => y.isCurrent);
  const isPastYear = !!(selMeta && curMeta && startYearOf(selMeta) < startYearOf(curMeta));
  // Edit permission: manager AND not a past year (current + future allowed).
  const canEdit = canManage && !isPastYear;

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
  const [autoForm, setAutoForm] = useState<any>({ categoryId: "", activityId: "", points: "", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "", sortOrder: "0", subItems: [] });
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

  useEffect(() => { getCitationActivities().then(setActivities).catch(() => {}); getCitationMeetingTypes().then(setMeetingTypes).catch(() => {}); }, []);

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

  const fetchCategories = async () => { try { setCategories(await getCitationCategoriesByDistrict(districtId, selectedYearId!)); } catch {} };
  const fetchDescription = async () => { try { const d = await getCitationDescription(districtId, selectedYearId!); setDescHtml(d.descriptionHtml || ""); } catch {} };
  const fetchAutoQuestions = async () => { try { setAutoQuestions(await getCitationAutoQuestions(districtId, selectedYearId!)); } catch {} };
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
      setSuccessMessage(next ? "District Awards enabled — clubs can enter points." : "District Awards disabled — clubs are now read-only.");
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
  const openAddAuto = () => { setEditingAuto(null); setAutoForm({ categoryId: "", activityId: "", points: "", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "", sortOrder: "0", subItems: [] }); setAutoDialogOpen(true); };
  const openEditAuto = async (q: any) => {
    setEditingAuto(q);
    const subs = (q.subItems || []).map((s: any) => ({
      ...s,
      points: String(s.points),
      bonusPoints: String(s.bonusPoints || ""),
      minBonus: String(s.minBonus || ""),
      maxBonus: String(s.maxBonus || ""),
      isBonus: !!s.isBonus,
      filterAofId: s.filterAofId || null,
      filterCatId: s.filterCatId || null,
    }));
    setAutoForm({
      categoryId: String(q.categoryId), activityId: String(q.activityId),
      points: String(q.points), isBonus: !!q.isBonus, bonusPoints: String(q.bonusPoints || ""), minBonus: String(q.minBonus || ""), maxBonus: String(q.maxBonus || ""),
      sortOrder: String(q.sortOrder), subItems: subs
    });
    setSubItemData({});
    setAutoDialogOpen(true);

    const actId = String(q.activityId);
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      if (sub.subItemType && sub.subItemType !== "meeting_type") {
        await loadAofList(i, actId);
        if (sub.filterAofId) { await loadCatList(i, sub.filterAofId); }
        if (sub.filterCatId) { await loadSubCatList(i, sub.filterCatId); }
      }
    }
  };
  const handleSaveAuto = async () => {
    if (!autoForm.categoryId || !autoForm.activityId) { setErrorMessage("Category and Activity required."); return; }
    const selActivity = activities.find((a: any) => String(a.id) === autoForm.activityId);
    const selActName = (selActivity?.activityName || "").toLowerCase();
    const isCommunityServiceSel = selActName.includes("community service");
    for (let i = 0; i < autoForm.subItems.length; i++) {
      const s = autoForm.subItems[i];
      if (!s.subItemId && s.subItemType !== "meeting_type") { setErrorMessage(`Sub Item #${i + 1}: Please select a value.`); return; }
      if (s.subItemType === "meeting_type" && !s.subItemName) { setErrorMessage(`Sub Item #${i + 1}: Please select a Meeting Type.`); return; }
      if (isCommunityServiceSel) {
        if (s.subItemType === "sub_category" && !s.filterAofId) { setErrorMessage(`Sub Item #${i + 1}: Please select Area of Focus first.`); return; }
        if (s.subItemType === "sub_category" && !s.filterCatId) { setErrorMessage(`Sub Item #${i + 1}: Please select Category first.`); return; }
      } else {
        if (s.subItemType === "sub_category" && !s.filterCatId) { setErrorMessage(`Sub Item #${i + 1}: Please select Category first.`); return; }
      }
      if (!s.points || Number(s.points) <= 0) { setErrorMessage(`Sub Item #${i + 1}: Points is required.`); return; }
    }
    setAutoSaving(true);
    try {
      const payload = {
        yearId: selectedYearId, categoryId: Number(autoForm.categoryId), activityId: Number(autoForm.activityId),
        points: Number(autoForm.points) || 0, isBonus: autoForm.isBonus, bonusPoints: Number(autoForm.bonusPoints) || 0,
        minBonus: Number(autoForm.minBonus) || 0, maxBonus: Number(autoForm.maxBonus) || 0, sortOrder: Number(autoForm.sortOrder) || 0,
        subItems: autoForm.subItems.map((s: any) => ({ subItemType: s.subItemType, subItemId: s.subItemId || null, subItemName: s.subItemName || null,
          filterAofId: s.filterAofId || null, filterCatId: s.filterCatId || null,
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
      setSubItemData(prev => ({ ...prev, [index]: { aofList: list, catList: [], subCatList: [] } }));
    } catch {}
  };

  const loadCatList = async (index: number, aofId: number) => {
    try {
      const list = await getCitationAofCategories(aofId);
      setSubItemData(prev => ({ ...prev, [index]: { ...prev[index], catList: list, subCatList: [] } }));
    } catch {}
  };

  const loadSubCatList = async (index: number, catId: number) => {
    try {
      const list = await getCitationSubCategories(catId);
      setSubItemData(prev => ({ ...prev, [index]: { ...prev[index], subCatList: list } }));
    } catch {}
  };

  const addAutoSubItem = () => setAutoForm((p: any) => ({ ...p, subItems: [...p.subItems, { subItemType: "", subItemId: null, subItemName: "", filterAofId: null, filterCatId: null, points: "", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "" }] }));
  const removeAutoSubItem = (i: number) => {
    setAutoForm((p: any) => ({ ...p, subItems: p.subItems.filter((_: any, idx: number) => idx !== i) }));
    // subItemData is keyed by row index and holds each row's dropdown option lists (aofList/catList/
    // subCatList). Removing row `i` shifts every later row down by one, so re-key the map to match —
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
  const normalizeManualAnswerType = (raw: any, hasOptions: boolean): "number" | "yesno" | "choose_one" => {
    const r = String(raw ?? "").toLowerCase().trim().replace(/[\s_\-/]/g, "");
    if (r === "yesno" || r === "yn" || r === "boolean" || r === "bool" || r === "yes" || r === "no") return "yesno";
    if (r === "chooseone" || r === "choose" || r === "select" || r === "option" || r === "options" || r === "radio" || hasOptions) return "choose_one";
    return "number";
  };

  const openEditManual = (mc: any) => {
    setEditingManual(mc);
    setManualForm({
      categoryId: String(mc.categoryId), sortOrder: String(mc.sortOrder),
      subCriteria: (mc.subCriteria || []).map((sc: any) => ({
        subCriteriaTitle: sc.subCriteriaTitle || "",
        answerType: normalizeManualAnswerType(sc.answerType, Array.isArray(sc.options) && sc.options.length > 0),
        points: String(sc.points || ""), isBonus: !!sc.isBonus, bonusPoints: String(sc.bonusPoints || ""), minBonus: String(sc.minBonus || ""), maxBonus: String(sc.maxBonus || ""),
        remark: sc.remark || "", sortOrder: String(sc.sortOrder || "0"),
        options: (sc.options || []).map((o: any) => ({ optionText: o.optionText, optionPoints: String(o.optionPoints || ""), sortOrder: String(o.sortOrder || "0") }))
      }))
    });
    setManualDialogOpen(true);
  };
  const handleSaveManual = async () => {
    if (!manualForm.categoryId) { setErrorMessage("Category is required."); return; }
    for (let i = 0; i < manualForm.subCriteria.length; i++) {
      const sc = manualForm.subCriteria[i];
      if (!sc.subCriteriaTitle?.trim()) { setErrorMessage(`Sub Criteria #${i + 1}: Title is required.`); return; }
      if ((sc.answerType === "number" || sc.answerType === "yesno") && (!sc.points || Number(sc.points) <= 0)) { setErrorMessage(`Sub Criteria #${i + 1}: Points is required.`); return; }
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
        yearId: selectedYearId, categoryId: Number(manualForm.categoryId), criteriaName: categories.find((c: any) => String(c.id) === manualForm.categoryId)?.categoryName || "", sortOrder: Number(manualForm.sortOrder) || 0,
        subCriteria: manualForm.subCriteria.map((sc: any) => ({
          subCriteriaTitle: sc.subCriteriaTitle, answerType: sc.answerType,
          points: Number(sc.points) || 0, isBonus: sc.isBonus, bonusPoints: Number(sc.bonusPoints) || 0, minBonus: Number(sc.minBonus) || 0, maxBonus: Number(sc.maxBonus) || 0,
          remark: sc.remark, sortOrder: Number(sc.sortOrder) || 0,
          options: sc.answerType === "choose_one" ? sc.options.map((o: any) => ({ optionText: o.optionText, optionPoints: Number(o.optionPoints) || 0, sortOrder: Number(o.sortOrder) || 0 })) : []
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

  if (loading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;

  // Configuration (categories / questions / criteria) is ALWAYS editable — the activation flag
  // only gates CLUB point entry. So there's no "Coming soon" block here; instead a disabled
  // notice (below) explains the state while the admin keeps building the awards.
  const kpiCategories = categories.length;
  const kpiAuto = autoQuestions.length;
  const kpiManual = manualCriteria.length;
  const kpiClubs = clubPoints.length;

  return (
    <div className="space-y-6">
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

      {/* Year picker removed — District Awards always uses the global (current)
          rotary year. add/edit/delete stay gated to the current year. */}

      {/* ── Top KPI tiles ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Categories" value={fmtInt(kpiCategories)} subtitle="Main award groups" icon={FolderOpen} color="blue" />
        <KpiCard title="Auto Questions" value={fmtInt(kpiAuto)} subtitle="System-scored" icon={Sparkles} color="purple" />
        <KpiCard title="Manual Criteria" value={fmtInt(kpiManual)} subtitle="Admin-entered" icon={ClipboardList} color="gold" />
        <KpiCard title="Clubs Reported" value={fmtInt(kpiClubs)} subtitle="With points this RY" icon={Trophy} color="green" />
      </div>

      {/* ── Tabs panel ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">District Awards Configuration</h3>
            <p className="text-xs text-slate-500 mt-0.5">Categories, description, auto & manual questions, and club leaderboard</p>
          </div>
          {/* Status + SuperAdmin-only enable/disable. Disabled ⇒ clubs are read-only (API-enforced). */}
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${awardsEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
              {awardsEnabled ? "Active" : "Disabled"}
            </span>
            {isSuperAdmin && (
              <Button
                size="sm"
                variant={awardsEnabled ? "outline" : "default"}
                disabled={togglingAwards}
                onClick={() => toggleAwards(!awardsEnabled)}
                className={awardsEnabled ? "" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
              >
                {togglingAwards ? "Saving…" : awardsEnabled ? "Disable" : "Enable"}
              </Button>
            )}
            {/* SuperAdmin-only: Clear all clubs' points (+ Restore) for this district & year. */}
            {isSuperAdmin && clearStatus && (
              <>
                <Button
                  size="sm" variant="outline"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                  disabled={clearing || !clearStatus.canClear}
                  onClick={() => setShowClearConfirm(true)}
                  title={clearStatus.canClear ? "Clear all clubs' points for this district & year" : "No club points to clear"}
                >
                  <Trash2 className="h-4 w-4 mr-1" />{clearing ? "Clearing…" : "Clear all clubs points"}
                </Button>
                {clearStatus.canRestore && (
                  <Button
                    size="sm" variant="outline"
                    disabled={restoring}
                    onClick={() => setShowRestoreConfirm(true)}
                    title={`Restore the points cleared on ${clearStatus.lastClearedDate ?? ""}`}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />{restoring ? "Restoring…" : "Restore"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        {/* No "not activated" banner here — this IS the add/edit District Awards area (the
            exception). The Active/Disabled chip + SuperAdmin toggle above convey the state, and
            configuring categories/questions/criteria stays fully editable regardless. */}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="px-5 pt-3">
            <TabsList className="bg-slate-100 h-9 w-full justify-start sm:w-auto flex-wrap">
              <TabsTrigger value="categories">Categories</TabsTrigger>
              <TabsTrigger value="description">Description</TabsTrigger>
              <TabsTrigger value="auto">Auto Questions</TabsTrigger>
              <TabsTrigger value="manual">Manual Questions</TabsTrigger>
              <TabsTrigger value="club_points">Club Points</TabsTrigger>
            </TabsList>
          </div>

          {/* Categories Tab */}
          <TabsContent value="categories" className="p-5 pt-4">
            <div className="space-y-4">
              {canEdit && (
                <div className="flex justify-end">
                  <Button onClick={openAddCat}><Plus className="mr-2 h-4 w-4" />Add Category</Button>
                </div>
              )}
              {categories.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white flex flex-col items-center py-12">
                  <FolderOpen className="h-10 w-10 text-slate-300 mb-3" />
                  <p className="text-sm text-slate-500">No categories. Add one to get started.</p>
                </div>
              ) : (
                <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                  {categories.map((c: any) => (
                    <li key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-blue-50/40 transition">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 flex items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                          <FolderOpen size={16} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{c.categoryName}</p>
                          <p className="text-[11px] text-slate-500">Sort order: {fmtInt(c.sortOrder)}</p>
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditCat(c)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteCat(c)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          {/* Description Tab */}
          <TabsContent value="description" className="p-5 pt-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-semibold text-slate-800">Description</Label>
                  <p className="text-[11px] text-slate-500 mt-0.5">Visible to clubs · max {fmtInt(CITATION_DESC_MAX_CHARS)} characters</p>
                </div>
                <FileText className="h-5 w-5 text-slate-300" />
              </div>
              {canEdit ? (
                <div className="space-y-2">
                  <div className="min-h-[300px]">
                    <ReactQuill
                      theme="snow"
                      value={descHtml}
                      onChange={setDescHtml}
                      modules={citationQuillModules}
                      placeholder="Enter description..."
                      style={{ height: "250px", marginBottom: "42px" }}
                    />
                  </div>
                  {(() => {
                    const used = citationPlainTextLength(descHtml);
                    const remaining = CITATION_DESC_MAX_CHARS - used;
                    const over = remaining < 0;
                    return (
                      <p className={`text-xs text-right ${over ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {fmtInt(used)}/{fmtInt(CITATION_DESC_MAX_CHARS)} characters{over ? ` (${fmtInt(Math.abs(remaining))} over limit)` : ""}
                      </p>
                    );
                  })()}
                  <div className="flex justify-end">
                    <Button onClick={handleSaveDesc} disabled={descSaving || citationPlainTextLength(descHtml) > CITATION_DESC_MAX_CHARS}>
                      {descSaving ? "Saving..." : "Next"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="prose prose-sm max-w-none break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_a]:break-all border rounded-md p-4 min-h-[200px]"
                  dangerouslySetInnerHTML={{ __html: descHtml || "<p class='text-muted-foreground'>No description.</p>" }}
                />
              )}
            </div>
          </TabsContent>

          {/* Auto Questions Tab */}
          <TabsContent value="auto" className="p-5 pt-4">
            <div className="space-y-4">
              {canEdit && (
                <div className="flex justify-end">
                  <Button onClick={openAddAuto}><Plus className="mr-2 h-4 w-4" />Add Auto Question</Button>
                </div>
              )}
              {autoQuestions.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white flex flex-col items-center py-12">
                  <Sparkles className="h-10 w-10 text-slate-300 mb-3" />
                  <p className="text-sm text-slate-500">No auto questions.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {autoQuestions.map((q: any) => (
                    <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-sm transition">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">{q.categoryName}</Badge>
                            <p className="font-semibold text-sm text-slate-800">{q.activityName}</p>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 tabular-nums">
                            Points: <span className="font-semibold text-slate-700">{fmtInt(Math.round(Number(q.points) || 0))}</span>
                            {q.isBonus ? <> &middot; Bonus: <span className="font-semibold text-amber-700">{fmtInt(Math.round(Number(q.bonusPoints) || 0))}</span> (Min: {fmtInt(Math.round(Number(q.minBonus) || 0))}, Max: {fmtInt(Math.round(Number(q.maxBonus) || 0))})</> : null}
                          </p>
                          {q.subItems && q.subItems.length > 0 && (
                            <div className="mt-2 pl-3 border-l-2 border-slate-100 space-y-1">
                              {q.subItems.map((s: any) => {
                                const t = String(s.subItemType || "").toLowerCase();
                                // subItemName is the exact label chosen in the edit popup's dropdown (saved on
                                // select), so it always matches the edit view. The backend-JOINed
                                // areaOfFocusName/categoryName/subCategoryName can be wrong: for non-Community-
                                // Service activities the stored id is an area-of-focus id tagged 'category', so the
                                // JOIN resolves the wrong master row. Prefer subItemName; fall back only if empty.
                                let lineage = s.subItemName || "";
                                if (!lineage) {
                                  if (t === "area_of_focus") {
                                    lineage = s.areaOfFocusName || `#${s.subItemId}`;
                                  } else if (t === "category") {
                                    lineage = s.categoryName || `#${s.subItemId}`;
                                  } else if (t === "sub_category" || t === "subcategory") {
                                    lineage = s.subCategoryName || `#${s.subItemId}`;
                                  } else {
                                    lineage = s.subItemId ? `#${s.subItemId}` : "";
                                  }
                                }
                                const typeLabel = t.replace(/_/g, " ");
                                return (
                                  <p key={s.id} className="text-xs text-slate-600">
                                    <span className="font-medium text-slate-700">{typeLabel}{typeLabel ? ": " : ""}{lineage}</span>
                                    {" "}— Points: <span className="tabular-nums font-semibold">{fmtInt(Math.round(Number(s.points) || 0))}</span>
                                    {s.isBonus ? <> &middot; Bonus: <span className="tabular-nums font-semibold text-amber-700">{fmtInt(Math.round(Number(s.bonusPoints) || 0))}</span></> : null}
                                  </p>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {canEdit && (
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" onClick={() => openEditAuto(q)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteAuto(q)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Manual Questions Tab */}
          <TabsContent value="manual" className="p-5 pt-4">
            <div className="space-y-4">
              {canEdit && (
                <div className="flex justify-end">
                  <Button onClick={openAddManual}><Plus className="mr-2 h-4 w-4" />Add Manual Criteria</Button>
                </div>
              )}
              {manualCriteria.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white flex flex-col items-center py-12">
                  <ListChecks className="h-10 w-10 text-slate-300 mb-3" />
                  <p className="text-sm text-slate-500">No manual criteria.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {manualCriteria.map((mc: any) => (
                    <div key={mc.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-sm transition">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50">{mc.categoryName}</Badge>
                            <p className="font-semibold text-sm text-slate-800">{mc.criteriaName}</p>
                          </div>
                          {mc.subCriteria && mc.subCriteria.length > 0 && (
                            <div className="mt-2 pl-3 border-l-2 border-slate-100 space-y-1">
                              {mc.subCriteria.map((sc: any) => (
                                <div key={sc.id} className="text-xs text-slate-600">
                                  <span className="font-medium text-slate-700">{sc.subCriteriaTitle}</span>
                                  <span className="text-slate-400"> ({sc.answerType})</span>
                                  {sc.answerType === "number" && <span> — Points: <span className="tabular-nums font-semibold">{fmtInt(Math.round(Number(sc.points) || 0))}</span>{sc.isBonus ? <> &middot; Bonus: <span className="tabular-nums font-semibold text-amber-700">{fmtInt(Math.round(Number(sc.bonusPoints) || 0))}</span></> : null}</span>}
                                  {sc.answerType === "yesno" && <span> — Base Points: <span className="tabular-nums font-semibold">{fmtInt(Math.round(Number(sc.points) || 0))}</span></span>}
                                  {sc.answerType === "choose_one" && sc.options && <span> — {fmtInt(sc.options.length)} options</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {canEdit && (
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" onClick={() => openEditManual(mc)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteManual(mc)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Club Points Tab — bulk "Download Report" intentionally removed.
              The same report is downloadable from the E-Governance ▸ Reports
              tab (District Awards / District Awards Extended). Per-row single
              club download is kept since it's a different artifact. */}
          <TabsContent value="club_points" className="p-5 pt-4">
            {viewClub ? (
              <div className="space-y-4">
                <Button variant="outline" size="sm" onClick={() => setViewClub(null)}>
                  <ArrowLeft className="mr-2 h-4 w-4" />Back to Club Points
                </Button>
                <ClubCitationV2View
                  clubId={viewClub.id}
                  embedded
                  readOnly
                  districtId={districtId}
                  yearId={selectedYearId}
                />
              </div>
            ) : (
            <div className="space-y-4">
              {clubPointsLoading ? (
                <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 hover:bg-slate-50 border-b border-slate-200">
                        <TableHead className="text-slate-600 w-14 text-xs font-semibold uppercase tracking-wider">#</TableHead>
                        <TableHead className="text-slate-600 text-xs font-semibold uppercase tracking-wider">Club</TableHead>
                        <TableHead className="text-slate-600 text-center text-xs font-semibold uppercase tracking-wider">Total Points</TableHead>
                        <TableHead className="text-slate-600 text-center w-32 text-xs font-semibold uppercase tracking-wider">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clubPoints.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-400 text-sm">No club data</TableCell></TableRow>
                      ) : clubPoints.map((c: any, i: number) => {
                        const total = Math.round(Number(c.totalPoints) || 0);
                        const isTop3 = i < 3;
                        return (
                          <TableRow key={c.clubId} className="hover:bg-blue-50/40">
                            <TableCell className="font-semibold tabular-nums text-slate-700">
                              <span className="inline-flex items-center gap-1">
                                {fmtInt(i + 1)}
                                {isTop3 && <Trophy className="h-3.5 w-3.5" style={{ color: i === 0 ? "#F7A81B" : i === 1 ? "#9CA3AF" : "#B45309" }} />}
                              </span>
                            </TableCell>
                            <TableCell className="font-medium text-slate-800">{c.clubName}</TableCell>
                            <TableCell className="text-center">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold tabular-nums ring-1 ${
                                  total > 0 ? "bg-blue-50 text-blue-700 ring-blue-100" : "bg-slate-50 text-slate-500 ring-slate-200"
                                }`}
                                style={total > 0 ? { color: ROTARY_BLUE } : undefined}
                              >
                                {fmtInt(total)}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <Button variant="ghost" size="icon" title="View" onClick={() => setViewClub({ id: c.clubId, name: c.clubName })}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Category Dialog ──────────────────────────────────────────── */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="max-w-md"><DialogHeader>
          <DialogTitle>{editingCat ? "Edit Category" : "Add Category"}</DialogTitle>
          <DialogDescription>Main criteria category for district awards.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div><Label>Category Name *</Label><Input value={catName} onChange={e => setCatName(e.target.value)} /></div>
          <div><Label>Sort Order</Label><Input type="number" step="1" value={catSort} onChange={e => setCatSort(intOnly(e.target.value))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveCat} disabled={catSaving}>{catSaving ? "Saving..." : editingCat ? "Update" : "Add"}</Button>
        </DialogFooter></DialogContent>
      </Dialog>

      {/* ── Auto Question Dialog ─────────────────────────────────────── */}
      <Dialog open={autoDialogOpen} onOpenChange={setAutoDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader>
          <DialogTitle>{editingAuto ? "Edit Auto Question" : "Add Auto Question"}</DialogTitle>
          <DialogDescription>Configure auto-calculated award question.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Category *</Label>
              <Select value={autoForm.categoryId} onValueChange={v => setAutoForm((p: any) => ({ ...p, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{categories.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.categoryName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Activity *</Label>
              <Select value={autoForm.activityId} onValueChange={v => setAutoForm((p: any) => ({ ...p, activityId: v, subItems: [] }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{activities.map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.activityName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Points</Label><Input type="number" step="1" value={autoForm.points} onChange={e => setAutoForm((p: any) => ({ ...p, points: intOnly(e.target.value) }))} /></div>
            <div><Label>Sort Order</Label><Input type="number" step="1" value={autoForm.sortOrder} onChange={e => setAutoForm((p: any) => ({ ...p, sortOrder: intOnly(e.target.value) }))} /></div>
          </div>
          <BonusFields form={autoForm} setField={(f, v) => setAutoForm((p: any) => ({ ...p, [f]: v }))} />

          {/* Sub Items based on activity type */}
          {(() => {
            const selectedActivity = activities.find((a: any) => String(a.id) === autoForm.activityId);
            if (!selectedActivity || selectedActivity.subType !== 1) return null;
            const actName = (selectedActivity.activityName || "").toLowerCase();
            const isClubService = actName.includes("club service");
            const isCommunityService = actName.includes("community service");

            let subItemTypeOptions: { value: string; label: string }[] = [];
            let sectionLabel = "";
            if (isClubService) {
              sectionLabel = "Meeting Types";
            } else if (isCommunityService) {
              sectionLabel = "Area of Focus / Category / Sub Category";
              subItemTypeOptions = [
                { value: "area_of_focus", label: "Area of Focus" },
                { value: "category", label: "Category" },
                { value: "sub_category", label: "Sub Category" },
              ];
            } else {
              sectionLabel = "Category / Sub Category";
              subItemTypeOptions = [
                { value: "category", label: "Category" },
                { value: "sub_category", label: "Sub Category" },
              ];
            }

            return (
              <div className="space-y-3 border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold">{sectionLabel}</Label>
                  <Button size="sm" variant="outline" onClick={addAutoSubItem}><Plus className="h-3 w-3 mr-1" />Add</Button>
                </div>
                {autoForm.subItems.map((sub: any, i: number) => (
                  <Card key={i}><CardContent className="p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-sm font-medium">#{i + 1}</Label>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAutoSubItem(i)}><Trash2 className="h-3 w-3" /></Button>
                    </div>

                    {isClubService ? (
                      <div>
                        <Label className="text-xs">Meeting Type</Label>
                        <Select value={sub.subItemName || ""} onValueChange={v => { updateAutoSubItem(i, "subItemType", "meeting_type"); updateAutoSubItem(i, "subItemName", v); updateAutoSubItem(i, "subItemId", null); }}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Select Meeting Type" /></SelectTrigger>
                          <SelectContent>
                            {meetingTypes.map((mt: any) => <SelectItem key={mt.id} value={mt.name}>{mt.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs">Points For</Label>
                          <Select value={sub.subItemType || ""} onValueChange={v => {
                            updateAutoSubItem(i, "subItemType", v);
                            updateAutoSubItem(i, "subItemId", null);
                            updateAutoSubItem(i, "subItemName", "");
                            updateAutoSubItem(i, "filterAofId", null);
                            updateAutoSubItem(i, "filterCatId", null);
                            setSubItemData(prev => ({ ...prev, [i]: {} }));
                            loadAofList(i, autoForm.activityId);
                          }}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Select Type" /></SelectTrigger>
                            <SelectContent>
                              {subItemTypeOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>

                        {sub.subItemType && (() => {
                          const data = subItemData[i] || {};
                          const aofList = data.aofList || [];
                          const catList = data.catList || [];
                          const subCatList = data.subCatList || [];

                          const aofLabel = isCommunityService ? "Area of Focus" : "Category";
                          const catLabel = isCommunityService ? "Category" : "Sub Category";
                          const subCatLabel = "Sub Category";

                          const isPointsForAof = sub.subItemType === "area_of_focus";
                          const isPointsForCat = sub.subItemType === "category";
                          const isPointsForSubCat = sub.subItemType === "sub_category";

                          const isLevel1Final = isCommunityService ? isPointsForAof : isPointsForCat;
                          const isLevel2Final = isCommunityService ? isPointsForCat : isPointsForSubCat;
                          const showLevel2 = isCommunityService
                            ? (isPointsForCat || isPointsForSubCat)
                            : isPointsForSubCat;
                          const showLevel3 = isCommunityService && isPointsForSubCat;
                          const level1FilterField = isCommunityService ? "filterAofId" : "filterCatId";
                          const level1FilterValue = isCommunityService ? sub.filterAofId : sub.filterCatId;

                          return (<>
                            <div>
                              <Label className="text-xs">{aofLabel}{!isLevel1Final && <span className="text-muted-foreground"> (filter)</span>}</Label>
                              <Select value={isLevel1Final ? (sub.subItemId ? String(sub.subItemId) : "") : (level1FilterValue ? String(level1FilterValue) : "")} onValueChange={v => {
                                if (isLevel1Final) {
                                  const sel = aofList.find((it: any) => String(it.id) === v);
                                  updateAutoSubItem(i, "subItemId", Number(v));
                                  updateAutoSubItem(i, "subItemName", sel?.name || "");
                                  updateAutoSubItem(i, "filterAofId", null);
                                  updateAutoSubItem(i, "filterCatId", null);
                                } else {
                                  updateAutoSubItem(i, level1FilterField, Number(v));
                                  if (isCommunityService) updateAutoSubItem(i, "filterCatId", null);
                                  else updateAutoSubItem(i, "filterAofId", null);
                                  updateAutoSubItem(i, "subItemId", null);
                                  updateAutoSubItem(i, "subItemName", "");
                                  if (isCommunityService) loadCatList(i, Number(v));
                                  else loadSubCatList(i, Number(v));
                                }
                              }}>
                                <SelectTrigger className="h-8"><SelectValue placeholder={`Select ${aofLabel}`} /></SelectTrigger>
                                <SelectContent>{aofList.map((it: any) => <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>

                            {showLevel2 && level1FilterValue && (
                              (isCommunityService ? catList.length > 0 : subCatList.length > 0) && (
                                <div>
                                  <Label className="text-xs">{catLabel}{!isLevel2Final && isCommunityService && <span className="text-muted-foreground"> (filter)</span>}</Label>
                                  <Select value={isLevel2Final ? (sub.subItemId ? String(sub.subItemId) : "") : (sub.filterCatId ? String(sub.filterCatId) : "")} onValueChange={v => {
                                    const list = isCommunityService ? catList : subCatList;
                                    if (isLevel2Final) {
                                      const sel = list.find((it: any) => String(it.id) === v);
                                      updateAutoSubItem(i, "subItemId", Number(v));
                                      updateAutoSubItem(i, "subItemName", sel?.name || "");
                                    } else {
                                      updateAutoSubItem(i, "filterCatId", Number(v));
                                      updateAutoSubItem(i, "subItemId", null);
                                      updateAutoSubItem(i, "subItemName", "");
                                      loadSubCatList(i, Number(v));
                                    }
                                  }}>
                                    <SelectTrigger className="h-8"><SelectValue placeholder={`Select ${catLabel}`} /></SelectTrigger>
                                    <SelectContent>{(isCommunityService ? catList : subCatList).map((it: any) => <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>)}</SelectContent>
                                  </Select>
                                </div>
                              )
                            )}

                            {showLevel3 && sub.filterCatId && subCatList.length > 0 && (
                              <div>
                                <Label className="text-xs">{subCatLabel}</Label>
                                <Select value={sub.subItemId ? String(sub.subItemId) : ""} onValueChange={v => {
                                  const sel = subCatList.find((it: any) => String(it.id) === v);
                                  updateAutoSubItem(i, "subItemId", Number(v));
                                  updateAutoSubItem(i, "subItemName", sel?.name || "");
                                }}>
                                  <SelectTrigger className="h-8"><SelectValue placeholder={`Select ${subCatLabel}`} /></SelectTrigger>
                                  <SelectContent>{subCatList.map((it: any) => <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>)}</SelectContent>
                                </Select>
                              </div>
                            )}
                          </>);
                        })()}
                      </div>
                    )}

                    <div><Label className="text-xs">Points</Label><Input type="number" step="1" className="h-8" value={sub.points} onChange={e => updateAutoSubItem(i, "points", intOnly(e.target.value))} /></div>
                    <BonusFields form={sub} setField={(f, v) => updateAutoSubItem(i, f, v)} />
                  </CardContent></Card>
                ))}
              </div>
            );
          })()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAutoDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveAuto} disabled={autoSaving}>{autoSaving ? "Saving..." : editingAuto ? "Update" : "Add"}</Button>
        </DialogFooter></DialogContent>
      </Dialog>

      {/* ── Manual Criteria Dialog ───────────────────────────────────── */}
      <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader>
          <DialogTitle>{editingManual ? "Edit Manual Criteria" : "Add Manual Criteria"}</DialogTitle>
          <DialogDescription>Add main criteria with sub criteria.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div><Label>Category *</Label>
            <Select value={manualForm.categoryId} onValueChange={v => setManualForm((p: any) => ({ ...p, categoryId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{categories.filter((c: any) => {
                const usedCatIds = manualCriteria.filter((mc: any) => !editingManual || mc.id !== editingManual.id).map((mc: any) => mc.categoryId);
                return !usedCatIds.includes(c.id);
              }).map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.categoryName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Sort Order</Label><Input type="number" step="1" value={manualForm.sortOrder} onChange={e => setManualForm((p: any) => ({ ...p, sortOrder: intOnly(e.target.value) }))} /></div>

          <div className="space-y-3 border rounded-lg p-3">
            <div className="flex items-center justify-between"><Label className="font-semibold">Sub Criteria</Label><Button size="sm" variant="outline" onClick={addManualSub}><Plus className="h-3 w-3 mr-1" />Add Sub Criteria</Button></div>
            {manualForm.subCriteria.map((sc: any, i: number) => (
              <Card key={i}><CardContent className="p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm font-medium">Sub Criteria #{i + 1}</Label>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-600" title="Add a new sub criteria below this one" onClick={() => insertManualSubAfter(i)}><Plus className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="Remove this sub criteria" onClick={() => removeManualSub(i)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
                <div><Label className="text-xs">Title</Label><Input value={sc.subCriteriaTitle} onChange={e => updateManualSub(i, "subCriteriaTitle", e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Answer Type</Label>
                    <Select value={sc.answerType} onValueChange={v => updateManualSub(i, "answerType", v)}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="yesno">Yes/No</SelectItem>
                        <SelectItem value="choose_one">Choose One</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {sc.answerType !== "choose_one" && <div><Label className="text-xs">Points</Label><Input type="number" step="1" className="h-8" value={sc.points} onChange={e => updateManualSub(i, "points", intOnly(e.target.value))} /></div>}
                </div>
                {sc.answerType === "number" && <BonusFields form={sc} setField={(f, v) => updateManualSub(i, f, v)} />}
                {sc.answerType === "choose_one" && (
                  <div className="space-y-2 pl-3 border-l-2 border-blue-200">
                    <div className="flex items-center justify-between"><Label className="text-xs font-medium">Options</Label><Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => addManualOption(i)}><Plus className="h-2 w-2 mr-1" />Add Option</Button></div>
                    {sc.options.map((o: any, j: number) => (
                      <div key={j} className="flex gap-2 items-center">
                        <Input className="h-7 text-xs flex-1" value={o.optionText} onChange={e => updateManualOption(i, j, "optionText", e.target.value)} placeholder="Option text" />
                        <Input className="h-7 text-xs w-20" type="number" step="1" value={o.optionPoints} onChange={e => updateManualOption(i, j, "optionPoints", intOnly(e.target.value))} placeholder="Points" />
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeManualOption(i, j)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    ))}
                  </div>
                )}
                <div><Label className="text-xs">Remark</Label><Input className="h-8" value={sc.remark} onChange={e => updateManualSub(i, "remark", e.target.value)} /></div>
              </CardContent></Card>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setManualDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveManual} disabled={manualSaving}>{manualSaving ? "Saving..." : editingManual ? "Update" : "Add"}</Button>
        </DialogFooter></DialogContent>
      </Dialog>

      {/* Delete confirmations */}
      <AlertModal open={!!deleteCat} onOpenChange={o => !o && setDeleteCat(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Category" description={<>Delete <strong>{deleteCat?.categoryName}</strong>?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDeleteCat} cancelLabel="Cancel" onCancel={() => setDeleteCat(null)} />
      <AlertModal open={!!deleteAuto} onOpenChange={o => !o && setDeleteAuto(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Auto Question" description={<>Delete this auto question?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDeleteAuto} cancelLabel="Cancel" onCancel={() => setDeleteAuto(null)} />
      <AlertModal open={!!deleteManual} onOpenChange={o => !o && setDeleteManual(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Manual Criteria" description={<>Delete <strong>{deleteManual?.criteriaName}</strong> and all sub criteria?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDeleteManual} cancelLabel="Cancel" onCancel={() => setDeleteManual(null)} />

      {/* Clear all clubs points — SuperAdmin confirm (destructive; backed up + emailed + restorable). */}
      <AlertModal
        open={showClearConfirm} onOpenChange={o => !o && setShowClearConfirm(false)}
        icon={AlertTriangle} iconClassName="text-destructive"
        title="Clear ALL clubs' points?"
        description={<>
          This clears <strong>{clearStatus?.liveEntryCount ?? 0} point entr{(clearStatus?.liveEntryCount ?? 0) === 1 ? "y" : "ies"}</strong> across{" "}
          <strong>{clearStatus?.liveClubCount ?? 0} club{(clearStatus?.liveClubCount ?? 0) === 1 ? "" : "s"}</strong> in <strong>this district only</strong> (for the selected year).
          One club has many answered questions/criteria, so entries are more than clubs. A full <strong>backup is taken</strong> and an <strong>Excel is emailed to the DG &amp; District Admins</strong>. You can <strong>Restore</strong> it afterwards. Continue?
        </>}
        confirmLabel={clearing ? "Clearing…" : "Yes, clear all"}
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={doClearPoints} cancelLabel="Cancel" onCancel={() => setShowClearConfirm(false)}
      />
      {/* Restore cleared points — SuperAdmin confirm. */}
      <AlertModal
        open={showRestoreConfirm} onOpenChange={o => !o && setShowRestoreConfirm(false)}
        icon={RotateCcw} iconClassName="text-blue-600"
        title="Restore cleared points?"
        description={<>
          Restore the <strong>{clearStatus?.lastClearedCount ?? 0}</strong> entr{(clearStatus?.lastClearedCount ?? 0) === 1 ? "y" : "ies"} cleared on <strong>{clearStatus?.lastClearedDate ?? ""}</strong>?
          Any points entered since the clear will be replaced by the backup.
        </>}
        confirmLabel={restoring ? "Restoring…" : "Yes, restore"}
        onConfirm={doRestorePoints} cancelLabel="Cancel" onCancel={() => setShowRestoreConfirm(false)}
      />
    </div>
  );
}
