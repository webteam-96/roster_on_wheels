import { NativeSelect } from "@/components/ui/native-select";
import FieldLabel from "@/components/form/FieldLabel";
import { Input } from "@/components/ui/input";
import { sameAddressType, onePerAddressType, isHomeAddressType } from "@/lib/memberAddress";
import { useBrand, useFeature } from "@/contexts/BrandContext";
import { familyDuplicateError } from "@/lib/familyValidation";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { createMember, getCountries, getMembers, addClubMember } from "@/services/api";
import { Country, Member, MemberAddress, FamilyMember, MemberListItem } from "@/types/member";
import { useV2ReturnTo } from "@/components/v2/V2FormShell";
import { todayIso, getAddress, emptyFamilyMember, emptyResidentialAddress, emptyBusinessAddress, defaultFormData, inputCls, errInputCls } from "./addMemberV2Shared";

export function useAddMemberV2() {
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

  useEffect(() => {
    getCountries()
      .then((cs) => setCountries(cs))
      .catch(() => setCountries([]))
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
    const idx = addresses.findIndex((a) => sameAddressType(a.addressType, type));
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
    const idx = addresses.findIndex((a) => sameAddressType(a.addressType, type));
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
        // One home + one Business row only (upstream 2026-11-02).
        submissionData.addresses = onePerAddressType(submissionData.addresses).filter((a) => {
          if (isHomeAddressType(a.addressType)) {
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
        <FieldLabel required={required}>{label}</FieldLabel>
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
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect
        value={(formData as Record<string, string>)[field] || ""}
        onChange={(e) => updateField(field, e.target.value)}
        
      >
        <option value="">{`Select ${label}`}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </NativeSelect>
    </div>
  );

  const renderCountrySelect = (
    field: "fkPrimaryCountryId" | "fkSecondaryCountryId",
    label: string,
    dot = "bg-blue-500"
  ) => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect
        value={String((formData as Record<string, unknown>)[field] || "")}
        onChange={(e) => handleCountryChange(field, e.target.value)}
        
      >
        {countries.map((c) => (
          <option key={c.id} value={String(c.id)}>{c.countryName}</option>
        ))}
      </NativeSelect>
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
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={inputType}
        value={getAddrField(addr, field)}
        onChange={(e) => updateAddress(type, field, e.target.value)}
        
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
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect
        value={getAddrField(addr, field)}
        onChange={(e) => updateAddress(type, field, e.target.value)}
        
      >
        <option value="">{`Select ${label}`}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </NativeSelect>
    </div>
  );

  const renderAddrCountrySelect = (
    type: "Residential" | "Business",
    addr: MemberAddress | undefined,
    label: string,
    dot = "bg-emerald-500"
  ) => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect
        value={String(addr?.fkCountryId || "")}
        onChange={(e) => handleAddrCountryChange(type, e.target.value)}
        
      >
        {countries.map((c) => (
          <option key={c.id} value={String(c.id)}>{c.countryName}</option>
        ))}
      </NativeSelect>
    </div>
  );
  return { paramClubId, isSuperAdmin, defaultBack, navigateAfterSave, formData, setFormData, countries, errors, saving, showBloodGroup, showFamily, loading, showSuccess, setShowSuccess, successTitle, successDescription, errorMessage, setErrorMessage, searchTerm, setSearchTerm, searchResults, searching, showForm, setShowForm, handleSearch, handleSearchKeyDown, handleAddExistingToClub, seedFromSearchTerm, resAddr, busAddr, updateField, updateAddress, getAddrField, updateFamilyMember, handleFamilyCountryChange, addFamilyMember, removeFamilyMember, handleSave, renderInput, renderSelect, renderCountrySelect, renderAddrInput, renderAddrCountrySelect };
}

export type AddMemberV2Ctx = ReturnType<typeof useAddMemberV2>;
