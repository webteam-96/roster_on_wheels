"use client";

// "Bring a guest" prompts (spec B.4 #33). The club picks a meeting; on the send date every member gets an email and
// an app notice with their personal invite link. A guest who replies becomes a contact, or a prospect when they
// want to join.

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { useCallback, useEffect, useState } from "react";
import {
  cancelInvitePrompt, createInvitePrompt, getInvitePrompts, sendInvitePromptNow,
  type InvitePrompt,
} from "@/services/api";
import { errorText, label } from "@/lib/contacts";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SEND_OPTIONS = [0, 1, 2, 3, 5, 7];
// Dates arrive as "YYYY-MM-DDT00:00:00": show the calendar day without a time-zone shift.
const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined,
  { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function InvitePromptsPanel({ clubId }: { clubId: number }) {
  const [prompts, setPrompts] = useState<InvitePrompt[] | null>(null);
  const [meetingDate, setMeetingDate] = useState("");
  const [daysBefore, setDaysBefore] = useState(3);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    getInvitePrompts(clubId).then(setPrompts).catch(() => setPrompts([]));
  }, [clubId]);
  useEffect(() => { load(); }, [load]);

  const act = async (work: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try { await work(); setMessage({ ok: true, text: ok }); load(); }
    catch (e) { setMessage({ ok: false, text: errorText(e, "That did not work. Please try again.") }); }
    finally { setBusy(false); }
  };

  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the viewer's zone

  return (
    <section className="row-card row-rise p-5">
      <h3 className="row-h3">Guest invite prompts</h3>
      <p className="mt-0.5 max-w-3xl text-xs text-slate-500">
        Before a meeting, every member gets an email and an app notice asking them to bring a guest, with their personal
        invite link. Guests who reply appear in Contacts, or in Prospects when they want to join.
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        act(() => createInvitePrompt(clubId, { meetingDate, daysBefore, note: note.trim() || null })
          .then(() => { setMeetingDate(""); setNote(""); }), "Prompt scheduled.");
      }}>
        <label className="space-y-1 text-xs font-medium text-slate-600">
          <span className="block">Meeting date</span>
          <Input type="date" required min={today} value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-600">
          <span className="block">Send</span>
          <NativeSelect value={daysBefore} onChange={(e) => setDaysBefore(Number(e.target.value))}
            className="font-normal w-auto">
            {SEND_OPTIONS.map((d) => <option key={d} value={d}>{d === 0 ? "On the day" : `${d} day${d > 1 ? "s" : ""} before`}</option>)}
          </NativeSelect>
        </label>
        <label className="min-w-56 flex-1 space-y-1 text-xs font-medium text-slate-600">
          <span className="block">Note for members (optional)</span>
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Our speaker is the city mayor" />
        </label>
        <Button type="submit" size="sm" disabled={busy || !meetingDate}>Schedule</Button>
      </form>
      {message && <p className={`mt-2 text-sm ${message.ok ? "text-emerald-700" : "text-rose-700"}`}>{message.text}</p>}

      <div className="mt-4">
        {prompts === null ? <TableSkeleton rows={2} /> : prompts.length === 0 ? (
          <p className="text-sm text-slate-400">No prompts yet.</p>
        ) : (
          <Card className="overflow-x-auto">
            <Table className="min-w-full text-sm">
              <TableHeader>
                <TableRow><TableHead className="px-3 text-left">Meeting</TableHead><TableHead className="px-3 text-left">Sends on</TableHead>
                  <TableHead className="px-3 text-left">Status</TableHead><TableHead className="px-3 text-left">Note</TableHead>
                  <TableHead className="px-3 text-right"><span className="sr-only">Actions</span></TableHead></TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {prompts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap px-3 py-2 text-slate-800">{day(p.meetingDate)}</TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-2 text-slate-600">{day(p.sendOn)}</TableCell>
                    <TableCell className="px-3 py-2 text-slate-600">{label(p.status)}{p.status === "sent" ? ` to ${p.sentCount} members` : ""}</TableCell>
                    <TableCell className="max-w-xs truncate px-3 py-2 text-slate-600" title={p.note ?? ""}>{p.note || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-2 text-right">
                      {p.status === "scheduled" && (
                        <>
                          <Button size="sm" variant="outline" disabled={busy} className="row-btn-sm"
                            onClick={() => act(() => sendInvitePromptNow(clubId, p.id), "The prompt is on its way to the members.")}>Send now</Button>
                          <Button size="sm" variant="ghost" disabled={busy} className="ml-1 text-rose-700 row-btn-sm"
                            onClick={() => act(() => cancelInvitePrompt(clubId, p.id), "Prompt cancelled.")}>Cancel</Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </section>
  );
}
