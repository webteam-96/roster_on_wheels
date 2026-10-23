"use client";

/**
 * Club Admin Dashboard › Grants (flagged module "grants"). A club whose district runs grants on ROW applies to the
 * district's open cycle and follows its applications; a club whose district is not on ROW (light mode) records
 * only a grant amount and a report date on its own projects.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ErrorAlert from "@/components/ErrorAlert";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { StatusBadge } from "@/components/grants/GrantParts";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat } from "@/hooks/useFormat";
import { createGrantApplication, getClubGrants, getGrantLightProjects, getRotaryYears, saveGrantLight } from "@/services/api";
import { dayInput } from "@/lib/grants";
import type { GrantClubOverview, GrantCycle, GrantLightProject } from "@/types/grants";
import type { RotaryYear } from "@/types/rotaryYear";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;

export default function ClubGrantsPage() {
  const { selectedClubId: clubId } = useAuth();
  const [data, setData] = useState<GrantClubOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    setData(null);
    getClubGrants(clubId).then(setData).catch((err) => setError(message(err, "Could not load grants.")));
  }, [clubId]);

  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Grants</h2>
        <p className="text-base text-muted-foreground">
          {data?.lightMode
            ? "Your district does not run its grants on ROW. Record each district grant on the project it funds."
            : "Apply for your district's grants and follow each application to the final report."}
        </p>
      </div>

      {!data ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <TableSkeleton rows={4} />
        </div>
      ) : data.lightMode ? (
        <LightMode clubId={clubId} onError={setError} />
      ) : (
        <>
          <OpenCycles clubId={clubId} cycles={data.cycles.filter((c) => c.status === "open")} onError={setError} />
          <Applications data={data} />
        </>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

function OpenCycles({ clubId, cycles, onError }: { clubId: number; cycles: GrantCycle[]; onError: (m: string) => void }) {
  const fmt = useFormat();
  const router = useRouter();
  const [starting, setStarting] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async (cycle: GrantCycle) => {
    setBusy(true);
    try {
      const { id } = await createGrantApplication(clubId, {
        cycleId: cycle.id, title: title.trim(), description: null, location: null, startDate: null, endDate: null,
        beneficiaries: null, amountRequested: 0, rulesAccepted: false, lines: [], members: [],
      });
      router.push(`/club-admin-dashboard/grants/${id}`);
    } catch (err) {
      onError(message(err, "Could not start the application."));
      setBusy(false);
    }
  };

  if (cycles.length === 0) {
    return <Card><CardContent className="p-5 text-sm text-muted-foreground">Your district has no grant cycle open for applications right now.</CardContent></Card>;
  }
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Open for applications</h3>
      {cycles.map((c) => (
        <Card key={c.id}>
          <CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">District grants {c.yearLabel}</p>
                <p className="text-sm text-muted-foreground">
                  {c.closesOn ? `Applications close on ${fmt.date(c.closesOn)}. ` : ""}
                  {c.maxRequest != null ? `Up to ${fmt.money(c.maxRequest)} per application. ` : ""}
                  {c.minQualifiedMembers > 0 ? `At least ${c.minQualifiedMembers} qualified members. ` : ""}
                  {c.reportDueOn ? `Final report due ${fmt.date(c.reportDueOn)}.` : ""}
                </p>
              </div>
              {starting !== c.id && (
                <Button className="gap-1.5" onClick={() => { setStarting(c.id); setTitle(""); }}>
                  <Plus className="h-4 w-4" /> Start an application
                </Button>
              )}
            </div>
            {c.rules && <p className="whitespace-pre-line text-sm">{c.rules}</p>}
            {starting === c.id && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(c); }}>
                <div className="min-w-[16rem] flex-1 space-y-1.5">
                  <Label htmlFor={`new-${c.id}`}>Project title</Label>
                  <Input id={`new-${c.id}`} maxLength={200} required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <Button type="submit" disabled={busy || !title.trim()}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create draft
                </Button>
                <Button type="button" variant="outline" onClick={() => setStarting(null)}>Cancel</Button>
              </form>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function Applications({ data }: { data: GrantClubOverview }) {
  const fmt = useFormat();
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Your applications</h3>
      {data.applications.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">The club has no grant applications yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">Project</th>
                  <th className="p-3 font-medium">Year</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Requested</th>
                  <th className="p-3 text-right font-medium">Approved</th>
                  <th className="p-3 text-right font-medium">Paid</th>
                  <th className="p-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.applications.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="p-3"><Link href={`/club-admin-dashboard/grants/${a.id}`} className="font-medium text-primary hover:underline">{a.title}</Link></td>
                    <td className="p-3">{a.yearLabel}</td>
                    <td className="p-3"><StatusBadge status={a.status} /></td>
                    <td className="p-3 text-right tabular-nums">{fmt.money(a.amountRequested)}</td>
                    <td className="p-3 text-right tabular-nums">{a.amountApproved != null ? fmt.money(a.amountApproved) : ""}</td>
                    <td className="p-3 text-right tabular-nums">{a.paid ? fmt.money(a.paid) : ""}</td>
                    <td className="p-3">{fmt.date(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/** Light mode: grant amount and report date on each of the club's projects of the chosen year. */
function LightMode({ clubId, onError }: { clubId: number; onError: (m: string) => void }) {
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [projects, setProjects] = useState<GrantLightProject[] | null>(null);
  const [edits, setEdits] = useState<Record<number, { amount: string; date: string }>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  useEffect(() => {
    getRotaryYears()
      .then((ys) => {
        const sorted = [...ys].sort((a, b) => b.startDate.localeCompare(a.startDate));
        setYears(sorted);
        setYearId(sorted.find((y) => y.isCurrent)?.id ?? sorted[0]?.id ?? null);
      })
      .catch(() => onError("Could not load the Rotary years."));
  }, [onError]);

  useEffect(() => {
    if (!yearId) return;
    setProjects(null);
    getGrantLightProjects(clubId, yearId)
      .then((ps) => {
        setProjects(ps);
        setEdits(Object.fromEntries(ps.map((p) => [p.projectId, { amount: p.grantAmount?.toString() ?? "", date: dayInput(p.reportDate) }])));
      })
      .catch((err) => { setProjects([]); onError(message(err, "Could not load the projects.")); });
  }, [clubId, yearId, onError]);

  const save = async (p: GrantLightProject) => {
    const e = edits[p.projectId];
    setSavingId(p.projectId);
    setSavedId(null);
    try {
      await saveGrantLight(clubId, yearId!, p.projectId, { grantAmount: e.amount === "" ? null : Number(e.amount), reportDate: e.date || null });
      setSavedId(p.projectId);
    } catch (err) {
      onError(message(err, "Could not save."));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="light-year">Rotary year</Label>
        <select id="light-year" className={SELECT} value={yearId ?? ""} onChange={(e) => setYearId(Number(e.target.value))}>
          {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}</option>)}
        </select>
      </div>
      {projects === null ? (
        <TableSkeleton rows={4} />
      ) : projects.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">The club has no projects in this year.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">Project</th>
                  <th className="p-3 font-medium">Grant amount</th>
                  <th className="p-3 font-medium">Report date</th>
                  <th className="p-3" aria-label="Save" />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const e = edits[p.projectId] ?? { amount: "", date: "" };
                  const set = (patch: Partial<typeof e>) => setEdits((all) => ({ ...all, [p.projectId]: { ...e, ...patch } }));
                  return (
                    <tr key={p.projectId} className="border-b last:border-0">
                      <td className="p-3">{p.title}{p.projectDate ? <span className="block text-xs text-muted-foreground">{dayInput(p.projectDate)}</span> : null}</td>
                      <td className="p-3"><Input aria-label={`Grant amount for ${p.title}`} type="number" min={0} step="0.01" className="w-36" value={e.amount} onChange={(ev) => set({ amount: ev.target.value })} /></td>
                      <td className="p-3"><Input aria-label={`Report date for ${p.title}`} type="date" className="w-44" value={e.date} onChange={(ev) => set({ date: ev.target.value })} /></td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={savingId === p.projectId} onClick={() => save(p)}>
                          {savingId === p.projectId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          {savedId === p.projectId ? "Saved" : "Save"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
