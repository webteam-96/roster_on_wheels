"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  getDistrict, getZonalAwardsAvailableYears, getRotaryYears,
  getDistrictZonalAwards, saveDistrictZonalAwardsManual,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save, ChevronDown, ChevronRight, Trophy } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

// Named export — embeddable view. Rendered inline by the District Admin E-Governance
// dashboard (Zonal Awards tab); the route's prop-less default export wraps it below.
export function DistrictZonalAwardsView({ districtId: propDistrictId, embedded = false, yearId: globalYearId = null }: { districtId?: number; embedded?: boolean; yearId?: number | null } = {}) {
  const params = useParams();
  const districtId = propDistrictId ?? Number(params.id);
  const searchParams = useSearchParams();
  // ?returnTo= overrides the default back target (district dashboard).
  const returnTo = searchParams.get("returnTo");
  const backHref = returnTo ? decodeURIComponent(returnTo) : `/districts/${districtId}/dashboard`;
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [allYears, setAllYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [currentYearId, setCurrentYearId] = useState<number | null>(null);
  const isCurrentYear = selectedYearId === currentYearId;

  // Permissions:
  //  - SuperAdmin: edit any year (current or past)
  //  - District Admin: edit only current year, past years are view-only
  const canEdit = isSuperAdmin || (isAdmin && isCurrentYear);
  // Legacy var kept to avoid touching every reference — maps to canEdit now
  const canManage = canEdit;

  const [data, setData] = useState<any>(null);
  // Manual answers: optionId → { counts, points }
  const [manualAnswers, setManualAnswers] = useState<Record<number, { enteredCounts?: number; receivedPoints?: number; counts: number; points: number }>>({});
  const [autoExpanded, setAutoExpanded] = useState(true);
  const [manualExpanded, setManualExpanded] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, avYears, years] = await Promise.all([
          getDistrict(districtId), getZonalAwardsAvailableYears(), getRotaryYears(),
        ]);
        setDistrictName(`District ${d.districtNumber}`);
        const current = years.find((y: any) => y.isCurrent);
        setCurrentYearId(current?.id || null);
        setAllYears(avYears.length > 0
          ? avYears
          : (current ? [{ id: current.id, label: current.yearLabel, isCurrent: true }] : []));
        // Embedded in the dashboard → follow the GLOBAL year selector (no own dropdown).
        if (globalYearId != null) {
          setSelectedYearId(globalYearId);
        } else if (avYears.length > 0) {
          const hasCurrent = avYears.find((y: any) => y.isCurrent);
          setSelectedYearId(hasCurrent ? hasCurrent.id : avYears[0].id);
        } else {
          setSelectedYearId(current?.id || null);
        }
      } catch { setErrorMessage("Failed to load."); }
      finally { setLoading(false); }
    })();
  }, [districtId]);

  // Embedded → keep following the global dashboard year whenever it changes.
  useEffect(() => {
    if (globalYearId != null) setSelectedYearId(globalYearId);
  }, [globalYearId]);

  const fetchData = useCallback(async () => {
    if (!selectedYearId) return;
    setLoading(true);
    try {
      const result = await getDistrictZonalAwards(districtId, selectedYearId);
      setData(result);
      // Initialize manual answers from entries
      const answers: Record<number, { enteredCounts?: number; receivedPoints?: number; counts: number; points: number }> = {};
      if (result.entries) {
        for (const [optId, entry] of Object.entries(result.entries) as any) {
          answers[Number(optId)] = { counts: Number(entry.enteredCounts), points: Number(entry.receivedPoints) };
        }
      }
      setManualAnswers(answers);
    } catch { setErrorMessage("Failed to load data."); }
    finally { setLoading(false); }
  }, [districtId, selectedYearId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Calculate points for a radio/choose-one selection
  const selectRadioOption = (questionOptions: any[], selectedOptId: number) => {
    const newAnswers = { ...manualAnswers };
    for (const opt of questionOptions) {
      if (opt.id === selectedOptId) {
        newAnswers[opt.id] = { counts: 1, points: opt.points };
      } else {
        newAnswers[opt.id] = { counts: 0, points: 0 };
      }
    }
    setManualAnswers(newAnswers);
  };

  // Update number input for an option
  const updateNumberAnswer = (optionId: number, value: string, opt: any) => {
    const numVal = Number(value) || 0;
    // For range-based: count × points per unit
    const pts = numVal > 0 ? numVal * (opt.points || 0) : 0;
    setManualAnswers(prev => ({ ...prev, [optionId]: { counts: numVal, points: pts } }));
  };

  // Update yes/no for an option
  const updateYesNoAnswer = (optionId: number, isYes: boolean, opt: any) => {
    setManualAnswers(prev => ({
      ...prev,
      [optionId]: { counts: isYes ? 1 : 0, points: isYes ? (opt.points || 0) : 0 }
    }));
  };

  const handleSaveManual = async () => {
    if (!selectedYearId) return;
    setSaving(true);
    try {
      // Only save manual question options
      const manualQuestionIds = new Set(
        (data?.questions || []).filter((q: any) => q.autoOrManual === "Manual").map((q: any) => q.id)
      );
      const entries = Object.entries(manualAnswers)
        .filter(([optId]) => {
          const opt = (data?.options || []).find((o: any) => o.id === Number(optId));
          return opt && manualQuestionIds.has(opt.questionId);
        })
        .map(([optId, ans]) => ({
          optionId: Number(optId),
          enteredCounts: ans.counts,
          receivedPoints: ans.points,
        }));
      if (entries.length === 0) {
        setErrorMessage("Please enter values for at least one manual question before saving.");
        return;
      }
      const result = await saveDistrictZonalAwardsManual(districtId, selectedYearId, entries);
      setSuccessMessage(result?.message || "Manual entries saved.");
      await fetchData();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save manual entries.");
    }
    finally { setSaving(false); }
  };

  // Build structured data
  const goals = data?.goals || [];
  const questions = data?.questions || [];
  const options = data?.options || [];
  const entries = data?.entries || {};

  // Zone-level questions are pulled out into their own top section
  const zoneQuestions = questions.filter((q: any) => q.questionLevel === "Zone");
  const isZoneQuestion = (qId: number) => zoneQuestions.some((q: any) => q.id === qId);

  const autoGoals = goals.filter((g: any) =>
    questions.some((q: any) => q.goalId === g.id && q.autoOrManual === "Auto" && !isZoneQuestion(q.id))
  );
  const manualGoals = goals.filter((g: any) =>
    questions.some((q: any) => q.goalId === g.id && q.autoOrManual === "Manual" && !isZoneQuestion(q.id))
  );

  const getQuestionOptions = (qId: number) => options.filter((o: any) => o.questionId === qId);

  const getOptionAnswer = (optId: number) => manualAnswers[optId] || entries[optId] || { counts: 0, points: 0 };
  const getOptionCounts = (optId: number) => {
    const a = getOptionAnswer(optId);
    return Number(a.enteredCounts ?? a.counts ?? 0);
  };
  const getOptionPoints = (optId: number) => {
    const a = getOptionAnswer(optId);
    return Number(a.receivedPoints ?? a.points ?? 0);
  };

  // Calculate totals
  const calcAutoTotal = () => {
    let total = 0;
    for (const q of questions.filter((q: any) => q.autoOrManual === "Auto" && !isZoneQuestion(q.id))) {
      for (const o of getQuestionOptions(q.id)) {
        total += getOptionPoints(o.id);
      }
    }
    return total;
  };

  const calcManualTotal = () => {
    let total = 0;
    for (const q of questions.filter((q: any) => q.autoOrManual === "Manual" && !isZoneQuestion(q.id))) {
      for (const o of getQuestionOptions(q.id)) {
        const ans = manualAnswers[o.id];
        if (ans) total += ans.points;
      }
    }
    return total;
  };

  const calcZoneTotal = () => {
    let total = 0;
    for (const q of zoneQuestions) {
      for (const o of getQuestionOptions(q.id)) {
        total += getOptionPoints(o.id);
      }
    }
    return total;
  };

  const totalAuto = calcAutoTotal();
  const totalManual = calcManualTotal();
  const totalZone = calcZoneTotal();
  const grandTotal = totalAuto + totalManual + totalZone;

  // Determine option input type: radio (choose one from group), number, yesno
  const getInputMode = (q: any, opts: any[]) => {
    // If options have subtype, group by subtype
    const subtypes = Array.from(new Set(opts.map((o: any) => o.subtype).filter(Boolean)));
    if (subtypes.length > 0) return "multi-subtype";
    // If any option has importType set → independent number inputs (each gets own textbox)
    if (opts.some((o: any) => o.importType)) return "independent-number";
    // If all options have mini=0, maxi=0 and no inputType → radio (choose one)
    if (opts.every((o: any) => o.mini === 0 && o.maxi === 0 && !o.inputType)) return "radio";
    // If options have ranges → auto range (read-only for auto, number for manual)
    return "range-or-number";
  };

  const renderQuestionOptions = (q: any, isAuto: boolean) => {
    const opts = getQuestionOptions(q.id);
    if (opts.length === 0) return null;

    const inputMode = getInputMode(q, opts);

    if (inputMode === "independent-number") {
      // Each option gets its own row with independent number textbox
      return opts.map((opt: any) => {
        const ans = manualAnswers[opt.id] || { counts: getOptionCounts(opt.id), points: getOptionPoints(opt.id) };
        return (
          <TableRow key={opt.id}>
            <TableCell className="pl-8 text-sm">{opt.label}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{opt.pointsLabel}</TableCell>
            <TableCell className="text-center">
              {isAuto ? (
                <span>{ans.counts || getOptionCounts(opt.id) || "-"}</span>
              ) : canEdit ? (
                <Input type="number" className="w-24 h-8 text-center mx-auto"
                  value={ans.counts || ""} placeholder="0"
                  onChange={e => updateNumberAnswer(opt.id, e.target.value, opt)}
                />
              ) : (
                <span>{ans.counts || getOptionCounts(opt.id) || "-"}</span>
              )}
            </TableCell>
            <TableCell className="text-center font-medium">
              {(manualAnswers[opt.id]?.points || getOptionPoints(opt.id)) || "-"}
            </TableCell>
          </TableRow>
        );
      });
    }

    if (inputMode === "multi-subtype") {
      // Group by subtype
      const subtypeGroups: Record<number, any[]> = {};
      opts.forEach((o: any) => {
        const st = o.subtype || 0;
        if (!subtypeGroups[st]) subtypeGroups[st] = [];
        subtypeGroups[st].push(o);
      });

      const sortedSubtypes = Object.keys(subtypeGroups).map(Number).sort((a, b) => a - b);

      // Detect Yes/No → Radio dependency pairs (odd subtype controls even subtype)
      // e.g., subtype 1 (Yes/No) controls subtype 2 (radio), subtype 3 controls 4, etc.
      const isYesNoSubtype = (st: number) => {
        const stOpts = subtypeGroups[st];
        if (!stOpts) return false;
        return stOpts.length === 2 && stOpts.some((o: any) => o.label === "No" || o.label?.includes("- No"));
      };

      const getYesNoState = (st: number): boolean => {
        const stOpts = subtypeGroups[st];
        if (!stOpts) return false;
        const yesOpt = stOpts.find((o: any) => o.label !== "No" && !o.label?.includes("- No"));
        if (!yesOpt) return false;
        return (manualAnswers[yesOpt.id]?.counts === 1) || getOptionCounts(yesOpt.id) === 1;
      };

      // Handle Yes/No toggle that clears dependent radio subtype
      const handleYesNoToggle = (st: number, isYes: boolean) => {
        const stOpts = subtypeGroups[st];
        if (!stOpts) return;
        const yesOpt = stOpts.find((o: any) => o.label !== "No" && !o.label?.includes("- No"));
        const noOpt = stOpts.find((o: any) => o.label === "No" || o.label?.includes("- No"));
        if (!yesOpt || !noOpt) return;

        const newAnswers = { ...manualAnswers };
        if (isYes) {
          newAnswers[yesOpt.id] = { counts: 1, points: yesOpt.points };
          newAnswers[noOpt.id] = { counts: 0, points: 0 };
        } else {
          newAnswers[yesOpt.id] = { counts: 0, points: 0 };
          newAnswers[noOpt.id] = { counts: 1, points: 0 };
          // Clear the dependent radio subtype (next subtype)
          const nextSt = st + 1;
          if (subtypeGroups[nextSt]) {
            for (const o of subtypeGroups[nextSt]) {
              newAnswers[o.id] = { counts: 0, points: 0 };
            }
          }
        }
        setManualAnswers(newAnswers);
      };

      return sortedSubtypes.map((st) => {
        const stOpts = subtypeGroups[st];
        const firstOpt = stOpts[0];
        const isYesNo = isYesNoSubtype(st);
        const isNumber = firstOpt.inputType === "Option1" || firstOpt.inputType === "Option2";

        if (isYesNo) {
          // Yes/No pair — renders as a single row with Yes/No radio
          const yesOpt = stOpts.find((o: any) => o.label !== "No" && !o.label?.includes("- No"))!;
          // Tri-state: Yes (counts=1), No (counts=0 with saved row), N/A (never saved)
          const localAns = manualAnswers[yesOpt.id];
          const persistedEntry = entries[yesOpt.id];
          const hasEntry = localAns !== undefined || persistedEntry !== undefined;
          const savedCounts = localAns?.counts ?? Number(persistedEntry?.enteredCounts ?? 0);
          const isYes = savedCounts === 1;
          const displayYn = !hasEntry ? "N/A" : isYes ? "Yes" : "No";
          const earnedPoints = !hasEntry ? 0 : (localAns?.points ?? Number(persistedEntry?.receivedPoints ?? 0));
          return (
            <TableRow key={`${q.id}_${st}`} className="bg-amber-50/50">
              <TableCell className="pl-8 text-sm font-medium">{yesOpt.label}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{yesOpt.pointsLabel}</TableCell>
              <TableCell className="text-center">
                {isAuto ? (
                  <span className={`text-sm font-medium ${!hasEntry ? "text-muted-foreground" : isYes ? "text-green-600" : "text-red-600"}`}>{displayYn}</span>
                ) : canEdit ? (
                  <div className="flex items-center justify-center gap-2">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name={`yn_${q.id}_${st}`} checked={hasEntry && isYes} onChange={() => handleYesNoToggle(st, true)} />
                      <span className="text-xs">Yes</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name={`yn_${q.id}_${st}`} checked={hasEntry && !isYes} onChange={() => handleYesNoToggle(st, false)} />
                      <span className="text-xs">No</span>
                    </label>
                  </div>
                ) : (
                  <span className={`text-sm font-medium ${!hasEntry ? "text-muted-foreground" : isYes ? "text-green-600" : "text-red-600"}`}>{displayYn}</span>
                )}
              </TableCell>
              <TableCell className="text-center font-medium">{earnedPoints || "-"}</TableCell>
            </TableRow>
          );
        }

        // Check if this subtype is controlled by a previous Yes/No subtype
        const controllerSt = st - 1;
        const isControlled = isYesNoSubtype(controllerSt);
        const isEnabled = !isControlled || getYesNoState(controllerSt);

        if (isNumber) {
          // Number input with ranges
          const counts = stOpts.reduce((s: number, o: any) => s + (manualAnswers[o.id]?.counts || getOptionCounts(o.id) || 0), 0);
          return (
            <TableRow key={`${q.id}_${st}`} className={!isEnabled ? "opacity-40" : ""}>
              <TableCell className="pl-8 text-sm">{stOpts.map((o: any) => o.label).join(" / ")}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{stOpts.map((o: any) => o.pointsLabel).join(" / ")}</TableCell>
              <TableCell className="text-center">
                {isAuto ? (
                  <span>{counts || "-"}</span>
                ) : canEdit ? (
                  <Input type="number" className="w-24 h-8 text-center mx-auto" value={counts || ""} placeholder="0"
                    disabled={!isEnabled}
                    onChange={e => {
                      const val = Number(e.target.value) || 0;
                      let matchedOpt = stOpts[0];
                      for (const o of stOpts) {
                        if (val > o.mini && val <= o.maxi) { matchedOpt = o; break; }
                        if (val > o.maxi) matchedOpt = o;
                      }
                      const newAnswers = { ...manualAnswers };
                      for (const o of stOpts) newAnswers[o.id] = { counts: 0, points: 0 };
                      newAnswers[matchedOpt.id] = { counts: val, points: val * matchedOpt.points };
                      setManualAnswers(newAnswers);
                    }}
                  />
                ) : (
                  <span>{counts || "-"}</span>
                )}
              </TableCell>
              <TableCell className="text-center font-medium">
                {stOpts.reduce((sum: number, o: any) => sum + (manualAnswers[o.id]?.points || getOptionPoints(o.id) || 0), 0) || "-"}
              </TableCell>
            </TableRow>
          );
        }

        // Radio group — check if controlled by Yes/No
        return stOpts.map((opt: any) => {
          const isSelected = (manualAnswers[opt.id]?.counts === 1) || getOptionCounts(opt.id) === 1;
          return (
            <TableRow key={opt.id} className={`${!isEnabled ? "opacity-40" : ""} ${isSelected ? "bg-green-50" : ""}`}>
              <TableCell className="pl-12 text-sm">{opt.label}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{opt.pointsLabel}</TableCell>
              <TableCell className="text-center">
                {isAuto ? (
                  isSelected ? <Badge variant="default" className="text-xs">Selected</Badge> : "-"
                ) : canEdit ? (
                  <input type="radio" name={`radio_${q.id}_${st}`} checked={isSelected}
                    disabled={!isEnabled}
                    onChange={() => selectRadioOption(stOpts, opt.id)} />
                ) : (
                  isSelected ? <Badge variant="default" className="text-xs">Selected</Badge> : "-"
                )}
              </TableCell>
              <TableCell className="text-center font-medium">
                {isSelected ? opt.points : "-"}
              </TableCell>
            </TableRow>
          );
        });
      });
    }

    if (inputMode === "radio") {
      // Simple radio group
      return opts.map((opt: any) => {
        const isSelected = getOptionCounts(opt.id) === 1 || (manualAnswers[opt.id]?.counts === 1);
        return (
          <TableRow key={opt.id} className={isSelected ? "bg-green-50" : ""}>
            <TableCell className="pl-8 text-sm">{opt.label}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{opt.pointsLabel}</TableCell>
            <TableCell className="text-center">
              {isAuto ? (
                isSelected ? <Badge variant="default" className="text-xs">Selected</Badge> : "-"
              ) : canEdit ? (
                <input type="radio" name={`radio_${q.id}`} checked={isSelected}
                  onChange={() => selectRadioOption(opts, opt.id)} />
              ) : (
                isSelected ? <Badge variant="default" className="text-xs">Selected</Badge> : "-"
              )}
            </TableCell>
            <TableCell className="text-center font-medium">{isSelected ? opt.points : "-"}</TableCell>
          </TableRow>
        );
      });
    }

    // Range/number — show each option as a row (for auto: read-only, for manual: number input on first)
    if (isAuto) {
      const totalPts = opts.reduce((s: number, o: any) => s + getOptionPoints(o.id), 0);
      const totalCounts = opts.reduce((s: number, o: any) => s + getOptionCounts(o.id), 0);
      return (
        <TableRow key={`${q.id}_range`}>
          <TableCell className="pl-8 text-sm">{opts.map((o: any) => o.label).join(" / ")}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{opts.map((o: any) => o.pointsLabel).join(" / ")}</TableCell>
          <TableCell className="text-center">{totalCounts || "-"}</TableCell>
          <TableCell className="text-center font-medium">{totalPts || "-"}</TableCell>
        </TableRow>
      );
    }

    // Manual number with ranges
    const firstOpt = opts[0];
    const totalCounts = opts.reduce((s: number, o: any) => s + (manualAnswers[o.id]?.counts || 0), 0);
    const totalPts = opts.reduce((s: number, o: any) => s + (manualAnswers[o.id]?.points || 0), 0);
    return (
      <TableRow key={`${q.id}_manual_range`}>
        <TableCell className="pl-8 text-sm">{opts.map((o: any) => o.label).join(" / ")}</TableCell>
        <TableCell className="text-sm text-muted-foreground">{opts.map((o: any) => o.pointsLabel).join(" / ")}</TableCell>
        <TableCell className="text-center">
          {canEdit ? (
            <Input type="number" className="w-24 h-8 text-center mx-auto" value={totalCounts || ""} placeholder="0"
              onChange={e => {
                const val = Number(e.target.value) || 0;
                let matchedOpt = opts[0];
                for (const o of opts) {
                  if (val > o.mini && val <= o.maxi) { matchedOpt = o; break; }
                  if (val >= o.maxi && o.maxi > 0) matchedOpt = o;
                }
                const newAnswers = { ...manualAnswers };
                for (const o of opts) newAnswers[o.id] = { counts: 0, points: 0 };
                newAnswers[matchedOpt.id] = { counts: val, points: val * matchedOpt.points };
                setManualAnswers(newAnswers);
              }}
            />
          ) : (
            <span>{totalCounts || "-"}</span>
          )}
        </TableCell>
        <TableCell className="text-center font-medium">{totalPts || "-"}</TableCell>
      </TableRow>
    );
  };

  const renderGoalSection = (goalList: any[], isAuto: boolean, color: string) => {
    return goalList.map((goal: any) => {
      const goalQuestions = questions.filter((q: any) =>
        q.goalId === goal.id
        && q.autoOrManual === (isAuto ? "Auto" : "Manual")
        && !isZoneQuestion(q.id)
      );
      if (goalQuestions.length === 0) return null;

      return (
        <div key={goal.id}>
          <div className={`${color === "blue" ? "bg-blue-100 text-blue-900" : "bg-green-100 text-green-900"} px-4 py-2 font-semibold text-sm border-t`}>
            {goal.title}
            {goal.maxPoints && <span className="ml-2 text-xs font-normal opacity-75">(Max: {goal.maxPoints} pts)</span>}
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[40%]">Criteria</TableHead>
                <TableHead className="w-[25%]">Points</TableHead>
                <TableHead className="text-center w-[15%]">Count</TableHead>
                <TableHead className="text-center w-[20%] font-semibold">Received Points</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {goalQuestions.map((q: any) => (
                <>
                  <TableRow key={q.id} className={`${color === "blue" ? "bg-blue-50/50" : "bg-green-50/50"}`}>
                    <TableCell colSpan={4} className="font-semibold text-sm py-1.5">
                      <span className="text-muted-foreground mr-1">{q.srNo}.</span> {q.category}
                    </TableCell>
                  </TableRow>
                  {renderQuestionOptions(q, isAuto)}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    });
  };

  if (loading || !data) {
    const loadingBody = <div className="flex justify-center items-center py-20 min-h-[60vh]"><RotaryLoader size="lg" /></div>;
    return embedded ? loadingBody : <ProtectedRoute>{loadingBody}</ProtectedRoute>;
  }

  // Gate: Zonal Awards must be switched ON for this district's parent zone
  // (Zones list → ⋮ → "Zonal Awards: Enable"). Only hide when the API explicitly
  // returns false — an older API that omits the flag keeps the previous behaviour.
  if (data.isZonalAwardsEnabled === false) {
    const disabledBody = (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-amber-100 p-3"><Trophy className="h-7 w-7 text-amber-600" /></div>
        <h3 className="text-lg font-semibold text-slate-800">Zonal Awards is not enabled</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Zonal Awards is not currently active for this district&apos;s zone.
        </p>
      </div>
    );
    return embedded ? disabledBody : <ProtectedRoute>{disabledBody}</ProtectedRoute>;
  }

  const body = (
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className={`flex flex-col gap-4 sm:flex-row sm:items-center ${embedded ? "sm:justify-end" : "sm:justify-between"}`}>
          {!embedded && (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={backHref}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {districtName ? `${districtName} - Zonal Awards` : "Zonal Awards"}
              </h2>
              <p className="text-muted-foreground text-base">{data?.yearLabel || "Current Year"}</p>
            </div>
          </div>
          )}
          <div className="flex items-center gap-3">
            {!embedded && (
              <Select value={String(selectedYearId || "")} onValueChange={v => setSelectedYearId(Number(v))}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Select Year" /></SelectTrigger>
                <SelectContent>
                  {allYears.map((y: any) => (
                    <SelectItem key={y.id} value={String(y.id)}>{y.label} {y.isCurrent ? "(Current)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canEdit && (
              <Button onClick={handleSaveManual} disabled={saving}>
                {saving ? <><RotaryLoader size="sm" /><span className="ml-2">Saving...</span></> : <><Save className="h-4 w-4 mr-2" />Save</>}
              </Button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-5 text-center">
              <p className="text-sm text-blue-600 font-medium mb-1">Auto Generated Points</p>
              <p className="text-4xl font-bold text-blue-800">{totalAuto.toFixed(0)}</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-5 text-center">
              <p className="text-sm text-green-600 font-medium mb-1">Manual Points</p>
              <p className="text-4xl font-bold text-green-800">{totalManual.toFixed(0)}</p>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-5 text-center">
              <p className="text-sm text-amber-600 font-medium mb-1">Total Points</p>
              <p className="text-4xl font-bold text-amber-800">{grandTotal.toFixed(0)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Auto Generated Points */}
        <Card className="border-blue-200 overflow-hidden">
          <CardHeader className="pb-2 cursor-pointer bg-blue-600 text-white hover:bg-blue-700 transition-colors" onClick={() => setAutoExpanded(!autoExpanded)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                {autoExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                Auto Generated Points: {totalAuto.toFixed(0)}
              </CardTitle>
              <Badge className="bg-white/20 text-white border-white/30">{questions.filter((q: any) => q.autoOrManual === "Auto" && !isZoneQuestion(q.id)).length} questions</Badge>
            </div>
          </CardHeader>
          {autoExpanded && (
            <CardContent className="p-0 overflow-x-auto">
              {renderGoalSection(autoGoals, true, "blue")}
            </CardContent>
          )}
        </Card>

        {/* Zone-Level Awards (e.g., Inter District Cricket Match) — yearly, read-only */}
        {zoneQuestions.length > 0 && (
          <Card className="border-purple-200 overflow-hidden">
            <CardHeader className="pb-2 bg-purple-600 text-white">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Zone-Level Awards: {totalZone.toFixed(0)}
                </CardTitle>
                <Badge className="bg-white/20 text-white border-white/30">Yearly · Set by Zone</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-purple-50">
                    <TableHead className="w-[45%]">Question / Option</TableHead>
                    <TableHead className="w-[20%]">Points Label</TableHead>
                    <TableHead className="w-[20%] text-center">Status</TableHead>
                    <TableHead className="w-[15%] text-center">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zoneQuestions.flatMap((q: any) => {
                    const qOpts = getQuestionOptions(q.id);
                    const rows: any[] = [
                      <TableRow key={`zq_${q.id}`} className="bg-purple-100/60">
                        <TableCell colSpan={4} className="font-semibold text-sm text-purple-900">
                          {q.srNo ? `${q.srNo}. ` : ""}{q.category}
                        </TableCell>
                      </TableRow>
                    ];
                    for (const opt of qOpts) {
                      const isSelected = getOptionCounts(opt.id) === 1;
                      rows.push(
                        <TableRow key={`zo_${opt.id}`} className={isSelected ? "bg-green-50" : ""}>
                          <TableCell className="pl-8 text-sm">{opt.label}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{opt.pointsLabel}</TableCell>
                          <TableCell className="text-center">
                            {isSelected ? <Badge variant="default" className="text-xs">Selected</Badge> : <span className="text-muted-foreground">, </span>}
                          </TableCell>
                          <TableCell className="text-center font-medium">{isSelected ? opt.points : "–"}</TableCell>
                        </TableRow>
                      );
                    }
                    return rows;
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Manual Points */}
        <Card className="border-green-200 overflow-hidden">
          <CardHeader className="pb-2 cursor-pointer bg-green-600 text-white hover:bg-green-700 transition-colors" onClick={() => setManualExpanded(!manualExpanded)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                {manualExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                Manual Points: {totalManual.toFixed(0)}
              </CardTitle>
              <Badge className="bg-white/20 text-white border-white/30">{questions.filter((q: any) => q.autoOrManual === "Manual").length} questions</Badge>
            </div>
          </CardHeader>
          {manualExpanded && (
            <CardContent className="p-0 overflow-x-auto">
              {renderGoalSection(manualGoals, false, "green")}
            </CardContent>
          )}
        </Card>

        {!canEdit && !isCurrentYear && (
          <div className="text-center py-4 text-muted-foreground text-sm bg-muted/30 rounded-lg">
            Viewing past year data (read-only). Editing past years is restricted to SuperAdmin.
          </div>
        )}
      </div>
  );

  return embedded ? body : <ProtectedRoute>{body}</ProtectedRoute>;
}
