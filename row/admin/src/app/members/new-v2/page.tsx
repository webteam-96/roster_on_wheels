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

import { Textarea } from "@/components/ui/textarea";
import FieldLabel from "@/components/form/FieldLabel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { Suspense } from "react";
import Image from "next/image";
import { User, Share2, Home, Briefcase, Plus, Info, Search, Mail, Phone, IdCard, UserPlus } from "@/components/icons";
import { getPhotoUrl } from "@/services/api";
import V2FormShell from "@/components/v2/V2FormShell";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { useAddMemberV2 } from "./useAddMemberV2";
import PersonalDetailsSection from "./PersonalDetailsSection";
import FamilyDetailsSection from "./FamilyDetailsSection";

/* ----- form (inside Suspense) ----- */

function AddMemberV2Form() {
  const h = useAddMemberV2();
  const { loading, showForm, defaultBack, searchTerm, setSearchTerm, handleSearchKeyDown, handleSearch, searching, searchResults, handleAddExistingToClub, setFormData, seedFromSearchTerm, setShowForm, showSuccess, successTitle, successDescription, setShowSuccess, navigateAfterSave, errorMessage, setErrorMessage, paramClubId, saving, handleSave, renderInput, renderAddrCountrySelect, resAddr, renderAddrInput, getAddrField, updateAddress, busAddr } = h;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <ListPageSkeleton />
      </div>
    );
  }

  // ---- Search-first pre-step (only when clubId is present, mirrors v1) ----
  if (!showForm) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <PageHeader title="Add Member" description="Search existing member or create new" back={defaultBack} />

        {/* Search box */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center rounded-xl border border-blue-200 bg-blue-50/50 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
            <Input
              type="text"
              placeholder="Search by mobile number, email, or Rotary ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-9 pr-3"
            />
          </div>
          <Button
            type="button"
            onClick={handleSearch}
            disabled={searching || !searchTerm.trim()}
            
          >
            <Search className="h-4 w-4" />
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>

        {/* Loading */}
        {searching && (
          <div className="flex items-center justify-center py-10">
            <ListPageSkeleton />
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
                      <Card
                        key={member.id}
                        className="overflow-hidden transition-shadow"
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
                            <h3 className="row-h3 truncate">{member.memberName}</h3>
                          </div>
                        </div>
                        <div className="border-t border-slate-100 px-4 py-3 space-y-1.5 text-xs text-slate-600">
                          {member.rotaryId && (
                            <div className="flex flex-wrap items-center gap-2">
                              <IdCard className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate">{member.rotaryId}</span>
                            </div>
                          )}
                          {member.emailId && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate">{member.emailId}</span>
                            </div>
                          )}
                          {member.primaryMobileNumber && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                              <span>{member.primaryMobileNumber}</span>
                            </div>
                          )}
                        </div>
                        <div className="border-t border-slate-100 px-4 py-3">
                          <Button
                            type="button"
                            onClick={() => handleAddExistingToClub(member.id, member.memberName)}
                            size="sm" className="w-full"
                          >
                            <UserPlus className="h-4 w-4" />
                            Add to Club
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <User className="h-12 w-12 text-slate-400 mb-3" />
                <h3 className="row-h2">No existing member found</h3>
                <p className="text-sm text-slate-500 mt-1">
                  No member matches your search. You can create a new member.
                </p>
              </div>
            )}

            {/* Always show Create New Member after a search */}
            <div className="flex justify-center">
              <Button
                type="button"
                onClick={() => {
                  setFormData((prev) => ({ ...prev, ...seedFromSearchTerm(searchTerm) }));
                  setShowForm(true);
                }}
                variant="outline"
              >
                <Plus className="h-4 w-4" />
                Create New Member
              </Button>
            </div>
          </>
        )}

        {/* Initial empty state */}
        {!searching && searchResults === null && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="h-12 w-12 text-slate-400 mb-3" />
            <h3 className="row-h2">Search for Existing Member</h3>
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
  const v = h;

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
      <PersonalDetailsSection v={v} />

      {/* 2 — Social */}
      <SectionCard number={2} icon={Share2} title="Social Media">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {renderInput("facebook",  "Facebook URL",   { type: "url", dot: "bg-[#A9C6EA]" })}
          {renderInput("instagram", "Instagram URL",  { type: "url", dot: "bg-[#A9C6EA]" })}
          {renderInput("linkedIn",  "LinkedIn URL",   { type: "url", dot: "bg-[#A9C6EA]" })}
          {renderInput("twitter",   "Twitter/X URL",  { type: "url", dot: "bg-[#A9C6EA]" })}
          {renderInput("youtube",   "YouTube URL",    { type: "url", dot: "bg-[#A9C6EA]" })}
          {renderInput("website",   "Website URL",    { type: "url", dot: "bg-[#A9C6EA]" })}
        </div>
      </SectionCard>

      {/* 3 — Residential Address */}
      <SectionCard number={3} icon={Home} title="Residential Address">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {renderAddrCountrySelect("Residential", resAddr, "Country")}
          {renderAddrInput("Residential", resAddr, "phoneNumber", "Phone Number", "tel")}
          <div className="sm:col-span-2">
            <FieldLabel>Address</FieldLabel>
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
      </SectionCard>

      {/* 4 — Business Details */}
      <SectionCard number={4} icon={Briefcase} title="Business Details">
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
            <FieldLabel>Address</FieldLabel>
            <Textarea
              value={getAddrField(busAddr, "address")}
              onChange={(e) => updateAddress("Business", "address", e.target.value)}
              rows={2}
              
            />
          </div>
          {renderAddrInput("Business", busAddr, "state", "State", "text", "bg-amber-500")}
          {renderAddrInput("Business", busAddr, "city", "City", "text", "bg-amber-500")}
          {renderAddrInput("Business", busAddr, "pinCode", "Postal code", "text", "bg-amber-500")}
        </div>
      </SectionCard>

      {/* 5 — Family */}
      <FamilyDetailsSection v={v} />

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
            <ListPageSkeleton />
          </div>
        }
      >
        <AddMemberV2Form />
      </Suspense>
    </ProtectedRoute>
  );
}
