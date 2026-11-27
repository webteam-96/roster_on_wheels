import { Textarea } from "@/components/ui/textarea";
import FieldLabel from "@/components/form/FieldLabel";
import SectionCard from "@/components/form/SectionCard";
import TshirtSizeSelect from "@/components/TshirtSizeSelect";
import DateField from "@/components/DateField";
import { User } from "@/components/icons";
import { BLOOD_GROUPS, GENDERS, LANGUAGES } from "@/lib/constants";
import PhotoUpload from "@/components/PhotoUpload";
import { DayMonthPicker } from "@/components/DayMonthPicker";
import { MEMBER_NAME_FILTER } from "@/lib/textInput";
import { todayIso, formatDateForInput, inputCls, errInputCls } from "./addMemberV2Shared";
import type { AddMemberV2Ctx } from "./useAddMemberV2";

export default function PersonalDetailsSection({ v }: { v: AddMemberV2Ctx }) {
  const { formData, updateField, renderInput, renderCountrySelect, errors, showBloodGroup, renderSelect, paramClubId, isSuperAdmin } = v;
  return (
      <SectionCard number={1} icon={User} title="Personal Details">
        <div className="flex flex-col sm:flex-row gap-6 mb-4">
          <PhotoUpload
            currentPath={formData.profilePhotoPath || null}
            type="profile"
            onUploaded={(path) => updateField("profilePhotoPath", path)}
          />
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {renderInput("memberName", "Full Name", { required: true, filter: MEMBER_NAME_FILTER })}
            {renderInput("emailId", "Email", { type: "email", required: true })}
            {renderInput("primaryMobileNumber", "Mobile Number", { type: "tel", required: true, filter: /[^0-9]/g })}
            {renderCountrySelect("fkPrimaryCountryId", "Country")}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <FieldLabel>Date of Birth</FieldLabel>
            {/* Day + month only — year never asked; backend saves as 1900-MM-DD. */}
            <DayMonthPicker
              value={formData.birthDate}
              onChange={(v) => updateField("birthDate", v)}
            />
          </div>
          <div>
            <FieldLabel required>Date of Joining</FieldLabel>
            <DateField max={todayIso()} value={formatDateForInput(formData.joinedDate)} onChange={(v: string) => updateField("joinedDate", v || null)} className={errors.joinedDate ? errInputCls : inputCls} />
            {errors.joinedDate && <p className="text-xs text-rose-600 mt-0.5">{errors.joinedDate}</p>}
          </div>
          <div>
            <FieldLabel>Anniversary Date</FieldLabel>
            <DayMonthPicker
              value={formData.anniversaryDate}
              onChange={(v) => updateField("anniversaryDate", v)}
            />
          </div>
          {showBloodGroup && renderSelect("bloodGroup", "Blood Group", BLOOD_GROUPS)}
          <div>
            <FieldLabel required={false}>T-Shirt Size</FieldLabel>
            <TshirtSizeSelect value={formData.tshirtSizeId} currentName={formData.tshirtSize}
              onChange={(v) => updateField("tshirtSizeId", v ?? 0)} className={inputCls} />
          </div>
          {renderSelect("gender", "Gender", GENDERS)}
          {renderSelect("primaryLanguage", "Primary Language", LANGUAGES)}
          {renderCountrySelect("fkSecondaryCountryId", "Secondary Country")}
          {renderInput("secondaryMobileNumber", "Secondary Mobile", { type: "tel", filter: /[^0-9]/g })}
          {renderInput("rotaryId", "Rotary ID", { required: true, filter: /[^0-9]/g })}
          {renderInput("donorRecognition", "Donor Recognition")}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-100">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={formData.isPersonalDetailsVisible ?? true}
              onChange={(e) => updateField("isPersonalDetailsVisible", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Personal Details Visible
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={formData.isYouth ?? false}
              onChange={(e) => updateField("isYouth", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Youth Member
          </label>
          {/* Honorary Member — only shown when ?clubId= is present (per-club
              flag, written to the new club_members row) AND user is SuperAdmin
              (Club Admin can view post-create on the directory dialog). */}
          {paramClubId && isSuperAdmin && (
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={formData.isHonoraryMember ?? false}
                onChange={(e) => updateField("isHonoraryMember", e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Honorary Member (this club)
            </label>
          )}
        </div>

        <div className="mt-4">
          <FieldLabel>Introduction</FieldLabel>
          <Textarea
            value={formData.memberIntroduction || ""}
            onChange={(e) => updateField("memberIntroduction", e.target.value)}
            rows={3}
            placeholder="Brief introduction about the member…"
            
          />
        </div>
      </SectionCard>
  );
}
