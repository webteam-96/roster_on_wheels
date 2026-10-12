"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Building2, FileText, CheckCircle2, Users, Target } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import { getMyContext, getMyGoalAssignments } from "@/services/api";
import type { GoalMyAssignmentDto } from "@/types/goalSetting";

interface MyContext {
  memberId: number;
  memberName: string;
  email?: string;
  mobile?: string;
  memberType: string;
  roles: {
    roleName: string;
    scope?: string;
    zoneId?: number;
    zoneName?: string;
    districtId?: number;
    districtNumber?: string;
    clubId?: number;
    clubName?: string;
  }[];
  accessibleZones: { id: number; name: string }[];
  accessibleDistricts: { id: number; number: string; zoneId?: number; totalClubs?: number; totalMembers?: number }[];
  accessibleClubs: { id: number; name: string; districtId?: number; totalMembers?: number }[];
}

export default function RoleBasedHome() {
  const router = useRouter();
  const { isAG, isClubModerator, isRIDirector, isSuperAdmin } = useAuth();
  const [ctx, setCtx] = useState<MyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [goalAssignments, setGoalAssignments] = useState<GoalMyAssignmentDto[]>([]);
  // Whether the goal-assignment fetch has settled — the auto-redirect must wait for this so
  // a coordinator who is ALSO a single-district/club admin isn't redirected away before we
  // know to keep them on the hub (where they can reach BOTH their dashboard and Goal Setting).
  const [goalLoaded, setGoalLoaded] = useState(false);

  const fetchContext = useCallback(async () => {
    try {
      const data = await getMyContext();
      setCtx(data);
    } catch {
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContext();
    // Goal Setting oversight roles aren't part of the JWT `roles` claim — fetched
    // separately so plain members holding one still get a way into the feature.
    getMyGoalAssignments()
      .then(setGoalAssignments)
      .catch(() => setGoalAssignments([]))
      .finally(() => setGoalLoaded(true));
  }, [fetchContext]);

  // Distinct admin district ids (where user has a district-scoped Admin role)
  const adminDistricts = useMemo(() => {
    if (!ctx) return [];
    const ids = new Set<number>();
    for (const r of ctx.roles) {
      if ((r.roleName === "Admin" || r.roleName === "District Admin") && r.scope === "district" && r.districtId) {
        ids.add(r.districtId);
      }
    }
    return ctx.accessibleDistricts.filter(d => ids.has(d.id));
  }, [ctx]);

  // Distinct admin club ids (where user has a club-scoped Admin role)
  const adminClubs = useMemo(() => {
    if (!ctx) return [];
    const ids = new Set<number>();
    for (const r of ctx.roles) {
      if ((r.roleName === "Admin" || r.roleName === "Club Admin") && r.scope === "club" && r.clubId) {
        ids.add(r.clubId);
      }
    }
    return ctx.accessibleClubs.filter(c => ids.has(c.id));
  }, [ctx]);

  // Auto-redirect target — computed SYNCHRONOUSLY during render so we never
  // have a frame where loading=false but we haven't decided to redirect yet.
  // Without this, the useEffect-based version would render content for one
  // frame (the "2 modules flash for 1 second" the user saw) before the effect
  // fired and flipped redirecting=true.
  const redirectTarget = useMemo<string | null>(() => {
    if (!ctx || !goalLoaded) return null;
    if (isAG || isClubModerator) return null; // these stay on this page
    // A user whose ONLY role is a Goal Setting oversight role (RI Director / Zone Co-ordinator /
    // District Assistant — no district/club admin, not SuperAdmin) goes STRAIGHT to the V2 goal
    // dashboard on login. If they ALSO hold an admin/club role, they stay on the hub (card links in).
    if (goalAssignments.length > 0) {
      const hasOtherDashboard =
        adminDistricts.length > 0 || adminClubs.length > 0 || isSuperAdmin || isRIDirector;
      return hasOtherDashboard ? null : "/goal-overviews";
    }
    if (isRIDirector && !isSuperAdmin && adminDistricts.length === 0 && adminClubs.length === 0) {
      return "/ri-director/v2";
    }
    if (adminDistricts.length === 1 && adminClubs.length === 0) {
      return "/district-admin-dashboard";
    }
    if (adminClubs.length === 1 && adminDistricts.length === 0) {
      return "/club-admin-dashboard";
    }
    return null;
  }, [ctx, goalLoaded, goalAssignments, adminDistricts, adminClubs, isAG, isClubModerator, isRIDirector, isSuperAdmin]);

  useEffect(() => {
    if (redirectTarget) {
      router.replace(redirectTarget);
    }
  }, [redirectTarget, router]);

  if (loading || redirectTarget) {
    return (
      <div className="flex justify-center items-center py-20">
        <RotaryLoader size="lg" />
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="flex flex-col items-center py-20 text-muted-foreground">
        <p>Unable to load your dashboard. Please try refreshing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Welcome, {ctx.memberName}</h2>
        <p className="text-muted-foreground">
          {ctx.roles.filter(r => r.roleName !== "Member").map(r => r.roleName).filter((v, i, a) => a.indexOf(v) === i).join(" · ") || "Member"}
        </p>
      </div>

      {/* Role-specific primary tiles */}
      {(isAG || isClubModerator) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isAG && (
            <Link href="/ag-reports">
              <Card className="overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-primary/20 cursor-pointer group">
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 border-2 border-white/40">
                      <FileText className="h-8 w-8 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-lg text-white">AG Reports</h4>
                      <p className="text-xs text-white/80 mt-0.5">Reports for clubs you manage</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
          {isClubModerator && (
            <Link href="/club-moderator/v2">
              <Card className="overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-primary/20 cursor-pointer group">
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 border-2 border-white/40">
                      <CheckCircle2 className="h-8 w-8 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-lg text-white">Approve / Reject Projects</h4>
                      <Badge className="text-xs mt-1 bg-white/20 text-white border-white/30">Club Moderator</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
        </div>
      )}

      {/* Admin districts — show when multiple districts, or when combined with AG/Moderator/Goal roles */}
      {adminDistricts.length > 0 && (adminDistricts.length > 1 || isAG || isClubModerator || adminClubs.length > 0 || goalAssignments.length > 0) && (
        <div>
          <h3 className="text-lg font-semibold text-primary mb-3 flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Your Districts ({adminDistricts.length})
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {adminDistricts.map(d => (
              <Link key={d.id} href={`/districts/${d.id}/dashboard`}>
                <Card className="overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-primary/20 cursor-pointer group h-full">
                  <CardContent className="p-0">
                    <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 border-2 border-white/40">
                        <MapPin className="h-8 w-8 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-lg text-white">District {d.number}</h4>
                        <Badge className="text-xs mt-1 bg-white/20 text-white border-white/30">District Admin</Badge>
                      </div>
                    </div>
                    <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground group-hover:bg-primary/5 transition-colors">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>{d.totalClubs || 0} Club{(d.totalClubs || 0) !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>{d.totalMembers || 0} Member{(d.totalMembers || 0) !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Admin clubs */}
      {adminClubs.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-primary mb-3 flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Your Club{adminClubs.length > 1 ? "s" : ""} ({adminClubs.length})
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {adminClubs.map(c => (
              <Link key={c.id} href={`/clubs/${c.id}/dashboard`}>
                <Card className="overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-primary/20 cursor-pointer group h-full">
                  <CardContent className="p-0">
                    <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 border-2 border-white/40">
                        <Building2 className="h-8 w-8 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-base truncate text-white">{c.name}</h4>
                        <Badge className="text-xs mt-1 bg-white/20 text-white border-white/30">Club Admin</Badge>
                      </div>
                    </div>
                    <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground group-hover:bg-primary/5 transition-colors">
                      <div className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>{c.totalMembers || 0} Member{(c.totalMembers || 0) !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Goal Setting oversight — shown to anyone holding an active goal_role_assignment
          (feature-scoped, not a JWT admin role), and always to SuperAdmin (unrestricted
          access to every district/category server-side even with zero assignments). */}
      {(goalAssignments.length > 0 || isSuperAdmin) && (
        <div>
          <h3 className="text-lg font-semibold text-primary mb-3 flex items-center gap-2">
            <Target className="h-5 w-5" />
            Goal Setting Oversight
          </h3>
          <Link href="/goal-overviews">
            <Card className="overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-primary/20 cursor-pointer group max-w-md">
              <CardContent className="p-0">
                <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 border-2 border-white/40">
                    <Target className="h-8 w-8 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-lg text-white">Review Goals</h4>
                    <p className="text-xs text-white/80 mt-0.5">
                      {goalAssignments.length > 0 ? goalAssignments.map((a) => a.assignmentName).join(" · ") : "All districts, all categories — locks & comments"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

      {adminDistricts.length === 0 && adminClubs.length === 0 && !isAG && !isClubModerator && goalAssignments.length === 0 && !isSuperAdmin && (
        <div className="flex flex-col items-center py-20 text-muted-foreground">
          <p>No admin scope assigned. Contact your administrator.</p>
        </div>
      )}
    </div>
  );
}
