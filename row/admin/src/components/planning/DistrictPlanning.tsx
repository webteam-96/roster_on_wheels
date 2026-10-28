"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import { useFormat } from "@/hooks/useFormat";
import { asUtc, launchpadProgress } from "@/lib/planning";
import {
  appointPlanningRole, getPlanningOverview, invitePlanningRole, revokePlanningRole, runCutover, searchDistrictCommitteeMembers, getOnboardingKitHtml, sendOnboardingNudge,
} from "@/services/api";
import { ROLE_NAMES, type PlanningClub, type PlanningOverview } from "@/types/planning";
import MemberPicker, { type MemberOption } from "./MemberPicker";
import NextYearDistrict from "./NextYearDistrict";
import { errorMessage, Pill, RoleHolder, Section } from "./PlanningParts";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

/** District planning workspace: launchpad, team, club invitations, next year's records and the cut-over. */
export default function DistrictPlanning({ districtId }: { districtId: number }) {
  const fmt = useFormat();
  const [o, setO] = useState<PlanningOverview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(() => {
    getPlanningOverview(districtId).then(setO).catch((err) => setFailed(errorMessage(err, "Could not load this district's planning.")));
  }, [districtId]);
  useEffect(load, [load]);

  // members of any club in the district (district committee search: the DGE may read the district)
  const searchDistrict = useCallback(async (q: string): Promise<MemberOption[]> =>
    ((await searchDistrictCommitteeMembers(districtId, q)) as { memberId: number; name: string; clubId: number; clubName: string }[])
      .map((m) => ({ id: m.memberId, name: m.name, hint: m.clubName, clubId: m.clubId })), [districtId]);

  if (failed) return <p className="text-sm text-muted-foreground">{failed}</p>;
  if (!o) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <TableSkeleton rows={6} />
      </div>
    );
  }

  const s = o.state;
  if (s.state !== "planning" || !s.planningYearId) {
    return (
      <Section title={`District ${s.districtNumber ?? districtId}`}>
        <p className="text-sm">
          {s.cutoverDoneAt
            ? `Live since the cut-over on ${fmt.date(asUtc(s.cutoverDoneAt), "long")}. ${s.readOnlyYearLabel ?? "The outgoing year"} is archived (read-only).`
            : "This district is not planning a year. A SuperAdmin starts planning in Settings > Tenants."}
        </p>
      </Section>
    );
  }

  const progress = launchpadProgress(o.launchpad);
  const year = { id: s.planningYearId, label: s.planningYearLabel ?? "", start: s.planningYearStart, end: s.planningYearEnd };
  const done = (m: string) => { setSuccess(m); load(); };

  return (
    <div className="space-y-6">
      <Section title="Next-year launchpad" hint={`${progress.done} of ${progress.total} done for ${s.planningYearLabel}.`}>
        <ul className="divide-y text-sm">
          {o.launchpad.map((i) => (
            <li key={i.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{i.label}</p>
                <p className="text-muted-foreground">{i.detail}</p>
              </div>
              <Pill kind={i.stub ? "stub" : i.done ? "done" : "open"}>{i.stub ? "Not available yet" : i.done ? "Done" : "To do"}</Pill>
            </li>
          ))}
        </ul>
      </Section>

      <Team o={o} districtId={districtId} search={searchDistrict} onDone={done} onError={setError} />
      <Clubs o={o} districtId={districtId} search={searchDistrict} onDone={done} onError={setError} />
      <NextYearDistrict districtId={districtId} year={year} clubs={o.clubs} search={searchDistrict} onChanged={load} onError={setError} />
      {o.canManage && <Cutover o={o} districtId={districtId} onDone={done} onError={setError} />}

      <SuccessAlert open={!!success} title="Done" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

interface PartProps {
  o: PlanningOverview;
  districtId: number;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

function Team({ o, districtId, search, onDone, onError }: PartProps & { search: (q: string) => Promise<MemberOption[]> }) {
  const [role, setRole] = useState<"DS" | "DT">("DS");
  const [member, setMember] = useState<MemberOption | null>(null);
  const [busy, setBusy] = useState(false);

  async function appoint() {
    if (!member) return;
    setBusy(true);
    try {
      await appointPlanningRole(districtId, role, member.id);
      setMember(null);
      onDone(`${member.name} is next year's ${ROLE_NAMES[role].toLowerCase()}.`);
    } catch (err) {
      onError(errorMessage(err, "Could not appoint this member."));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(roleId: number) {
    try {
      await revokePlanningRole(districtId, roleId);
      onDone("Role revoked.");
    } catch (err) {
      onError(errorMessage(err, "Could not revoke this role."));
    }
  }

  return (
    <Section title="District team" hint="The governor-elect appoints next year's district secretary and treasurer. AGs and committee chairs are set below.">
      <table className="w-full text-sm">
        <tbody>
          {(["DGE", "DS", "DT"] as const).map((code) => {
            const r = o.team.find((t) => t.role === code) ?? null;
            return (
              <tr key={code} className="border-b last:border-0">
                <td className="py-2 font-medium">{ROLE_NAMES[code]}</td>
                <td className="py-2"><RoleHolder role={r} /></td>
                <td className="py-2 text-right">
                  {o.canManage && r && code !== "DGE" && <Button size="sm" variant="ghost" onClick={() => revoke(r.roleId)}>Revoke</Button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {o.canManage && (
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="appoint-role">Role</Label>
            <select id="appoint-role" className={SELECT} value={role} onChange={(e) => setRole(e.target.value as "DS" | "DT")}>
              <option value="DS">District secretary</option>
              <option value="DT">District treasurer</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="appoint-member">Member</Label>
            <MemberPicker id="appoint-member" search={search} value={member} onChange={setMember} />
          </div>
          <Button onClick={appoint} disabled={!member || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Appoint</Button>
        </div>
      )}
    </Section>
  );
}

function Clubs({ o, districtId, search, onDone, onError }: PartProps & { search: (q: string) => Promise<MemberOption[]> }) {
  // Onboarding kit (build spec 3.2): the printable steps, or emailed to the club's president and secretary.
  async function openKit(clubId: number) {
    const tab = window.open("", "_blank");
    try {
      const html = await getOnboardingKitHtml(districtId, clubId);
      if (tab) { tab.document.open(); tab.document.write(html); tab.document.close(); }
    } catch (err) {
      tab?.close();
      onError(errorMessage(err, "Could not open the onboarding kit."));
    }
  }
  async function nudge(c: PlanningClub) {
    try {
      const r = await sendOnboardingNudge(districtId, c.clubId);
      onDone(`Onboarding kit emailed to ${r.sent} officer${r.sent === 1 ? "" : "s"} of ${c.clubName}.`);
    } catch (err) {
      onError(errorMessage(err, "Could not send the onboarding kit."));
    }
  }
  const [inviting, setInviting] = useState<{ club: PlanningClub; role: "PE" | "SE" } | null>(null);
  const [member, setMember] = useState<MemberOption | null>(null);
  const [busy, setBusy] = useState(false);
  // only members of the club being invited for
  const searchClub = useCallback(async (q: string) =>
    (await search(q)).filter((m) => m.clubId === inviting?.club.clubId), [search, inviting]);

  async function invite() {
    if (!inviting || !member) return;
    setBusy(true);
    try {
      await invitePlanningRole(districtId, inviting.club.clubId, inviting.role, member.id);
      onDone(`Invitation emailed to ${member.name}.`);
      setInviting(null);
      setMember(null);
    } catch (err) {
      onError(errorMessage(err, "Could not send the invitation."));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(roleId: number) {
    try {
      await revokePlanningRole(districtId, roleId);
      onDone("Role revoked.");
    } catch (err) {
      onError(errorMessage(err, "Could not revoke this role."));
    }
  }

  const cell = (c: PlanningClub, code: "PE" | "SE") => {
    const r = code === "PE" ? c.pe : c.se;
    return (
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          <RoleHolder role={r} />
          {o.canManage && (r?.status === "active"
            ? <Button size="sm" variant="ghost" onClick={() => revoke(r.roleId)}>Revoke</Button>
            : <Button size="sm" variant="outline" onClick={() => { setInviting({ club: c, role: code }); setMember(null); }}>{r ? "Invite again" : "Invite"}</Button>)}
        </div>
      </td>
    );
  };

  return (
    <Section title="Clubs" hint="Each club's president-elect and secretary-elect plan their club's next year. Invitations go by email with an accept link.">
      {inviting && (
        <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="invite-member">{ROLE_NAMES[inviting.role]} of {inviting.club.clubName}</Label>
            <MemberPicker id="invite-member" search={searchClub} value={member} onChange={setMember} />
          </div>
          <Button onClick={invite} disabled={!member || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send invitation</Button>
          <Button variant="outline" onClick={() => setInviting(null)}>Cancel</Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">Club</th>
              <th className="py-2 font-medium">President-elect</th>
              <th className="py-2 font-medium">Secretary-elect</th>
              <th className="py-2 font-medium">Onboarding kit</th>
            </tr>
          </thead>
          <tbody>
            {o.clubs.map((c) => (
              <tr key={c.clubId} className="border-b last:border-0">
                <td className="py-2 pr-4">{c.clubName}</td>
                {cell(c, "PE")}
                {cell(c, "SE")}
                <td className="py-2 whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => openKit(c.clubId)}>Open</Button>
                  <Button size="sm" variant="ghost" onClick={() => nudge(c)}>Email to president and secretary</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Cutover({ o, districtId, onDone, onError }: PartProps) {
  const fmt = useFormat();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = o.state;

  async function run() {
    setBusy(true);
    setConfirm(false);
    try {
      const r = await runCutover(districtId);
      onDone(`District ${s.districtNumber} is live. ${r.rolesActivated} roles became current roles and ${r.officersQueued} officers were queued for RI.`);
    } catch (err) {
      onError(errorMessage(err, "Could not run the cut-over."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Cut-over" hint={`Scheduled for ${s.cutoverAt ? fmt.dateTime(asUtc(s.cutoverAt)) : "1 July"}. Run it earlier when the team is ready.`}>
      <p className="text-sm">
        The cut-over makes the district live: {s.readOnlyYearLabel} is archived, the elect roles become current roles, dues
        collection opens, and next year&apos;s officers are queued for RI.
      </p>
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span>Run the cut-over for District {s.districtNumber} now? This cannot be undone here.</span>
          <Button size="sm" onClick={run}>Run the cut-over</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setConfirm(true)} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run the cut-over now
        </Button>
      )}
    </Section>
  );
}
