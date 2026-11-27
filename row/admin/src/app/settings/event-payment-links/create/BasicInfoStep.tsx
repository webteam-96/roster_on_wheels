import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { PaymentLinkFormCtx } from "./usePaymentLinkForm";

export default function BasicInfoStep({ v }: { v: PaymentLinkFormCtx }) {
  const { formType, setFormType, setIsForm, setIsPersonal, title, setTitle, description, setDescription, isMultipleDistricts, setIsMultipleDistricts, setSelectedDistrictIds, setSelectedDistrictId, setSelectedClubId, setRecipientType, setSelectedYearId, setSelectedSubGroupIds, setSubGroups, allDistricts, selectedDistrictIds, selectedDistrictId, selectedClubId, districtClubs, recipientType, isHideCharges, setIsHideCharges, selectedYearId, rotaryYears, subGroups, selectedSubGroupIds, setLogoFile, setBgImageFile } = v;

  // ---- RENDER STEPS ----

  const renderStepBasicInfo = () => (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div>
          <Label>Form Type</Label>
          <Select value={formType} onValueChange={v => { setFormType(v); if (v === "2") { setIsForm(true); setIsPersonal(true); } }}>
            <SelectTrigger className="w-full md:w-1/2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Standard (Members Only)</SelectItem>
              <SelectItem value="2">Dynamic (Anyone)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Title *</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Event description" />
        </div>

        {/* District/Club selection - only for Standard form */}
        {formType === "1" && (
          <div className="flex items-center gap-3">
            <Checkbox checked={isMultipleDistricts} onCheckedChange={(c) => { setIsMultipleDistricts(!!c); setSelectedDistrictIds([]); setSelectedDistrictId(""); setSelectedClubId(""); if (c) { setRecipientType("1"); setSelectedYearId(""); setSelectedSubGroupIds([]); setSubGroups([]); } }} id="multiDistrict" />
            <Label htmlFor="multiDistrict">Is For Multiple Districts</Label>
          </div>
        )}

        {formType === "1" && isMultipleDistricts ? (
          <div>
            <Label>Select Districts</Label>
            <div className="border rounded-lg p-3 max-h-48 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-2">
              {allDistricts.map(d => (
                <div key={d.id} className="flex flex-wrap items-center gap-2">
                  <Checkbox
                    checked={selectedDistrictIds.includes(d.id)}
                    onCheckedChange={(c) => {
                      if (c) setSelectedDistrictIds(prev => [...prev, d.id]);
                      else setSelectedDistrictIds(prev => prev.filter(id => id !== d.id));
                    }}
                    id={`dist-${d.id}`}
                  />
                  <Label htmlFor={`dist-${d.id}`} className="text-sm font-normal">{d.districtNumber}</Label>
                </div>
              ))}
            </div>
            {selectedDistrictIds.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1">{selectedDistrictIds.length} district(s) selected</p>
            )}
          </div>
        ) : formType === "1" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Select District</Label>
              <Select value={selectedDistrictId} onValueChange={v => { setSelectedDistrictId(v); setSelectedClubId(""); }}>
                <SelectTrigger><SelectValue placeholder="Choose district" /></SelectTrigger>
                <SelectContent>
                  {allDistricts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedDistrictId && (
              <div>
                <Label>Select Club (optional)</Label>
                <Select value={selectedClubId} onValueChange={setSelectedClubId}>
                  <SelectTrigger><SelectValue placeholder="Choose club" /></SelectTrigger>
                  <SelectContent>
                    {districtClubs.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {formType === "1" && (
            <div>
              <Label>Recipient Type</Label>
              <Select value={recipientType} onValueChange={v => { setRecipientType(v); setSelectedYearId(""); setSelectedSubGroupIds([]); setSubGroups([]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">All Members</SelectItem>
                  {/* Subgroups only make sense for single-club/district scope, not All Districts. */}
                  {!isMultipleDistricts && <SelectItem value="2">Subgroup</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Switch id="epl-isHideCharges" checked={isHideCharges} onCheckedChange={setIsHideCharges} />
            <Label htmlFor="epl-isHideCharges">Hide Gateway Charges</Label>
          </div>
        </div>

        {/* Subgroup selection - Year + Subgroup checkboxes */}
        {formType === "1" && recipientType === "2" && (
          <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
            <h4 className="row-h3">Select Subgroups</h4>
            <div>
              <Label>Rotary Year</Label>
              <Select value={selectedYearId} onValueChange={v => { setSelectedYearId(v); setSelectedSubGroupIds([]); }}>
                <SelectTrigger className="w-full md:w-1/2"><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {rotaryYears.map(y => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedYearId && subGroups.length > 0 && (
              <div>
                <Label>Subgroups</Label>
                <Card className="p-3 max-h-48 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2">
                  {subGroups.map(sg => (
                    <div key={sg.id} className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        checked={selectedSubGroupIds.includes(sg.id)}
                        onCheckedChange={(c) => {
                          if (c) setSelectedSubGroupIds(prev => [...prev, sg.id]);
                          else setSelectedSubGroupIds(prev => prev.filter(id => id !== sg.id));
                        }}
                        id={`sg-${sg.id}`}
                      />
                      <Label htmlFor={`sg-${sg.id}`} className="text-sm font-normal">{sg.groupName}</Label>
                    </div>
                  ))}
                </Card>
                {selectedSubGroupIds.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">{selectedSubGroupIds.length} subgroup(s) selected</p>
                )}
              </div>
            )}
            {selectedYearId && subGroups.length === 0 && (
              <p className="text-sm text-muted-foreground">No subgroups found for the selected year and scope.</p>
            )}
          </div>
        )}

        {/* Images */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Logo Image</Label><Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setLogoFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
          <div><Label>Background Image</Label><Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setBgImageFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
        </div>
      </CardContent>
    </Card>
  );

  return renderStepBasicInfo();
}
