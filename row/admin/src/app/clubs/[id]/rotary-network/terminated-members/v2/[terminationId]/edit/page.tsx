"use client";

/**
 * Terminated Members v2 — Edit.
 *
 * Pre-populates from the existing `getTerminatedMembers` listing (find by id).
 * Allows editing termination_date / reason / notes; the member cannot be
 * swapped (per spec).
 *
 * NOTE (frontend-only constraint): the v1 backend currently has no PUT
 * endpoint for a terminated club_members row — `removeClubMember` is the only
 * write path and it stamps a canned reason+date. We intentionally do NOT
 * fabricate an unsupported PUT here; the Save button is disabled and the
 * banner explains the pending backend support. The structural form is in
 * place so the day a PUT endpoint lands, only `handleSave` needs filling in.
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import { useEffect, useMemo, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Info, User, Calendar, MessageSquare, UserMinus, AlertTriangle,
} from "@/components/icons";
import { getClub, getTerminatedMembers } from "@/services/api";
import { TerminatedMember } from "@/types/club";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

const TERMINATION_REASONS = [
  { value: "Lack of Participation", label: "Lack of Participation" },
  { value: "Business Relocation",   label: "Business Relocation" },
  { value: "Personal / Health",     label: "Personal / Health" },
  { value: "Transfer to Other Club", label: "Transfer to Other Club" },
  { value: "Resigned",              label: "Resigned" },
  { value: "Other",                 label: "Other" },
];

function FieldLabel({ children, hint, dot, required = true }: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function toInputDate(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

export default function TerminatedMembersV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const terminationId = Number(params.terminationId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/rotary-network/terminated-members/v2`);

  const [clubName, setClubName] = useState("");
  const [record, setRecord] = useState<TerminatedMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Editable form fields (pre-populated from record).
  const [terminationDate, setTerminationDate] = useState<string>("");
  const [terminationReason, setTerminationReason] = useState<string>("");
  const [reasonIsCustom, setReasonIsCustom] = useState<boolean>(false);
  const [customReason, setCustomReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    async function init() {
      try {
        const [club, terminated] = await Promise.all([
          getClub(clubId),
          getTerminatedMembers(clubId, 1, 100000),
        ]);
        setClubName(club.clubName);
        const found = terminated.items.find((t) => t.id === terminationId) || null;
        setRecord(found);
        if (found) {
          setTerminationDate(toInputDate(found.terminationDate));
          // Match against known dropdown values; fall back to custom.
          const known = TERMINATION_REASONS.find(
            (r) => r.value.toLowerCase() === (found.terminationReason || "").toLowerCase(),
          );
          if (known) {
            setTerminationReason(known.value);
            setReasonIsCustom(false);
            setCustomReason("");
          } else {
            setTerminationReason("Other");
            setReasonIsCustom(true);
            setCustomReason(found.terminationReason || "");
          }
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } | string } };
        const apiMsg =
          (typeof e.response?.data === "object" && e.response?.data?.message) ||
          (typeof e.response?.data === "string" ? e.response.data : undefined) ||
          "Failed to load termination record.";
        setErrorMessage(apiMsg);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, terminationId]);

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  // The backend currently exposes no PUT/PATCH for terminated club_members.
  // Save is therefore disabled — the form is structurally ready for when the
  // backend gains support, and the banner tells the user clearly.
  const handleSave = () => {
    setErrorMessage(
      "Saving edits to a terminated-member record is not yet supported by the API. " +
      "Please contact a SuperAdmin if the termination details must be corrected.",
    );
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Terminated Member"
          pageSubtitle="Club Admin Dashboard"
          activeNavHref="/club-admin-dashboard/dashboard"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  if (!record) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Terminated Member"
          pageSubtitle="Club Admin Dashboard"
          activeNavHref="/club-admin-dashboard/dashboard"
        >
        <V2FormShell
          title="Edit Termination"
          subtitle={clubName}
          defaultBack={`/clubs/${clubId}/rotary-network/terminated-members/v2`}
          saving={false}
          saveLabel="Save"
          onSave={() => navigateAfterSave()}
          banner={
            <div className="flex items-start gap-2 text-rose-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Termination record not found. It may have been removed or never existed.</span>
            </div>
          }
        >
          <div className="text-sm text-slate-500 text-center py-8">No record to display.</div>
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </V2FormShell>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit Terminated Member"
        pageSubtitle="Club Admin Dashboard"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <V2FormShell
        title="Edit Termination"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/rotary-network/terminated-members/v2`}
        saving={true /* keeps the primary button disabled. See comment below */}
        saveLabel="Save (pending API)"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-amber-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Editing termination date / reason is pending backend support. The form below shows
              the current values and the standard reason list, but Save is disabled until the
              API exposes an update endpoint.
            </span>
          </div>
        }
      >
        {/* 1. Member (read-only — member cannot be swapped on edit) */}
        <SectionCard number={1} icon={UserMinus} title="Member" dot="bg-amber-600">
          <FieldLabel dot="bg-amber-500" required={false}>Member (locked)</FieldLabel>
          <div className="flex items-center gap-3 p-3 border rounded-lg bg-slate-50 border-slate-200">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-400">
              <User className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-800 truncate">{record.memberName}</div>
              <div className="text-xs text-slate-500 truncate">
                {record.rotaryId ? `#${record.rotaryId}` : "No Rotary ID"}
                {record.joinedDate ? ` · joined ${toInputDate(record.joinedDate)}` : ""}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 2. Termination Details (editable) */}
        <SectionCard number={2} icon={Calendar} title="Termination Details" dot="bg-rose-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel dot="bg-rose-500">Termination Date</FieldLabel>
              <DateField value={terminationDate} onChange={setTerminationDate} max={today} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500" />
            </div>
            <div>
              <FieldLabel dot="bg-rose-500">Termination Reason</FieldLabel>
              <select
                value={terminationReason}
                onChange={(e) => {
                  setTerminationReason(e.target.value);
                  setReasonIsCustom(e.target.value === "Other");
                }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
              >
                <option value="">Select a reason…</option>
                {TERMINATION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {reasonIsCustom && (
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Custom reason"
                  maxLength={200}
                  className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              )}
            </div>
          </div>
        </SectionCard>

        {/* 3. Notes */}
        <SectionCard number={3} icon={MessageSquare} title="Notes" dot="bg-slate-600">
          <FieldLabel dot="bg-slate-500" hint="(optional, max 1000 chars)" required={false}>Additional Context</FieldLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any context to record alongside the termination…"
            rows={4}
            maxLength={1000}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <p className="text-xs text-slate-400 text-right mt-0.5">{notes.length}/1000</p>
        </SectionCard>

        <ErrorAlert open={!!errorMessage} title="Edit Not Supported" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
