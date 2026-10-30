"use client";

import { useState, useEffect, useCallback, memo } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
  getDistrict, getRotaryYears, getCitationAvailableYears,
  getCitationCategoriesByDistrict, createCitationCategory, updateCitationCategory, deleteCitationCategory,
  getCitationDescription, saveCitationDescription,
  getCitationAutoQuestions, createCitationAutoQuestion, updateCitationAutoQuestion, deleteCitationAutoQuestion,
  getCitationActivities, getCitationMeetingTypes, getCitationAreaOfFocus,
  getCitationManualCriteria, createCitationManualCriteria, updateCitationManualCriteria, deleteCitationManualCriteria,
  getCitationClubPoints, downloadCitationClubReport, downloadCitationSingleClubReport,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, Save, AlertTriangle, FolderOpen, Download, Trophy, Eye } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ListPageSkeleton } from "@/components/row/AppKit";

function BonusFieldsInner({ form, setField }: { form: any; setField: (f: string, v: any) => void }) {
  return (
    <div className="space-y-2 pl-4 border-l-2 border-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <Switch checked={form.isBonus} onCheckedChange={v => setField("isBonus", v)} /><Label className="text-sm">Bonus</Label>
      </div>
      {form.isBonus && (
        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-xs">Bonus Points</Label><Input type="number" value={form.bonusPoints} onChange={e => setField("bonusPoints", e.target.value)} /></div>
          <div><Label className="text-xs">Min for Bonus</Label><Input type="number" value={form.minBonus} onChange={e => setField("minBonus", e.target.value)} /></div>
          <div><Label className="text-xs">Max for Bonus</Label><Input type="number" value={form.maxBonus} onChange={e => setField("maxBonus", e.target.value)} /></div>
        </div>
      )}
    </div>
  );
}

export default function DistrictCitationPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;
  const initialTab = searchParams.get("tab") || "categories";

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Year
  const [allYears, setAllYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [currentYearId, setCurrentYearId] = useState<number | null>(null);
  const isCurrentYear = selectedYearId === currentYearId;

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
  // Per sub-item loaded data: { [index]: { aofList } }
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

  useEffect(() => {
    (async () => {
      try {
        const [d, years, avYears] = await Promise.all([getDistrict(districtId), getRotaryYears(), getCitationAvailableYears(districtId)]);
        setDistrictName(`District ${d.districtNumber}`);
        const current = years.find((y: any) => y.isCurrent);
        setCurrentYearId(current?.id || null);

        // Year dropdown = (current year) + (all past years with data), current
        // year always present so admins can start a fresh year even if nothing
        // has been created for it yet. Past-year rows in avYears are already
        // ordered DESC by year id; we prepend current only if missing so it
        // sits at the top of the dropdown.
        const merged: any[] = [];
        if (current) merged.push(current);
        for (const y of avYears) {
          if (!current || y.id !== current.id) merged.push(y);
        }
        // Fallback: no current year in year_master at all — use whatever
        // avYears has, else fall back to the raw rotary_year_master list.
        const finalYears = merged.length > 0 ? merged : (avYears.length > 0 ? avYears : years.slice(0, 1));
        setAllYears(finalYears);
        // Default the year picker to CURRENT year every time the page loads.
        setSelectedYearId(current?.id || finalYears[0]?.id || null);
      } catch { setErrorMessage("Failed to load."); }
      finally { setLoading(false); }
    })();
  }, [districtId]);

  // Load activities + meeting types once
  useEffect(() => { getCitationActivities().then(setActivities).catch(() => {}); getCitationMeetingTypes().then(setMeetingTypes).catch(() => {}); }, []);

  // Load tab data when year or tab changes
  useEffect(() => {
    if (!selectedYearId) return;
    if (activeTab === "categories") fetchCategories();
    if (activeTab === "description") fetchDescription();
    if (activeTab === "auto") fetchAutoQuestions();
    if (activeTab === "manual") fetchManualCriteria();
    if (activeTab === "club_points") fetchClubPoints();
  }, [selectedYearId, activeTab]);

  const fetchCategories = async () => { try { setCategories(await getCitationCategoriesByDistrict(districtId, selectedYearId!)); } catch {} };
  const fetchDescription = async () => { try { const d = await getCitationDescription(districtId, selectedYearId!); setDescHtml(d.descriptionHtml || ""); } catch {} };
  const fetchAutoQuestions = async () => { try { setAutoQuestions(await getCitationAutoQuestions(districtId, selectedYearId!)); } catch {} };
  const fetchManualCriteria = async () => { try { setManualCriteria(await getCitationManualCriteria(districtId, selectedYearId!)); } catch {} };
  const fetchClubPoints = async () => { setClubPointsLoading(true); try { setClubPoints(await getCitationClubPoints(districtId, selectedYearId!)); } catch {} finally { setClubPointsLoading(false); } };

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
    }));
    setAutoForm({
      categoryId: String(q.categoryId), activityId: String(q.activityId),
      points: String(q.points), isBonus: !!q.isBonus, bonusPoints: String(q.bonusPoints || ""), minBonus: String(q.minBonus || ""), maxBonus: String(q.maxBonus || ""),
      sortOrder: String(q.sortOrder), subItems: subs
    });
    setSubItemData({});
    setAutoDialogOpen(true);

    // Load dropdown data for each sub-item
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
      // Validate final selection is made
      if (!s.subItemId && s.subItemType !== "meeting_type") { setErrorMessage(`Sub Item #${i + 1}: Please select a value.`); return; }
      if (s.subItemType === "meeting_type" && !s.subItemName) { setErrorMessage(`Sub Item #${i + 1}: Please select a Meeting Type.`); return; }
      // Points mandatory for sub items
      if (!s.points || Number(s.points) <= 0) { setErrorMessage(`Sub Item #${i + 1}: Points is required.`); return; }
    }
    setAutoSaving(true);
    try {
      const payload = {
        yearId: selectedYearId, categoryId: Number(autoForm.categoryId), activityId: Number(autoForm.activityId),
        points: Number(autoForm.points) || 0, isBonus: autoForm.isBonus, bonusPoints: Number(autoForm.bonusPoints) || 0,
        minBonus: Number(autoForm.minBonus) || 0, maxBonus: Number(autoForm.maxBonus) || 0, sortOrder: Number(autoForm.sortOrder) || 0,
        subItems: autoForm.subItems.map((s: any) => ({ subItemType: s.subItemType, subItemId: s.subItemId || null, subItemName: s.subItemName || null,
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

  // Auto sub-item helpers
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
    console.log("loadAofList called", { index, activityId, act, activitiesLen: activities.length });
    if (!act) return;
    const moduleKey = getModuleKeyFromActivity(act.activityName);
    console.log("loadAofList moduleKey:", moduleKey);
    try {
      const list = await getCitationAreaOfFocus(moduleKey);
      console.log("loadAofList result:", list);
      setSubItemData(prev => ({ ...prev, [index]: { aofList: list } }));
    } catch (err) { console.error("loadAofList error:", err); }
  };

  const addAutoSubItem = () => setAutoForm((p: any) => ({ ...p, subItems: [...p.subItems, { subItemType: "", subItemId: null, subItemName: "", points: "", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "" }] }));
  const removeAutoSubItem = (i: number) => { setAutoForm((p: any) => ({ ...p, subItems: p.subItems.filter((_: any, idx: number) => idx !== i) })); setSubItemData(prev => { const n = { ...prev }; delete n[i]; return n; }); };
  const updateAutoSubItem = (i: number, field: string, value: any) => setAutoForm((p: any) => ({ ...p, subItems: p.subItems.map((s: any, idx: number) => idx === i ? { ...s, [field]: value } : s) }));

  // ── Manual Criteria CRUD ──
  const openAddManual = () => { setEditingManual(null); setManualForm({ categoryId: "", sortOrder: "0", subCriteria: [] }); setManualDialogOpen(true); };
  // Normalize raw answer_type into one of the three canonical UI values so the
  // edit dialog's <Select> shows the right selection for migrated rows whose
  // answer_type uses different casing/separators (e.g. "Number", "Yes/No",
  // "choose-one", "select").
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

  // Manual sub-criteria helpers
  const addManualSub = () => setManualForm((p: any) => ({ ...p, subCriteria: [...p.subCriteria, { subCriteriaTitle: "", answerType: "number", points: "", isBonus: false, bonusPoints: "", minBonus: "", maxBonus: "", remark: "", sortOrder: "0", options: [] }] }));
  const removeManualSub = (i: number) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.filter((_: any, idx: number) => idx !== i) }));
  const updateManualSub = (i: number, field: string, value: any) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.map((sc: any, idx: number) => idx === i ? { ...sc, [field]: value } : sc) }));
  const addManualOption = (subIdx: number) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.map((sc: any, i: number) => i === subIdx ? { ...sc, options: [...sc.options, { optionText: "", optionPoints: "", sortOrder: "0" }] } : sc) }));
  const removeManualOption = (subIdx: number, optIdx: number) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.map((sc: any, i: number) => i === subIdx ? { ...sc, options: sc.options.filter((_: any, j: number) => j !== optIdx) } : sc) }));
  const updateManualOption = (subIdx: number, optIdx: number, field: string, value: any) => setManualForm((p: any) => ({ ...p, subCriteria: p.subCriteria.map((sc: any, i: number) => i === subIdx ? { ...sc, options: sc.options.map((o: any, j: number) => j === optIdx ? { ...o, [field]: value } : o) } : sc) }));

  const BonusFields = BonusFieldsInner;

  if (loading) return <ProtectedRoute><div className="flex justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{districtName ? `${districtName} - District Awards` : "District Awards"}</h2>
              <p className="text-muted-foreground text-base">Manage award criteria and view club points</p>
            </div>
          </div>
          <Select value={String(selectedYearId || "")} onValueChange={v => setSelectedYearId(Number(v))}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Year" /></SelectTrigger>
            <SelectContent>
              {allYears.map((y: any) => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel || y.YearLabel}{y.isCurrent || y.IsCurrent ? " (Current)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="categories" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Categories</TabsTrigger>
            <TabsTrigger value="description" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Description</TabsTrigger>
            <TabsTrigger value="auto" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Auto Questions</TabsTrigger>
            <TabsTrigger value="manual" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Manual Questions</TabsTrigger>
            <TabsTrigger value="club_points" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Club Points</TabsTrigger>
          </TabsList>

          {/* ── Categories Tab ── */}
          <TabsContent value="categories">
            <div className="space-y-4">
              {canManage && isCurrentYear && <div className="flex justify-end"><Button onClick={openAddCat}><Plus className="mr-2 h-4 w-4" />Add Category</Button></div>}
              {categories.length === 0 ? (
                <div className="flex flex-col items-center py-12"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><p className="text-muted-foreground">No categories. Add one to get started.</p></div>
              ) : (
                <div className="space-y-2">
                  {categories.map((c: any) => (
                    <Card key={c.id}><CardContent className="p-4 flex items-center justify-between">
                      <div><p className="font-semibold">{c.categoryName}</p><p className="text-xs text-muted-foreground">Sort: {c.sortOrder}</p></div>
                      {canManage && isCurrentYear && <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditCat(c)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteCat(c)}><Trash2 className="h-4 w-4" /></Button>
                      </div>}
                    </CardContent></Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Description Tab ── */}
          <TabsContent value="description">
            <Card><CardContent className="pt-6 space-y-4">
              <Label>Description <span className="text-xs text-muted-foreground font-normal">(max {CITATION_DESC_MAX_CHARS} characters)</span></Label>
              {canManage && isCurrentYear ? (
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
                        {used}/{CITATION_DESC_MAX_CHARS} characters{over ? ` (${Math.abs(remaining)} over limit)` : ""}
                      </p>
                    );
                  })()}
                  <div className="flex justify-end">
                    <Button onClick={handleSaveDesc} disabled={descSaving || citationPlainTextLength(descHtml) > CITATION_DESC_MAX_CHARS}>
                      <Save className="mr-2 h-4 w-4" />{descSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="prose prose-sm max-w-none break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_a]:break-all border rounded-md p-4 min-h-[200px]"
                  dangerouslySetInnerHTML={{ __html: descHtml || "<p class='text-muted-foreground'>No description.</p>" }}
                />
              )}
            </CardContent></Card>
          </TabsContent>

          {/* ── Auto Questions Tab ── */}
          <TabsContent value="auto">
            <div className="space-y-4">
              {canManage && isCurrentYear && <div className="flex justify-end"><Button onClick={openAddAuto}><Plus className="mr-2 h-4 w-4" />Add Auto Question</Button></div>}
              {autoQuestions.length === 0 ? (
                <div className="flex flex-col items-center py-12"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><p className="text-muted-foreground">No auto questions.</p></div>
              ) : (
                <div className="space-y-3">
                  {autoQuestions.map((q: any) => (
                    <Card key={q.id}><CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{q.categoryName}</Badge>
                            <p className="font-semibold">{q.activityName}</p>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">Points: {q.points}{q.isBonus ? ` | Bonus: ${q.bonusPoints} (Min: ${q.minBonus}, Max: ${q.maxBonus})` : ""}</p>
                          {q.subItems && q.subItems.length > 0 && (
                            <div className="mt-2 pl-4 border-l-2 border-muted space-y-1">
                              {q.subItems.map((s: any) => {
                                const t = String(s.subItemType || "").toLowerCase();
                                let lineage = "";
                                if (t === "area_of_focus") {
                                  lineage = s.areaOfFocusName || s.subItemName || `#${s.subItemId}`;
                                } else {
                                  lineage = s.subItemName || (s.subItemId ? `#${s.subItemId}` : "");
                                }
                                const typeLabel = t.replace(/_/g, " ");
                                return (
                                  <p key={s.id} className="text-sm">
                                    <span className="font-medium">{typeLabel}{typeLabel ? ": " : ""}{lineage}</span>
                                    {" "},  Points: {s.points}{s.isBonus ? ` | Bonus: ${s.bonusPoints}` : ""}
                                  </p>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {canManage && isCurrentYear && <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditAuto(q)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteAuto(q)}><Trash2 className="h-4 w-4" /></Button>
                        </div>}
                      </div>
                    </CardContent></Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Manual Questions Tab ── */}
          <TabsContent value="manual">
            <div className="space-y-4">
              {canManage && isCurrentYear && <div className="flex justify-end"><Button onClick={openAddManual}><Plus className="mr-2 h-4 w-4" />Add Manual Criteria</Button></div>}
              {manualCriteria.length === 0 ? (
                <div className="flex flex-col items-center py-12"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><p className="text-muted-foreground">No manual criteria.</p></div>
              ) : (
                <div className="space-y-3">
                  {manualCriteria.map((mc: any) => (
                    <Card key={mc.id}><CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{mc.categoryName}</Badge>
                            <p className="font-semibold">{mc.criteriaName}</p>
                          </div>
                          {mc.subCriteria && mc.subCriteria.length > 0 && (
                            <div className="mt-2 pl-4 border-l-2 border-muted space-y-1">
                              {mc.subCriteria.map((sc: any) => (
                                <div key={sc.id} className="text-sm">
                                  <span className="font-medium">{sc.subCriteriaTitle}</span>
                                  <span className="text-muted-foreground"> ({sc.answerType})</span>
                                  {sc.answerType === "number" && <span>: Points: {sc.points}{sc.isBonus ? ` | Bonus: ${sc.bonusPoints}` : ""}</span>}
                                  {sc.answerType === "yesno" && <span>: Base Points: {sc.points}</span>}
                                  {sc.answerType === "choose_one" && sc.options && (
                                    <span>: {sc.options.length} options</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {canManage && isCurrentYear && <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditManual(mc)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteManual(mc)}><Trash2 className="h-4 w-4" /></Button>
                        </div>}
                      </div>
                    </CardContent></Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Club Points Tab ── */}
          <TabsContent value="club_points">
            <div className="space-y-4">
              {clubPoints.length > 0 && (
                <div className="flex justify-end">
                  <Button variant="outline" disabled={downloading} onClick={async () => {
                    setDownloading(true);
                    try {
                      const blob = await downloadCitationClubReport(districtId, selectedYearId!);
                      const url = URL.createObjectURL(new Blob([blob]));
                      const a = document.createElement("a"); a.href = url; a.download = `citation_report_${districtId}_${fileTimestamp()}.xlsx`; a.click(); URL.revokeObjectURL(url);
                    } catch { setErrorMessage("Failed to download report."); }
                    finally { setDownloading(false); }
                  }}>{downloading ? <><RotaryLoader size="sm" /><span className="ml-2">Downloading...</span></> : <><Download className="h-4 w-4 mr-2" />Download Report</>}</Button>
                </div>
              )}
              {clubPointsLoading ? <div className="flex justify-center py-10"><ListPageSkeleton /></div> : (
                <Card><CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow className="bg-primary hover:bg-primary">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Club</TableHead>
                      <TableHead className="text-center">Total Points</TableHead>
                      <TableHead className="text-center w-28">Action</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {clubPoints.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No club data</TableCell></TableRow>
                      ) : clubPoints.map((c: any, i: number) => (
                        <TableRow key={c.clubId}>
                          <TableCell className="font-medium">{i + 1}{i < 3 && <Trophy className="inline ml-1 h-3.5 w-3.5 text-amber-500" />}</TableCell>
                          <TableCell className="font-medium">{c.clubName}</TableCell>
                          <TableCell className="text-center"><Badge variant={c.totalPoints > 0 ? "default" : "secondary"}>{c.totalPoints}</Badge></TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="icon" title="View" disabled={viewingClubId === c.clubId} onClick={() => {
                                setViewingClubId(c.clubId);
                                router.push(`/clubs/${c.clubId}/citation?districtId=${districtId}&readOnly=true`);
                              }}>
                                {viewingClubId === c.clubId ? <RotaryLoader size="sm" /> : <Eye className="h-4 w-4" />}
                              </Button>
                              <Button variant="ghost" size="icon" title="Download Report" disabled={downloadingClubId === c.clubId} onClick={async () => {
                                setDownloadingClubId(c.clubId);
                                try {
                                  const blob = await downloadCitationSingleClubReport(districtId, c.clubId, selectedYearId!);
                                  const url = URL.createObjectURL(new Blob([blob]));
                                  const a = document.createElement("a"); a.href = url; a.download = `citation_${c.clubName.replace(/\s/g, "_")}_${fileTimestamp()}.xlsx`; a.click(); URL.revokeObjectURL(url);
                                } catch { setErrorMessage("Failed to download."); }
                                finally { setDownloadingClubId(null); }
                              }}>
                                {downloadingClubId === c.clubId ? <RotaryLoader size="sm" /> : <Download className="h-4 w-4" />}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent></Card>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Category Dialog ── */}
        <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
          <DialogContent className="max-w-md"><DialogHeader>
            <DialogTitle>{editingCat ? "Edit Category" : "Add Category"}</DialogTitle>
            <DialogDescription>Main criteria category for district awards.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Category Name *</Label><Input value={catName} onChange={e => setCatName(e.target.value)} /></div>
            <div><Label>Sort Order</Label><Input type="number" value={catSort} onChange={e => setCatSort(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveCat} disabled={catSaving}>{catSaving ? "Saving..." : editingCat ? "Update" : "Add"}</Button>
          </DialogFooter></DialogContent>
        </Dialog>

        {/* ── Auto Question Dialog ── */}
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
              <div><Label>Points</Label><Input type="number" value={autoForm.points} onChange={e => setAutoForm((p: any) => ({ ...p, points: e.target.value }))} /></div>
              <div><Label>Sort Order</Label><Input type="number" value={autoForm.sortOrder} onChange={e => setAutoForm((p: any) => ({ ...p, sortOrder: e.target.value }))} /></div>
            </div>
            <BonusFields form={autoForm} setField={(f, v) => setAutoForm((p: any) => ({ ...p, [f]: v }))} />

            {/* Sub Items based on activity type */}
            {(() => {
              const selectedActivity = activities.find((a: any) => String(a.id) === autoForm.activityId);
              if (!selectedActivity || selectedActivity.subType !== 1) return null;
              const actName = (selectedActivity.activityName || "").toLowerCase();
              const isClubService = actName.includes("club service");
              const isCommunityService = actName.includes("community service");
              // Vocational, International, New Generation, Public Image: their Area of Focus is labelled "Category"
              const isTwoLevelService = !isClubService && !isCommunityService;

              // Determine available sub-item types for this activity
              let subItemTypeOptions: { value: string; label: string }[] = [];
              let sectionLabel = "";
              if (isClubService) {
                sectionLabel = "Meeting Types";
              } else if (isCommunityService) {
                sectionLabel = "Area of Focus";
                subItemTypeOptions = [{ value: "area_of_focus", label: "Area of Focus" }];
              } else {
                // Vocational, International, New Generation, Public Image
                sectionLabel = "Category";
                subItemTypeOptions = [{ value: "category", label: "Category" }];
              }

              return (
                <div className="space-y-3 border rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
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
                          {/* Type selector */}
                          <div>
                            <Label className="text-xs">Points For</Label>
                            <Select value={sub.subItemType || ""} onValueChange={v => {
                              updateAutoSubItem(i, "subItemType", v);
                              updateAutoSubItem(i, "subItemId", null);
                              updateAutoSubItem(i, "subItemName", "");
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
                            const aofList = (subItemData[i] || {}).aofList || [];
                            const aofLabel = isCommunityService ? "Area of Focus" : "Category";
                            return (
                              <div>
                                <Label className="text-xs">{aofLabel}</Label>
                                <Select value={sub.subItemId ? String(sub.subItemId) : ""} onValueChange={v => {
                                  const sel = aofList.find((it: any) => String(it.id) === v);
                                  updateAutoSubItem(i, "subItemId", Number(v));
                                  updateAutoSubItem(i, "subItemName", sel?.name || "");
                                }}>
                                  <SelectTrigger className="h-8"><SelectValue placeholder={`Select ${aofLabel}`} /></SelectTrigger>
                                  <SelectContent>{aofList.map((it: any) => <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>)}</SelectContent>
                                </Select>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      <div><Label className="text-xs">Points</Label><Input type="number" className="h-8" value={sub.points} onChange={e => updateAutoSubItem(i, "points", e.target.value)} /></div>
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

        {/* ── Manual Criteria Dialog ── */}
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
            <div><Label>Sort Order</Label><Input type="number" value={manualForm.sortOrder} onChange={e => setManualForm((p: any) => ({ ...p, sortOrder: e.target.value }))} /></div>

            <div className="space-y-3 border rounded-lg p-3">
              <div className="flex flex-wrap items-center justify-between gap-3"><Label className="font-semibold">Sub Criteria</Label><Button size="sm" variant="outline" onClick={addManualSub}><Plus className="h-3 w-3 mr-1" />Add Sub Criteria</Button></div>
              {manualForm.subCriteria.map((sc: any, i: number) => (
                <Card key={i}><CardContent className="p-3 space-y-2">
                  <div className="flex justify-between items-center"><Label className="text-sm font-medium">Sub Criteria #{i + 1}</Label><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeManualSub(i)}><Trash2 className="h-3 w-3" /></Button></div>
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
                    {sc.answerType !== "choose_one" && <div><Label className="text-xs">Points</Label><Input type="number" className="h-8" value={sc.points} onChange={e => updateManualSub(i, "points", e.target.value)} /></div>}
                  </div>
                  {sc.answerType === "number" && <BonusFields form={sc} setField={(f, v) => updateManualSub(i, f, v)} />}
                  {sc.answerType === "choose_one" && (
                    <div className="space-y-2 pl-3 border-l-2 border-blue-200">
                      <div className="flex flex-wrap items-center justify-between gap-3"><Label className="text-xs font-medium">Options</Label><Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => addManualOption(i)}><Plus className="h-2 w-2 mr-1" />Add Option</Button></div>
                      {sc.options.map((o: any, j: number) => (
                        <div key={j} className="flex gap-2 items-center">
                          <Input className="h-7 text-xs flex-1" value={o.optionText} onChange={e => updateManualOption(i, j, "optionText", e.target.value)} placeholder="Option text" />
                          <Input className="h-7 text-xs w-20" type="number" value={o.optionPoints} onChange={e => updateManualOption(i, j, "optionPoints", e.target.value)} placeholder="Points" />
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
      </div>
    </ProtectedRoute>
  );
}
