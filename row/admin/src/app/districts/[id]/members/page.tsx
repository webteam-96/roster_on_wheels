"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { DistrictMember } from "@/types/district";
import { PagedResult } from "@/types/member";
import { getDistrict, getDistrictMembers, getPhotoUrl, assignDistrictAdmin, removeDistrictAdmin, setDistrictAdminClubAccess } from "@/services/api";
import { formatDMY } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Search, User, Users, MoreVertical, MoreHorizontal, ShieldCheck, ShieldOff, Mail, Phone, IdCard, Calendar, LayoutGrid, List, X, Eye, Building2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import MemberDetailDialog from "@/components/MemberDetailDialog";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function DistrictMembersPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const { isSuperAdmin } = useAuth();
  const [districtNumber, setDistrictNumber] = useState("");
  const [data, setData] = useState<PagedResult<DistrictMember> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState<number | null>(null);
  const [detailMemberId, setDetailMemberId] = useState<number | null>(null);

  useEffect(() => {
    async function fetchDistrict() {
      try {
        const d = await getDistrict(districtId);
        setDistrictNumber(d.districtNumber);
      } catch { /* ignore */ }
    }
    fetchDistrict();
  }, [districtId]);

  const fetchMembers = useCallback(async (pageNum?: number) => {
    setLoading(true);
    try {
      const result = await getDistrictMembers(districtId, pageNum || page, 20, search || undefined);
      setData(result);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [districtId, page, search]);

  // Load members on page load
  useEffect(() => { fetchMembers(); }, []);

  const handleSearch = () => {
    setPage(1);
    fetchMembers(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setLoading(true);
    getDistrictMembers(districtId, newPage, 20, search || undefined)
      .then(result => setData(result))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const handleMakeAdmin = async (memberId: number, memberName: string) => {
    setRoleLoading(memberId);
    try {
      await assignDistrictAdmin(districtId, memberId);
      setSuccessMessage(`${memberName} has been made District Admin.`);
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to assign District Admin role.");
    } finally {
      setRoleLoading(null);
    }
  };

  const handleRemoveAdmin = async (memberId: number, memberName: string, sendEmail = true) => {
    setRoleLoading(memberId);
    try {
      await removeDistrictAdmin(districtId, memberId, sendEmail);
      setSuccessMessage(`District Admin role removed from ${memberName}${sendEmail ? "" : " (no email sent)"}.`);
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to remove District Admin role.");
    } finally {
      setRoleLoading(null);
    }
  };

  // SuperAdmin toggles whether this District Admin can access all clubs of the district.
  // Enabled only for members who are already District Admins.
  const handleToggleClubAccess = async (memberId: number, memberName: string, enable: boolean) => {
    setRoleLoading(memberId);
    try {
      await setDistrictAdminClubAccess(districtId, memberId, enable);
      setSuccessMessage(enable
        ? `${memberName} can now access all clubs of the district.`
        : `Club access removed for ${memberName}.`);
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update club access.");
    } finally {
      setRoleLoading(null);
    }
  };

  // Members come straight from the server search — no separate client-side quick filter.
  const filteredMembers = data?.items || [];

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">District {districtNumber} - Members</h2>
              <p className="text-muted-foreground text-base">Search by member name, email, or Rotary ID</p>
              {data && (data.memberCount != null || data.honoraryCount != null) && (
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium text-slate-700">Total: {data.totalCount}</span>
                  <span className="text-emerald-700">Paid: {data.memberCount ?? 0}</span>
                  <span className="text-amber-600">Honorary: {data.honoraryCount ?? 0}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Search bar + View toggle */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-primary/5 p-4 rounded-lg border border-primary/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input placeholder="Search by member name, email, or Rotary ID..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={handleKeyDown} className="pl-9 border-primary/30 focus:border-primary text-base" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSearch} size="sm">
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>

            {search && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); }}>
                <X className="mr-1 h-4 w-4" />Clear
              </Button>
            )}

            <div className="flex items-center rounded-md border ml-auto">
              <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-r-none" onClick={() => setViewMode("grid")}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === "table" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-l-none" onClick={() => setViewMode("table")}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>


        {loading && <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}

        {!loading && data && data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No members found</h3>
            <p className="text-muted-foreground mt-2">Try a different search term.</p>
          </div>
        )}

        {!loading && data && filteredMembers.length > 0 && (
          <>
            {viewMode === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredMembers.map((member) => {
                  const photoUrl = getPhotoUrl(member.profilePhotoPath);
                  return (
                    <Card key={member.id} className={`overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-primary/20 cursor-pointer group relative ${roleLoading === member.id ? "opacity-60 pointer-events-none" : ""}`} onClick={() => setDetailMemberId(member.id)}>
                      {roleLoading === member.id && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 rounded-lg">
                          <RotaryLoader size="sm" />
                        </div>
                      )}
                      <CardContent className="p-0">
                        <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
                          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-white/20 border-2 border-white/40">
                            {photoUrl ? (
                              <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-white">
                                <User className="h-8 w-8" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-semibold text-base truncate text-white">{member.memberName}</h3>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {(() => {
                                    const displayRoles = member.roles?.filter(r => !(r === "Member" && member.roles.some(x => x === "Admin" || x === "Club Admin" || x === "District Admin" || x === "SuperAdmin")));
                                    return displayRoles && displayRoles.length > 0 ? displayRoles.map((role) => (
                                      <Badge key={role} className="text-xs bg-white/20 text-white border-white/30">{role}</Badge>
                                    )) : (
                                      <Badge className="text-xs bg-white/20 text-white border-white/30">Member</Badge>
                                    );
                                  })()}
                                </div>
                              </div>
                              {isSuperAdmin && (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {!member.isSuperAdmin && (
                                        member.hasDistrictAdminRole ? (
                                          <>
                                            <DropdownMenuItem onClick={() => handleRemoveAdmin(member.id, member.memberName, true)}>
                                              <ShieldOff className="mr-2 h-4 w-4" />Remove Admin with Email
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleRemoveAdmin(member.id, member.memberName, false)}>
                                              <ShieldOff className="mr-2 h-4 w-4" />Remove Admin Without Email
                                            </DropdownMenuItem>
                                          </>
                                        ) : (
                                          <DropdownMenuItem onClick={() => handleMakeAdmin(member.id, member.memberName)}>
                                            <ShieldCheck className="mr-2 h-4 w-4" />Make Admin
                                          </DropdownMenuItem>
                                        )
                                      )}
                                      {/* Club access toggle — enabled ONLY for District Admins */}
                                      {!member.isSuperAdmin && member.hasDistrictAdminRole && (
                                        <DropdownMenuItem onClick={() => handleToggleClubAccess(member.id, member.memberName, !member.allClubsAccess)}>
                                          <Building2 className="mr-2 h-4 w-4" />
                                          {member.allClubsAccess ? "Disable All-Clubs Access" : "Enable All-Clubs Access"}
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground group-hover:bg-primary/5 transition-colors">
                          {member.clubName && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate">{member.clubName}</span>
                            </div>
                          )}
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
                          {member.joinedDate && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                              <span>Joined {formatDMY(member.joinedDate)}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* Table view */
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary">
                      <TableHead className="w-12"></TableHead>
                      <TableHead className="text-base font-semibold">Member Name</TableHead>
                      <TableHead className="hidden md:table-cell text-base font-semibold">Rotary ID</TableHead>
                      <TableHead className="hidden md:table-cell text-base font-semibold">Email</TableHead>
                      <TableHead className="hidden lg:table-cell text-base font-semibold">Phone</TableHead>
                      <TableHead className="hidden lg:table-cell text-base font-semibold">Club</TableHead>
                      <TableHead className="text-base font-semibold">Roles</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMembers.map((member) => {
                      const photoUrl = getPhotoUrl(member.profilePhotoPath);
                      return (
                        <TableRow key={member.id} className={`hover:bg-primary/5 transition-colors cursor-pointer ${roleLoading === member.id ? "opacity-60 pointer-events-none" : ""}`} onClick={() => setDetailMemberId(member.id)}>
                          <TableCell>
                            <div className="relative h-8 w-8 overflow-hidden rounded-full bg-muted">
                              {photoUrl ? (
                                <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                                  <User className="h-4 w-4" />
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-semibold text-primary">{member.memberName}</TableCell>
                          <TableCell className="hidden md:table-cell">{member.rotaryId || "-"}</TableCell>
                          <TableCell className="hidden md:table-cell">{member.emailId || "-"}</TableCell>
                          <TableCell className="hidden lg:table-cell">{member.primaryMobileNumber || "-"}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{member.clubName || "-"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(() => {
                                const displayRoles = member.roles?.filter(r => !(r === "Member" && member.roles.some(x => x === "Admin" || x === "Club Admin" || x === "District Admin" || x === "SuperAdmin")));
                                return displayRoles && displayRoles.length > 0 ? displayRoles.map((role) => (
                                  <Badge key={role} variant="secondary" className="text-xs">{role}</Badge>
                                )) : (
                                  <Badge variant="secondary" className="text-xs">Member</Badge>
                                );
                              })()}
                            </div>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {isSuperAdmin && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {!member.isSuperAdmin && (
                                    member.hasDistrictAdminRole ? (
                                      <>
                                        <DropdownMenuItem onClick={() => handleRemoveAdmin(member.id, member.memberName, true)}>
                                          <ShieldOff className="mr-2 h-4 w-4" />Remove Admin with Email
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleRemoveAdmin(member.id, member.memberName, false)}>
                                          <ShieldOff className="mr-2 h-4 w-4" />Remove Admin Without Email
                                        </DropdownMenuItem>
                                      </>
                                    ) : (
                                      <DropdownMenuItem onClick={() => handleMakeAdmin(member.id, member.memberName)}>
                                        <ShieldCheck className="mr-2 h-4 w-4" />Make Admin
                                      </DropdownMenuItem>
                                    )
                                  )}
                                  {/* Club access toggle — enabled ONLY for District Admins */}
                                  {!member.isSuperAdmin && member.hasDistrictAdminRole && (
                                    <DropdownMenuItem onClick={() => handleToggleClubAccess(member.id, member.memberName, !member.allClubsAccess)}>
                                      <Building2 className="mr-2 h-4 w-4" />
                                      {member.allClubsAccess ? "Disable All-Clubs Access" : "Enable All-Clubs Access"}
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} pageSize={data.pageSize} onPageChange={handlePageChange} />
          </>
        )}

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        <MemberDetailDialog memberId={detailMemberId} open={detailMemberId !== null} onClose={() => setDetailMemberId(null)} />
      </div>
    </ProtectedRoute>
  );
}
