"use client";

import { goalRagClass, fmtGoalPct } from "@/components/awards/GoalAchievement";
import { Button } from "@/components/ui/button";
import RccSetPointsTab from "@/components/goal-flow/RccSetPointsTab";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
  Trophy,
  Eye,
  FileText,
  Sparkles,
  ListChecks,
  ArrowLeft,
  RotateCcw,
} from "@/components/icons";
import { ClubCitationV2View } from "@/app/clubs/[id]/citation/v2/view";
import RotaryLoader from "@/components/RotaryLoader";
import { fmtInt, ROTARY_BLUE } from "@/components/dashboard/formatters";
import { ReactQuill, CITATION_DESC_MAX_CHARS, citationQuillModules, citationPlainTextLength } from "./districtAwardsParts";
import { DistrictAwardsModuleState } from "./useDistrictAwards";

export default function DistrictAwardsTabs({ r }: { r: DistrictAwardsModuleState }) {
  const { districtId, rccPointsTab, fe, isSuperAdmin, activeTab, setActiveTab, awardsEnabled, togglingAwards, clearStatus, clearing, restoring, setShowClearConfirm, setShowRestoreConfirm, selectedYearId, clubGoals, canEdit, categories, setDeleteCat, descHtml, setDescHtml, descSaving, autoQuestions, setDeleteAuto, manualCriteria, setDeleteManual, isRotarySection, clubPoints, clubPointsLoading, viewClub, setViewClub, toggleAwards, openAddCat, openEditCat, handleSaveDesc, openAddAuto, openEditAuto, openAddManual, openEditManual } = r;
  return (
    <>
    {/* ── Tabs panel ────────────────────────────────────────────────── */}
    <Card>
      <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="row-h3">District Awards Configuration</h3>
          <p className="text-xs text-slate-500 mt-0.5">{fe ? "Categories, description, Auto Fetch & Manual Entry questions, and club leaderboard" : "Categories, description, auto & manual questions, and club leaderboard"}</p>
        </div>
        {/* Status + SuperAdmin-only enable/disable. Disabled ⇒ clubs are read-only (API-enforced). */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${awardsEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
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
                className="text-destructive"
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
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="description">Description</TabsTrigger>
            {rccPointsTab && <TabsTrigger value="rcc_points">RCC Set Points</TabsTrigger>}
            <TabsTrigger value="auto">{fe ? "Auto Fetch Question" : "Auto Questions"}</TabsTrigger>
            <TabsTrigger value="manual">{fe ? "Manual Entry Question" : "Manual Questions"}</TabsTrigger>
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
              <Card className="flex flex-col items-center py-12">
                <FolderOpen className="h-10 w-10 text-slate-300 mb-3" />
                <p className="text-sm text-slate-500">No categories. Add one to get started.</p>
              </Card>
            ) : (
              <ul className="row-card row-rise divide-y divide-slate-100 overflow-hidden">
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
                    {canEdit && isRotarySection(c.categoryName) && (
                      <span className="text-[11px] font-semibold rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-2 py-0.5">Rotary.org section · default</span>
                    )}
                    {canEdit && !isRotarySection(c.categoryName) && (
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
          <Card className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
          </Card>
        </TabsContent>

        {rccPointsTab && (
          <TabsContent value="rcc_points" className="p-5 pt-4">
            <RccSetPointsTab districtId={districtId} yearId={selectedYearId} />
          </TabsContent>
        )}

        {/* Auto Questions Tab */}
        <TabsContent value="auto" className="p-5 pt-4">
          <div className="space-y-4">
            {canEdit && (
              <div className="flex justify-end">
                <Button onClick={openAddAuto}><Plus className="mr-2 h-4 w-4" />{fe ? "Add Auto Fetch question" : "Add Auto Question"}</Button>
              </div>
            )}
            {autoQuestions.length === 0 ? (
              <Card className="flex flex-col items-center py-12">
                <Sparkles className="h-10 w-10 text-slate-300 mb-3" />
                <p className="text-sm text-slate-500">{fe ? "No Auto Fetch questions." : "No auto questions."}</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {autoQuestions.map((q: any) => (
                  <Card key={q.id} className="p-5 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-100 text-azure-50">{q.categoryName}</Badge>
                          <p className="font-semibold text-sm text-slate-800">{q.activityName}</p>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 tabular-nums">
                          Points: <span className="font-semibold text-slate-700">{fmtInt(Math.round(Number(q.points) || 0))}</span>{Number(q.perUnit) > 1 && <span className="font-semibold text-slate-700"> for every {fmtInt(Number(q.perUnit))}</span>}
                          {q.isBonus ? <> &middot; Bonus: <span className="font-semibold text-amber-700">{fmtInt(Math.round(Number(q.bonusPoints) || 0))}</span> (Min: {fmtInt(Math.round(Number(q.minBonus) || 0))}, Max: {fmtInt(Math.round(Number(q.maxBonus) || 0))})</> : null}
                        </p>
                        {q.subItems && q.subItems.length > 0 && (
                          <div className="mt-2 pl-3 border-l-2 border-slate-100 space-y-1">
                            {q.subItems.map((s: any) => {
                              const t = String(s.subItemType || "").toLowerCase();
                              // subItemName is the exact label chosen in the edit popup's dropdown (saved on
                              // select), so it always matches the edit view. Prefer it; fall back only if empty.
                              let lineage = s.subItemName || "";
                              if (!lineage) {
                                if (t === "area_of_focus") {
                                  lineage = s.areaOfFocusName || `#${s.subItemId}`;
                                } else {
                                  lineage = s.subItemId ? `#${s.subItemId}` : "";
                                }
                              }
                              const typeLabel = t.replace(/_/g, " ");
                              return (
                                <p key={s.id} className="text-xs text-slate-600">
                                  <span className="font-medium text-slate-700">{typeLabel}{typeLabel ? ": " : ""}{lineage}</span>
                                  {" "},  Points: <span className="tabular-nums font-semibold">{fmtInt(Math.round(Number(s.points) || 0))}</span>
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
                  </Card>
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
                <Button onClick={openAddManual}><Plus className="mr-2 h-4 w-4" />{fe ? "Add Manual Entry question" : "Add Manual Criteria"}</Button>
              </div>
            )}
            {manualCriteria.length === 0 ? (
              <Card className="flex flex-col items-center py-12">
                <ListChecks className="h-10 w-10 text-slate-300 mb-3" />
                <p className="text-sm text-slate-500">{fe ? "No Manual Entry questions." : "No manual criteria."}</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {manualCriteria.map((mc: any) => (
                  <Card key={mc.id} className="p-5 transition">
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
                                {sc.answerType === "number" && <span>: Points: <span className="tabular-nums font-semibold">{fmtInt(Math.round(Number(sc.points) || 0))}</span>{sc.isBonus ? <> &middot; Bonus: <span className="tabular-nums font-semibold text-amber-700">{fmtInt(Math.round(Number(sc.bonusPoints) || 0))}</span></> : null}</span>}
                                {sc.answerType === "yesno" && <span>: Base Points: <span className="tabular-nums font-semibold">{fmtInt(Math.round(Number(sc.points) || 0))}</span></span>}
                                {sc.answerType === "choose_one" && sc.options && <span>: {fmtInt(sc.options.length)} options</span>}
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
                  </Card>
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
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-slate-200">
                      <TableHead className="w-14">#</TableHead>
                      <TableHead>Club</TableHead>
                      <TableHead className="text-center">Total Points</TableHead>
                      {clubGoals.columns.map((g) => (
                        <TableHead key={g.key} className="text-center" title="Goal achievement % from Goal Setting - view only, not part of the award points">{g.label} %</TableHead>
                      ))}
                      <TableHead className="text-center w-32">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clubPoints.length === 0 ? (
                      <TableRow><TableCell colSpan={4 + clubGoals.columns.length} className="text-center py-8 text-slate-400 text-sm">No club data</TableCell></TableRow>
                    ) : clubPoints.map((c: any, i: number) => {
                      const total = Math.round(Number(c.totalPoints) || 0);
                      const isTop3 = i < 3;
                      return (
                        <TableRow key={c.clubId} className="hover:bg-blue-50/40">
                          <TableCell className="font-semibold tabular-nums text-slate-700">
                            <span className="inline-flex items-center gap-1">
                              {fmtInt(i + 1)}
                              {isTop3 && <Trophy className="h-3.5 w-3.5" style={{ color: i === 0 ? "#F7A81B" : i === 1 ? "#8796AA" : "#B97A0B" }} />}
                            </span>
                          </TableCell>
                          <TableCell className="font-medium text-slate-800">{c.clubName}</TableCell>
                          <TableCell className="text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold tabular-nums ring-1 ${
                                total > 0 ? "bg-blue-50 text-blue-700 ring-blue-100" : "bg-slate-50 text-slate-500 ring-slate-200"
                              }`}
                              style={total > 0 ? { color: ROTARY_BLUE } : undefined}
                            >
                              {fmtInt(total)}
                            </span>
                          </TableCell>
                          {clubGoals.columns.map((g) => {
                            const p = clubGoals.byClub[c.clubId]?.[g.key] ?? null;
                            return (
                              <TableCell key={g.key} className="text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold tabular-nums ring-1 ${goalRagClass(p)}`}>{fmtGoalPct(p, g.categoryId)}</span>
                              </TableCell>
                            );
                          })}
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
              </Card>
            )}
          </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
    </>
  );
}
