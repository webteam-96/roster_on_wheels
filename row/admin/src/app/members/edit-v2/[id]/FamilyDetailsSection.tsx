import { NativeSelect } from "@/components/ui/native-select";
import FieldLabel from "@/components/form/FieldLabel";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { Users, Plus, Trash2 } from "@/components/icons";
import { BLOOD_GROUPS, RELATIONS } from "@/lib/constants";
import PhotoUpload from "@/components/PhotoUpload";
import { DayMonthPicker } from "@/components/DayMonthPicker";
import type { EditMemberV2Ctx } from "./useEditMemberV2";

export default function FamilyDetailsSection({ v }: { v: EditMemberV2Ctx }) {
  const { showFamily, formData, updateField, isFieldLocked, addFamilyMember, removeFamilyMember, updateFamilyMember, showBloodGroup, handleFamilyCountryChange, countries } = v;
  return (
    <>
      {showFamily && (
      <SectionCard number={5} icon={Users} title="Family Details">
        <div className="flex flex-col sm:flex-row gap-6 items-start mb-4">
          <PhotoUpload
            currentPath={formData.familyPhotoPath || null}
            type="family"
            onUploaded={(path) => updateField("familyPhotoPath", path)}
          />
          <label className={`inline-flex items-center gap-2 text-xs font-semibold text-slate-700 mt-2 ${isFieldLocked("isFamilyDetailsVisible") ? "opacity-60 cursor-not-allowed" : ""}`}>
            <input
              type="checkbox"
              checked={formData.isFamilyDetailsVisible ?? true}
              onChange={(e) => updateField("isFamilyDetailsVisible", e.target.checked)}
              disabled={isFieldLocked("isFamilyDetailsVisible")}
              className="h-4 w-4 rounded border-slate-300 text-rose-600"
            />
            Family Details Visible
          </label>
        </div>

        <div className="flex items-center justify-between mb-3 pt-3 border-t border-slate-100">
          <h4 className="row-h3">Family Members</h4>
          <Button
            type="button"
            onClick={addFamilyMember}
            variant="outline" size="sm" className="text-red-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add Family Member
          </Button>
        </div>

        {formData.familyMembers && formData.familyMembers.length > 0 ? (
          <div className="space-y-3">
            {formData.familyMembers.map((fm, index) => (
              <div
                key={index}
                className="rounded-xl border border-dashed border-rose-200 bg-rose-50/30 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <h5 className="row-h3 text-rose-700">Family Member #{index + 1}</h5>
                  <IconButton
                    type="button"
                    onClick={() => removeFamilyMember(index)}
                    className="hover:text-red-700"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <FieldLabel>Name</FieldLabel>
                    <Input
                      type="text"
                      value={fm.name || ""}
                      onChange={(e) => updateFamilyMember(index, "name", e.target.value)}
                      
                    />
                  </div>
                  <div>
                    <FieldLabel>Relation</FieldLabel>
                    <NativeSelect
                      value={fm.relation || ""}
                      onChange={(e) => updateFamilyMember(index, "relation", e.target.value)}
                      
                    >
                      <option value="">Select Relation</option>
                      {RELATIONS.filter((r) => r !== "Spouse" || !(formData.familyMembers ?? []).some((o, i) => i !== index && o.relation?.trim().toLowerCase() === "spouse")).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </NativeSelect>
                  </div>
                  {showBloodGroup && (
                  <div>
                    <FieldLabel>Blood Group</FieldLabel>
                    <NativeSelect
                      value={fm.bloodGroup || ""}
                      onChange={(e) => updateFamilyMember(index, "bloodGroup", e.target.value)}
                      
                    >
                      <option value="">Select Blood Group</option>
                      {BLOOD_GROUPS.map((bg) => (
                        <option key={bg} value={bg}>{bg}</option>
                      ))}
                    </NativeSelect>
                  </div>
                  )}
                  <div>
                    <FieldLabel>Country</FieldLabel>
                    <NativeSelect
                      value={String(fm.fkCountryId || "")}
                      onChange={(e) => handleFamilyCountryChange(index, e.target.value)}
                      
                    >
                      {countries.map((c) => (
                        <option key={c.id} value={String(c.id)}>{c.countryName}</option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div>
                    <FieldLabel>Phone Number</FieldLabel>
                    <Input
                      type="tel"
                      value={fm.phoneNumber || ""}
                      onChange={(e) => updateFamilyMember(index, "phoneNumber", e.target.value)}
                      
                    />
                  </div>
                  <div>
                    <FieldLabel>Email</FieldLabel>
                    <Input
                      type="email"
                      value={fm.emailId || ""}
                      onChange={(e) => updateFamilyMember(index, "emailId", e.target.value)}
                      
                    />
                  </div>
                  <div>
                    <FieldLabel>Date of Birth</FieldLabel>
                    <DayMonthPicker
                      value={fm.birthDate}
                      onChange={(v) => updateFamilyMember(index, "birthDate", v)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Anniversary</FieldLabel>
                    <DayMonthPicker
                      value={fm.anniversaryDate}
                      onChange={(v) => updateFamilyMember(index, "anniversaryDate", v)}
                    />
                  </div>
                  <div className="flex items-end">
                    <PhotoUpload
                      currentPath={fm.photoPath}
                      type="familymember"
                      onUploaded={(path) => updateFamilyMember(index, "photoPath", path)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-xs text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
            No family members added. Click &quot;Add Family Member&quot; to add one.
          </div>
        )}
      </SectionCard>
      )}
    </>
  );
}
