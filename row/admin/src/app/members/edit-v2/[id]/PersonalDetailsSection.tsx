import { Textarea } from "@/components/ui/textarea";
import FieldLabel from "@/components/form/FieldLabel";
import SectionCard from "@/components/form/SectionCard";
import TshirtSizeSelect from "@/components/TshirtSizeSelect";
import DateField from "@/components/DateField";
import { User } from "@/components/icons";
import SearchableCombo from "@/components/SearchableCombo";
import { BLOOD_GROUPS, GENDERS, LANGUAGES } from "@/lib/constants";
import PhotoUpload from "@/components/PhotoUpload";
import { DayMonthPicker } from "@/components/DayMonthPicker";
import { MEMBER_NAME_FILTER } from "@/lib/textInput";
import { todayIso, formatDateForInput, inputCls, errInputCls } from "./editMemberV2Shared";
import type { EditMemberV2Ctx } from "./useEditMemberV2";

export default function PersonalDetailsSection({ v }: { v: EditMemberV2Ctx }) {
  const { formData, updateField, renderInput, renderCountrySelect, isCog, isSuperAdmin, cogDistrict, setCogDistrict, districtNumbers, cogYear, setCogYear, rotaryYearLabels, errors, isFieldLocked, lockedInputCls, showBloodGroup, renderSelect, paramClubId } = v;
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
          {/* COG (club 31598) swaps Date of Joining for the DG district + Rotary
              year. Everything here is gated on `isCog`, which comes from the
              ?clubId= in the URL — every other club renders the date input below
              exactly as before, still required. Editable for SuperAdmin only;
              other roles see both values read-only (same access model as the
              Honorary Member checkbox further down). */}
          {isCog ? (
            <>
              <div>
                <FieldLabel required={isSuperAdmin}>District Number</FieldLabel>
                <SearchableCombo
                  value={cogDistrict}
                  onChange={setCogDistrict}
                  options={districtNumbers.map((d) => ({ value: d, label: d }))}
                  placeholder="Select district"
                  searchPlaceholder="Type a district number…"
                  emptyText="No district found."
                  disabled={!isSuperAdmin}
                />
                {!isSuperAdmin && <p className="text-[10px] italic text-slate-500 mt-0.5">SuperAdmin only</p>}
              </div>
              <div>
                <FieldLabel required={isSuperAdmin}>Year</FieldLabel>
                <SearchableCombo
                  value={cogYear}
                  onChange={setCogYear}
                  options={rotaryYearLabels.map((y) => ({ value: y, label: y }))}
                  placeholder="Select Rotary year"
                  searchPlaceholder="Type a year…"
                  emptyText="No year found."
                  disabled={!isSuperAdmin}
                />
                {errors.cogDesignation && <p className="text-xs text-rose-600 mt-0.5">{errors.cogDesignation}</p>}
                {!isSuperAdmin && <p className="text-[10px] italic text-slate-500 mt-0.5">SuperAdmin only</p>}
              </div>
            </>
          ) : (
            <div>
              <FieldLabel required>Date of Joining</FieldLabel>
              <DateField max={todayIso()} value={formatDateForInput(formData.joinedDate)} onChange={(v: string) => updateField("joinedDate", v || null)} readOnly={isFieldLocked("joinedDate")} className={errors.joinedDate ? errInputCls : (isFieldLocked("joinedDate") ? lockedInputCls : inputCls)} />
              {errors.joinedDate && <p className="text-xs text-rose-600 mt-0.5">{errors.joinedDate}</p>}
            </div>
          )}
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
          <label className={`inline-flex items-center gap-2 text-xs font-semibold text-slate-700 ${isFieldLocked("isPersonalDetailsVisible") ? "opacity-60 cursor-not-allowed" : ""}`}>
            <input
              type="checkbox"
              checked={formData.isPersonalDetailsVisible ?? true}
              onChange={(e) => updateField("isPersonalDetailsVisible", e.target.checked)}
              disabled={isFieldLocked("isPersonalDetailsVisible")}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Personal Details Visible
          </label>
          <label className={`inline-flex items-center gap-2 text-xs font-semibold text-slate-700 ${isFieldLocked("isYouth") ? "opacity-60 cursor-not-allowed" : ""}`}>
            <input
              type="checkbox"
              checked={formData.isYouth ?? false}
              onChange={(e) => updateField("isYouth", e.target.checked)}
              disabled={isFieldLocked("isYouth")}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Youth Member
          </label>
          {/* Honorary Member — per-club. SuperAdmin can toggle on edit (saves
              via the dedicated PATCH endpoint in handleSubmit); other roles
              see disabled. Shown only when ?clubId= is in scope; current state
              fetched from GET /api/clubs/{clubId}/members/{memberId}/honorary-status. */}
          {paramClubId && (
            <label className={`inline-flex items-center gap-2 text-xs font-semibold text-slate-700 ${!isSuperAdmin ? "opacity-60 cursor-not-allowed" : ""}`}>
              <input
                type="checkbox"
                checked={formData.isHonoraryMember ?? false}
                onChange={(e) => updateField("isHonoraryMember", e.target.checked)}
                disabled={!isSuperAdmin}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Honorary Member (this club)
              {!isSuperAdmin && (
                <span className="text-[10px] italic font-normal">,  SuperAdmin only</span>
              )}
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
