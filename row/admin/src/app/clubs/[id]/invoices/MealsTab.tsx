"use client";

// Meal charges (DACdb parity): club default price, price per meeting, diners marked from the meeting's attendance
// with guests as named lines on the host, and billing as invoice lines (monthly, or onto the open invoice).
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, SkeletonRows } from "@/components/row/AppKit";
import {
  billMeals, getMealMeeting, getMealMeetings, getMealSettings, saveMealDiners, saveMealSettings,
  type MealMeetingDetail, type MealMeetingRow,
} from "@/services/api";

const SELECT = "w-full border border-input bg-background rounded-md h-9 px-2 text-sm";

function errText(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof m === "string" && m ? m : fallback;
}

type Props = { clubId: number; today: string; money: (n: number) => string; onBilled: (text: string) => void };

export default function MealsTab({ clubId, today, money, onBilled }: Props) {
  const [defaultPrice, setDefaultPrice] = useState("");
  const [from, setFrom] = useState(() => { const d = new Date(`${today}T00:00:00`); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(today);
  const [meetings, setMeetings] = useState<MealMeetingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [mode, setMode] = useState<"monthly" | "open">("monthly");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setMeetings(null); setError(null);
    Promise.all([getMealSettings(clubId), getMealMeetings(clubId, from, to)])
      .then(([s, m]) => { setDefaultPrice(s.defaultPrice == null ? "" : String(s.defaultPrice)); setMeetings(m); })
      .catch((e) => setError(errText(e, "Could not load meals.")));
  }, [clubId, from, to]);
  useEffect(() => { load(); }, [load]);

  const savePrice = async () => {
    setBusy(true); setMessage(null);
    try { await saveMealSettings(clubId, Number(defaultPrice)); setMessage("Default meal price saved."); }
    catch (e) { setMessage(errText(e, "Could not save the price.")); } finally { setBusy(false); }
  };

  const bill = async () => {
    setBusy(true); setMessage(null);
    try {
      const due = new Date(`${today}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + 14);
      const r = await billMeals(clubId, { month, mode, issueDate: today, dueDate: due.toISOString().slice(0, 10) });
      onBilled(r.chargesBilled === 0 ? `No unbilled meals in ${month}.`
        : `Billed ${r.chargesBilled} meal${r.chargesBilled === 1 ? "" : "s"}: ${r.invoicesCreated} new invoice(s), ${r.invoicesUpdated} added to open invoices.`);
      load();
    } catch (e) { setMessage(errText(e, "Could not bill the meals.")); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end gap-3">
        <div className="w-40"><Label htmlFor="m-default">Default meal price</Label>
          <Input id="m-default" type="number" min="0" step="0.01" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} /></div>
        <Button variant="outline" disabled={busy || defaultPrice === ""} onClick={savePrice}>Save price</Button>
        <div className="ml-auto flex flex-wrap items-end gap-3">
          <div><Label htmlFor="m-month">Bill month</Label><Input id="m-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div className="w-60"><Label htmlFor="m-mode">How</Label>
            <select id="m-mode" className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as "monthly" | "open")}>
              <option value="monthly">One invoice per member for the month</option>
              <option value="open">Add to the member&apos;s open invoice</option>
            </select></div>
          <Button disabled={busy || !month} onClick={bill}>Bill meals</Button>
        </div>
      </section>
      {message && <p role="status" className="text-sm">{message}</p>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="m-from">Meetings from</Label><Input id="m-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="m-to">To</Label><Input id="m-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {error ? <ErrorState message={error} onRetry={load} retryLabel="Try again" />
          : meetings == null ? <SkeletonRows rows={4} />
          : meetings.length === 0 ? <p className="py-8 text-center text-muted-foreground">No meetings in these dates. Meetings come from the club&apos;s attendance.</p>
          : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Meeting</TableHead><TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Meals</TableHead><TableHead className="text-right">Billed</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {meetings.map((m) => (
                  <TableRow key={m.attendanceId}>
                    <TableCell>{m.eventDate}</TableCell><TableCell>{m.eventName}</TableCell>
                    <TableCell className="text-right">{m.meetingPrice != null ? money(m.meetingPrice) : defaultPrice ? `${money(Number(defaultPrice))} (default)` : "Not set"}</TableCell>
                    <TableCell className="text-right">{m.diners}</TableCell><TableCell className="text-right">{m.billed}</TableCell>
                    <TableCell><button type="button" className="underline" onClick={() => setOpenId(openId === m.attendanceId ? null : m.attendanceId)}>
                      {openId === m.attendanceId ? "Close" : "Mark diners"}</button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </section>

      {openId != null && <DinersPanel key={openId} clubId={clubId} attendanceId={openId} money={money} onSaved={(t) => { setMessage(t); load(); }} />}
    </div>
  );
}

type Row = { memberId: number; memberName: string; attended: boolean; ate: boolean; guests: string; billed: boolean };

function DinersPanel({ clubId, attendanceId, money, onSaved }: { clubId: number; attendanceId: number; money: (n: number) => string; onSaved: (t: string) => void }) {
  const [detail, setDetail] = useState<MealMeetingDetail | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setDetail(null); setError(null);
    getMealMeeting(clubId, attendanceId).then((d) => {
      setDetail(d);
      setPrice(d.meeting.meetingPrice == null ? "" : String(d.meeting.meetingPrice));
      setRows(d.members.map((m) => {
        const mine = d.charges.filter((c) => c.memberId === m.memberId);
        return {
          ...m, ate: mine.some((c) => c.guestName === ""), billed: mine.some((c) => c.billed),
          guests: mine.filter((c) => c.guestName !== "").map((c) => c.guestName).join(", "),
        };
      }));
    }).catch((e) => setError(errText(e, "Could not load the meeting.")));
  }, [clubId, attendanceId]);
  useEffect(() => { load(); }, [load]);

  const set = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.memberId === id ? { ...r, ...patch } : r)));
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const diners = rows
        .map((r) => ({ memberId: r.memberId, ate: r.ate, guests: r.guests.split(",").map((g) => g.trim()).filter(Boolean) }))
        .filter((d) => d.ate || d.guests.length > 0);
      const r = await saveMealDiners(clubId, attendanceId, { price: price === "" ? undefined : Number(price), diners });
      onSaved(`Saved ${r.meals} meal${r.meals === 1 ? "" : "s"} for ${detail?.meeting.eventName ?? "the meeting"}.`);
      load();
    } catch (e) { setError(errText(e, "Could not save the diners.")); } finally { setSaving(false); }
  };

  if (error && !detail) return <ErrorState message={error} onRetry={load} retryLabel="Try again" />;
  if (!detail) return <SkeletonRows rows={6} />;
  const effective = price !== "" ? Number(price) : detail.defaultPrice;
  const count = rows.reduce((n, r) => n + (r.ate ? 1 : 0) + r.guests.split(",").filter((g) => g.trim()).length, 0);
  return (
    <section className="space-y-3 rounded-[20px] border border-[color:var(--row-line)] p-5">
      <div className="flex flex-wrap items-end gap-3">
        <h3 className="mr-auto text-lg font-semibold">{detail.meeting.eventName}, {detail.meeting.eventDate}</h3>
        <div className="w-44"><Label htmlFor="d-price">Price for this meeting</Label>
          <Input id="d-price" type="number" min="0" step="0.01" placeholder={detail.defaultPrice != null ? `Default ${detail.defaultPrice}` : "Not set"}
            value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <Button disabled={saving} onClick={save}>Save diners</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {count} meal{count === 1 ? "" : "s"}{effective != null ? `, ${money(count * effective)} in all` : ""}. Members marked present are listed first.
        Guests go on their host, separated by commas. Billed meals can only be removed after their invoice is voided.
      </p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Table>
        <TableHeader><TableRow><TableHead className="w-16">Ate</TableHead><TableHead>Member</TableHead><TableHead>Guests</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.memberId}>
              <TableCell><Checkbox aria-label={`${r.memberName} ate`} checked={r.ate} onCheckedChange={(c) => set(r.memberId, { ate: c === true })} /></TableCell>
              <TableCell>{r.memberName} {r.attended && <Badge variant="outline" className="ml-1">Present</Badge>}</TableCell>
              <TableCell><Input aria-label={`Guests of ${r.memberName}`} maxLength={1000} placeholder="Guest names" value={r.guests} onChange={(e) => set(r.memberId, { guests: e.target.value })} /></TableCell>
              <TableCell>{r.billed && <Badge variant="secondary">Billed</Badge>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
