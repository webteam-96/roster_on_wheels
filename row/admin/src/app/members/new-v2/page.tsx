"use client";

/**
 * Add Member — v2.
 *
 * New design wrapper around the same data model used by /members/new (v1).
 * Every field, validation rule, and API call is preserved verbatim. Only the
 * visual presentation differs (V2FormShell wrapper, dot-accented section
 * headers, sticky save bar).
 *
 * URL params:
 *   - clubId    (optional) — pre-assigns the new member to that club (v1 behavior).
 *   - returnTo  (optional) — overrides where we navigate after a successful save.
 *
 * v1 page (/members/new) is intentionally left in place — many entry points
 * across the app still link to it. Migrating those references is a follow-up.
 */

import { useFeature } from "@/contexts/BrandContext";
import { familyDuplicateError } from "@/lib/familyValidation";
import { Suspense, useEffect, useState } from "react";
import DateField from "@/components/DateField";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";
import {
  User, Share2, Home, Briefcase, Users, Plus, Trash2, Info,
  Search, Mail, Phone, IdCard, UserPlus, ArrowLeft,
} from "lucide-react";
import { createMember, getCountries, getMembers, addClubMember, getPhotoUrl } from "@/services/api";
import { Country, Member, MemberAddress, FamilyMember, MemberListItem } from "@/types/member";
import {
  BLOOD_GROUPS, GENDERS, LANGUAGES, RELATIONS,
} from "@/lib/constants";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import PhotoUpload from "@/components/PhotoUpload";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { DayMonthPicker } from "@/components/DayMonthPicker";
import { MEMBER_NAME_FILTER } from "@/lib/englishText";

/* ----- helpers ----- */

const todayIso = (): string => new Date().toISOString().substring(0, 10);

function formatDateForInput(date: string | null | undefined): string {
  if (!date) return "";
  return date.substring(0, 10);
}

function getAddress(addresses: MemberAddress[] | undefined, type: string): MemberAddress | undefined {
  return addresses?.find((a) => a.addressType === type);
}

const emptyFamilyMember: Omit<FamilyMember, "id" | "fkMemberMasterProfileId"> = {
  name: "",
  relation: "",
  bloodGroup: "",
  fkCountryId: 1,
  country: "India",
  countryPhoneCode: "+91",
  phoneNumber: "",
  emailId: "",
  birthDate: null,
  anniversaryDate: null,
  photoPath: null,
};

const emptyResidentialAddress: Partial<MemberAddress> = {
  addressType: "Residential",
  fkCountryId: 1,
  country: "India",
  countryPhoneCode: "+91",
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
  fkCountryId: 1,
  country: "India",
  countryPhoneCode: "+91",
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
  fkPrimaryCountryId: 1,
  primaryCountry: "India",
  primaryCountryPhoneCode: "+91",
  primaryMobileNumber: "",
  emailId: "",
  birthDate: null,
  anniversaryDate: null,
  bloodGroup: "",
  fkSecondaryCountryId: 1,
  secondaryCountry: "India",
  secondaryCountryPhoneCode: "+91",
  secondaryMobileNumber: "",
  isPersonalDetailsVisible: true,
  // Honorary is per-club; only written when ?clubId= is present (writes the
  // initial club_members row). Edit page has no per-club context so it's
  // gone from there — post-create toggles go through the SuperAdmin directory.
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

/* ----- presentational primitives (mirrors club-service v2 add) ----- */

function SectionCard({
  number, icon: Icon, title, dot, children,
}: {
  number: number;
  icon: React.ElementType;
  title: string;
  dot: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>
          {number}
        </div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function FieldLabel({
  children, hint, dot, required,
}: {
  children: React.ReactNode;
  hint?: string;
  dot: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const errInputCls =
  "w-full px-3 py-2 text-sm border border-rose-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400";

/* ----- form (inside Suspense) ----- */

function AddMemberV2Form() {
  const searchParams = useSearchParams();
  const paramClubId = searchParams.get("clubId");
  const { isSuperAdmin } = useAuth();
  const defaultBack = paramClubId ? `/clubs/${paramClubId}/members` : "/";
  const { navigateAfterSave } = useV2ReturnTo(defaultBack);

  const [formData, setFormData] = useState<Partial<Member>>({ ...defaultFormData });
  const [countries, setCountries] = useState<Country[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const showBloodGroup = useFeature("member.bloodGroup");
  const showFamily = useFeature("member.familyDetails");
  const [loading, setLoading] = useState(true);

  const [showSuccess, setShowSuccess] = useState(false);
  const [successTitle, setSuccessTitle] = useState("Member Created");
  const [successDescription, setSuccessDescription] = useState("The member has been added successfully.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search-first state (only when clubId is present) — mirrors v1 /members/new.
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<MemberListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Show form directly if no clubId; otherwise force the search-first pre-step.
  const [showForm, setShowForm] = useState(!paramClubId);

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const result = await getMembers(1, 10, searchTerm.trim());
      setSearchResults(result.items);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setErrorMessage(axiosErr?.response?.data?.message || "Failed to search members.");
    } finally {
      setSearching(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleAddExistingToClub = async (memberId: number, memberName: string) => {
    if (!paramClubId) return;
    try {
      await addClubMember(parseInt(paramClubId), { memberId });
      setSuccessTitle("Member Added");
      setSuccessDescription(`${memberName} has been added to the club successfully.`);
      setShowSuccess(true);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setErrorMessage(axiosErr?.response?.data?.message || "Failed to add member to club.");
    }
  };

  // Route the search term into the right field when the user opts to create
  // a new member after a fruitless search (mirrors v1 buildInitialData).
  const seedFromSearchTerm = (raw: string): Partial<Member> => {
    const term = raw.trim();
    if (!term) return {};
    if (term.includes("@")) return { emailId: term };
    if (/^[+\-\s\d]+$/.test(term)) return { primaryMobileNumber: term.replace(/[^\d+]/g, "") };
    return { memberName: term };
  };

  useEffect(() => {
    getCountries()
      .then((cs) => setCountries(cs))
      .catch(() =>
        setCountries([
          {
            id: 1,
            countryName: "India",
            countryCode: "IN",
            phoneCode: "+91",
            gmtOpt: "+",
            gmtTime: "05:30",
            ordering: 1,
          },
        ])
      )
      .finally(() => setLoading(false));
  }, []);

  const resAddr = getAddress(formData.addresses as MemberAddress[], "Residential");
  const busAddr = getAddress(formData.addresses as MemberAddress[], "Business");

  /* ----- field mutators ----- */

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

  const handleCountryChange = (
    field: "fkPrimaryCountryId" | "fkSecondaryCountryId",
    countryId: string
  ) => {
    const id = parseInt(countryId);
    const country = countries.find((c) => c.id === id);
    if (field === "fkPrimaryCountryId") {
      setFormData((prev) => ({
        ...prev,
        fkPrimaryCountryId: id,
        primaryCountry: country?.countryName || "India",
        primaryCountryPhoneCode: country?.phoneCode || "+91",
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        fkSecondaryCountryId: id,
        secondaryCountry: country?.countryName || "India",
        secondaryCountryPhoneCode: country?.phoneCode || "+91",
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
        country: country?.countryName || "India",
        countryPhoneCode: country?.phoneCode || "+91",
      };
    } else {
      const base = type === "Residential" ? { ...emptyResidentialAddress } : { ...emptyBusinessAddress };
      addresses.push({
        ...base,
        id: 0,
        fkMemberMasterProfileId: 0,
        fkCountryId: id,
        country: country?.countryName || "India",
        countryPhoneCode: country?.phoneCode || "+91",
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
      country: country?.countryName || "India",
      countryPhoneCode: country?.phoneCode || "+91",
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

  /* ----- validation (matches v1 verbatim) ----- */

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.memberName?.trim()) newErrors.memberName = "Name is required";
    if (!formData.emailId?.trim()) newErrors.emailId = "Email is required";
    if (!formData.primaryMobileNumber?.trim()) newErrors.primaryMobileNumber = "Mobile number is required";
    if (!formData.rotaryId?.trim()) newErrors.rotaryId = "Rotary ID is required";
    if (!formData.joinedDate) newErrors.joinedDate = "Date of Joining is required";
    else if ((formData.joinedDate as string).substring(0, 10) > todayIso()) newErrors.joinedDate = "Date of Joining cannot be in the future";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      setErrorMessage("Please correct the highlighted fields and try again.");
      return;
    }
    const familyErr = familyDuplicateError(formData.familyMembers);
    if (familyErr) {
      setErrorMessage(familyErr);
      return;
    }
    setSaving(true);
    try {
      const submissionData: Partial<Member> = { ...formData };
      if (submissionData.addresses) {
        submissionData.addresses = submissionData.addresses.filter((a) => {
          if (a.addressType === "Residential") {
            return a.address || a.city || a.state || a.phoneNumber || a.pinCode;
          }
          return a.businessName || a.address || a.city || a.state;
        });
      }
      const payload = paramClubId
        ? { ...submissionData, clubId: parseInt(paramClubId) }
        : submissionData;
      await createMember(payload);
      setSuccessTitle("Member Created");
      setSuccessDescription("The member has been added successfully.");
      setShowSuccess(true);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setErrorMessage(axiosErr?.response?.data?.message || "Failed to create member. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /* ----- presentational helpers (closed over state) ----- */

  const renderInput = (
    field: keyof Member | string,
    label: string,
    {
      type = "text",
      required = false,
      filter,
      placeholder,
      dot = "bg-blue-500",
    }: { type?: string; required?: boolean; filter?: RegExp; placeholder?: string; dot?: string } = {}
  ) => {
    const value = (formData as Record<string, string>)[field as string] || "";
    const hasErr = !!errors[field as string];
    return (
      <div>
        <FieldLabel dot={dot} required={required}>{label}</FieldLabel>
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) =>
            updateField(
              field as string,
              filter ? e.target.value.replace(filter, "") : e.target.value
            )
          }
          className={hasErr ? errInputCls : inputCls}
        />
        {hasErr && <p className="text-xs text-rose-600 mt-0.5">{errors[field as string]}</p>}
      </div>
    );
  };

  const renderSelect = (
    field: string,
    label: string,
    options: string[],
    dot = "bg-blue-500"
  ) => (
    <div>
      <FieldLabel dot={dot}>{label}</FieldLabel>
      <select
        value={(formData as Record<string, string>)[field] || ""}
        onChange={(e) => updateField(field, e.target.value)}
        className={inputCls}
      >
        <option value="">{`Select ${label}`}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );

  const renderCountrySelect = (
    field: "fkPrimaryCountryId" | "fkSecondaryCountryId",
    label: string,
    dot = "bg-blue-500"
  ) => (
    <div>
      <FieldLabel dot={dot}>{label}</FieldLabel>
      <select
        value={String((formData as Record<string, unknown>)[field] || 1)}
        onChange={(e) => handleCountryChange(field, e.target.value)}
        className={inputCls}
      >
        {countries.map((c) => (
          <option key={c.id} value={String(c.id)}>{c.countryName}</option>
        ))}
      </select>
    </div>
  );

  const renderAddrInput = (
    type: "Residential" | "Business",
    addr: MemberAddress | undefined,
    field: keyof MemberAddress,
    label: string,
    inputType: string = "text",
    dot = "bg-emerald-500"
  ) => (
    <div>
      <FieldLabel dot={dot}>{label}</FieldLabel>
      <input
        type={inputType}
        value={getAddrField(addr, field)}
        onChange={(e) => updateAddress(type, field, e.target.value)}
        className={inputCls}
      />
    </div>
  );

  const renderAddrSelect = (
    type: "Residential" | "Business",
    addr: MemberAddress | undefined,
    field: keyof MemberAddress,
    label: string,
    options: string[],
    dot = "bg-emerald-500"
  ) => (
    <div>
      <FieldLabel dot={dot}>{label}</FieldLabel>
      <select
        value={getAddrField(addr, field)}
        onChange={(e) => updateAddress(type, field, e.target.value)}
        className={inputCls}
      >
        <option value="">{`Select ${label}`}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );

  const renderAddrCountrySelect = (
    type: "Residential" | "Business",
    addr: MemberAddress | undefined,
    label: string,
    dot = "bg-emerald-500"
  ) => (
    <div>
      <FieldLabel dot={dot}>{label}</FieldLabel>
      <select
        value={String(addr?.fkCountryId || 1)}
        onChange={(e) => handleAddrCountryChange(type, e.target.value)}
        className={inputCls}
      >
        {countries.map((c) => (
          <option key={c.id} value={String(c.id)}>{c.countryName}</option>
        ))}
      </select>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" />
      </div>
    );
  }

  // ---- Search-first pre-step (only when clubId is present, mirrors v1) ----
  if (!showForm) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <a
            href={defaultBack}
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </a>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Add Member</h2>
            <p className="text-sm text-slate-500">Search existing member or create new</p>
          </div>
        </div>

        {/* Search box */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center rounded-xl border border-blue-200 bg-blue-50/50 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
            <input
              type="text"
              placeholder="Search by mobile number, email, or Rotary ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-9 pr-3 py-2 text-sm border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={searching || !searchTerm.trim()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Search className="h-4 w-4" />
            {searching ? "Searching..." : "Search"}
          </button>
        </div>

        {/* Loading */}
        {searching && (
          <div className="flex items-center justify-center py-10">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* Results */}
        {!searching && searchResults !== null && (
          <>
            {searchResults.length > 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-500">
                  {searchResults.length} member(s) found. Click &quot;Add to Club&quot; to add an existing member.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {searchResults.map((member) => {
                    const photoUrl = getPhotoUrl(member.profilePhotoPath);
                    return (
                      <div
                        key={member.id}
                        className="overflow-hidden rounded-xl border border-slate-200 bg-white hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-center gap-3 p-4 bg-blue-600 text-white">
                          <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-white/20 border-2 border-white/40">
                            {photoUrl ? (
                              <Image
                                src={photoUrl}
                                alt={member.memberName}
                                fill
                                className="object-cover"
                                unoptimized
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-white">
                                <User className="h-6 w-6" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm truncate">{member.memberName}</h3>
                          </div>
                        </div>
                        <div className="border-t border-slate-100 px-4 py-3 space-y-1.5 text-xs text-slate-600">
                          {member.rotaryId && (
                            <div className="flex items-center gap-2">
                              <IdCard className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate">{member.rotaryId}</span>
                            </div>
                          )}
                          {member.emailId && (
                            <div className="flex items-center gap-2">
                              <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate">{member.emailId}</span>
                            </div>
                          )}
                          {member.primaryMobileNumber && (
                            <div className="flex items-center gap-2">
                              <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                              <span>{member.primaryMobileNumber}</span>
                            </div>
                          )}
                        </div>
                        <div className="border-t border-slate-100 px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleAddExistingToClub(member.id, member.memberName)}
                            className="inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                          >
                            <UserPlus className="h-4 w-4" />
                            Add to Club
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <User className="h-12 w-12 text-slate-400 mb-3" />
                <h3 className="text-base font-semibold text-slate-700">No existing member found</h3>
                <p className="text-sm text-slate-500 mt-1">
                  No member matches your search. You can create a new member.
                </p>
              </div>
            )}

            {/* Always show Create New Member after a search */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setFormData((prev) => ({ ...prev, ...seedFromSearchTerm(searchTerm) }));
                  setShowForm(true);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" />
                Create New Member
              </button>
            </div>
          </>
        )}

        {/* Initial empty state */}
        {!searching && searchResults === null && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="h-12 w-12 text-slate-400 mb-3" />
            <h3 className="text-base font-semibold text-slate-700">Search for Existing Member</h3>
            <p className="text-sm text-slate-500 mt-1">
              Enter mobile number, email, or Rotary ID to check if member already exists.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              If found, you can add them directly to this club.
            </p>
          </div>
        )}

        <SuccessAlert
          open={showSuccess}
          title={successTitle}
          description={successDescription}
          onOk={() => {
            setShowSuccess(false);
            navigateAfterSave();
          }}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    );
  }

  return (
    <V2FormShell
      title="Add New Member"
      subtitle={paramClubId ? "This member will be added to the selected club" : "Create a new member profile"}
      defaultBack={defaultBack}
      saving={saving}
      saveLabel="Save Member"
      onSave={handleSave}
      banner={
        <div className="flex items-start gap-2 text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Required fields: Full Name, Email, Mobile Number, Rotary ID, and Date of Joining.
            Names accept English letters only; mobile/Rotary ID accept digits only.
          </span>
        </div>
      }
    >
      {/* 1 — Personal */}
      <SectionCard number={1} icon={User} title="Personal Details" dot="bg-blue-600">
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
            <FieldLabel dot="bg-blue-500">Date of Birth</FieldLabel>
            {/* Day + month only — year never asked; backend saves as 1900-MM-DD. */}
            <DayMonthPicker
              value={formData.birthDate}
              onChange={(v) => updateField("birthDate", v)}
            />
          </div>
          <div>
            <FieldLabel dot="bg-blue-500" required>Date of Joining</FieldLabel>
            <DateField max={todayIso()} value={formatDateForInput(formData.joinedDate)} onChange={(v: string) => updateField("joinedDate", v || null)} className={errors.joinedDate ? errInputCls : inputCls} />
            {errors.joinedDate && <p className="text-xs text-rose-600 mt-0.5">{errors.joinedDate}</p>}
          </div>
          <div>
            <FieldLabel dot="bg-blue-500">Anniversary Date</FieldLabel>
            <DayMonthPicker
              value={formData.anniversaryDate}
              onChange={(v) => updateField("anniversaryDate", v)}
            />
          </div>
          {showBloodGroup && renderSelect("bloodGroup", "Blood Group", BLOOD_GROUPS)}
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
          <FieldLabel dot="bg-blue-500">Introduction</FieldLabel>
          <textarea
            value={formData.memberIntroduction || ""}
            onChange={(e) => updateField("memberIntroduction", e.target.value)}
            rows={3}
            placeholder="Brief introduction about the member…"
            className={inputCls}
          />
        </div>
      </SectionCard>

      {/* 2 — Social */}
      <SectionCard number={2} icon={Share2} title="Social Media" dot="bg-violet-600">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {renderInput("facebook",  "Facebook URL",   { type: "url", dot: "bg-violet-500" })}
          {renderInput("instagram", "Instagram URL",  { type: "url", dot: "bg-violet-500" })}
          {renderInput("linkedIn",  "LinkedIn URL",   { type: "url", dot: "bg-violet-500" })}
          {renderInput("twitter",   "Twitter/X URL",  { type: "url", dot: "bg-violet-500" })}
          {renderInput("youtube",   "YouTube URL",    { type: "url", dot: "bg-violet-500" })}
          {renderInput("website",   "Website URL",    { type: "url", dot: "bg-violet-500" })}
        </div>
      </SectionCard>

      {/* 3 — Residential Address */}
      <SectionCard number={3} icon={Home} title="Residential Address" dot="bg-emerald-600">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {renderAddrCountrySelect("Residential", resAddr, "Country")}
          {renderAddrInput("Residential", resAddr, "phoneNumber", "Phone Number", "tel")}
          <div className="sm:col-span-2">
            <FieldLabel dot="bg-emerald-500">Address</FieldLabel>
            <textarea
              value={getAddrField(resAddr, "address")}
              onChange={(e) => updateAddress("Residential", "address", e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
          {renderAddrInput("Residential", resAddr, "state", "State")}
          {renderAddrInput("Residential", resAddr, "city", "City")}
          {renderAddrInput("Residential", resAddr, "pinCode", "PIN Code")}
        </div>
      </SectionCard>

      {/* 4 — Business Details */}
      <SectionCard number={4} icon={Briefcase} title="Business Details" dot="bg-amber-600">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Designation + Classification are MEMBER-level (stored on club_members), shared across all clubs */}
          {renderInput("designation", "Designation", { dot: "bg-amber-500" })}
          {renderInput("classificationProfession", "Classification / Profession", { dot: "bg-amber-500" })}
          {renderAddrInput("Business", busAddr, "businessName", "Business Name", "text", "bg-amber-500")}
          {renderAddrInput("Business", busAddr, "businessEmailId", "Business Email", "email", "bg-amber-500")}
          {renderAddrInput("Business", busAddr, "keywords", "Keywords", "text", "bg-amber-500")}
          {renderAddrCountrySelect("Business", busAddr, "Country", "bg-amber-500")}
          {renderAddrInput("Business", busAddr, "phoneNumber", "Phone Number", "tel", "bg-amber-500")}
          <div className="sm:col-span-2">
            <FieldLabel dot="bg-amber-500">Address</FieldLabel>
            <textarea
              value={getAddrField(busAddr, "address")}
              onChange={(e) => updateAddress("Business", "address", e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
          {renderAddrInput("Business", busAddr, "state", "State", "text", "bg-amber-500")}
          {renderAddrInput("Business", busAddr, "city", "City", "text", "bg-amber-500")}
          {renderAddrInput("Business", busAddr, "pinCode", "PIN Code", "text", "bg-amber-500")}
        </div>
      </SectionCard>

      {/* 5 — Family */}
      {showFamily && (
      <SectionCard number={5} icon={Users} title="Family Details" dot="bg-rose-600">
        <div className="flex flex-col sm:flex-row gap-6 items-start mb-4">
          <PhotoUpload
            currentPath={formData.familyPhotoPath || null}
            type="family"
            onUploaded={(path) => updateField("familyPhotoPath", path)}
          />
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 mt-2">
            <input
              type="checkbox"
              checked={formData.isFamilyDetailsVisible ?? true}
              onChange={(e) => updateField("isFamilyDetailsVisible", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-rose-600"
            />
            Family Details Visible
          </label>
        </div>

        <div className="flex items-center justify-between mb-3 pt-3 border-t border-slate-100">
          <h4 className="text-sm font-semibold text-slate-700">Family Members</h4>
          <button
            type="button"
            onClick={addFamilyMember}
            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add Family Member
          </button>
        </div>

        {formData.familyMembers && formData.familyMembers.length > 0 ? (
          <div className="space-y-3">
            {formData.familyMembers.map((fm, index) => (
              <div
                key={index}
                className="rounded-xl border border-dashed border-rose-200 bg-rose-50/30 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <h5 className="text-xs font-bold text-rose-700">Family Member #{index + 1}</h5>
                  <button
                    type="button"
                    onClick={() => removeFamilyMember(index)}
                    className="p-1 rounded-md text-rose-600 hover:bg-rose-100"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <FieldLabel dot="bg-rose-500">Name</FieldLabel>
                    <input
                      type="text"
                      value={fm.name || ""}
                      onChange={(e) => updateFamilyMember(index, "name", e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-rose-500">Relation</FieldLabel>
                    <select
                      value={fm.relation || ""}
                      onChange={(e) => updateFamilyMember(index, "relation", e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select Relation</option>
                      {RELATIONS.filter((r) => r !== "Spouse" || !(formData.familyMembers ?? []).some((o, i) => i !== index && o.relation?.trim().toLowerCase() === "spouse")).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  {showBloodGroup && (
                  <div>
                    <FieldLabel dot="bg-rose-500">Blood Group</FieldLabel>
                    <select
                      value={fm.bloodGroup || ""}
                      onChange={(e) => updateFamilyMember(index, "bloodGroup", e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select Blood Group</option>
                      {BLOOD_GROUPS.map((bg) => (
                        <option key={bg} value={bg}>{bg}</option>
                      ))}
                    </select>
                  </div>
                  )}
                  <div>
                    <FieldLabel dot="bg-rose-500">Country</FieldLabel>
                    <select
                      value={String(fm.fkCountryId || 1)}
                      onChange={(e) => handleFamilyCountryChange(index, e.target.value)}
                      className={inputCls}
                    >
                      {countries.map((c) => (
                        <option key={c.id} value={String(c.id)}>{c.countryName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel dot="bg-rose-500">Phone Number</FieldLabel>
                    <input
                      type="tel"
                      value={fm.phoneNumber || ""}
                      onChange={(e) => updateFamilyMember(index, "phoneNumber", e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-rose-500">Email</FieldLabel>
                    <input
                      type="email"
                      value={fm.emailId || ""}
                      onChange={(e) => updateFamilyMember(index, "emailId", e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-rose-500">Date of Birth</FieldLabel>
                    <DayMonthPicker
                      value={fm.birthDate}
                      onChange={(v) => updateFamilyMember(index, "birthDate", v)}
                    />
                  </div>
                  <div>
                    <FieldLabel dot="bg-rose-500">Anniversary</FieldLabel>
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

      <SuccessAlert
        open={showSuccess}
        title={successTitle}
        description={successDescription}
        onOk={() => {
          setShowSuccess(false);
          navigateAfterSave();
        }}
      />
      <ErrorAlert
        open={!!errorMessage}
        title="Error"
        description={errorMessage || ""}
        onOk={() => setErrorMessage(null)}
      />
    </V2FormShell>
  );
}

export default function NewMemberV2Page() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        }
      >
        <AddMemberV2Form />
      </Suspense>
    </ProtectedRoute>
  );
}
