"use client";

import { MenuItemButton } from "@/components/ui/text-buttons"
import { IconButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Search, Trash2, X } from "@/components/icons";
import { ErrorState, Panel, SkeletonRows } from "@/components/row/AppKit";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import {
  confirmOfficerProgressionStep, createOfficerProgression, deleteOfficerProgression, dismissOfficerProgressionStep,
  getOfficerProgressionCandidates, getOfficerProgressions,
  type Progression, type ProgressionCandidate, type ProgressionScope, type ProgressionStep,
} from "@/services/api";

type Props = { scope: ProgressionScope; scopeId: number; canManage: boolean };

function apiMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string } } };
  return err?.response?.data?.message || fallback;
}

const STATUS_STYLE: Record<ProgressionStep["status"], string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  applying: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  dismissed: "border-slate-200 bg-slate-50 text-slate-500",
};

const STATUS_TEXT: Record<ProgressionStep["status"], string> = {
  pending: "Suggested",
  applying: "Saving",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
};

function whereText(step: ProgressionStep): string {
  if (step.appliesTo === "board") return "Confirming adds this to the Board of Directors.";
  if (step.appliesTo === "governor") return "Confirming adds this to the District Governors list.";
  return "Confirming records the office on this chain.";
}

/**
 * Officer progression: the named nominee and the suggested chain (club PN, PE, P, IPP; district DGN, DGE, DG, IPDG).
 * Each step is a suggestion an admin confirms or dismisses; the API refuses to replace a sitting office holder.
 */
export default function OfficerProgressionPanel({ scope, scopeId, canManage }: Props) {
  const { years, currentYearId } = useRotaryYears();
  const [chains, setChains] = useState<Progression[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<ProgressionCandidate[]>([]);
  const [memberId, setMemberId] = useState<number | null>(null);
  const currentLabel = years.find((y) => y.id === currentYearId)?.yearLabel;
  const currentStart = currentLabel ? parseInt(currentLabel.slice(0, 4), 10) : new Date().getUTCFullYear();
  const [nomineeYear, setNomineeYear] = useState<number | null>(null);
  const yearChoice = nomineeYear ?? currentStart;
  const nomineeLabel = scope === "club" ? "President-Nominee" : "District Governor-Nominee";

  const load = useCallback(() => {
    setError(null);
    getOfficerProgressions(scope, scopeId)
      .then(setChains)
      .catch((e) => { setChains(null); setError(apiMessage(e, "Could not load the officer progression.")); });
  }, [scope, scopeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!adding) return;
    let cancelled = false;
    const t = setTimeout(() => {
      getOfficerProgressionCandidates(scope, scopeId, search)
        .then((c) => { if (!cancelled) setCandidates(c); })
        .catch((e) => { if (!cancelled) setError(apiMessage(e, "Could not load members.")); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [adding, search, scope, scopeId]);

  const run = async (key: string, action: () => Promise<{ message?: string } | unknown>) => {
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      const r = (await action()) as { message?: string } | undefined;
      if (r?.message) setNotice(r.message);
      load();
      return true;
    } catch (e) {
      setError(apiMessage(e, "That did not work. Try again."));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async () => {
    if (!memberId) return;
    const ok = await run("create", () => createOfficerProgression(scope, scopeId, memberId, yearChoice));
    if (ok) { setAdding(false); setMemberId(null); setSearch(""); setNotice(`${nomineeLabel} named. The chain below is suggested, nothing is saved to the board until you confirm each step.`); }
  };

  const yearOptions = Array.from({ length: 7 }, (_, i) => currentStart - 3 + i);

  return (
    <Panel
      title="Officer progression"
      subtitle={`Name the ${nomineeLabel}. The following years are suggested for you to confirm.`}
      headerRight={canManage && !adding ? (
        <Button type="button" onClick={() => setAdding(true)}
          >
          <Plus size={13} /> Name {nomineeLabel}
        </Button>
      ) : undefined}
    >
      {notice && <p role="status" className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-800">{notice}</p>}
      {error && chains !== null && <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800">{error}</p>}

      {adding && (
        <div className="mb-4 rounded-md border border-slate-200 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 text-[13px] text-slate-600">
              Member
              <span className="relative mt-1 block">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name"
                  className="pl-8 pr-3" />
              </span>
            </label>
            <label className="block text-[13px] text-slate-600">
              Nominee in Rotary year
              <NativeSelect value={yearChoice} onChange={(e) => setNomineeYear(parseInt(e.target.value, 10))}
                className="mt-1 block w-auto">
                {yearOptions.map((y) => <option key={y} value={y}>{`${y}-${String((y + 1) % 100).padStart(2, "0")}`}</option>)}
              </NativeSelect>
            </label>
          </div>
          <ul className="mt-3 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-100">
            {candidates.length === 0 && <li className="px-3 py-2 text-[13px] text-slate-500">No members match.</li>}
            {candidates.map((c) => (
              <li key={c.memberId}>
                <MenuItemButton selected={memberId === c.memberId} className="justify-between" type="button" onClick={() => setMemberId(c.memberId)} aria-pressed={memberId === c.memberId}
                 >
                  <span>{c.memberName}</span>
                  {scope === "district" && c.clubName && <span className="text-xs text-slate-500">{c.clubName}</span>}
                </MenuItemButton>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button type="button" disabled={!memberId || busy === "create"} onClick={handleCreate}
              >
              {busy === "create" ? "Saving" : "Save nominee"}
            </Button>
            <Button type="button" onClick={() => { setAdding(false); setMemberId(null); }}
              variant="outline">Cancel</Button>
          </div>
        </div>
      )}

      {chains === null && !error && <SkeletonRows rows={3} />}
      {chains === null && error && <ErrorState message={error} onRetry={load} retryLabel="Try again" />}
      {chains !== null && chains.length === 0 && (
        <p className="py-4 text-[13px] text-slate-500">
          No {nomineeLabel} named yet.{canManage ? ` Name one and the next three years fill in as suggestions.` : ""}
        </p>
      )}

      {chains?.map((c) => (
        <div key={c.progressionId} className="mb-4 rounded-md border border-slate-200 last:mb-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">{c.memberName} <span className="font-normal text-slate-500">· {nomineeLabel} {c.nomineeYearLabel}</span></p>
            {canManage && (
              <IconButton type="button" aria-label={`Remove the chain for ${c.memberName}`} title="Remove chain"
                disabled={busy !== null}
                onClick={() => { if (window.confirm(`Remove the chain for ${c.memberName}? Offices already confirmed stay where they are.`)) void run(`del-${c.progressionId}`, () => deleteOfficerProgression(c.progressionId)); }}
                className="hover:text-red-700">
                <Trash2 size={14} />
              </IconButton>
            )}
          </div>
          <ol className="divide-y divide-slate-100">
            {c.steps.map((s) => {
              const clash = s.currentHolderName && !s.currentHolderIsNominee;
              return (
                <li key={s.stepId} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800"><span className="font-medium">{s.title}</span> · {s.yearLabel}</p>
                    <p className="text-xs text-slate-500">
                      {s.status === "pending" && s.yearId === null ? "This Rotary year is not open yet." : s.status === "pending" ? whereText(s) : ""}
                      {clash && ` ${s.currentHolderName} already holds this office, so it cannot be confirmed here.`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}>{STATUS_TEXT[s.status]}</span>
                    {canManage && s.status === "pending" && (
                      <>
                        <Button type="button" disabled={busy !== null || s.yearId === null || !!clash}
                          onClick={() => void run(`c-${s.stepId}`, () => confirmOfficerProgressionStep(s.stepId))}
                          size="sm">
                          <Check size={12} /> {busy === `c-${s.stepId}` ? "Saving" : "Confirm"}
                        </Button>
                        <Button type="button" disabled={busy !== null}
                          onClick={() => void run(`d-${s.stepId}`, () => dismissOfficerProgressionStep(s.stepId))}
                          variant="outline" size="sm">
                          <X size={12} /> Dismiss
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </Panel>
  );
}
