"use client";

/**
 * Planning workspace (build spec 3.1 / 3.16, flagged module "planning_mode"): next year's view for a district that is
 * planning. The governor-elect, district secretary and treasurer get the district (launchpad, team, club
 * invitations, committees, AGs, calendar, goal, cut-over); a president- or secretary-elect gets their club (officers,
 * calendar). A SuperAdmin or district admin opens a district with ?districtId=. Elect-only members land here after
 * sign-in. The API decides every write (the planning year only, own club only).
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import ClubPlanning from "@/components/planning/ClubPlanning";
import DistrictPlanning from "@/components/planning/DistrictPlanning";
import { Section } from "@/components/planning/PlanningParts";
import { useFormat } from "@/hooks/useFormat";
import { asUtc, planningScopes } from "@/lib/planning";
import { getMyPlanningRoles } from "@/services/api";
import { ROLE_NAMES, type PlanningRole } from "@/types/planning";

export default function PlanningPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <Workspace />
      </Suspense>
    </ProtectedRoute>
  );
}

function Workspace() {
  const searchParams = useSearchParams();
  const askedDistrict = Number(searchParams.get("districtId")) || null;
  const [roles, setRoles] = useState<PlanningRole[] | null>(null);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyPlanningRoles().then(setRoles).catch(() => setRoles([]));
  }, []);

  const scopes = useMemo(() => planningScopes(roles ?? []), [roles]);
  const scope = scopes.find((s) => `${s.kind}-${s.kind === "club" ? s.clubId : s.districtId}` === scopeKey) ?? scopes[0];
  const pending = (roles ?? []).filter((r) => r.status === "invited");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Planning workspace</h2>
        <p className="text-base text-muted-foreground">Next year&apos;s team, officers, committees and calendar, ready before the cut-over.</p>
      </div>

      {askedDistrict ? (
        <DistrictPlanning districtId={askedDistrict} />
      ) : roles === null ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-10 w-72" />
          <TableSkeleton rows={5} />
        </div>
      ) : scopes.length === 0 ? (
        <Section title="No planning role">
          <p className="text-sm">
            {pending.length > 0
              ? `Open the invitation email for ${pending.map((r) => `${ROLE_NAMES[r.role].toLowerCase()} of ${r.clubName ?? `District ${r.districtNumber}`}`).join(", ")} and accept it to start planning.`
              : "You have no part in a district's planning. The governor-elect invites presidents-elect and secretaries-elect by email."}
          </p>
        </Section>
      ) : (
        <>
          {scopes.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Workspaces">
              {scopes.map((s) => {
                const key = `${s.kind}-${s.kind === "club" ? s.clubId : s.districtId}`;
                const selected = scope === s;
                return (
                  <Button key={key} role="tab" aria-selected={selected} variant={selected ? "default" : "outline"} size="sm" onClick={() => setScopeKey(key)}>
                    {s.label}
                  </Button>
                );
              })}
            </div>
          )}
          {scope && (scope.kind === "district"
            ? <DistrictPlanning key={`d-${scope.districtId}`} districtId={scope.districtId} />
            : <ClubWorkspace key={`c-${scope.clubId}`} role={scope.roles[0]} onError={setError} />)}
        </>
      )}

      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

function ClubWorkspace({ role, onError }: { role: PlanningRole; onError: (m: string) => void }) {
  const fmt = useFormat();
  const year = { id: role.yearId, label: role.yearLabel ?? "", start: role.yearStart, end: role.yearEnd };
  return (
    <div className="space-y-6">
      <Section title={`${role.clubName}: planning ${role.yearLabel}`}
        hint={`${ROLE_NAMES[role.role]}, District ${role.districtNumber}${role.acceptedAt ? `. Accepted ${fmt.date(asUtc(role.acceptedAt), "long")}` : ""}.`}>
        <p className="text-sm">
          You plan the club&apos;s {role.yearLabel} here. The current year stays with the club&apos;s present officers until the
          district&apos;s cut-over, when you become a club admin.
        </p>
      </Section>
      <ClubPlanning clubId={role.clubId} year={year} onError={onError} />
    </div>
  );
}
