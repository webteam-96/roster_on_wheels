"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getRIDirectors,
  assignRIDirector,
  removeRIDirector,
  sendRIDirectorCredentials,
  getMembersWithRoles,
  getRIDirectorProfile,
  getPhotoUrl,
  type RIDirector,
  type RIDirectorProfile,
} from "@/services/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Search, UserPlus, UserMinus, Crown, Mail, Building2, MapPin, Phone, AtSign, X } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function RIDirectorManagementPage() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Current RI Directors
  const [directors, setDirectors] = useState<RIDirector[]>([]);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [resendTarget, setResendTarget] = useState<RIDirector | null>(null);
  // Profile popup behind a row (user 2026-09-29): who he is, and which clubs / districts he sits in.
  const [profile, setProfile] = useState<RIDirectorProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  async function openProfile(memberId: number) {
    setProfileOpen(true); setProfile(null); setProfileLoading(true);
    try { setProfile(await getRIDirectorProfile(memberId)); }
    catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Could not load that profile.");
      setProfileOpen(false);
    } finally { setProfileLoading(false); }
  }

  // Member search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const loadDirectors = useCallback(async () => {
    try {
      const list = await getRIDirectors();
      setDirectors(list);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load RI Directors.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadDirectors();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadDirectors]);

  const doSearch = async () => {
    if (!searchQuery.trim()) {
      setErrorMessage("Enter a name, email or mobile to search.");
      return;
    }
    setSearching(true);
    try {
      const result = await getMembersWithRoles(1, 20, searchQuery.trim());
      setSearchResults(result?.items || []);
      if ((result?.items || []).length === 0) setErrorMessage("No members matched your search.");
    } catch {
      setErrorMessage("Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const handleAssign = async (memberId: number) => {
    setAssigningId(memberId);
    try {
      const result = await assignRIDirector(memberId);
      setSuccessMessage(result?.message || "RI Director assigned.");
      setSearchResults([]);
      setSearchQuery("");
      await loadDirectors();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to assign RI Director.");
    } finally {
      setAssigningId(null);
    }
  };

  const handleRemove = async (memberId: number) => {
    setRemovingId(memberId);
    try {
      const result = await removeRIDirector(memberId);
      setSuccessMessage(result?.message || "RI Director removed.");
      await loadDirectors();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to remove RI Director.");
    } finally {
      setRemovingId(null);
    }
  };

  // Login details are emailed only on request — never on assign.
  const handleSendEmail = async (memberId: number) => {
    setSendingId(memberId);
    try {
      const result = await sendRIDirectorCredentials(memberId);
      setSuccessMessage(result?.message || "Login details sent.");
      await loadDirectors();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to send login details.");
    } finally {
      setSendingId(null);
    }
  };

  const directorMemberIds = new Set(directors.map((d) => d.memberId));

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex justify-center items-center py-20 min-h-[60vh]">
          <RotaryLoader size="lg" />
        </div>
      </ProtectedRoute>
    );
  }

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage RI Directors.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <AlertDialog open={!!resendTarget} onOpenChange={(open) => { if (!open) setResendTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Resend login details?</AlertDialogTitle>
              <AlertDialogDescription>
                The login details will be emailed again to {resendTarget?.memberName} ({resendTarget?.email}).
                If the portal set up this login, a new temporary password is issued and the old one stops working.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const target = resendTarget;
                  setResendTarget(null);
                  if (target) handleSendEmail(target.memberId);
                }}
              >
                Resend Email
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">RI Director Management</h2>
            <p className="text-muted-foreground text-base">Assign or remove RI Director role (mutually exclusive with SuperAdmin / Admin / Zonal Coordinator)</p>
          </div>
        </div>

        {/* Current RI Directors */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Crown className="h-4 w-4 text-amber-600" />
              Current RI Directors ({directors.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {directors.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No RI Directors assigned yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>#</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Assigned On</TableHead>
                    <TableHead>Login Email</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {directors.map((d, i) => {
                    const sent = (d.emailSentCount ?? 0) > 0;
                    return (
                    <TableRow key={d.memberId}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          onClick={() => openProfile(d.memberId)}
                          className="text-left text-[#003DA5] hover:underline font-medium"
                          title="View profile, clubs and districts"
                        >
                          {d.memberName}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm">{d.email}</TableCell>
                      <TableCell className="text-sm">{d.mobile || "—"}</TableCell>
                      <TableCell className="text-sm">{d.assignedDate ? new Date(d.assignedDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm">
                        {sent ? (
                          <Badge variant="secondary" className="text-xs">
                            Sent{d.emailLastSentDate ? ` · ${new Date(d.emailLastSentDate).toLocaleDateString()}` : ""}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not sent</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={sendingId === d.memberId || !d.email}
                          title={!d.email ? "No email on the profile" : undefined}
                          onClick={() => (sent ? setResendTarget(d) : handleSendEmail(d.memberId))}
                        >
                          {sendingId === d.memberId ? <RotaryLoader size="sm" /> : <><Mail className="h-4 w-4 mr-1" />{sent ? "Resend Email" : "Send Email"}</>}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10"
                          disabled={removingId === d.memberId}
                          onClick={() => handleRemove(d.memberId)}
                        >
                          {removingId === d.memberId ? <RotaryLoader size="sm" /> : <><UserMinus className="h-4 w-4 mr-1" />Remove</>}
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Assign New */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Assign RI Director
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search by member name, email or mobile"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
              />
              <Button onClick={doSearch} disabled={searching}>
                {searching ? <RotaryLoader size="sm" /> : <><Search className="h-4 w-4 mr-2" />Search</>}
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Member</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Current Roles</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchResults.map((m: any) => {
                      const roles: string[] = m.roles || [];
                      const alreadyDirector = directorMemberIds.has(m.id);
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">{m.memberName}</TableCell>
                          <TableCell className="text-sm">{m.emailId}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {roles.length === 0 ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                /* Other roles are shown for information only - they no longer block
                                   the assignment, so nothing here is painted as an error. */
                                roles.map((r) => (
                                  <Badge key={r} variant="secondary" className="text-xs">
                                    {r}
                                  </Badge>
                                ))
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {alreadyDirector ? (
                              <Badge variant="default" className="bg-amber-600">Already RI Director</Badge>
                            ) : (
                              <Button
                                size="sm"
                                disabled={assigningId === m.id}
                                onClick={() => handleAssign(m.id)}
                              >
                                {assigningId === m.id ? <RotaryLoader size="sm" /> : <><Crown className="h-4 w-4 mr-1" />Assign</>}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* ── profile popup ── */}
            <Dialog open={profileOpen} onOpenChange={(o) => { setProfileOpen(o); if (!o) setProfile(null); }}>
              <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-600" /> RI Director
                  </DialogTitle>
                </DialogHeader>

                {profileLoading ? (
                  <div className="py-10 flex justify-center"><RotaryLoader size="lg" /></div>
                ) : !profile ? null : (
                  <div className="space-y-4">
                    {/* who he is */}
                    <div className="flex items-start gap-4">
                      {profile.photoPath ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={getPhotoUrl(profile.photoPath)}
                          alt={profile.memberName}
                          className="h-20 w-20 rounded-full object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="h-20 w-20 rounded-full bg-slate-100 flex items-center justify-center text-xl font-semibold text-slate-400 shrink-0">
                          {profile.memberName.charAt(0)}
                        </div>
                      )}
                      <div className="min-w-0 space-y-1">
                        <p className="text-base font-semibold text-slate-800">{profile.memberName}</p>
                        {profile.rotaryId && <p className="text-xs text-slate-400">Rotary ID {profile.rotaryId}</p>}
                        {profile.email && (
                          <p className="text-sm text-slate-600 flex items-center gap-1.5 break-all"><AtSign className="h-3.5 w-3.5 text-slate-400" />{profile.email}</p>
                        )}
                        {profile.mobile && (
                          <p className="text-sm text-slate-600 flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />{profile.mobile}</p>
                        )}
                        {(profile.city || profile.state) && (
                          <p className="text-sm text-slate-600 flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-slate-400" />{[profile.city, profile.state].filter(Boolean).join(", ")}
                          </p>
                        )}
                        {profile.assignedDate && (
                          <p className="text-xs text-slate-400">RI Director since {new Date(profile.assignedDate).toLocaleDateString()}</p>
                        )}
                      </div>
                    </div>

                    {/* the other hats he wears */}
                    {(profile.otherRoles.length > 0 || profile.adminDistricts.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {profile.otherRoles.map((r) => <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>)}
                        {profile.adminDistricts.map((d) => (
                          <Badge key={d} variant="outline" className="text-xs">District {d}</Badge>
                        ))}
                      </div>
                    )}

                    {/* clubs + districts */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                        Clubs {profile.clubs.length > 0 ? `(${profile.clubs.length})` : ""}
                      </p>
                      {profile.clubs.length === 0 ? (
                        <p className="text-sm text-slate-400">Not an active member of any club.</p>
                      ) : (
                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                          {profile.clubs.map((c) => (
                            <div key={c.clubId} className="px-4 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                              <span className="text-sm font-medium text-slate-800">{c.clubName}</span>
                              {c.districtNumber && <Badge variant="outline" className="text-[10px]">District {c.districtNumber}</Badge>}
                              {c.zoneName && <span className="text-xs text-slate-400">{c.zoneName}</span>}
                              {c.designation && <Badge variant="secondary" className="text-[10px]">{c.designation}</Badge>}
                              {c.isClubAdmin && <Badge variant="secondary" className="text-[10px]">Club Admin</Badge>}
                              {c.isHonorary && <Badge variant="outline" className="text-[10px]">Honorary</Badge>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => setProfileOpen(false)}>
                        <X className="h-4 w-4 mr-1" /> Close
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <p className="text-xs text-muted-foreground">
              Note: a member may hold <b>RI Director alongside any other role</b> (District Admin, Club Admin, AG,
              Zonal Coordinator, Club Moderator, SuperAdmin). After login they land on their highest-priority
              dashboard and switch between the rest from the role switcher at the bottom left.
            </p>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
