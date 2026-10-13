"use client";

import { useState, useEffect } from "react";
import DateField from "@/components/DateField";
import { useBrand, useFeature } from "@/contexts/BrandContext";
import { Country, Member, MemberAddress, FamilyMember } from "@/types/member";
import { getCountries } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import PhotoUpload from "@/components/PhotoUpload";
import {
  BLOOD_GROUPS,
  GENDERS,
  LANGUAGES,
  RELATIONS,
} from "@/lib/constants";
import { Plus, Trash2, Save, ArrowLeft } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import { DayMonthPicker } from "@/components/DayMonthPicker";
import { MEMBER_NAME_FILTER } from "@/lib/textInput";
import { familyDuplicateError } from "@/lib/familyValidation";

interface MemberFormProps {
  initialData?: Partial<Member>;
  onSubmit: (data: Partial<Member>) => Promise<void>;
  isEdit?: boolean;
  // Three-tier edit policy (mirrors backend MembersController.Update):
  //   isSuperAdmin: full edit
  //   isSelfEdit:   full edit on own profile (member editing themselves)
  //   isAdminPartial: edit most fields, the 10 in PARTIAL_EDIT_LOCKED_FIELDS
  //                   below are read-only (Club Admin / District Admin)
  //   none of the above → form is fully read-only
  // Frontend list MUST stay in sync with UserPermissionHelper.DirectoryMemberLockedFields
  // on the backend. If you add/remove a locked field, change BOTH.
  isSuperAdmin?: boolean;
  isSelfEdit?: boolean;
  isAdminPartial?: boolean;
  backUrl?: string;
}

// Field names match UpdateMemberDto property names (camelCased here for the
// Member type). When a Club Admin / District Admin edits someone ELSE's record,
// these inputs render read-only. Backend silently reverts any tampered values.
// Update 2026-06-10: Club Admin can now edit Primary Mobile / Email / Primary
// Country for their club's members (these three were removed from the lock).
// Backend MembersController.Update enforces a duplicate check on mobile + email
// and forces a mobile re-login on mobile change. Must stay in sync with the
// equivalent set in app/members/edit-v2/[id]/page.tsx AND
// UserPermissionHelper.DirectoryMemberLockedFields on the backend.
const PARTIAL_EDIT_LOCKED_FIELDS = new Set<string>([
  "secondaryMobileNumber",
  "rotaryId",
  // isHonoraryMember moved to club_members 2026-06-26 (per-club) — managed via
  // a separate SuperAdmin toggle on the club members listing, no longer on this form.
  "isYouth",
  "joinedDate",
  "isPersonalDetailsVisible",
  "fkSecondaryCountryId",
  "isFamilyDetailsVisible",
  "primaryLanguage",
]);

const emptyFamilyMember: Omit<FamilyMember, "id" | "fkMemberMasterProfileId"> = {
  name: "",
  relation: "",
  bloodGroup: "",
  fkCountryId: 0,
  country: "",
  countryPhoneCode: "",
  phoneNumber: "",
  emailId: "",
  birthDate: null,
  anniversaryDate: null,
  photoPath: null,
};

const emptyResidentialAddress: Partial<MemberAddress> = {
  addressType: "Residential",
  fkCountryId: 0,
  country: "",
  countryPhoneCode: "",
  phoneNumber: "",
  address: "",
  state: "",
  city: "",
  pinCode: "",
  businessName: null,
  businessEmailId: null,
  keywords: null,
};

const emptyBusinessAddress: Partial<MemberAddress> = {
  addressType: "Business",
  fkCountryId: 0,
  country: "",
  countryPhoneCode: "",
  phoneNumber: "",
  address: "",
  state: "",
  city: "",
  pinCode: "",
  businessName: "",
  businessEmailId: "",
  keywords: "",
};

const defaultFormData: Partial<Member> = {
  memberName: "",
  profilePhotoPath: null,
  fkPrimaryCountryId: 0,
  primaryCountry: "",
  primaryCountryPhoneCode: "",
  primaryMobileNumber: "",
  emailId: "",
  birthDate: null,
  anniversaryDate: null,
  bloodGroup: "",
  fkSecondaryCountryId: 0,
  secondaryCountry: "",
  secondaryCountryPhoneCode: "",
  secondaryMobileNumber: "",
  isPersonalDetailsVisible: true,
  // Honorary is per-club (cm.IsHonoraryMember) and only meaningful on CREATE
  // when a clubId is present in the URL (the new member is being added to
  // that one club). Edit form NEVER reads or writes this field — post-create
  // toggles go through the SuperAdmin per-club endpoint on the directory page.
  isHonoraryMember: false,
  gender: "",
  primaryLanguage: "English",
  isYouth: false,
  memberIntroduction: "",
  facebook: "",
  instagram: "",
  linkedIn: "",
  twitter: "",
  youtube: "",
  website: "",
  rotaryId: "",
  donorRecognition: "",
  designation: null,
  classificationProfession: null,
  familyPhotoPath: null,
  isFamilyDetailsVisible: true,
  addresses: [],
  familyMembers: [],
  joinedDate: null,
};

const todayIso = (): string => {
  const d = new Date();
  return d.toISOString().substring(0, 10);
};

function formatDateForInput(date: string | null | undefined): string {
  if (!date) return "";
  return date.substring(0, 10);
}

function getAddress(addresses: MemberAddress[] | undefined, type: string): MemberAddress | undefined {
  return addresses?.find((a) => a.addressType === type);
}

export default function MemberForm({
  initialData,
  onSubmit,
  isEdit = false,
  isSuperAdmin = false,
  isSelfEdit = false,
  isAdminPartial = false,
  backUrl = "/",
}: MemberFormProps) {
  // Three-tier resolution: full edit (SA / self) → partial edit (Admin) → read-only.
  // For non-edit (create) flow, never read-only.
  const canFullEdit = !isEdit || isSuperAdmin || isSelfEdit;
  const isReadOnly = isEdit && !canFullEdit && !isAdminPartial;
  // Helper that resolves whether a given field is read-only for the current user.
  // Used inline on inputs the partial-edit policy locks. Inputs not in
  // PARTIAL_EDIT_LOCKED_FIELDS stay editable for Admin.
  const isFieldLocked = (fieldKey: string): boolean => {
    if (canFullEdit) return false;
    if (isAdminPartial) return PARTIAL_EDIT_LOCKED_FIELDS.has(fieldKey);
    return true; // fully read-only role
  };
  const [formData, setFormData] = useState<Partial<Member>>({
    ...defaultFormData,
    ...initialData,
  });
  const [saving, setSaving] = useState(false);
  const showBloodGroup = useFeature("member.bloodGroup");
  const showFamily = useFeature("member.familyDetails");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [countries, setCountries] = useState<Country[]>([]);

  useEffect(() => {
    getCountries()
      .then(setCountries)
      .catch(() => setCountries([]));
  }, []);

  // ROW: a new member starts in the brand's default country (Brand:Locale:DefaultCountryId); none when it is 0.
  const brand = useBrand();
  useEffect(() => {
    const c = countries.find((x) => x.id === brand.locale.defaultCountryId);
    if (!c) return;
    setFormData((p) => (p.fkPrimaryCountryId ? p : {
      ...p,
      fkPrimaryCountryId: c.id, primaryCountry: c.countryName, primaryCountryPhoneCode: c.phoneCode,
      fkSecondaryCountryId: p.fkSecondaryCountryId || c.id, secondaryCountry: p.secondaryCountry || c.countryName,
      secondaryCountryPhoneCode: p.secondaryCountryPhoneCode || c.phoneCode,
    }));
  }, [countries, brand.locale.defaultCountryId]);

  const resAddr = getAddress(formData.addresses as MemberAddress[], "Residential");
  const busAddr = getAddress(formData.addresses as MemberAddress[], "Business");

  const updateField = (field: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleCountryChange = (field: "fkPrimaryCountryId" | "fkSecondaryCountryId", countryId: string) => {
    const id = parseInt(countryId);
    const country = countries.find((c) => c.id === id);
    if (field === "fkPrimaryCountryId") {
      setFormData((prev) => ({
        ...prev,
        fkPrimaryCountryId: id,
        primaryCountry: country?.countryName || "",
        primaryCountryPhoneCode: country?.phoneCode || "",
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        fkSecondaryCountryId: id,
        secondaryCountry: country?.countryName || "",
        secondaryCountryPhoneCode: country?.phoneCode || "",
      }));
    }
  };

  const updateAddress = (type: "Residential" | "Business", field: string, value: unknown) => {
    const addresses = [...(formData.addresses || [])] as MemberAddress[];
    const idx = addresses.findIndex((a) => a.addressType === type);
    if (idx >= 0) {
      addresses[idx] = { ...addresses[idx], [field]: value };
    } else {
      const base = type === "Residential" ? { ...emptyResidentialAddress } : { ...emptyBusinessAddress };
      addresses.push({ ...base, id: 0, fkMemberMasterProfileId: 0, [field]: value } as MemberAddress);
    }
    updateField("addresses", addresses);
  };

  const handleAddrCountryChange = (type: "Residential" | "Business", countryId: string) => {
    const id = parseInt(countryId);
    const country = countries.find((c) => c.id === id);
    const addresses = [...(formData.addresses || [])] as MemberAddress[];
    const idx = addresses.findIndex((a) => a.addressType === type);
    if (idx >= 0) {
      addresses[idx] = {
        ...addresses[idx],
        fkCountryId: id,
        country: country?.countryName || "",
        countryPhoneCode: country?.phoneCode || "",
      };
    } else {
      const base = type === "Residential" ? { ...emptyResidentialAddress } : { ...emptyBusinessAddress };
      addresses.push({
        ...base,
        id: 0,
        fkMemberMasterProfileId: 0,
        fkCountryId: id,
        country: country?.countryName || "",
        countryPhoneCode: country?.phoneCode || "",
      } as MemberAddress);
    }
    updateField("addresses", addresses);
  };

  const getAddrField = (addr: MemberAddress | undefined, field: keyof MemberAddress): string => {
    if (!addr) return "";
    const val = addr[field];
    return (val as string) ?? "";
  };

  const updateFamilyMember = (index: number, field: string, value: unknown) => {
    const members = [...(formData.familyMembers || [])];
    members[index] = { ...members[index], [field]: value };
    updateField("familyMembers", members);
  };

  const handleFamilyCountryChange = (index: number, countryId: string) => {
    const id = parseInt(countryId);
    const country = countries.find((c) => c.id === id);
    const members = [...(formData.familyMembers || [])];
    members[index] = {
      ...members[index],
      fkCountryId: id,
      country: country?.countryName || "",
      countryPhoneCode: country?.phoneCode || "",
    };
    updateField("familyMembers", members);
  };

  const addFamilyMember = () => {
    const members = [...(formData.familyMembers || [])];
    members.push({ ...emptyFamilyMember, id: 0, fkMemberMasterProfileId: 0 } as FamilyMember);
    updateField("familyMembers", members);
  };

  const removeFamilyMember = (index: number) => {
    const members = [...(formData.familyMembers || [])];
    members.splice(index, 1);
    updateField("familyMembers", members);
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.memberName?.trim()) newErrors.memberName = "Name is required";
    if (!formData.emailId?.trim()) newErrors.emailId = "Email is required";
    if (!formData.primaryMobileNumber?.trim()) newErrors.primaryMobileNumber = "Mobile number is required";
    if (!formData.rotaryId?.trim()) newErrors.rotaryId = "Rotary ID is required";
    if (!formData.joinedDate) newErrors.joinedDate = "Date of Joining is required";
    else if ((formData.joinedDate as string).substring(0, 10) > todayIso()) newErrors.joinedDate = "Date of Joining cannot be in the future";
    const familyErr = familyDuplicateError(formData.familyMembers);
    if (familyErr) newErrors.family = familyErr;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      // Filter out empty addresses before submitting
      const submissionData = { ...formData };
      if (submissionData.addresses) {
        submissionData.addresses = submissionData.addresses.filter((a) => {
          if (a.addressType === "Residential") {
            return a.address || a.city || a.state || a.phoneNumber || a.pinCode;
          }
          return a.businessName || a.address || a.city || a.state;
        });
      }
      await onSubmit(submissionData);
    } finally {
      setSaving(false);
    }
  };

  const renderSelect = (
    field: string,
    label: string,
    options: string[],
    placeholder?: string
  ) => {
    const locked = isFieldLocked(field);
    return (
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-foreground">{label}</Label>
        <Select
          value={(formData as Record<string, string>)[field] || ""}
          onValueChange={(v) => updateField(field, v)}
          disabled={locked}
        >
          <SelectTrigger className={locked ? "bg-muted" : ""}>
            <SelectValue placeholder={placeholder || `Select ${label}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const renderCountrySelect = (
    field: "fkPrimaryCountryId" | "fkSecondaryCountryId",
    label: string
  ) => {
    const locked = isFieldLocked(field);
    return (
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-foreground">{label}</Label>
        <Select
          value={String((formData as Record<string, unknown>)[field] || 1)}
          onValueChange={(v) => handleCountryChange(field, v)}
          disabled={locked}
        >
          <SelectTrigger className={locked ? "bg-muted" : ""}>
            <SelectValue placeholder={`Select ${label}`} />
          </SelectTrigger>
          <SelectContent>
            {countries.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.countryName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const renderAddrCountrySelect = (
    type: "Residential" | "Business",
    addr: MemberAddress | undefined,
    label: string
  ) => (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-foreground">{label}</Label>
      <Select
        value={String(addr?.fkCountryId || 1)}
        onValueChange={(v) => handleAddrCountryChange(type, v)}
      >
        <SelectTrigger>
          <SelectValue placeholder={`Select ${label}`} />
        </SelectTrigger>
        <SelectContent>
          {countries.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.countryName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderAddrSelect = (
    type: "Residential" | "Business",
    addr: MemberAddress | undefined,
    field: keyof MemberAddress,
    label: string,
    options: string[]
  ) => (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-foreground">{label}</Label>
      <Select
        value={getAddrField(addr, field)}
        onValueChange={(v) => updateAddress(type, field, v)}
      >
        <SelectTrigger>
          <SelectValue placeholder={`Select ${label}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderAddrInput = (
    type: "Residential" | "Business",
    addr: MemberAddress | undefined,
    field: keyof MemberAddress,
    label: string,
    inputType: string = "text"
  ) => (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-foreground">{label}</Label>
      <Input
        type={inputType}
        value={getAddrField(addr, field)}
        onChange={(e) => updateAddress(type, field, e.target.value)}
      />
    </div>
  );

  const renderInput = (
    field: string,
    label: string,
    type: string = "text",
    required: boolean = false,
    inputFilter?: RegExp
  ) => {
    const locked = isFieldLocked(field);
    return (
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-foreground">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Input
          type={type}
          value={(formData as Record<string, string>)[field] || ""}
          onChange={(e) => updateField(field, inputFilter ? e.target.value.replace(inputFilter, "") : e.target.value)}
          readOnly={locked}
          className={`${errors[field] ? "border-destructive" : ""} ${locked ? "bg-muted cursor-not-allowed" : ""}`}
        />
        {errors[field] ? (
          <p className="text-xs text-destructive">{errors[field]}</p>
        ) : required ? (
          <p className="text-xs text-muted-foreground">{label} is required</p>
        ) : null}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={backUrl}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-primary">
              {isEdit ? "Edit Member" : "Add New Member"}
            </h2>
            <p className="text-muted-foreground text-base">
              {isEdit
                ? "Update member information"
                : "Fill in the details to add a new member"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={backUrl}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              <RotaryLoader size="sm" className="mr-2" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="personal" className="w-full">
        <TabsList className={`grid w-full grid-cols-3 ${showFamily ? "lg:grid-cols-5" : "lg:grid-cols-4"} bg-primary h-12 rounded-lg`}>
          <TabsTrigger value="personal" className="text-primary-foreground text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md">Personal</TabsTrigger>
          <TabsTrigger value="social" className="text-primary-foreground text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md">Social</TabsTrigger>
          <TabsTrigger value="residential" className="text-primary-foreground text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md">Residential</TabsTrigger>
          <TabsTrigger value="business" className="text-primary-foreground text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md">Business</TabsTrigger>
          {showFamily && <TabsTrigger value="family" className="text-primary-foreground text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md">Family</TabsTrigger>}
        </TabsList>

        <TabsContent value="personal" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="bg-primary/5 rounded-t-lg border-b border-primary/20">
              <CardTitle className="text-primary text-lg">Personal Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-6">
                {isReadOnly ? (
                  <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-full bg-muted border">
                    {formData.profilePhotoPath ? (
                      <img src={formData.profilePhotoPath.startsWith("http") ? formData.profilePhotoPath : `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${formData.profilePhotoPath}`} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">No Photo</div>
                    )}
                  </div>
                ) : (
                  <PhotoUpload
                    currentPath={formData.profilePhotoPath || null}
                    type="profile"
                    onUploaded={(path) => updateField("profilePhotoPath", path)}
                  />
                )}
                <div className="flex-1 grid gap-4 sm:grid-cols-2">
                  {isReadOnly ? (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-foreground">Full Name <span className="text-destructive ml-1">*</span></Label>
                      <Input value={formData.memberName || ""} readOnly className="bg-muted" />
                    </div>
                  ) : renderInput("memberName", "Full Name", "text", true, MEMBER_NAME_FILTER)}
                  {isReadOnly ? (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-foreground">Email <span className="text-destructive ml-1">*</span></Label>
                      <Input value={formData.emailId || ""} readOnly className="bg-muted" />
                    </div>
                  ) : renderInput("emailId", "Email", "email", true)}
                  {isReadOnly ? (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-foreground">Mobile Number <span className="text-destructive ml-1">*</span></Label>
                      <Input value={formData.primaryMobileNumber || ""} readOnly className="bg-muted" />
                    </div>
                  ) : renderInput("primaryMobileNumber", "Mobile Number", "tel", true, /[^0-9]/g)}
                  {isReadOnly ? (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-foreground">Country</Label>
                      <Input value={formData.primaryCountry || ""} readOnly className="bg-muted" />
                    </div>
                  ) : renderCountrySelect("fkPrimaryCountryId", "Country")}
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-foreground">Date of Birth</Label>
                  {/* Birthday + anniversary collect day + month only — year is never
                      asked from the user and backend always saves with year=1900. */}
                  <DayMonthPicker
                    value={formData.birthDate}
                    onChange={(v) => updateField("birthDate", v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-foreground">
                    Date of Joining <span className="text-destructive ml-1">*</span>
                  </Label>
                  <DateField max={todayIso()} value={formatDateForInput(formData.joinedDate)} onChange={(v: string) => updateField("joinedDate", v || null)} readOnly={isFieldLocked("joinedDate")} className={`${errors.joinedDate ? "border-destructive" : ""} ${isFieldLocked("joinedDate") ? "bg-muted cursor-not-allowed" : ""}`} />
                  {errors.joinedDate && <p className="text-xs text-destructive">{errors.joinedDate}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-foreground">Anniversary Date</Label>
                  <DayMonthPicker
                    value={formData.anniversaryDate}
                    onChange={(v) => updateField("anniversaryDate", v)}
                  />
                </div>
                {showBloodGroup && renderSelect("bloodGroup", "Blood Group", BLOOD_GROUPS)}
                {renderSelect("gender", "Gender", GENDERS)}
                {renderSelect("primaryLanguage", "Primary Language", LANGUAGES)}
                {renderCountrySelect("fkSecondaryCountryId", "Secondary Country")}
                {renderInput("secondaryMobileNumber", "Secondary Mobile", "tel", false, /[^0-9]/g)}
                {isReadOnly ? (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-foreground">Rotary ID <span className="text-destructive ml-1">*</span></Label>
                    <Input value={formData.rotaryId || ""} readOnly className="bg-muted" />
                  </div>
                ) : renderInput("rotaryId", "Rotary ID", "text", true, /[^0-9]/g)}
                {renderInput("donorRecognition", "Donor Recognition")}
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-3">
                <div className={`flex items-center gap-3 ${isFieldLocked("isPersonalDetailsVisible") ? "opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    id="isPersonalDetailsVisible"
                    checked={formData.isPersonalDetailsVisible ?? true}
                    onChange={(e) => updateField("isPersonalDetailsVisible", e.target.checked)}
                    disabled={isFieldLocked("isPersonalDetailsVisible")}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="isPersonalDetailsVisible" className="text-sm font-semibold text-foreground">Personal Details Visible</Label>
                </div>
                {/* Honorary Member — per-club flag (cm.IsHonoraryMember).
                    SuperAdmin → editable on both NEW and EDIT (per user spec).
                    Other roles → read-only display when the per-club value is loaded.
                    Hidden entirely when no club context (formData.isHonoraryMember === undefined). */}
                {(!isEdit ? isSuperAdmin : (isSuperAdmin || formData.isHonoraryMember !== undefined)) && (
                  <div className={`flex items-center gap-3 ${!isSuperAdmin ? "opacity-60 cursor-not-allowed" : ""}`}>
                    <input
                      type="checkbox"
                      id="isHonoraryMember"
                      checked={formData.isHonoraryMember ?? false}
                      onChange={(e) => updateField("isHonoraryMember", e.target.checked)}
                      disabled={!isSuperAdmin}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="isHonoraryMember" className="text-sm font-semibold text-foreground">
                      Honorary Member (this club)
                      {!isSuperAdmin && (
                        <span className="ml-1 text-[10px] italic font-normal text-muted-foreground">
                          — SuperAdmin only
                        </span>
                      )}
                    </Label>
                  </div>
                )}
                <div className={`flex items-center gap-3 ${isFieldLocked("isYouth") ? "opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    id="isYouth"
                    checked={formData.isYouth ?? false}
                    onChange={(e) => updateField("isYouth", e.target.checked)}
                    disabled={isFieldLocked("isYouth")}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="isYouth" className="text-sm font-semibold text-foreground">Youth Member</Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-foreground">Introduction</Label>
                <Textarea
                  value={formData.memberIntroduction || ""}
                  onChange={(e) => updateField("memberIntroduction", e.target.value)}
                  rows={3}
                  placeholder="Brief introduction about the member..."
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="social" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="bg-primary/5 rounded-t-lg border-b border-primary/20">
              <CardTitle className="text-primary text-lg">Social Media</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {renderInput("facebook", "Facebook URL", "url")}
                {renderInput("instagram", "Instagram URL", "url")}
                {renderInput("linkedIn", "LinkedIn URL", "url")}
                {renderInput("twitter", "Twitter/X URL", "url")}
                {renderInput("youtube", "YouTube URL", "url")}
                {renderInput("website", "Website URL", "url")}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="residential" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="bg-primary/5 rounded-t-lg border-b border-primary/20">
              <CardTitle className="text-primary text-lg">Residential Address</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {renderAddrCountrySelect("Residential", resAddr, "Country")}
                {renderAddrInput("Residential", resAddr, "phoneNumber", "Phone Number", "tel")}
                <div className="sm:col-span-2 space-y-2">
                  <Label className="text-sm font-semibold text-foreground">Address</Label>
                  <Textarea
                    value={getAddrField(resAddr, "address")}
                    onChange={(e) => updateAddress("Residential", "address", e.target.value)}
                    rows={2}
                  />
                </div>
                {renderAddrInput("Residential", resAddr, "state", "State")}
                {renderAddrInput("Residential", resAddr, "city", "City")}
                {renderAddrInput("Residential", resAddr, "pinCode", "Postal code")}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="business" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="bg-primary/5 rounded-t-lg border-b border-primary/20">
              <CardTitle className="text-primary text-lg">Business Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Designation + Classification are MEMBER-level (stored on club_members), shared across all clubs */}
                {renderInput("designation", "Designation")}
                {renderInput("classificationProfession", "Classification / Profession")}
                {renderAddrInput("Business", busAddr, "businessName", "Business Name")}
                {renderAddrInput("Business", busAddr, "businessEmailId", "Business Email", "email")}
                {renderAddrInput("Business", busAddr, "keywords", "Keywords")}
                {renderAddrCountrySelect("Business", busAddr, "Country")}
                {renderAddrInput("Business", busAddr, "phoneNumber", "Phone Number", "tel")}
                <div className="sm:col-span-2 space-y-2">
                  <Label className="text-sm font-semibold text-foreground">Address</Label>
                  <Textarea
                    value={getAddrField(busAddr, "address")}
                    onChange={(e) => updateAddress("Business", "address", e.target.value)}
                    rows={2}
                  />
                </div>
                {renderAddrInput("Business", busAddr, "state", "State")}
                {renderAddrInput("Business", busAddr, "city", "City")}
                {renderAddrInput("Business", busAddr, "pinCode", "Postal code")}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {showFamily && (
        <TabsContent value="family" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="bg-primary/5 rounded-t-lg border-b border-primary/20">
              <CardTitle className="text-primary text-lg">Family Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <PhotoUpload
                  currentPath={formData.familyPhotoPath || null}
                  type="family"
                  onUploaded={(path) => updateField("familyPhotoPath", path)}
                />
                <div className={`flex items-center gap-3 ${isFieldLocked("isFamilyDetailsVisible") ? "opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    id="isFamilyDetailsVisible"
                    checked={formData.isFamilyDetailsVisible ?? true}
                    onChange={(e) => updateField("isFamilyDetailsVisible", e.target.checked)}
                    disabled={isFieldLocked("isFamilyDetailsVisible")}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="isFamilyDetailsVisible" className="text-sm font-semibold text-foreground">Family Details Visible</Label>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-primary">Family Members</h3>
                <Button type="button" variant="outline" onClick={addFamilyMember}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Family Member
                </Button>
              </div>

              {errors.family && <p className="text-sm text-destructive">{errors.family}</p>}
              {formData.familyMembers?.map((fm, index) => (
                <Card key={index} className="border-dashed border-primary/30">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-4">
                      <h4 className="font-semibold text-sm text-primary">
                        Family Member #{index + 1}
                      </h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeFamilyMember(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">Name</Label>
                        <Input
                          value={fm.name || ""}
                          onChange={(e) => updateFamilyMember(index, "name", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">Relation</Label>
                        <Select
                          value={fm.relation || ""}
                          onValueChange={(v) => updateFamilyMember(index, "relation", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select Relation" />
                          </SelectTrigger>
                          <SelectContent>
                            {RELATIONS.filter((r) => r !== "Spouse" || !(formData.familyMembers ?? []).some((o, i) => i !== index && o.relation?.trim().toLowerCase() === "spouse")).map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {showBloodGroup && (
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">Blood Group</Label>
                        <Select
                          value={fm.bloodGroup || ""}
                          onValueChange={(v) => updateFamilyMember(index, "bloodGroup", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select Blood Group" />
                          </SelectTrigger>
                          <SelectContent>
                            {BLOOD_GROUPS.map((bg) => (
                              <SelectItem key={bg} value={bg}>
                                {bg}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      )}
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">Country</Label>
                        <Select
                          value={String(fm.fkCountryId || 1)}
                          onValueChange={(v) => handleFamilyCountryChange(index, v)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {countries.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.countryName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">Phone Number</Label>
                        <Input
                          type="tel"
                          value={fm.phoneNumber || ""}
                          onChange={(e) => updateFamilyMember(index, "phoneNumber", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">Email</Label>
                        <Input
                          type="email"
                          value={fm.emailId || ""}
                          onChange={(e) => updateFamilyMember(index, "emailId", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">Date of Birth</Label>
                        <DayMonthPicker
                          value={fm.birthDate}
                          onChange={(v) => updateFamilyMember(index, "birthDate", v)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">Anniversary</Label>
                        <DayMonthPicker
                          value={fm.anniversaryDate}
                          onChange={(v) => updateFamilyMember(index, "anniversaryDate", v)}
                        />
                      </div>
                      <div className="space-y-2 flex items-end">
                        <PhotoUpload
                          currentPath={fm.photoPath}
                          type="familymember"
                          onUploaded={(path) => updateFamilyMember(index, "photoPath", path)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {(!formData.familyMembers || formData.familyMembers.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  No family members added. Click &quot;Add Family Member&quot; to add one.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}
      </Tabs>
    </form>
  );
}
