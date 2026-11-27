import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Pencil } from "@/components/icons";
import type { PaymentLinkFormCtx } from "./usePaymentLinkForm";

export default function FormFieldsStep({ v }: { v: PaymentLinkFormCtx }) {
  const { isForm, setIsForm, formType, isTshirtSize, setIsTshirtSize, isFood, setIsFood, allFoodPreferences, foodPreferenceIds, setFoodPreferenceIds, isDesignation, setIsDesignation, designationLabel, setDesignationLabel, desigName, setDesigName, handleAddDesig, editingDesigIdx, setEditingDesigIdx, designations, handleDeleteDesig, isPartner, setIsPartner, isPartnerName, setIsPartnerName, isPartnerMobile, setIsPartnerMobile, isPartnerEmail, setIsPartnerEmail, isPartnerGender, setIsPartnerGender, isRemark1, setIsRemark1, remark1Title, setRemark1Title, isRemark2, setIsRemark2, remark2Title, setRemark2Title, isRemark3, setIsRemark3, remark3Title, setRemark3Title, isPersonal, setIsPersonal, isPersonalName, setIsPersonalName, isPersonalMobile, setIsPersonalMobile, isPersonalEmail, setIsPersonalEmail, isPersonalDistrict, setIsPersonalDistrict, isPersonalClub, setIsPersonalClub } = v;

  const renderStepFormFields = () => (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div className="flex items-center gap-3">
          <Switch id="epl-isForm" checked={isForm} onCheckedChange={setIsForm} disabled={formType === "2"} />
          <Label htmlFor="epl-isForm">Enable additional data collection form</Label>
          {formType === "2" && <span className="text-xs text-muted-foreground">(Auto-enabled for Dynamic form)</span>}
        </div>

        {isForm && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="row-h3">General Fields</h3>
                <div className="flex items-center gap-3"><Switch id="epl-isTshirtSize" checked={isTshirtSize} onCheckedChange={setIsTshirtSize} /><Label htmlFor="epl-isTshirtSize">T-shirt Size</Label></div>
                <div className="flex items-center gap-3"><Switch id="epl-isFood" checked={isFood} onCheckedChange={setIsFood} /><Label htmlFor="epl-isFood">Food Preference</Label></div>
                {isFood && allFoodPreferences.length > 0 && (
                  <div className="ml-6 space-y-2">
                    {allFoodPreferences.map(f => {
                      const selectedIds = foodPreferenceIds.split(",").filter(Boolean).map(Number);
                      const isChecked = selectedIds.includes(f.id);
                      return (
                        <div key={f.id} className="flex flex-wrap items-center gap-2">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(c) => {
                              const ids = foodPreferenceIds.split(",").filter(Boolean).map(Number);
                              if (c) setFoodPreferenceIds([...ids, f.id].join(","));
                              else setFoodPreferenceIds(ids.filter(id => id !== f.id).join(","));
                            }}
                            id={`food-${f.id}`}
                          />
                          <Label htmlFor={`food-${f.id}`} className="text-sm font-normal">{f.foodType}</Label>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-3"><Switch id="epl-isDesignation" checked={isDesignation} onCheckedChange={setIsDesignation} /><Label htmlFor="epl-isDesignation">Custom Designation</Label></div>
                {isDesignation && (
                  <div className="ml-6 space-y-3">
                    <div><Label>Designation Label</Label><Input value={designationLabel} onChange={e => setDesignationLabel(e.target.value)} placeholder="e.g. Select Designation" /></div>
                    <div>
                      <Label>Designation List</Label>
                      <div className="flex gap-2 mt-1">
                        <Input value={desigName} onChange={e => setDesigName(e.target.value)} placeholder="e.g. President" className="flex-1" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddDesig(); } }} />
                        <Button type="button" size="sm" onClick={handleAddDesig} disabled={!desigName.trim()}>
                          {editingDesigIdx !== null ? <><Pencil className="h-4 w-4 mr-1" />Update</> : <><Plus className="h-4 w-4 mr-1" />Add</>}
                        </Button>
                        {editingDesigIdx !== null && (
                          <Button type="button" size="sm" variant="outline" onClick={() => { setEditingDesigIdx(null); setDesigName(""); }}>Cancel</Button>
                        )}
                      </div>
                      {designations.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {designations.map((d, i) => (
                            <div key={i} className={`flex items-center justify-between px-3 py-1.5 rounded text-sm ${editingDesigIdx === i ? "bg-primary/10 border border-primary" : "bg-muted"}`}>
                              <span>{d.designationName}</span>
                              <div className="flex gap-1">
                                <IconButton type="button" aria-label="Edit designation" className="h-6 w-6" onClick={() => { setEditingDesigIdx(i); setDesigName(d.designationName); }}><Pencil className="h-3.5 w-3.5" /></IconButton>
                                <IconButton type="button" aria-label="Delete designation" className="h-6 w-6 text-destructive" onClick={() => handleDeleteDesig(i)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <h3 className="row-h3">Partner Fields</h3>
                <div className="flex items-center gap-3"><Switch id="epl-isPartner" checked={isPartner} onCheckedChange={setIsPartner} /><Label htmlFor="epl-isPartner">Enable Partner Section</Label></div>
                {isPartner && (
                  <div className="ml-6 space-y-2">
                    <div className="flex items-center gap-3"><Switch id="epl-isPartnerName" checked={isPartnerName} onCheckedChange={setIsPartnerName} /><Label htmlFor="epl-isPartnerName">Partner Name</Label></div>
                    <div className="flex items-center gap-3"><Switch id="epl-isPartnerMobile" checked={isPartnerMobile} onCheckedChange={setIsPartnerMobile} /><Label htmlFor="epl-isPartnerMobile">Partner Mobile</Label></div>
                    <div className="flex items-center gap-3"><Switch id="epl-isPartnerEmail" checked={isPartnerEmail} onCheckedChange={setIsPartnerEmail} /><Label htmlFor="epl-isPartnerEmail">Partner Email</Label></div>
                    <div className="flex items-center gap-3"><Switch id="epl-isPartnerGender" checked={isPartnerGender} onCheckedChange={setIsPartnerGender} /><Label htmlFor="epl-isPartnerGender">Partner Gender</Label></div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="row-h3">Custom Remark Fields</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3"><Switch id="epl-isRemark1" checked={isRemark1} onCheckedChange={setIsRemark1} /><Label htmlFor="epl-isRemark1">Remark 1</Label></div>
                  {isRemark1 && <Input value={remark1Title} onChange={e => setRemark1Title(e.target.value)} placeholder="Remark 1 title" />}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3"><Switch id="epl-isRemark2" checked={isRemark2} onCheckedChange={setIsRemark2} /><Label htmlFor="epl-isRemark2">Remark 2</Label></div>
                  {isRemark2 && <Input value={remark2Title} onChange={e => setRemark2Title(e.target.value)} placeholder="Remark 2 title" />}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3"><Switch id="epl-isRemark3" checked={isRemark3} onCheckedChange={setIsRemark3} /><Label htmlFor="epl-isRemark3">Remark 3</Label></div>
                  {isRemark3 && <Input value={remark3Title} onChange={e => setRemark3Title(e.target.value)} placeholder="Remark 3 title" />}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="row-h3">Personal Detail Fields</h3>
              <div className="flex items-center gap-3">
                <Switch id="epl-isPersonal" checked={isPersonal} onCheckedChange={setIsPersonal} disabled={formType === "2"} />
                <Label htmlFor="epl-isPersonal">Enable Personal Details</Label>
                {formType === "2" && <span className="text-xs text-muted-foreground">(Auto-enabled for Dynamic form)</span>}
              </div>
              {isPersonal && (
                <div className="ml-6 grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div className="flex items-center gap-3"><Switch id="epl-isPersonalName" checked={isPersonalName} onCheckedChange={setIsPersonalName} /><Label htmlFor="epl-isPersonalName">Name</Label></div>
                  <div className="flex items-center gap-3"><Switch id="epl-isPersonalMobile" checked={isPersonalMobile} onCheckedChange={setIsPersonalMobile} /><Label htmlFor="epl-isPersonalMobile">Mobile</Label></div>
                  <div className="flex items-center gap-3"><Switch id="epl-isPersonalEmail" checked={isPersonalEmail} onCheckedChange={setIsPersonalEmail} /><Label htmlFor="epl-isPersonalEmail">Email</Label></div>
                  <div className="flex items-center gap-3"><Switch id="epl-isPersonalDistrict" checked={isPersonalDistrict} onCheckedChange={setIsPersonalDistrict} /><Label htmlFor="epl-isPersonalDistrict">District</Label></div>
                  <div className="flex items-center gap-3"><Switch id="epl-isPersonalClub" checked={isPersonalClub} onCheckedChange={setIsPersonalClub} /><Label htmlFor="epl-isPersonalClub">Club</Label></div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );

  return renderStepFormFields();
}
