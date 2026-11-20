"use client";

/**
 * Club Dashboard › Profile updates: ask chosen members, or every member with an incomplete profile, to check their
 * profile. Each member gets an email with a personal link (works 30 days, no sign-in) and an item in the app's bell.
 * The history shows who has updated. Data: api/clubs/{clubId}/profile-updates/*.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Send } from "@/components/icons";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { fmtDate } from "@/components/dashboard/formatters";
import { apiMessage, selectCls } from "@/components/membership/FoundationDesignationsCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSelectedClub } from "@/contexts/AuthContext";
import {
  getProfileUpdateMembers, getProfileUpdateRequests, sendProfileUpdateRequests,
  type ProfileUpdateField, type ProfileRequestStatus, type ProfileUpdateMember, type ProfileUpdateRequest,
} from "@/services/api";

const FIELD_LABELS: Record<ProfileUpdateField, string> = {
  photo: "Photo",
  email: "Email",
  mobile: "Mobile",
  birthDate: "Birth date",
  classification: "Classification",
};
const STATUS_LABELS: Record<ProfileRequestStatus, string> = { pending: "Waiting", updated: "Updated", expired: "Link expired" };
const VIA_LABELS = { link: "through the email link", confirm: "confirmed no change", profile: "in their profile" } as const;

type Filter = "incomplete" | "all";

export default function ClubProfileUpdatesPage() {
  const club = useSelectedClub();
  const clubId = club?.id ?? 0;
  const [members, setMembers] = useState<ProfileUpdateMember[] | null>(null);
  const [requests, setRequests] = useState<ProfileUpdateRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("incomplete");
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!(clubId > 0)) return;
    setError(null);
    try {
      const [m, r] = await Promise.all([getProfileUpdateMembers(clubId), getProfileUpdateRequests(clubId)]);
      setMembers(m);
      setRequests(r);
    } catch (err) {
      setError(apiMessage(err, "Could not load the members."));
    }
  }, [clubId]);

  useEffect(() => {
    setMembers(null);
    setRequests(null);
    setChosen(new Set());
    load();
  }, [load]);

  const shown = useMemo(
    () => (members ?? []).filter((m) => filter === "all" || m.missing.length > 0),
    [members, filter],
  );
  const incompleteCount = (members ?? []).filter((m) => m.missing.length > 0).length;
  const allShownChosen = shown.length > 0 && shown.every((m) => chosen.has(m.memberId));

  if (!club) return <p className="text-sm text-slate-500">No club selected.</p>;

  const toggle = (id: number) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setChosen(allShownChosen ? new Set() : new Set(shown.map((m) => m.memberId)));

  const send = async (incompleteOnly: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await sendProfileUpdateRequests(clubId, {
        incompleteOnly,
        memberIds: incompleteOnly ? undefined : [...chosen],
        message: message.trim() || undefined,
      });
      setNotice(`Asked ${r.requested} member${r.requested === 1 ? "" : "s"}: ${r.emailed} by email and in the app`
        + (r.noEmail ? `, ${r.noEmail} in the app only (no email address)` : "")
        + (r.skipped ? `. ${r.skipped} skipped (no longer active in this club)` : "") + ".");
      setChosen(new Set());
      setMessage("");
      await load();
    } catch (err) {
      setError(apiMessage(err, "Could not send the requests."));
    } finally {
      setBusy(false);
    }
  };

  const updated = (requests ?? []).filter((r) => r.status === "updated").length;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-[20px] border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-800">Ask members to update their profile</h2>
        <p className="text-sm text-slate-600">
          Each member gets an email with a personal link to check their details (no sign-in, works for 30 days) and a
          notice in the app. Login details (main mobile and email) can only be changed in the app or by the club.
        </p>
        <label className="block space-y-1 text-xs font-semibold text-slate-700">
          <span>Note to include (optional)</span>
          <Textarea value={message} maxLength={1000} rows={2} onChange={(e) => setMessage(e.target.value)}
            placeholder="For example: we are updating the club directory before the district conference." />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy || chosen.size === 0} onClick={() => send(false)}>
            <Send className="h-4 w-4" /> Ask {chosen.size} selected
          </Button>
          <Button type="button" variant="outline" disabled={busy || incompleteCount === 0} onClick={() => send(true)}>
            Ask all {incompleteCount} with incomplete profiles
          </Button>
        </div>
        {notice && <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status">{notice}</p>}
      </section>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Members</h2>
          <label className="w-60 space-y-1 text-xs font-semibold text-slate-700">
            <span>Show</span>
            <select className={selectCls} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="incomplete">Incomplete profiles</option>
              <option value="all">All active members</option>
            </select>
          </label>
        </div>
        {members === null ? (
          !error && <TableSkeleton rows={6} />
        ) : (
          <div className="overflow-x-auto rounded-[20px] border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allShownChosen} onCheckedChange={toggleAll} aria-label="Select all shown members" />
                  </TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Missing</TableHead>
                  <TableHead>Last asked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((m) => (
                  <TableRow key={m.memberId}>
                    <TableCell>
                      <Checkbox checked={chosen.has(m.memberId)} onCheckedChange={() => toggle(m.memberId)} aria-label={`Select ${m.memberName}`} />
                    </TableCell>
                    <TableCell className="font-medium text-slate-800">
                      {m.memberName}
                      {!m.hasEmail && <span className="ml-2 text-xs font-normal text-slate-500">(app only)</span>}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {m.missing.length ? m.missing.map((f) => FIELD_LABELS[f]).join(", ") : "Complete"}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {m.lastRequestedAt ? `${fmtDate(m.lastRequestedAt)}: ${STATUS_LABELS[m.lastStatus!]}` : "Never"}
                    </TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                      {filter === "incomplete" ? "Every active member has a complete profile." : "The club has no active members."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">
          Requests sent{requests && requests.length > 0 ? `: ${updated} of ${requests.length} updated` : ""}
        </h2>
        {requests === null ? (
          !error && <TableSkeleton rows={4} />
        ) : (
          <div className="overflow-x-auto rounded-[20px] border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Asked</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-slate-800">{r.memberName}</TableCell>
                    <TableCell className="text-slate-600">{fmtDate(r.requestedAt)}</TableCell>
                    <TableCell className="text-slate-600">{r.requestedByName ?? "–"}</TableCell>
                    <TableCell className="text-slate-600">{r.emailStatus === "emailed" ? "Email and app" : "App only"}</TableCell>
                    <TableCell>
                      {STATUS_LABELS[r.status]}
                      {r.status === "updated" && r.completedAt && (
                        <span className="text-slate-500"> {fmtDate(r.completedAt)}, {r.completedVia ? VIA_LABELS[r.completedVia] : ""}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {requests.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-slate-500">No requests sent yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
