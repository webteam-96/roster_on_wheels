"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import AlertModal from "@/components/AlertModal";
import { Plus, Trash2, AlertTriangle, RotateCcw } from "@/components/icons";
import { intOnly } from "./dishaAwardsParts";
import { DishaAwardsModuleState } from "./useDishaAwards";

export default function DishaAwardsDialogs({ r }: { r: DishaAwardsModuleState }) {
  const { rotarySections, clearStatus, clearing, restoring, showClearConfirm, setShowClearConfirm, showRestoreConfirm, setShowRestoreConfirm, categories, catDialogOpen, setCatDialogOpen, editingCat, catName, setCatName, catSort, setCatSort, catSaving, deleteCat, setDeleteCat, activities, autoDialogOpen, setAutoDialogOpen, editingAuto, autoForm, setAutoForm, autoSaving, deleteAuto, setDeleteAuto, meetingTypes, subItemData, setSubItemData, manualCriteria, manualDialogOpen, setManualDialogOpen, editingManual, manualForm, setManualForm, manualSaving, deleteManual, setDeleteManual, sectionItems, doClearPoints, doRestorePoints, handleSaveCat, handleDeleteCat, handleSaveAuto, handleDeleteAuto, loadAofList, loadCatList, loadSubCatList, addAutoSubItem, removeAutoSubItem, updateAutoSubItem, handleSaveManual, handleDeleteManual, addManualSub, insertManualSubAfter, removeManualSub, updateManualSub, addManualOption, removeManualOption, updateManualOption, BonusFields } = r;
  return (
    <>
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
        <DialogTitle>{editingAuto ? "Edit Auto Fetch question" : "Add Auto Fetch question"}</DialogTitle>
        <DialogDescription>Configure auto-calculated award question.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Category *</Label>
            <Select value={autoForm.categoryId} onValueChange={v => setAutoForm((p: any) => ({ ...p, categoryId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{sectionItems}{categories.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.categoryName}</SelectItem>)}</SelectContent>
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
          <div><Label>Points</Label><Input type="number" step="1" value={autoForm.points} onChange={e => setAutoForm((p: any) => ({ ...p, points: intOnly(e.target.value) }))} />
            {/* "For every" (user 2026-11-18, option B): points per block - 1 = the usual count x points */}
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <span className="shrink-0">for every</span>
              <Input type="number" min={1} step="1" className="h-8 w-24" value={autoForm.perUnit ?? "1"}
                onChange={e => setAutoForm((p: any) => ({ ...p, perUnit: intOnly(e.target.value) }))} />
              <span className="text-slate-400">{Number(autoForm.perUnit || 1) > 1 ? `e.g. ${autoForm.perUnit} clubs / US$${autoForm.perUnit} = ${autoForm.points || 0} points` : "(1 = each one)"}</span>
            </div>
          </div>
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
        <DialogTitle>{editingManual ? "Edit Manual Entry question" : "Add Manual Entry question"}</DialogTitle>
        <DialogDescription>Add main criteria with sub criteria.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div><Label>Category *</Label>
          <Select value={manualForm.categoryId} onValueChange={v => setManualForm((p: any) => ({ ...p, categoryId: v }))}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{sectionItems}{categories.filter((c: any) => {
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
                      {/* Text answer (no points) - District Goals only (user 2026-11-16). */}
                      {(rotarySections || sc.answerType === "text") && <SelectItem value="text">Text</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                {sc.answerType !== "choose_one" && sc.answerType !== "text" && <div><Label className="text-xs">Points</Label><Input type="number" step="1" className="h-8" value={sc.points} onChange={e => updateManualSub(i, "points", intOnly(e.target.value))} /></div>}
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
    <AlertModal open={!!deleteAuto} onOpenChange={o => !o && setDeleteAuto(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Auto Fetch question" description={<>Delete this Auto Fetch question?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDeleteAuto} cancelLabel="Cancel" onCancel={() => setDeleteAuto(null)} />
    <AlertModal open={!!deleteManual} onOpenChange={o => !o && setDeleteManual(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Manual Entry question" description={<>Delete <strong>{deleteManual?.criteriaName}</strong> and all sub criteria?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDeleteManual} cancelLabel="Cancel" onCancel={() => setDeleteManual(null)} />

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
    </>
  );
}
