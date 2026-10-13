"use client";

import { useFeature } from "@/contexts/BrandContext";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { globalMemberSearch, globalMemberSoftDelete, globalMemberUpdateContact } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import { ArrowLeft, Search, User, Building, Shield, Award, Crown, Users, Briefcase, X, Pencil, Trash2, Calendar, CreditCard, ClipboardList } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { formatBirthAnniversary } from "@/lib/dateUtils";

import { appLocale, currencySymbol } from "@/lib/appFormat";
// Field keys (case-insensitive) that should display DD-MM only — project rule.
const BIRTH_ANNIV_KEYS = new Set(["birthdate", "anniversarydate"]);

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function InfoRow({ label, value, fieldKey }: { label: string; value: any; fieldKey?: string }) {
  if (value == null || value === "" || value === false) return null;
  if (value === true) value = "Yes";
  // Birthday + anniversary fields display as DD-MM only — strip year on render.
  // The year is preserved in the DB and visible only inside edit forms.
  if (fieldKey && BIRTH_ANNIV_KEYS.has(fieldKey.toLowerCase()) && typeof value === "string") {
    value = formatBirthAnniversary(value);
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1970) value = d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
  }
  return (
    <div className="flex gap-2 py-1.5 border-b border-dashed border-gray-100 last:border-0">
      <span className="text-xs text-muted-foreground w-44 flex-shrink-0 font-medium">{label}</span>
      <span className="text-sm break-all">{String(value)}</span>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2 mt-5 mb-2 border-b pb-1">
      <Icon className="h-4 w-4 text-primary" />
      <h4 className="text-sm font-semibold text-primary">{title}</h4>
      <Badge variant="secondary" className="text-xs">{count}</Badge>
    </div>
  );
}

const fieldLabels: Record<string, string> = {
  pk_member_master_profile_id: "Member ID",
  MemberName: "Name",
  PrimaryMobileNumber: "Mobile",
  SecondaryMobileNumber: "Secondary Mobile",
  EmailId: "Email",
  BirthDate: "Birth Date",
  AnniversaryDate: "Anniversary",
  BloodGroup: "Blood Group",
  Gender: "Gender",
  PrimaryLanguage: "Language",
  IsYouth: "Youth",
  MemberIntroduction: "Introduction",
  Facebook: "Facebook",
  Instagram: "Instagram",
  LinkedIn: "LinkedIn",
  Twitter: "Twitter",
  Youtube: "YouTube",
  Website: "Website",
  RotaryId: "Rotary ID",
  DonorRecognition: "Donor Recognition",
  IsPersonalDetailsVisible: "Personal Details Visible",
  IsFamilyDetailsVisible: "Family Details Visible",
  RiAdmissionDate: "RI Admission Date",
  fk_primary_country_id: "Country ID",
  fk_secondary_country_id: "Secondary Country ID",
  created_date: "Created Date",
  modified_date: "Modified Date",
};

const skipFields = new Set(["isdeleted", "deleted_by", "deleted_date", "created_by", "modified_by", "MobileLoginCount", "LastImei", "LastDeviceToken", "LastDeviceName", "FirstMobileVisit", "LastMobileVisit", "LastMobileLogout", "ProfilePhotoPath", "FamilyPhotoPath"]);

export default function GlobalMemberSearchPage() {
  const { isSuperAdmin } = useAuth();
  const showBloodGroup = useFeature("member.bloodGroup");
  const showFamily = useFeature("member.familyDetails");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Inline edit (mobile + email) state
  const [editing, setEditing] = useState<any>(null);
  const [editPrimary, setEditPrimary] = useState("");
  const [editSecondary, setEditSecondary] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete-confirm state
  const [deleting, setDeleting] = useState<any>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Paging (user 2026-09-29): a broad search returns hundreds of members and the page rendered every
  // one of them. 20 to a page, paged in the browser - the search itself is unchanged.
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = results.slice(pageStart, pageStart + PAGE_SIZE);

  const handleSearch = async () => {
    if (search.trim().length < 2) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = await globalMemberSearch(search.trim());
      setResults(Array.isArray(data) ? data : []);
      setPage(1);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Search failed.");
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (mem: any) => {
    setEditing(mem);
    setEditPrimary(mem.PrimaryMobileNumber || "");
    setEditSecondary(mem.SecondaryMobileNumber || "");
    setEditEmail(mem.EmailId || "");
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await globalMemberUpdateContact(editing.pk_member_master_profile_id, {
        primaryMobileNumber: editPrimary.trim() || null,
        secondaryMobileNumber: editSecondary.trim() || null,
        emailId: editEmail.trim() || null,
      });
      setEditing(null);
      setSuccessMessage("Contact details updated.");
      await handleSearch();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await globalMemberSoftDelete(deleting.pk_member_master_profile_id);
      setDeleting(null);
      setSuccessMessage("Member deleted. Primary mobile moved to secondary and freed.");
      await handleSearch();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Delete failed.");
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access global member search.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const r = selected;
  const m = r?.member;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Global Member Search</h2>
            <p className="text-muted-foreground text-base">Search members across all zones, districts and clubs</p>
          </div>
        </div>

        {/* Search Bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Input
                placeholder="Search by name, email, mobile, rotary ID or club name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} disabled={loading || search.trim().length < 2}>
                {loading ? <RotaryLoader size="sm" /> : <><Search className="mr-2 h-4 w-4" />Search</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {loading ? (
          <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : !searched ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">Search Members</h3>
            <p className="text-muted-foreground mt-2">Enter a name, email, mobile, rotary ID or club name to search.</p>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">No members found matching &quot;{search}&quot;.</div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="px-4 py-2 text-sm text-muted-foreground border-b">
                {results.length} member(s) found
                {results.length > PAGE_SIZE && (
                  <span> · showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, results.length)}</span>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>District</TableHead>
                    <TableHead>Club</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Rotary ID</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r: any, idx: number) => {
                    const mem = r.member;
                    return (
                      <TableRow key={mem.pk_member_master_profile_id} className="cursor-pointer hover:bg-primary/5" onClick={() => setSelected(r)}>
                        <TableCell>{pageStart + idx + 1}</TableCell>
                        <TableCell>
                          {r.clubs?.slice(0, 2).map((c: any, i: number) => (
                            <div key={i} className="text-xs">{c.zoneName || "—"}</div>
                          ))}
                        </TableCell>
                        <TableCell>
                          {r.clubs?.slice(0, 2).map((c: any, i: number) => (
                            <div key={i} className="text-xs">{c.districtNumber || "—"}</div>
                          ))}
                        </TableCell>
                        <TableCell>
                          {r.clubs?.slice(0, 2).map((c: any, i: number) => (
                            <div key={i} className="text-xs">{c.clubName}</div>
                          ))}
                          {r.clubs?.length > 2 && <div className="text-xs text-muted-foreground">+{r.clubs.length - 2} more</div>}
                        </TableCell>
                        <TableCell className="font-medium">{mem.MemberName}</TableCell>
                        <TableCell className="text-sm">{mem.PrimaryMobileNumber || "—"}</TableCell>
                        <TableCell className="text-sm">{mem.EmailId || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{mem.RotaryId || "—"}</Badge></TableCell>
                        <TableCell>
                          {r.roles?.map((role: any, i: number) => (
                            <Badge key={i} variant="secondary" className="text-xs mr-1">{role.displayRole}</Badge>
                          ))}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit mobile & email" onClick={() => openEdit(mem)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700" title="Delete member" onClick={() => setDeleting(mem)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {pageCount > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t">
                  <span className="text-xs text-muted-foreground">Page {page} of {pageCount}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(1)}>First</Button>
                    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)}>Next</Button>
                    <Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => setPage(pageCount)}>Last</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Member Detail Popup */}
        <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            {m && (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-4">
                    {m.ProfilePhotoPath ? (
                      <img src={`${API_URL}${m.ProfilePhotoPath}`} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-primary/20" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">{m.MemberName?.charAt(0)}</div>
                    )}
                    <div>
                      <DialogTitle className="text-xl">{m.MemberName}</DialogTitle>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {m.RotaryId && <Badge variant="outline">{m.RotaryId}</Badge>}
                        {r.roles?.map((role: any, i: number) => (
                          <Badge key={i} className="bg-primary/80 text-white text-xs">{role.displayRole}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </DialogHeader>

                {/* Profile Details */}
                <div className="flex items-center gap-2 mt-2 mb-1">
                  <User className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold text-primary">Profile Details</h4>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  {Object.entries(m).map(([key, val]) => {
                    if (skipFields.has(key)) return null;
                    if (!showBloodGroup && key === "BloodGroup") return null;
                    if (!showFamily && key === "IsFamilyDetailsVisible") return null;
                    const label = fieldLabels[key] || key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
                    return <InfoRow key={key} label={label} value={val} fieldKey={key} />;
                  })}
                </div>

                {/* Club Memberships */}
                <SectionHeader icon={Building} title="Club Memberships" count={r.clubs?.length || 0} />
                {r.clubs?.length > 0 && (
                  <div className="space-y-2">
                    {r.clubs.map((c: any, i: number) => (
                      <div key={i} className="bg-muted/30 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{c.clubName}</span>
                          {c.clubRotaryId && <Badge variant="outline" className="text-xs">{c.clubRotaryId}</Badge>}
                          <Badge className={c.isActive ? "bg-green-500 text-xs text-white" : "bg-gray-400 text-xs text-white"}>
                            {c.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {c.zoneName && <span>{c.zoneName} &rarr; </span>}
                          District {c.districtNumber} &rarr; {c.clubName}
                          {c.city && ` (${c.city}${c.state ? `, ${c.state}` : ""})`}
                        </div>
                        {c.joinedDate && <div className="text-xs text-muted-foreground">Joined: {new Date(c.joinedDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" })}</div>}
                        {c.terminationDate && <div className="text-xs text-red-500">Terminated: {new Date(c.terminationDate).toLocaleDateString(appLocale())} — {c.terminationReason}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* BOD */}
                <SectionHeader icon={Award} title="Board of Directors" count={r.designations?.length || 0} />
                {r.designations?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.designations.map((d: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Badge variant={d.isCurrent ? "default" : "secondary"} className="text-xs">{d.yearLabel}</Badge>
                        <span className="font-medium">{d.designationName}</span>
                        <span className="text-xs text-muted-foreground">— {d.clubName}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* District Committee */}
                <SectionHeader icon={Users} title="District Committee" count={r.districtCommittee?.length || 0} />
                {r.districtCommittee?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.districtCommittee.map((d: any, i: number) => (
                      <div key={i} className="text-sm">
                        <Badge variant="secondary" className="text-xs mr-2">{d.yearLabel}</Badge>
                        District {d.districtNumber} — {d.designation || "Member"}
                        {d.remark && <span className="text-xs text-muted-foreground ml-2">({d.remark})</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Group Committee */}
                <SectionHeader icon={Briefcase} title="Group Committee" count={r.groupCommittee?.length || 0} />
                {r.groupCommittee?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.groupCommittee.map((g: any, i: number) => (
                      <div key={i} className="text-sm">
                        <Badge variant="secondary" className="text-xs mr-2">{g.yearLabel}</Badge>
                        {g.groupName} — {g.designation || "Member"}
                        <span className="text-xs text-muted-foreground ml-2">(District {g.districtNumber})</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sub Group Committee */}
                <SectionHeader icon={Briefcase} title="Sub Group Committee" count={r.subGroupCommittee?.length || 0} />
                {r.subGroupCommittee?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.subGroupCommittee.map((sg: any, i: number) => (
                      <div key={i} className="text-sm">
                        <Badge variant="secondary" className="text-xs mr-2">{sg.yearLabel}</Badge>
                        {sg.groupName} &rarr; {sg.subGroupName} — {sg.designation || "Member"}
                        <span className="text-xs text-muted-foreground ml-2">(District {sg.districtNumber})</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* District Governor */}
                <SectionHeader icon={Crown} title="District Governor" count={r.districtGovernor?.length || 0} />
                {r.districtGovernor?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.districtGovernor.map((dg: any, i: number) => (
                      <div key={i} className="text-sm">
                        <Badge variant="secondary" className="text-xs mr-2">{dg.yearLabel}</Badge>
                        District {dg.districtNumber}
                      </div>
                    ))}
                  </div>
                )}

                {/* Past President */}
                <SectionHeader icon={Shield} title="Past President" count={r.pastPresident?.length || 0} />
                {r.pastPresident?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.pastPresident.map((pp: any, i: number) => (
                      <div key={i} className="text-sm">
                        <Badge variant="secondary" className="text-xs mr-2">{pp.yearLabel}</Badge>
                        {pp.clubName}
                      </div>
                    ))}
                  </div>
                )}

                {/* Assistant Governor */}
                <SectionHeader icon={Crown} title="Assistant Governor" count={r.assistantGovernor?.length || 0} />
                {r.assistantGovernor?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.assistantGovernor.map((ag: any, i: number) => (
                      <div key={i} className="text-sm">
                        <Badge variant={ag.isCurrent ? "default" : "secondary"} className="text-xs mr-2">{ag.yearLabel || "—"}</Badge>
                        {ag.clubName}
                        <span className="text-xs text-muted-foreground ml-2">(District {ag.districtNumber})</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Club Moderator */}
                <SectionHeader icon={Shield} title="Club Moderator" count={r.clubModerator?.length || 0} />
                {r.clubModerator?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.clubModerator.map((cmod: any, i: number) => (
                      <div key={i} className="text-sm flex items-center gap-2">
                        {cmod.clubName}
                        <span className="text-xs text-muted-foreground">(District {cmod.districtNumber})</span>
                        {!cmod.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Club Sub-Groups / Committees */}
                <SectionHeader icon={Users} title="Club Sub-Groups / Committees" count={r.clubSubGroups?.length || 0} />
                {r.clubSubGroups?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.clubSubGroups.map((sg: any, i: number) => (
                      <div key={i} className="text-sm">
                        <Badge variant={sg.isCurrent ? "default" : "secondary"} className="text-xs mr-2">{sg.yearLabel || "—"}</Badge>
                        {sg.groupName}
                        <span className="text-xs text-muted-foreground ml-2">— {sg.clubName}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Events (registered / paid) */}
                <SectionHeader icon={Calendar} title="Events" count={r.events?.length || 0} />
                {r.events?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.events.map((e: any, i: number) => (
                      <div key={i} className="text-sm flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{e.eventTitle || "Event"}</span>
                        {e.amount != null && <span className="text-xs text-muted-foreground">{currencySymbol()}{Number(e.amount).toLocaleString(appLocale())}</span>}
                        <Badge className={e.isPaid ? "bg-green-500 text-xs text-white" : "bg-amber-500 text-xs text-white"}>{e.isPaid ? "Paid" : "Unpaid"}</Badge>
                        {e.paymentDate && <span className="text-xs text-muted-foreground">{new Date(e.paymentDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" })}</span>}
                        {e.clubName && <span className="text-xs text-muted-foreground">— {e.clubName}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Membership Dues */}
                <SectionHeader icon={CreditCard} title="Membership Dues" count={r.membershipDues?.length || 0} />
                {r.membershipDues?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.membershipDues.map((d: any, i: number) => (
                      <div key={i} className="text-sm flex items-center gap-2 flex-wrap">
                        {d.rotaryYear && <Badge variant="secondary" className="text-xs">{d.rotaryYear}</Badge>}
                        <span className="font-medium">{d.purpose}</span>
                        {d.amount != null && <span className="text-xs text-muted-foreground">{currencySymbol()}{Number(d.amount).toLocaleString(appLocale())}</span>}
                        <Badge className={d.isPaid ? "bg-green-500 text-xs text-white" : "bg-amber-500 text-xs text-white"}>{d.isPaid ? "Paid" : (d.paymentStatus || "Pending")}</Badge>
                        <span className="text-xs text-muted-foreground">— {d.clubName}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Directory Submissions */}
                <SectionHeader icon={ClipboardList} title="Directory Submissions" count={r.directorySubmissions?.length || 0} />
                {r.directorySubmissions?.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                    {r.directorySubmissions.map((ds: any, i: number) => (
                      <div key={i} className="text-sm flex items-center gap-2 flex-wrap">
                        {ds.yearLabel && <Badge variant="secondary" className="text-xs">{ds.yearLabel}</Badge>}
                        District {ds.districtNumber}
                        {ds.groupType && <span className="text-xs text-muted-foreground">({ds.groupType})</span>}
                        {ds.totalCount > 0 && <span className="text-xs text-muted-foreground">{ds.completedCount}/{ds.totalCount} fields</span>}
                        {ds.submittedAt && <span className="text-xs text-muted-foreground">{new Date(ds.submittedAt).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" })}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit contact (mobile + email) */}
        <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Contact{editing?.MemberName ? ` — ${editing.MemberName}` : ""}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium">Primary Mobile</label>
                <Input value={editPrimary} onChange={(e) => setEditPrimary(e.target.value)} placeholder="Primary mobile number" />
              </div>
              <div>
                <label className="text-sm font-medium">Secondary Mobile</label>
                <Input value={editSecondary} onChange={(e) => setEditSecondary(e.target.value)} placeholder="Secondary mobile number" />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email address" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={saving}>{saving ? <RotaryLoader size="sm" /> : "Save"}</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Member?</DialogTitle>
            </DialogHeader>
            <div className="py-2 text-sm text-muted-foreground">
              This soft-deletes <span className="font-semibold text-foreground">{deleting?.MemberName}</span>
              {deleting?.PrimaryMobileNumber
                ? <> and moves their primary mobile <span className="font-semibold text-foreground">{deleting.PrimaryMobileNumber}</span> to secondary, freeing the number for another member.</>
                : <>.</>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</Button>
              <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteBusy}>{deleteBusy ? <RotaryLoader size="sm" /> : "Delete"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
