"use client";

/**
 * Club Admin Dashboard › RI data: the six RI-reported officer positions in ROW next to what Rotary International
 * holds, and a transfer-in wizard for people RI lists for the club who are missing in ROW. Both read the RI data the
 * server sync stored; nothing here calls Rotary.org.
 */

import { useCallback, useEffect, useState } from "react";
import { useSelectedClub } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/components/dashboard/formatters";
import { ErrorState, PageHeader, Panel, SkeletonRows, rowTable as t } from "@/components/row/AppKit";
import { apiMessage } from "@/components/membership/FoundationDesignationsCard";
import {
  getRiOfficerCompare, getRiTransferIn, riTransferInOne,
  type RiHolder, type RiOfficerCompare, type RiOfficerStatus, type RiOnlyMember, type RiTransferIn, type RiTransferMode,
} from "@/services/api";

const STATUS: Record<RiOfficerStatus, { label: string; cls: string }> = {
  match: { label: "Matches RI", cls: "bg-green-50 text-green-800" },
  different: { label: "Differs from RI", cls: "bg-amber-50 text-amber-800" },
  missing_in_row: { label: "Missing in ROW", cls: "bg-red-50 text-red-800" },
  missing_in_ri: { label: "Missing in RI", cls: "bg-red-50 text-red-800" },
  empty: { label: "Not set in either", cls: "bg-[#EDF4FB] text-[#64748B]" },
  not_synced: { label: "RI data not synced", cls: "bg-[#EDF4FB] text-[#64748B]" },
};

const when = (utc: string | null) => (utc ? new Date(utc).toLocaleString() : null);

function Holders({ list, other }: { list: RiHolder[]; other: RiHolder[] }) {
  if (list.length === 0) return <span className="text-[#64748B]">None</span>;
  const otherIds = new Set(other.map((h) => h.rotaryId));
  return (
    <ul className="space-y-1">
      {list.map((h, i) => (
        <li key={`${h.rotaryId ?? h.name}-${i}`} className={otherIds.has(h.rotaryId) && h.rotaryId ? "" : "font-semibold"}>
          {h.name || "Unnamed"}
          <span className="ml-2 text-[12px] text-[#64748B]">{h.rotaryId ? `RI ${h.rotaryId}` : "No RI member id in ROW"}</span>
        </li>
      ))}
    </ul>
  );
}

function OfficerCompare({ clubId }: { clubId: number }) {
  const [yearId, setYearId] = useState<number | undefined>();
  const [data, setData] = useState<RiOfficerCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    getRiOfficerCompare(clubId, yearId)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(apiMessage(e, "Could not load the officer compare.")));
    return () => { live = false; };
  }, [clubId, yearId, tick]);

  const synced = data && (data.sync.status === "ok" || data.sync.status === "no_officers");
  const differences = data?.rows.filter((r) => r.status !== "match" && r.status !== "empty" && r.status !== "not_synced").length ?? 0;

  return (
    <Panel
      title="Officers: ROW and Rotary International"
      subtitle="The six club officer positions RI records. Names in bold are not in the other list."
      headerRight={data && (
        <label className="flex items-center gap-2 text-[13px] text-[#64748B]">
          <span>Rotary year</span>
          <select
            className="h-10 rounded-[12px] border border-[color:var(--row-line)] bg-[#FCFDFE] px-3 text-[14px] text-[#1B2C42]"
            value={data.year.id}
            onChange={(e) => setYearId(Number(e.target.value))}
          >
            {data.years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
          </select>
        </label>
      )}
    >
      {error ? (
        <ErrorState message={error} onRetry={() => setTick((n) => n + 1)} retryLabel="Try again" />
      ) : !data ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-4">
          {synced ? (
            <p className="text-[14px] text-[#1B2C42]">
              RI officers last read {when(data.sync.syncedAtUtc)}.{" "}
              {differences === 0 ? "ROW and RI agree for this year." : `${differences} of 6 positions need attention.`}
            </p>
          ) : (
            <p role="status" className="rounded-[12px] border border-[color:var(--row-line)] bg-[#EDF4FB] px-4 py-3 text-[14px] text-[#1B2C42]">
              {data.sync.status === "error"
                ? `The last RI officer sync failed${data.sync.syncedAtUtc ? ` (${when(data.sync.syncedAtUtc)})` : ""}. ROW shows its own officers; the RI column fills in after the next successful server sync.`
                : !data.riClubId
                  ? "This club has no RI club id in ROW, so RI officers cannot be synced. Ask your district or ROW support to add it."
                  : "RI officers for this club have not been synced yet. The server reads them once a day; the RI column fills in after the first sync."}
            </p>
          )}
          <div className={t.wrap}>
            <table className={t.table}>
              <thead className={t.head}>
                <tr>
                  <th className={t.th}>Position</th>
                  <th className={t.th}>In ROW ({data.year.label})</th>
                  <th className={t.th}>In RI</th>
                  <th className={t.th}>Result</th>
                </tr>
              </thead>
              <tbody className={t.body}>
                {data.rows.map((r) => (
                  <tr key={r.title} className={t.tr}>
                    <td className={`${t.td} font-semibold`}>{r.title}</td>
                    <td className={t.td}><Holders list={r.row} other={r.ri} /></td>
                    <td className={t.td}>{synced ? <Holders list={r.ri} other={r.row} /> : <span className="text-[#64748B]">Not synced</span>}</td>
                    <td className={t.td}>
                      <span className={`inline-block rounded-[6px] px-2 py-1 text-[12px] font-semibold ${STATUS[r.status].cls}`}>
                        {STATUS[r.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-[#64748B]">
            Change ROW officers under Board of Directors. Change RI&apos;s record in My Rotary (club administration).
            A ROW officer with no RI member id can never match: add the id on the member&apos;s profile.
          </p>
        </div>
      )}
    </Panel>
  );
}

type Choice = { mode: RiTransferMode | "skip"; memberId?: number };

function defaultChoice(m: RiOnlyMember): Choice {
  if (m.sameRiId) return { mode: "add", memberId: m.sameRiId.memberId };
  if (m.matches.length === 1) return { mode: "link", memberId: m.matches[0].memberId };
  return { mode: "create" };
}

function choiceLabel(m: RiOnlyMember, c: Choice): string {
  if (c.mode === "skip") return "Skip for now";
  if (c.mode === "create") return "Create a new ROW member from the RI record";
  if (c.mode === "add") return `Add ${m.sameRiId?.name ?? "the existing ROW member"} to this club`;
  const who = m.matches.find((x) => x.memberId === c.memberId);
  return `Link club member ${who?.name ?? ""} to this RI record`;
}

type Result = { rotaryMemberId: number; name: string; ok: boolean; message: string };

function TransferInWizard({ clubId }: { clubId: number }) {
  const [data, setData] = useState<RiTransferIn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const load = useCallback(() => {
    setData(null);
    setError(null);
    setStep(1);
    setPicked(new Set());
    setResults([]);
    getRiTransferIn(clubId)
      .then((d) => {
        setData(d);
        setChoices(Object.fromEntries(d.missing.map((m) => [m.rotaryMemberId, defaultChoice(m)])));
      })
      .catch((e) => setError(apiMessage(e, "Could not load RI members.")));
  }, [clubId]);
  useEffect(load, [load]);

  const selected = data?.missing.filter((m) => picked.has(m.rotaryMemberId)) ?? [];
  const toRun = selected.filter((m) => choices[m.rotaryMemberId]?.mode !== "skip");

  async function run() {
    setRunning(true);
    const out: Result[] = [];
    for (const m of toRun) {
      const c = choices[m.rotaryMemberId];
      try {
        const r = await riTransferInOne(clubId, { rotaryMemberId: m.rotaryMemberId, mode: c.mode as RiTransferMode, memberId: c.memberId });
        out.push({ rotaryMemberId: m.rotaryMemberId, name: m.name, ok: true, message: r.message });
      } catch (e) {
        out.push({ rotaryMemberId: m.rotaryMemberId, name: m.name, ok: false, message: apiMessage(e, "Could not bring this person in.") });
      }
    }
    setResults(out);
    setRunning(false);
    setStep(4);
  }

  const steps = ["Review RI members", "Choose an action", "Confirm", "Done"];

  return (
    <Panel
      title="Transfer-in from Rotary International"
      subtitle="People RI lists for this club who are not members of it in ROW"
      headerRight={data && <span className="text-[13px] text-[#64748B]">Step {step} of 4: {steps[step - 1]}</span>}
    >
      {error ? (
        <ErrorState message={error} onRetry={load} retryLabel="Try again" />
      ) : !data ? (
        <SkeletonRows rows={5} />
      ) : !data.riClubId ? (
        <p className="text-[14px] text-[#1B2C42]">This club has no RI club id in ROW, so its RI member list cannot be read.</p>
      ) : data.riCount === 0 ? (
        <p role="status" className="rounded-[12px] border border-[color:var(--row-line)] bg-[#EDF4FB] px-4 py-3 text-[14px] text-[#1B2C42]">
          No RI member list is stored for this club yet. It is filled by the Rotary.org member sync on the server
          (ROW support runs it). Once it has run, the people RI lists here who are missing in ROW appear in this wizard.
        </p>
      ) : step === 1 ? (
        <div className="space-y-4">
          <p className="text-[14px] text-[#1B2C42]">
            RI lists {data.riCount} {data.riCount === 1 ? "member" : "members"} (read {when(data.cacheFetchedUtc)}).{" "}
            {data.missing.length === 0 ? "Every one of them is a member of this club in ROW." : `${data.missing.length} of them are not in this club in ROW. Pick who to bring in.`}
          </p>
          {data.missing.length > 0 && (
            <>
              <div className={t.wrap}>
                <table className={t.table}>
                  <thead className={t.head}>
                    <tr>
                      <th className={t.th}>
                        <input
                          type="checkbox"
                          aria-label="Select everyone"
                          checked={picked.size === data.missing.length}
                          onChange={(e) => setPicked(new Set(e.target.checked ? data.missing.map((m) => m.rotaryMemberId) : []))}
                        />
                      </th>
                      <th className={t.th}>Name in RI</th>
                      <th className={t.th}>RI member id</th>
                      <th className={t.th}>Type</th>
                      <th className={t.th}>Admitted</th>
                      <th className={t.th}>Found in ROW</th>
                    </tr>
                  </thead>
                  <tbody className={t.body}>
                    {data.missing.map((m) => (
                      <tr key={m.rotaryMemberId} className={t.tr}>
                        <td className={t.td}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${m.name}`}
                            checked={picked.has(m.rotaryMemberId)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(m.rotaryMemberId); else next.delete(m.rotaryMemberId);
                              setPicked(next);
                            }}
                          />
                        </td>
                        <td className={`${t.td} font-semibold`}>{m.name}</td>
                        <td className={t.tdMuted}>{m.rotaryMemberId}</td>
                        <td className={t.tdMuted}>{m.memberType ?? ""}</td>
                        <td className={t.tdMuted}>{m.admissionDate ? fmtDate(m.admissionDate) : ""}</td>
                        <td className={t.tdMuted}>
                          {m.sameRiId ? `Yes, ${m.sameRiId.name} (another club)` : m.matches.length > 0 ? `Possible: ${m.matches.map((x) => x.name).join(", ")}` : "No"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button disabled={picked.size === 0} onClick={() => setStep(2)}>Next: choose an action</Button>
              </div>
            </>
          )}
        </div>
      ) : step === 2 ? (
        <div className="space-y-4">
          {selected.map((m) => {
            const c = choices[m.rotaryMemberId];
            const set = (v: Choice) => setChoices({ ...choices, [m.rotaryMemberId]: v });
            const name = `ri-choice-${m.rotaryMemberId}`;
            return (
              <fieldset key={m.rotaryMemberId} className="rounded-[12px] border border-[color:var(--row-line)] px-4 py-3">
                <legend className="px-1 text-[14px] font-semibold text-[#1B2C42]">{m.name} <span className="font-normal text-[#64748B]">RI {m.rotaryMemberId}{m.email ? `, ${m.email}` : ""}</span></legend>
                <div className="space-y-2 text-[14px] text-[#1B2C42]">
                  {m.sameRiId && (
                    <label className="flex items-center gap-2">
                      <input type="radio" name={name} checked={c.mode === "add"} onChange={() => set({ mode: "add", memberId: m.sameRiId!.memberId })} />
                      Add {m.sameRiId.name} (already in ROW with this RI id) to this club
                    </label>
                  )}
                  {m.matches.map((x) => (
                    <label key={x.memberId} className="flex items-center gap-2">
                      <input type="radio" name={name} checked={c.mode === "link" && c.memberId === x.memberId} onChange={() => set({ mode: "link", memberId: x.memberId })} />
                      Link club member {x.name}{x.email ? ` (${x.email})` : ""}: same {x.reason === "email" ? "email" : "name"}, no RI id yet
                    </label>
                  ))}
                  {!m.sameRiId && (
                    <label className="flex items-center gap-2">
                      <input type="radio" name={name} checked={c.mode === "create"} onChange={() => set({ mode: "create" })} />
                      Create a new ROW member from the RI record
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input type="radio" name={name} checked={c.mode === "skip"} onChange={() => set({ mode: "skip" })} />
                    Skip for now
                  </label>
                </div>
              </fieldset>
            );
          })}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button disabled={toRun.length === 0} onClick={() => setStep(3)}>Next: confirm</Button>
          </div>
        </div>
      ) : step === 3 ? (
        <div className="space-y-4">
          <p className="text-[14px] text-[#1B2C42]">ROW will make these changes for {data.clubName}:</p>
          <ul className="list-disc space-y-1 pl-6 text-[14px] text-[#1B2C42]">
            {toRun.map((m) => <li key={m.rotaryMemberId}><strong>{m.name}</strong>: {choiceLabel(m, choices[m.rotaryMemberId])}</li>)}
          </ul>
          <p className="text-[13px] text-[#64748B]">New members get the default Member role. Each change is written to the audit log.</p>
          <div className="flex justify-between">
            <Button variant="outline" disabled={running} onClick={() => setStep(2)}>Back</Button>
            <Button disabled={running} onClick={run}>{running ? "Working" : `Bring in ${toRun.length} ${toRun.length === 1 ? "person" : "people"}`}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-2 text-[14px]">
            {results.map((r) => (
              <li key={r.rotaryMemberId} className={r.ok ? "text-green-800" : "text-red-800"}>
                <strong>{r.name}</strong>: {r.ok ? "Done. " : "Not done. "}{r.message}
              </li>
            ))}
          </ul>
          <Button onClick={load}>Back to the RI list</Button>
        </div>
      )}
    </Panel>
  );
}

export default function ClubRiDataPage() {
  const club = useSelectedClub();
  if (!club) return <p className="text-sm text-slate-500">No club selected.</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="RI data" description="Compare your club with Rotary International's records and bring missing members in" />
      <OfficerCompare clubId={club.id} />
      <TransferInWizard clubId={club.id} />
    </div>
  );
}
