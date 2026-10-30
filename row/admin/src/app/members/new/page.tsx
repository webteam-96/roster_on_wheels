"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MemberForm from "@/components/MemberForm";
import { useAuth } from "@/contexts/AuthContext";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import RotaryLoader from "@/components/RotaryLoader";
import { createMember, getMembers, addClubMember, getPhotoUrl } from "@/services/api";
import { Member, MemberListItem } from "@/types/member";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Search, User, Plus, Mail, Phone, IdCard, UserPlus } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";
import { ListPageSkeleton } from "@/components/row/AppKit";

function NewMemberForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramClubId = searchParams.get("clubId");
  const backUrl = paramClubId ? `/clubs/${paramClubId}/members` : "/";
  const { isSuperAdmin } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [successTitle, setSuccessTitle] = useState("Member Created");
  const [successDescription, setSuccessDescription] = useState("The member has been added successfully.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search-first state (only when clubId is present)
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<MemberListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(!paramClubId); // Show form directly if no clubId

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const result = await getMembers(1, 10, searchTerm.trim());
      setSearchResults(result.items);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to search members.");
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      const message = axiosErr?.response?.data?.message || "Failed to add member to club.";
      setErrorMessage(message);
    }
  };

  const handleSubmit = async (data: Partial<Member>) => {
    try {
      const payload = paramClubId ? { ...data, clubId: parseInt(paramClubId) } : data;
      await createMember(payload);
      setSuccessTitle("Member Created");
      setSuccessDescription("The member has been added successfully.");
      setShowSuccess(true);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      const message = axiosErr?.response?.data?.message || "Failed to create member. Please try again.";
      setErrorMessage(message);
    }
  };

  // Route the search term into the right field on the create form:
  //   - contains "@" → email
  //   - all digits (with optional + - space) → mobile
  //   - otherwise → member name
  const buildInitialData = (raw: string): { emailId?: string; primaryMobileNumber?: string; memberName?: string } | undefined => {
    const term = raw.trim();
    if (!term) return undefined;
    if (term.includes("@")) return { emailId: term };
    if (/^[+\-\s\d]+$/.test(term)) return { primaryMobileNumber: term.replace(/[^\d+]/g, "") };
    return { memberName: term };
  };

  // If no clubId or user chose to create new member → show the form
  if (showForm) {
    return (
      <>
        <MemberForm
          onSubmit={handleSubmit}
          backUrl={backUrl}
          initialData={buildInitialData(searchTerm)}
          isSuperAdmin={isSuperAdmin}
        />
        <SuccessAlert
          open={showSuccess}
          title={successTitle}
          description={successDescription}
          onOk={() => router.push(backUrl)}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </>
    );
  }

  // Search-first UI (when clubId is present)
  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={backUrl}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Add Member</h2>
              <p className="text-muted-foreground text-base">Search existing member or create new</p>
            </div>
          </div>
        </div>

        {/* Search box */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-primary/5 p-4 rounded-lg border border-primary/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input
              placeholder="Search by mobile number, email, or Rotary ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9 border-primary/30 focus:border-primary text-base"
            />
          </div>
          <Button onClick={handleSearch} size="sm" disabled={searching || !searchTerm.trim()}>
            <Search className="mr-2 h-4 w-4" />
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>

        {/* Loading */}
        {searching && <div className="flex items-center justify-center py-10"><ListPageSkeleton /></div>}

        {/* Search results */}
        {!searching && searchResults !== null && (
          <>
            {searchResults.length > 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{searchResults.length} member(s) found. Click &quot;Add to Club&quot; to add an existing member.</p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {searchResults.map((member) => {
                    const photoUrl = getPhotoUrl(member.profilePhotoPath);
                    return (
                      <Card key={member.id} className="overflow-hidden border-primary/20 hover:shadow-lg transition-shadow">
                        <CardContent className="p-0">
                          <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg">
                            <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-white/20 border-2 border-white/40">
                              {photoUrl ? (
                                <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-white">
                                  <User className="h-7 w-7" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-base truncate text-white">{member.memberName}</h3>
                            </div>
                          </div>
                          <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground">
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
                          <div className="border-t px-4 py-3">
                            <Button className="w-full" onClick={() => handleAddExistingToClub(member.id, member.memberName)}>
                              <UserPlus className="mr-2 h-4 w-4" />Add to Club
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <User className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">No existing member found</h3>
                <p className="text-muted-foreground mt-2">No member matches your search. You can create a new member.</p>
              </div>
            )}

            {/* Add New Member button - always visible after search */}
            <div className="flex justify-center">
              <Button variant="outline" size="lg" onClick={() => setShowForm(true)}>
                <Plus className="mr-2 h-4 w-4" />Create New Member
              </Button>
            </div>
          </>
        )}

        {/* Initial state - before any search */}
        {!searching && searchResults === null && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">Search for Existing Member</h3>
            <p className="text-muted-foreground mt-2">Enter mobile number, email, or Rotary ID to check if member already exists.</p>
            <p className="text-muted-foreground mt-1 text-sm">If found, you can add them directly to this club.</p>
          </div>
        )}
      </div>

      <SuccessAlert
        open={showSuccess}
        title={successTitle}
        description={successDescription}
        onOk={() => router.push(backUrl)}
      />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </>
  );
}

export default function NewMemberPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}>
        <NewMemberForm />
      </Suspense>
    </ProtectedRoute>
  );
}
