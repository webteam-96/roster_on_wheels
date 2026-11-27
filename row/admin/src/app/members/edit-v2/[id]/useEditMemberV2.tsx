import { NativeSelect } from "@/components/ui/native-select";
import FieldLabel from "@/components/form/FieldLabel";
import { Input } from "@/components/ui/input";
import { sameAddressType, onePerAddressType, isHomeAddressType } from "@/lib/memberAddress";
import { useFeature } from "@/contexts/BrandContext";
import { familyDuplicateError } from "@/lib/familyValidation";
import { useEffect, useState } from "react";
import { useSearchParams, useParams } from "next/navigation";
import { getCountries, getMembers, addClubMember, getMember, updateMember, getClubMemberHonorary, setClubMemberHonorary, getDistricts, getRotaryYears, getCogDesignation, updateCogDesignation } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Country, Member, MemberAddress, FamilyMember, MemberListItem } from "@/types/member";
import { useV2ReturnTo } from "@/components/v2/V2FormShell";
import { COG_CLUB_ID, PARTIAL_EDIT_LOCKED_FIELDS, todayIso, getAddress, emptyFamilyMember, emptyResidentialAddress, emptyBusinessAddress, defaultFormData, inputCls, errInputCls } from "./editMemberV2Shared";

export function useEditMemberV2() {
  const searchParams = useSearchParams();
  const routeParams = useParams();
  const memberId = Number(routeParams?.id);
  const paramClubId = searchParams.get("clubId");
  // COG treatment is driven purely by the club this edit was opened FROM.
  const isCog = Number(paramClubId) === COG_CLUB_ID;
  const defaultBack = paramClubId ? `/clubs/${paramClubId}/members` : "/";
  const { navigateAfterSave } = useV2ReturnTo(defaultBack);

  // Three-tier edit policy — matches MembersController.Update on the backend.
  // SA or self → no field locks. Admin (CA/DA) editing someone else → 10 fields
  // locked (PARTIAL_EDIT_LOCKED_FIELDS). Other roles → entire form read-only.
  const { isSuperAdmin, isAdmin, user } = useAuth();
  const isSelfEdit = user?.memberId === memberId;
  const canFullEdit = isSuperAdmin || isSelfEdit;
  const isAdminPartial = isAdmin && !canFullEdit;
  const isAllReadOnly = !canFullEdit && !isAdminPartial;
  const isFieldLocked = (field: string): boolean => {
    if (canFullEdit) return false;
    if (isAllReadOnly) return true;
    return PARTIAL_EDIT_LOCKED_FIELDS.has(field);
  };

  const [formData, setFormData] = useState<Partial<Member>>({ ...defaultFormData });
  const [countries, setCountries] = useState<Country[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const showBloodGroup = useFeature("member.bloodGroup");
  const showFamily = useFeature("member.familyDetails");
  const [loading, setLoading] = useState(true);

  // COG-only state. Left untouched (and never fetched) for every other club.
  const [cogDistrict, setCogDistrict] = useState("");
  const [cogYear, setCogYear] = useState("");
  const [districtNumbers, setDistrictNumbers] = useState<string[]>([]);
  const [rotaryYearLabels, setRotaryYearLabels] = useState<string[]>([]);

  const [showSuccess, setShowSuccess] = useState(false);
  const [successTitle, setSuccessTitle] = useState("Member Updated");
  const [successDescription, setSuccessDescription] = useState("The member has been updated successfully.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Edit mode skips the search-first / duplicate-check UI completely.
  // These setters stay declared so the legacy branches inherited from new-v2
  // still type-check; they're never invoked because `showForm` is forced true.
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<MemberListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(true);
  void setSearchTerm; void setSearchResults; void setSearching; void setShowForm;

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
    // Load countries AND the existing member in parallel — countries for the
    // dropdowns, member for the form's initial values.
    if (!Number.isFinite(memberId) || memberId <= 0) {
      setErrorMessage("Invalid member ID.");
      setLoading(false);
      return;
    }
    Promise.all([
      getCountries().catch(() => [] as Country[]),
      getMember(memberId, paramClubId ? parseInt(paramClubId) || undefined : undefined).catch((err: unknown) => {
        const axiosErr = err as { response?: { data?: { message?: string } } };
        setErrorMessage(axiosErr?.response?.data?.message || "Failed to load member.");
        return null;
      }),
    ])
      .then(async ([cs, mem]) => {
        setCountries(cs);
        if (!mem) return;
        // Per-club honorary — fetch in-line with the member load (NOT a
        // separate useEffect) to avoid a race: a parallel fetch could resolve
        // first and then get nuked when the main `setFormData(mem)` replaced
        // the whole object. Sequential merge guarantees the honorary value
        // sticks for SuperAdmin's edit-then-save flow and Club Admin's read view.
        let memWithHonorary: Member = mem;
        if (paramClubId) {
          const clubIdNum = parseInt(paramClubId);
          if (Number.isFinite(clubIdNum) && clubIdNum > 0) {
            try {
              const h = await getClubMemberHonorary(clubIdNum, memberId);
              memWithHonorary = { ...mem, isHonoraryMember: !!h.isHonorary };
            } catch { /* non-fatal: checkbox stays false */ }
          }
        }
        setFormData(memWithHonorary);
      })
      .finally(() => setLoading(false));
  }, [memberId, paramClubId]);

  // COG only: option lists for the two pickers + this member's current values,
  // read from the COG membership row (NOT the member-level designation, which
  // would return their real club's value for the 840 dual-membership members).
  useEffect(() => {
    if (!isCog || !Number.isFinite(memberId) || memberId <= 0) return;
    getDistricts(1, 9999)
      .then((d) => setDistrictNumbers(
        Array.from(new Set(d.items.map((x) => (x.districtNumber ?? "").trim()).filter((x) => /^\d{3,5}$/.test(x))))
          .sort((a, b) => Number(a) - Number(b))
      ))
      .catch(() => {});
    getRotaryYears()
      .then((y) => setRotaryYearLabels(
        y.map((x) => x.yearLabel).filter((l) => /^\d{4}-\d{2}$/.test(l)).sort((a, b) => b.localeCompare(a))
      ))
      .catch(() => {});
    getCogDesignation(COG_CLUB_ID, memberId)
      .then((v) => { setCogDistrict(v.districtNumber || ""); setCogYear(v.yearLabel || ""); })
      .catch(() => { /* non-fatal: pickers just start empty */ });
  }, [isCog, memberId]);

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
    // Date of Joining is hidden for COG, so it must not be required there — the
    // field is required exactly as before for every other club. Without this the
    // form would refuse to save with an error pointing at an invisible field.
    if (!isCog) {
      if (!formData.joinedDate) newErrors.joinedDate = "Date of Joining is required";
      else if ((formData.joinedDate as string).substring(0, 10) > todayIso()) newErrors.joinedDate = "Date of Joining cannot be in the future";
    }
    // COG replaces it with district + year; both or neither (a half-set pair
    // can't be encoded into the single Designation label).
    if (isCog && isSuperAdmin && (!!cogDistrict !== !!cogYear)) {
      newErrors.cogDesignation = "Select both a district number and a year.";
    }
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
      const payload: Partial<Member> = paramClubId
        ? { ...submissionData, clubId: parseInt(paramClubId) }
        : { ...submissionData, clubId: submissionData.clubId ?? null };
      // Backend MembersController.Update enforces the 10-field lock for
      // CA/DA roles — even if the UI doesn't strip them, the server reverts
      // any locked field back to the existing DB value silently.
      await updateMember(memberId, payload);

      // SuperAdmin per-club honorary write — UpdateMemberDto doesn't carry
      // IsHonoraryMember (per-club column). Fire the dedicated PATCH endpoint.
      if (isSuperAdmin && paramClubId && submissionData.isHonoraryMember !== undefined) {
        const clubIdNum = parseInt(paramClubId);
        if (Number.isFinite(clubIdNum) && clubIdNum > 0) {
          try {
            await setClubMemberHonorary(clubIdNum, memberId, !!submissionData.isHonoraryMember);
          } catch (hErr) {
            const msg = hErr instanceof Error ? hErr.message : "Honorary status update failed.";
            setErrorMessage(msg);
            setSaving(false);
            return;
          }
        }
      }

      // SuperAdmin COG district + year write — same shape as the honorary write
      // above: a per-club value that UpdateMemberDto doesn't carry, so it goes
      // through its own endpoint. Scoped to the COG membership row.
      if (isCog && isSuperAdmin && cogDistrict && cogYear) {
        try {
          await updateCogDesignation(COG_CLUB_ID, memberId, { districtNumber: cogDistrict, yearLabel: cogYear });
        } catch (cErr) {
          const axiosErr = cErr as { response?: { data?: { message?: string } } };
          setErrorMessage(axiosErr?.response?.data?.message || "District/year update failed.");
          setSaving(false);
          return;
        }
      }

      setSuccessTitle("Member Updated");
      setSuccessDescription("The member has been updated successfully.");
      setShowSuccess(true);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setErrorMessage(axiosErr?.response?.data?.message || "Failed to update member. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /* ----- presentational helpers (closed over state) ----- */

  // Tailwind class for an input rendered in its locked state — keeps the V2
  // look (rounded, border, height) but mutes the color and shows not-allowed
  // cursor so the user immediately knows the field is unavailable to them.
  const lockedInputCls = `${inputCls} bg-slate-100 text-slate-500 cursor-not-allowed`;

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
    const locked = isFieldLocked(field as string);
    return (
      <div>
        <FieldLabel required={required}>{label}</FieldLabel>
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          readOnly={locked}
          onChange={(e) =>
            updateField(
              field as string,
              filter ? e.target.value.replace(filter, "") : e.target.value
            )
          }
          className={hasErr ? errInputCls : (locked ? lockedInputCls : inputCls)}
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
  ) => {
    const locked = isFieldLocked(field);
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <select
          value={(formData as Record<string, string>)[field] || ""}
          onChange={(e) => updateField(field, e.target.value)}
          disabled={locked}
          className={locked ? lockedInputCls : inputCls}
        >
          <option value="">{`Select ${label}`}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  };

  const renderCountrySelect = (
    field: "fkPrimaryCountryId" | "fkSecondaryCountryId",
    label: string,
    dot = "bg-blue-500"
  ) => {
    const locked = isFieldLocked(field);
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <select
          value={String((formData as Record<string, unknown>)[field] || "")}
          onChange={(e) => handleCountryChange(field, e.target.value)}
          disabled={locked}
          className={locked ? lockedInputCls : inputCls}
        >
          {countries.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.countryName}</option>
          ))}
        </select>
      </div>
    );
  };

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
  return { memberId, paramClubId, isCog, defaultBack, navigateAfterSave, isSuperAdmin, isAdminPartial, isAllReadOnly, isFieldLocked, formData, setFormData, countries, errors, saving, showBloodGroup, showFamily, loading, cogDistrict, setCogDistrict, cogYear, setCogYear, districtNumbers, rotaryYearLabels, showSuccess, setShowSuccess, successTitle, successDescription, errorMessage, setErrorMessage, searchTerm, setSearchTerm, searchResults, searching, showForm, setShowForm, handleSearch, handleSearchKeyDown, handleAddExistingToClub, seedFromSearchTerm, resAddr, busAddr, updateField, updateAddress, getAddrField, updateFamilyMember, handleFamilyCountryChange, addFamilyMember, removeFamilyMember, handleSave, lockedInputCls, renderInput, renderSelect, renderCountrySelect, renderAddrInput, renderAddrCountrySelect };
}

export type EditMemberV2Ctx = ReturnType<typeof useEditMemberV2>;
