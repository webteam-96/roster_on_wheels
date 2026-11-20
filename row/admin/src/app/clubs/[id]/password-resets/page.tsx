"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getClub, getClubMembers, getClubPasswordResets, sendClubMemberPasswordReset, type ClubPasswordResetRow,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SearchableCombo from "@/components/SearchableCombo";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ErrorState, ListPageSkeleton, SkeletonRows } from "@/components/row/AppKit";
import { ArrowLeft, KeyRound } from "@/components/icons";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

function apiMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string } | string } })?.response?.data;
  return (typeof data === "string" ? data : data?.message) || fallback;
}

// Club leaders email a member of their club the standard reset link. The link goes to the member's own address;
// nobody here sees or sets the password. The API checks the club, the daily limits, and audits every send.
export default function ClubPasswordResetsPage() {
  useSyncClubIdFromUrl();
  const clubId = Number(useParams().id);
  const [clubName, setClubName] = useState("");
  const [members, setMembers] = useState<{ value: string; label: string }[]>([]);
  const [rows, setRows] = useState<ClubPasswordResetRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setRows(null);
    try {
      const [club, list, history] = await Promise.all([
        getClub(clubId), getClubMembers(clubId, 1, 500), getClubPasswordResets(clubId),
      ]);
      setClubName(club?.clubName ?? "");
      setMembers(list.items.map((m) => ({
        value: String(m.id),
        label: m.emailId ? `${m.memberName} (${m.emailId})` : `${m.memberName} (no email)`,
      })));
      setRows(history);
    } catch (err) {
      setLoadError(apiMessage(err, "Could not load this page."));
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const handleSend = async () => {
    if (!memberId) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await sendClubMemberPasswordReset(clubId, Number(memberId));
      setSuccess(res.message);
      setMemberId("");
      setRows(await getClubPasswordResets(clubId));
    } catch (err) {
      setError(apiMessage(err, "Could not send the reset link."));
    } finally {
      setSending(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/members`} aria-label="Back to members"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Password resets</h2>
            <p className="text-base text-muted-foreground">{clubName}</p>
          </div>
        </div>

        <SuccessAlert open={!!success} title="Reset link sent" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Not sent" description={error ?? ""} onOk={() => setError(null)} />

        {loadError ? (
          <ErrorState message={loadError} onRetry={load} retryLabel="Try again" />
        ) : rows === null ? (
          <ListPageSkeleton tiles={0} rows={6} />
        ) : (
          <>
            <section className="space-y-3 rounded-[20px] border border-[color:var(--row-line)] p-6">
              <h3 className="text-lg font-semibold">Send a reset link</h3>
              <p className="text-sm text-muted-foreground">
                The member gets an email with a link to set a new password. You will not see their password.
                A member can get 3 of these a day, and you can send 20 a day.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <SearchableCombo
                  value={memberId}
                  onChange={setMemberId}
                  options={members}
                  placeholder="Choose a member"
                  searchPlaceholder="Search members"
                  emptyText="No member found"
                  className="sm:flex-1"
                />
                <Button onClick={handleSend} disabled={!memberId || sending}>
                  <KeyRound className="mr-2 h-4 w-4" />{sending ? "Sending" : "Send reset link"}
                </Button>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-lg font-semibold">Sent in this club</h3>
              {sending ? <SkeletonRows rows={3} /> : rows.length === 0 ? (
                <p className="rounded-[20px] border border-[color:var(--row-line)] p-6 text-sm text-muted-foreground">
                  No reset links have been sent from this club yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Sent by</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.memberName ?? `Member ${r.memberId}`}</TableCell>
                        <TableCell>{r.sentByName ?? `Member ${r.sentById}`}</TableCell>
                        <TableCell>{new Date(r.sentAtUtc).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
