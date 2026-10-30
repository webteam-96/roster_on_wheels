"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getClub, getClubCitation, saveClubManualEntries, refreshClubAutoPoints } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, RefreshCw, Save, Trophy, Calculator } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function ClubCitationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const districtIdParam = Number(searchParams.get("districtId") || "0");
  const readOnly = searchParams.get("readOnly") === "true";
  // Edit-vs-read-only is determined PURELY by the URL ?readOnly=true flag.
  // - Caller from District → District Awards → Club Points → View: passes ?readOnly=true → read-only
  // - Caller from Club → District Awards: no readOnly → editable
  const canManage = !readOnly;

  const [clubName, setClubName] = useState("");
  const [districtId, setDistrictId] = useState(districtIdParam);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("auto");

  const [citationData, setCitationData] = useState<any>(null);
  const [manualAnswers, setManualAnswers] = useState<Record<number, { value: string; points: number; bonus: number }>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const club = await getClub(clubId);
      const dId = districtId || club.fkDistrictId || 0;
      if (!dId) { setErrorMessage("District ID not found."); setLoading(false); return; }
      if (!districtId) setDistrictId(dId);
      const data = await getClubCitation(clubId, dId);
      setClubName(club.clubName);
      setCitationData(data);
      // Initialize manual answers from saved data
      const answers: Record<number, { value: string; points: number; bonus: number }> = {};
      if (data.manualQuestions) {
        for (const mc of data.manualQuestions) {
          for (const sc of (mc.subCriteria || [])) {
            answers[sc.id] = {
              value: sc.answerValue || "",
              points: Number(sc.pointsEarned) || 0,
              bonus: Number(sc.bonusEarned) || 0,
            };
          }
        }
      }
      setManualAnswers(answers);
    } catch { setErrorMessage("Failed to load citation data."); }
    finally { setLoading(false); }
  }, [clubId, districtId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefreshAuto = async () => {
    setRefreshing(true);
    try {
      await refreshClubAutoPoints(clubId, districtId);
      await fetchData();
      setSuccessMessage("Auto points refreshed.");
    } catch { setErrorMessage("Failed to refresh."); }
    finally { setRefreshing(false); }
  };

  // Normalize migrated/mixed-casing answer_type values to canonical
  // 'number' | 'yesno' | 'choose_one'. Must match the render-side mapping
  // below — otherwise the input renders (via fallback) but updateManualAnswer
  // never matches a branch and points stay 0 on every keystroke.
  const normalizeAnswerType = (raw: any, hasOptions: boolean): "number" | "yesno" | "choose_one" => {
    const r = String(raw ?? "").toLowerCase().trim().replace(/[\s_-]/g, "");
    if (r === "yesno" || r === "yn" || r === "boolean" || r === "bool" || r === "yes" || r === "no") return "yesno";
    if (r === "chooseone" || r === "choose" || r === "select" || r === "option" || r === "options" || r === "radio" || hasOptions) return "choose_one";
    return "number";
  };

  // Points are integers everywhere — round to whole number for display.
  const fmtPts = (n: number) => String(Math.round(Number(n) || 0));

  // Manual answer change handlers
  const updateManualAnswer = (subCriteriaId: number, value: string, sc: any) => {
    const answerType = normalizeAnswerType(sc.answerType, Array.isArray(sc.options) && sc.options.length > 0);
    let points = 0;
    let bonus = 0;

    if (answerType === "number") {
      const numVal = Number(value) || 0;
      points = numVal * Number(sc.points);
      if (sc.isBonus) {
        if (Number(sc.minBonus) === 0 && Number(sc.maxBonus) === 0) {
          bonus = Number(sc.bonusPoints);
        } else {
          if (numVal >= Number(sc.minBonus) && Number(sc.minBonus) > 0) bonus = Number(sc.bonusPoints);
          if (Number(sc.maxBonus) > 0 && numVal > Number(sc.maxBonus)) points = Number(sc.maxBonus) * Number(sc.points);
        }
      }
      if (numVal === 0) { points = 0; bonus = 0; }
    } else if (answerType === "yesno") {
      points = value === "yes" ? Number(sc.points) : 0;
    } else if (answerType === "choose_one") {
      const selectedOpt = (sc.options || []).find((o: any) => String(o.id) === value);
      points = selectedOpt ? Number(selectedOpt.optionPoints) : 0;
    }

    setManualAnswers(prev => ({ ...prev, [subCriteriaId]: { value, points, bonus } }));
  };

  const handleSaveManual = async () => {
    setSavingManual(true);
    try {
      const entries = Object.entries(manualAnswers).map(([id, ans]) => ({
        districtId,
        subCriteriaId: Number(id),
        answerValue: ans.value,
        pointsEarned: ans.points,
        bonusEarned: ans.bonus,
      }));
      await saveClubManualEntries(clubId, entries);
      setSuccessMessage("Manual entries saved.");
      await fetchData();
    } catch { setErrorMessage("Failed to save."); }
    finally { setSavingManual(false); }
  };

  const totalAuto = citationData?.totalAuto || 0;
  const totalManual = Object.values(manualAnswers).reduce((sum, a) => sum + a.points + a.bonus, 0);
  const grandTotal = totalAuto + totalManual;

  if (loading) return <ProtectedRoute><div className="flex justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={readOnly ? `/districts/${districtId}/citation?tab=club_points` : `/clubs/${clubId}/dashboard${districtId ? `?districtId=${districtId}` : ""}`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{clubName ? `${clubName} - District Awards` : "District Awards"}</h2>
              <p className="text-muted-foreground text-base">{citationData?.yearLabel || "Current Year"}</p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-blue-600 font-medium">Auto Points</p>
              <p className="text-2xl font-bold text-blue-800">{fmtPts(Number(totalAuto))}</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-green-600 font-medium">Manual Points</p>
              <p className="text-2xl font-bold text-green-800">{fmtPts(Number(totalManual))}</p>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-amber-600 font-medium">Grand Total</p>
              <p className="text-2xl font-bold text-amber-800">{fmtPts(Number(grandTotal))}</p>
            </CardContent>
          </Card>
        </div>

        {/* Description */}
        {citationData?.descriptionHtml && (
          <Card><CardContent className="p-4">
            <div dangerouslySetInnerHTML={{ __html: citationData.descriptionHtml }} />
          </CardContent></Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="auto" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Auto Points</TabsTrigger>
            <TabsTrigger value="manual" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Manual Points</TabsTrigger>
          </TabsList>

          {/* Auto Points Tab */}
          <TabsContent value="auto">
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="outline" onClick={handleRefreshAuto} disabled={refreshing}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                  {refreshing ? "Refreshing..." : "Refresh Auto Points"}
                </Button>
              </div>

              {(!citationData?.autoEntries || citationData.autoEntries.length === 0) ? (
                <div className="flex flex-col items-center py-12">
                  <Calculator className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No auto points calculated yet. Click &quot;Refresh Auto Points&quot; to calculate.</p>
                </div>
              ) : (
                <Card><CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground">#</TableHead>
                        <TableHead className="text-primary-foreground">Category</TableHead>
                        <TableHead className="text-primary-foreground">Activity</TableHead>
                        <TableHead className="text-primary-foreground">Sub Item</TableHead>
                        <TableHead className="text-primary-foreground text-center">Count</TableHead>
                        <TableHead className="text-primary-foreground text-center">Base Points</TableHead>
                        <TableHead className="text-primary-foreground text-center">Points</TableHead>
                        <TableHead className="text-primary-foreground text-center">Bonus</TableHead>
                        <TableHead className="text-primary-foreground text-center">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {citationData.autoEntries.map((e: any, i: number) => {
                        const effectiveBase = e.subBasePoints != null && Number(e.subBasePoints) > 0
                          ? Number(e.subBasePoints)
                          : Number(e.basePoints || 0);
                        const subItemLabel = e.subItemDisplay || e.subItemName || (e.subItemType ? String(e.subItemType) : "-");
                        return (
                          <TableRow key={e.id}>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell>{e.categoryName}</TableCell>
                            <TableCell>{e.activityName}</TableCell>
                            <TableCell>{subItemLabel}</TableCell>
                            <TableCell className="text-center">{e.answerValue || "-"}</TableCell>
                            <TableCell className="text-center">{fmtPts(effectiveBase)}</TableCell>
                            <TableCell className="text-center">{fmtPts(Number(e.pointsEarned))}</TableCell>
                            <TableCell className="text-center">{Number(e.bonusEarned) > 0 ? fmtPts(Number(e.bonusEarned)) : "-"}</TableCell>
                            <TableCell className="text-center font-semibold">{fmtPts(Number(e.pointsEarned) + Number(e.bonusEarned))}</TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted font-bold">
                        <TableCell colSpan={6}>Total Auto Points</TableCell>
                        <TableCell className="text-center">{fmtPts(citationData.autoEntries.reduce((s: number, e: any) => s + Number(e.pointsEarned), 0))}</TableCell>
                        <TableCell className="text-center">{fmtPts(citationData.autoEntries.reduce((s: number, e: any) => s + Number(e.bonusEarned), 0))}</TableCell>
                        <TableCell className="text-center">{fmtPts(Number(totalAuto))}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent></Card>
              )}
            </div>
          </TabsContent>

          {/* Manual Points Tab */}
          <TabsContent value="manual">
            <div className="space-y-4">
              {(!citationData?.manualQuestions || citationData.manualQuestions.length === 0) ? (
                <div className="flex flex-col items-center py-12">
                  <Calculator className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No manual questions configured for this year.</p>
                </div>
              ) : (
                <>
                  {citationData.manualQuestions.map((mc: any) => (
                    <Card key={mc.criteriaId}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{mc.categoryName}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {(mc.subCriteria || []).map((sc: any) => {
                          const answer = manualAnswers[sc.id] || { value: "", points: 0, bonus: 0 };
                          // Defensive normalization — old/migrated data may store
                          // answer_type with different casing / whitespace / synonyms.
                          // Map everything to the three canonical UI types so the
                          // input always renders.
                          const rawType = String(sc.answerType ?? "").toLowerCase().trim().replace(/[\s_-]/g, "");
                          let normalizedType: "number" | "yesno" | "choose_one";
                          if (rawType === "yesno" || rawType === "yn" || rawType === "boolean" || rawType === "bool" || rawType === "yes" || rawType === "no") {
                            normalizedType = "yesno";
                          } else if (rawType === "chooseone" || rawType === "choose" || rawType === "select" || rawType === "option" || rawType === "options" || rawType === "radio" || (Array.isArray(sc.options) && sc.options.length > 0)) {
                            normalizedType = "choose_one";
                          } else {
                            // Fallback: anything else (number, blank, unknown) → numeric input
                            normalizedType = "number";
                          }
                          return (
                            <div key={sc.id} className="border rounded-lg p-3 space-y-2">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-medium text-sm">{sc.title}</p>
                                  {sc.remark && <p className="text-xs text-muted-foreground">{sc.remark}</p>}
                                </div>
                                <Badge variant="outline" className="shrink-0">
                                  {fmtPts(answer.points + answer.bonus)}
                                </Badge>
                              </div>

                              {normalizedType === "number" && (
                                <div className="flex items-center gap-3">
                                  <Input type="number" step="1" className="w-32 h-8" value={answer.value}
                                    onChange={e => updateManualAnswer(sc.id, e.target.value.replace(/[^0-9-]/g, ""), sc)}
                                    disabled={!canManage} placeholder="Enter value" />
                                  <span className="text-xs text-muted-foreground">× {Math.round(Number(sc.points) || 0)}{sc.isBonus ? ` + bonus ${Math.round(Number(sc.bonusPoints) || 0)}` : ""}</span>
                                </div>
                              )}

                              {normalizedType === "yesno" && (
                                <div className="flex items-center gap-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Switch checked={answer.value === "yes"}
                                      onCheckedChange={v => updateManualAnswer(sc.id, v ? "yes" : "no", sc)}
                                      disabled={!canManage} />
                                    <span className="text-sm">{answer.value === "yes" ? "Yes" : "No"}</span>
                                  </div>
                                  <span className="text-xs text-muted-foreground">{sc.points} if Yes</span>
                                </div>
                              )}

                              {normalizedType === "choose_one" && (
                                <div className="space-y-2">
                                  {(sc.options || []).map((opt: any) => (
                                    <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
                                      <input type="radio" name={`sc-${sc.id}`} value={String(opt.id)}
                                        checked={answer.value === String(opt.id)}
                                        onChange={() => updateManualAnswer(sc.id, String(opt.id), sc)}
                                        disabled={!canManage}
                                        className="h-4 w-4 text-primary" />
                                      <span className="text-sm">{opt.optionText} ({opt.optionPoints})</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  ))}

                  {canManage && (
                    <div className="flex justify-end">
                      <Button onClick={handleSaveManual} disabled={savingManual}>
                        <Save className="h-4 w-4 mr-2" />{savingManual ? "Saving..." : "Save Manual Points"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ProtectedRoute>
  );
}
