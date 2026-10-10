import { Injectable, Logger } from "@nestjs/common";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { bodyField } from "../../common/binding";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { InvalidOperationException } from "../../common/exceptions";
import { Db, type DbCommands } from "../../database/db.service";
import { EmailService } from "../../services/email.service";
import { ZoomMeetingService } from "../../services/zoom-meeting.service";

// ── Pure date/slot helpers (exported for the spec) ───────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
/** "HH:mm[:ss]" (a TIME column or a request value) → minutes, else null. */
export function minutesOf(v: unknown): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? ""));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const dayOfWeek = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
export interface HourRange { id: number; start: number; end: number }
/** Slot start times inside the ranges: 11:30-12:30 at 30 min gives 11:30 and 12:00. */
export function slotsInRanges(ranges: HourRange[], step: number): string[] {
  const times: string[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start))
    for (let t = r.start; t + step <= r.end; t += step) {
      const label = hhmm(t);
      if (!times.includes(label)) times.push(label);
    }
  return times.sort();
}
interface DayOverride { allDay: boolean; reason: string | null; ranges: HourRange[] }
/** An override replaces the weekday pattern for its date (all-day or no hours = closed). */
export function dayRanges(date: string, weekly: Map<number, HourRange[]>, overrides: Map<string, DayOverride>): { ranges: HourRange[]; closedReason: string | null } {
  const o = overrides.get(date);
  if (o) return o.allDay || o.ranges.length === 0 ? { ranges: [], closedReason: o.reason ?? "Not available" } : { ranges: o.ranges, closedReason: null };
  const w = weekly.get(dayOfWeek(date));
  return w && w.length > 0 ? { ranges: w, closedReason: null } : { ranges: [], closedReason: "Not available" };
}
/** DateTime.TryParse of a slot, truncated to the minute: "yyyy-MM-ddTHH:mm[:ss]" → "yyyy-MM-dd HH:mm:00". */
export function parseSlot(v: unknown): string | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*$/.exec(String(v ?? ""));
  if (!m) return null;
  const [y, mo, d, h = "0", mi = "0"] = m.slice(1);
  const t = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  if (t.getUTCMonth() !== +mo - 1 || t.getUTCDate() !== +d || +h > 23 || +mi > 59) return null;
  return `${y}-${mo}-${d} ${pad(+h)}:${mi}:00`;
}
/** A DATETIME read back (UTC-marked string of the stored wall clock) → "yyyy-MM-dd HH:mm:00". */
const wall = (v: unknown) => String(v ?? "").replace("T", " ").slice(0, 16) + ":00";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fail = (message: string) => ({ isSuccess: false, message, appointment: null as unknown });

/**
 * Port of TrainingAppointmentService.cs: website-training bookings (30-min slots, a global daily cap,
 * one Zoom meeting per booking). Times are wall clock in the brand time zone (RIZones: IST).
 */
@Injectable()
export class TrainingAppointmentService {
  private readonly log = new Logger("TrainingAppointmentService");

  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly zoom: ZoomMeetingService, private readonly email: EmailService) {}

  private cfg = (k: string, d: number) => { const v = Number(this.config.get(`Training:${k}`)); return this.config.get(`Training:${k}`) !== undefined && Number.isFinite(v) ? Math.trunc(v) : d; };
  private get slotMinutes() { return this.cfg("SlotMinutes", 30); }
  private get maxPerDay() { return this.cfg("MaxPerDay", 3); }
  private get minNoticeDays() { return this.cfg("MinNoticeDays", 1); }
  private get horizonDays() { return this.cfg("HorizonDays", 30); }
  private get teamEmails() { return this.config.getArray("Training:TeamEmails"); }
  private get tz() { return Brand.Current.locale.defaultTimeZone; }
  private today() { return nowIn(this.tz).slice(0, 10); }

  async hasActiveWebsite(clubId: number) {
    return Number(await this.db.executeScalar(
      `SELECT COUNT(*) FROM club_websites
       WHERE fk_club_id = @C AND isdeleted = 0
         AND (IsPurchased = 1 OR (AmountPaid IS NOT NULL AND AmountPaid > 0) OR (TransactionId IS NOT NULL AND TransactionId <> ''))
         AND EndDate >= CURDATE()`,
      { C: clubId },
    )) > 0;
  }

  // ── Availability ─────────────────────────────────────────────────────────────────────────────
  async getAvailability() {
    const today = this.today();
    const start = addDays(today, this.minNoticeDays), end = addDays(today, this.horizonDays);
    const booked = await this.db.query(
      "SELECT SlotStart FROM website_training_appointments WHERE SlotStart >= @S AND SlotStart < @E AND Status <> 'Cancelled' AND isdeleted = 0",
      { S: start, E: addDays(end, 1) },
    );
    const byDate = new Map<string, string[]>();
    for (const b of booked) {
      const w = wall(b.SlotStart);
      byDate.set(w.slice(0, 10), [...(byDate.get(w.slice(0, 10)) ?? []), w.slice(11, 16)]);
    }
    const weekly = await this.loadWeekly(this.db);
    const overrides = await this.loadOverrides(this.db, start, end);
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const taken = byDate.get(d) ?? [];
      const { ranges, closedReason } = dayRanges(d, weekly, overrides);
      const dayLabel = formatDate(`${d}T00:00:00`, "ddd, dd MMM");
      if (ranges.length === 0) {
        days.push({ date: d, dayLabel, slots: [], allSlots: [], isClosed: true, closedReason: closedReason ?? "Not available" });
        continue;
      }
      const dayFull = taken.length >= this.maxPerDay;
      const all = slotsInRanges(ranges, this.slotMinutes).map((t) =>
        taken.includes(t) ? { time: t, isOpen: false, status: "booked", reason: "Already booked" }
          : dayFull ? { time: t, isOpen: false, status: "dayFull", reason: "That day is fully booked" }
            : { time: t, isOpen: true, status: "open", reason: null });
      const noneOpen = !all.some((x) => x.isOpen);
      days.push({ date: d, dayLabel, slots: all.filter((x) => x.isOpen).map((x) => x.time), allSlots: all, isClosed: noneOpen, closedReason: noneOpen ? "Fully booked" : null });
    }
    return { slotMinutes: this.slotMinutes, days };
  }

  private async loadWeekly(conn: DbCommands) {
    const map = new Map<number, HourRange[]>();
    for (const r of await conn.query("SELECT pk_id, DayOfWeek, StartTime, EndTime FROM training_weekly_hours WHERE isdeleted = 0 ORDER BY DayOfWeek, StartTime")) {
      const dow = Number(r.DayOfWeek);
      map.set(dow, [...(map.get(dow) ?? []), { id: Number(r.pk_id), start: minutesOf(r.StartTime) ?? 0, end: minutesOf(r.EndTime) ?? 0 }]);
    }
    return map;
  }

  private async loadOverrides(conn: DbCommands, from: string, to: string) {
    const map = new Map<string, DayOverride>();
    for (const r of await conn.query(
      `SELECT pk_id, OverrideDate, IsUnavailableAllDay, StartTime, EndTime, Reason FROM training_date_overrides
       WHERE isdeleted = 0 AND OverrideDate BETWEEN @F AND @T ORDER BY OverrideDate, StartTime`,
      { F: from, T: to },
    )) {
      const key = String(r.OverrideDate).slice(0, 10);
      const o = map.get(key) ?? { allDay: false, reason: null, ranges: [] };
      map.set(key, o);
      const st = minutesOf(r.StartTime), en = minutesOf(r.EndTime);
      if (r.IsUnavailableAllDay === true || Number(r.IsUnavailableAllDay) === 1) o.allDay = true;
      else if (st !== null && en !== null) o.ranges.push({ id: Number(r.pk_id), start: st, end: en });
      if (r.Reason && String(r.Reason).trim()) o.reason = String(r.Reason);
    }
    return map;
  }

  /** Shape and booking window only; the published hours are checked by validateSlotAvailable. */
  private parseAndValidateSlot(v: unknown): { slot: string | null; error: string | null } {
    const slot = parseSlot(v);
    if (!slot) return { slot: null, error: "Invalid date/time." };
    const today = this.today(), date = slot.slice(0, 10);
    if (date < addDays(today, this.minNoticeDays) || date > addDays(today, this.horizonDays)) return { slot, error: "That date is outside the booking window." };
    return { slot, error: null };
  }

  private async validateSlotAvailable(conn: DbCommands, slot: string): Promise<string | null> {
    const date = slot.slice(0, 10);
    const { ranges, closedReason } = dayRanges(date, await this.loadWeekly(conn), await this.loadOverrides(conn, date, date));
    if (ranges.length === 0)
      return closedReason && closedReason !== "Not available" ? `The training team is not available that day (${closedReason}).` : "The training team is not available on that day.";
    if (!slotsInRanges(ranges, this.slotMinutes).includes(slot.slice(11, 16))) return "The training team is not available at that time. Please pick another slot.";
    return null;
  }

  // ── Book / reschedule ────────────────────────────────────────────────────────────────────────
  async book(body: unknown, userId: number) {
    const clubId = Math.trunc(Number(bodyField(body, "clubId")) || 0);
    if (clubId <= 0) return fail("Club is required.");
    if (!(await this.hasActiveWebsite(clubId))) return fail("Your club needs an active website subscription to book training.");
    const { slot, error } = this.parseAndValidateSlot(bodyField(body, "slotStart"));
    if (error || !slot) return fail(error!);
    const notes = bodyField(body, "notes");
    return this.db.session(async (conn) => {
      const blocked = await this.validateSlotAvailable(conn, slot);
      if (blocked) return fail(blocked);
      // The day's rows are locked so the daily cap and per-slot uniqueness hold under concurrency.
      const outcome = await conn.transaction(async (tx) => {
        const date = slot.slice(0, 10);
        const day = (await tx.query(
          "SELECT SlotStart FROM website_training_appointments WHERE SlotStart >= @S AND SlotStart < @E AND Status <> 'Cancelled' AND isdeleted = 0 FOR UPDATE",
          { S: date, E: addDays(date, 1) },
        )).map((r) => wall(r.SlotStart));
        if (day.length >= this.maxPerDay) return fail("That date is fully booked. Please pick another day.");
        if (day.includes(slot)) return fail("That slot was just taken. Please pick another.");
        const district = Number(await tx.executeScalar("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", { C: clubId })) || 0;
        return Number(await tx.executeScalar(
          `INSERT INTO website_training_appointments (fk_club_id, fk_district_id, SlotStart, DurationMinutes, Status, fk_booker_member_id, Notes, created_by, created_date, isdeleted)
           VALUES (@Club, @District, @Slot, @Dur, 'Scheduled', @User, @Notes, @User, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          { Club: clubId, District: district, Slot: slot, Dur: this.slotMinutes, User: userId, Notes: notes === undefined || notes === null ? null : String(notes) },
        ));
      });
      if (typeof outcome !== "number") return outcome;
      const id = outcome;
      // Zoom and emails after the slot is reserved (outside the row lock).
      const clubName = await this.clubName(conn, clubId);
      const z = this.zoom.isConfigured ? await this.zoom.createMeeting(`Website Training — ${clubName}`, slot.replace(" ", "T"), this.slotMinutes) : null;
      if (z) await conn.execute("UPDATE website_training_appointments SET ZoomMeetingId=@M, ZoomJoinUrl=@J, ZoomStartUrl=@S, modified_date=NOW() WHERE pk_id=@Id", { M: z.meetingId, J: z.joinUrl, S: z.startUrl, Id: id });
      await this.notify(conn, id, clubId, clubName, slot, z?.joinUrl ?? null, userId, false);
      return this.successWith(conn, id);
    });
  }

  async reschedule(appointmentId: number, body: unknown, userId: number) {
    const { slot, error } = this.parseAndValidateSlot(bodyField(body, "slotStart"));
    if (error || !slot) return fail(error!);
    return this.db.session(async (conn) => {
      const blocked = await this.validateSlotAvailable(conn, slot);
      if (blocked) return fail(blocked);
      const appt = await conn.queryFirstOrDefault("SELECT pk_id, fk_club_id, SlotStart, ZoomMeetingId, Status FROM website_training_appointments WHERE pk_id=@Id AND isdeleted=0", { Id: appointmentId });
      if (!appt || appt.Status === "Cancelled") return fail("Appointment not found.");
      const clubId = Number(appt.fk_club_id);
      const refused = await conn.transaction(async (tx) => {
        const date = slot.slice(0, 10);
        const others = (await tx.query(
          "SELECT pk_id, SlotStart FROM website_training_appointments WHERE SlotStart >= @S AND SlotStart < @E AND Status <> 'Cancelled' AND isdeleted = 0 FOR UPDATE",
          { S: date, E: addDays(date, 1) },
        )).filter((a) => Number(a.pk_id) !== appointmentId);
        if (others.length >= this.maxPerDay) return fail("That date is fully booked. Please pick another day.");
        if (others.some((a) => wall(a.SlotStart) === slot)) return fail("That slot is taken. Please pick another.");
        await tx.execute(
          "UPDATE website_training_appointments SET SlotStart=@Slot, Status='Scheduled', RescheduleCount=RescheduleCount+1, modified_by=@User, modified_date=NOW() WHERE pk_id=@Id",
          { Slot: slot, User: userId, Id: appointmentId },
        );
        return null;
      });
      if (refused) return refused;
      // Keep the same Zoom meeting; only its time moves.
      const meetingId = appt.ZoomMeetingId ? String(appt.ZoomMeetingId) : "";
      if (meetingId.trim() && this.zoom.isConfigured) await this.zoom.updateMeetingTime(meetingId, slot.replace(" ", "T"), this.slotMinutes);
      const clubName = await this.clubName(conn, clubId);
      const joinUrl = await conn.executeScalar<string>("SELECT ZoomJoinUrl FROM website_training_appointments WHERE pk_id=@Id", { Id: appointmentId });
      await this.notify(conn, appointmentId, clubId, clubName, slot, joinUrl ?? null, userId, true);
      return this.successWith(conn, appointmentId);
    });
  }

  // ── Reads ────────────────────────────────────────────────────────────────────────────────────
  getForClub(clubId: number) {
    return this.queryAppointments(this.db, "a.fk_club_id = @C AND a.Status <> 'Cancelled' AND a.isdeleted = 0 AND a.SlotStart >= (NOW() - INTERVAL 1 DAY)", "a.SlotStart ASC", { C: clubId });
  }
  getAll() {
    return this.queryAppointments(this.db, "a.isdeleted = 0", "a.SlotStart DESC", {});
  }
  async getAppointmentClubId(id: number): Promise<number | null> {
    const v = await this.db.executeScalar("SELECT fk_club_id FROM website_training_appointments WHERE pk_id=@Id AND isdeleted=0", { Id: id });
    return v === null || v === undefined ? null : Number(v);
  }

  private async queryAppointments(conn: DbCommands, where: string, orderBy: string, args: Record<string, unknown>) {
    return (await conn.query(
      `SELECT a.pk_id AS Id, a.fk_club_id AS ClubId, c.ClubName AS ClubName,
              DATE_FORMAT(a.SlotStart, '%Y-%m-%dT%H:%i:%s') AS SlotStart,
              a.DurationMinutes AS DurationMinutes, a.Status AS Status,
              a.ZoomJoinUrl AS ZoomJoinUrl, a.ZoomStartUrl AS ZoomStartUrl,
              m.MemberName AS BookedByName, a.Notes AS Notes, a.created_date AS BookedDate
       FROM website_training_appointments a
       LEFT JOIN club_master c ON c.pk_club_id = a.fk_club_id
       LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_booker_member_id
       WHERE ${where}
       ORDER BY ${orderBy}`,
      args,
    )).map((r) => ({
      id: Number(r.Id), clubId: Number(r.ClubId ?? 0), clubName: String(r.ClubName ?? ""), slotStart: String(r.SlotStart ?? ""), durationMinutes: Number(r.DurationMinutes ?? 0),
      status: String(r.Status ?? ""), zoomJoinUrl: r.ZoomJoinUrl ?? null, zoomStartUrl: r.ZoomStartUrl ?? null, bookedByName: r.BookedByName ?? null, notes: r.Notes ?? null, bookedDate: r.BookedDate ?? null,
    }));
  }

  private async clubName(conn: DbCommands, clubId: number) {
    return (await conn.executeScalar<string>("SELECT ClubName FROM club_master WHERE pk_club_id=@C", { C: clubId })) ?? "your club";
  }
  private async successWith(conn: DbCommands, id: number) {
    return { isSuccess: true, message: null, appointment: (await this.queryAppointments(conn, "a.pk_id = @Id", "a.pk_id", { Id: id }))[0] ?? null };
  }

  /** Best effort: the booker, every club admin and the Training:TeamEmails list, each address once. */
  private async notify(conn: DbCommands, apptId: number, clubId: number, clubName: string, slot: string, joinUrl: string | null, bookerId: number, isReschedule: boolean) {
    const sentTo = new Set<string>();
    const sendSafe = async (to: string | null | undefined, subject: string, body: string, cc: string | null = null) => {
      if (!to || !to.trim()) return;
      const addr = to.trim();
      if (sentTo.has(addr.toLowerCase())) return;
      sentTo.add(addr.toLowerCase());
      try {
        await this.email.sendGenericEmailWithCc(addr, cc, subject, body);
      } catch (e) {
        this.log.warn(`Training ${apptId}: email to ${addr} failed. ${(e as Error).message}`);
      }
    };
    try {
      const booker = await conn.queryFirstOrDefault("SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id=@Id", { Id: bookerId });
      const bookerName = String(booker?.MemberName ?? "there");
      const bookerEmail = booker?.EmailId ? String(booker.EmailId) : null;
      const when = formatDate(slot.replace(" ", "T"), "dddd, dd MMM yyyy 'at' h:mm tt");
      const zone = this.tz;
      const verb = isReschedule ? "rescheduled" : "confirmed";
      const linkHtml = !joinUrl || !joinUrl.trim() ? "<p>The Zoom meeting link will be shared shortly.</p>" : `<p><strong>Zoom link:</strong> <a href="${joinUrl}">${joinUrl}</a></p>`;
      if (bookerEmail && bookerEmail.trim()) {
        const body = `<p>Hi ${bookerName},</p>
<p>Your website training session for <strong>${clubName}</strong> has been ${verb} for:</p>
<p style="font-size:16px"><strong>${when} (${zone})</strong></p>
${linkHtml}
<p>Please join a few minutes early. If you need to change the time, use the Reschedule option in your dashboard.</p>`;
        await sendSafe(bookerEmail, `Website Training ${isReschedule ? "Rescheduled" : "Confirmed"} — ${when}`, body, this.config.get("Training:BookerCc")?.trim() || null);
      }
      const adminBody = `<p>A website training session for <strong>${clubName}</strong> has been ${verb}:</p>
<ul>
  <li><strong>When:</strong> ${when} (${zone})</li>
  <li><strong>Booked by:</strong> ${bookerName}</li>
</ul>
${linkHtml}
<p>Any club admin may join using the link above. To change the time, use the Reschedule option in the club admin dashboard.</p>`;
      for (const admin of await conn.query(
        `SELECT DISTINCT m.MemberName AS Name, m.EmailId AS Email
         FROM member_roles mr JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
         WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
           AND m.EmailId IS NOT NULL AND m.EmailId <> ''`,
        { ClubId: clubId },
      )) await sendSafe(String(admin.Email ?? ""), `Website Training ${isReschedule ? "Rescheduled" : "Scheduled"} — ${clubName} (${when})`, adminBody);
      const teamBody = `<p>A website training appointment was ${verb}:</p>
<ul>
  <li><strong>Club:</strong> ${clubName}</li>
  <li><strong>When:</strong> ${when} (${zone})</li>
  <li><strong>Booked by:</strong> ${bookerName}</li>
</ul>
${linkHtml}`;
      for (const t of this.teamEmails) await sendSafe(t, `New Website Training ${isReschedule ? "Reschedule" : "Booking"} — ${clubName} (${when})`, teamBody);
    } catch (e) {
      this.log.warn(`Training appointment ${apptId} notification emails failed. ${(e as Error).message}`);
    }
  }

  // ── SuperAdmin: the training team's availability ─────────────────────────────────────────────
  async getAvailabilitySettings() {
    const weekly = await this.loadWeekly(this.db);
    const week = DAY_NAMES.map((dayName, d) => {
      const ranges = [...(weekly.get(d) ?? [])].sort((a, b) => a.start - b.start);
      return { dayOfWeek: d, dayName, isAvailable: ranges.length > 0, ranges: ranges.map((x) => ({ id: x.id, start: hhmm(x.start), end: hhmm(x.end) })) };
    });
    // Overrides from today on; past ones only clutter the screen.
    const today = this.today();
    const rows = await this.db.query(
      "SELECT pk_id, OverrideDate, IsUnavailableAllDay, StartTime, EndTime, Reason FROM training_date_overrides WHERE isdeleted = 0 AND OverrideDate >= @T ORDER BY OverrideDate, StartTime", { T: today });
    const booked = new Map((await this.db.query(
      "SELECT DATE(SlotStart) AS d, COUNT(*) AS n FROM website_training_appointments WHERE SlotStart >= @T AND Status <> 'Cancelled' AND isdeleted = 0 GROUP BY DATE(SlotStart)", { T: today },
    )).map((x) => [String(x.d).slice(0, 10), Number(x.n)]));
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) groups.set(String(r.OverrideDate).slice(0, 10), [...(groups.get(String(r.OverrideDate).slice(0, 10)) ?? []), r]);
    const allDay = (r: Record<string, unknown>) => r.IsUnavailableAllDay === true || Number(r.IsUnavailableAllDay) === 1;
    const overrides = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, g]) => ({
      id: Number(g[0].pk_id), date, dateLabel: formatDate(`${date}T00:00:00`, "ddd, dd MMM yyyy"), isUnavailableAllDay: g.some(allDay),
      ranges: g.filter((x) => !allDay(x) && minutesOf(x.StartTime) !== null && minutesOf(x.EndTime) !== null)
        .sort((a, b) => minutesOf(a.StartTime)! - minutesOf(b.StartTime)!)
        .map((x) => ({ id: Number(x.pk_id), start: hhmm(minutesOf(x.StartTime)!), end: hhmm(minutesOf(x.EndTime)!) })),
      reason: (g.map((x) => x.Reason).find((x) => x && String(x).trim()) as string | undefined) ?? null,
      bookedCount: booked.get(date) ?? 0,
    }));
    return { slotMinutes: this.slotMinutes, maxPerDay: this.maxPerDay, week, overrides };
  }

  /** The whole week is replaced in one go; old rows are soft-deleted. */
  async saveWeeklyHours(body: unknown, userId: number) {
    const week = bodyField(body, "week");
    await this.db.session((conn) => conn.transaction(async (tx) => {
      await tx.execute("UPDATE training_weekly_hours SET isdeleted = 1, modified_by = @U, modified_date = NOW() WHERE isdeleted = 0", { U: userId });
      for (const day of Array.isArray(week) ? week : []) {
        const dow = Math.trunc(Number(bodyField(day, "dayOfWeek")));
        const available = bodyField(day, "isAvailable") === true;
        if (!(dow >= 0 && dow <= 6) || !available) continue;
        const ranges = bodyField(day, "ranges");
        for (const r of Array.isArray(ranges) ? ranges : []) {
          const st = minutesOf(bodyField(r, "start")), en = minutesOf(bodyField(r, "end"));
          if (st === null || en === null) continue;
          if (en <= st) throw new InvalidOperationException(`${DAY_NAMES[dow]}: the end time must be after the start time.`);
          await tx.execute("INSERT INTO training_weekly_hours (DayOfWeek, StartTime, EndTime, created_by, created_date) VALUES (@D, @S, @E, @U, NOW())", { D: dow, S: `${hhmm(st)}:00`, E: `${hhmm(en)}:00`, U: userId });
        }
      }
    }));
  }

  /** One or many dates: closed all day, or the hours they ARE free. Saving a date replaces what it had. */
  async saveDateOverride(body: unknown, userId: number): Promise<number> {
    const raw: string[] = [];
    const one = bodyField(body, "date");
    if (typeof one === "string" && one.trim()) raw.push(one);
    const many = bodyField(body, "dates");
    if (Array.isArray(many)) raw.push(...many.filter((d) => typeof d === "string" && d.trim()));
    const today = this.today();
    const dates: string[] = [];
    for (const d of raw) {
      const p = parseSlot(d);
      if (!p) throw new InvalidOperationException(`"${d}" is not a valid date.`);
      const date = p.slice(0, 10);
      if (date < today) throw new InvalidOperationException(`${formatDate(`${date}T00:00:00`, "dd MMM yyyy")} has already passed.`);
      if (!dates.includes(date)) dates.push(date);
    }
    if (dates.length === 0) throw new InvalidOperationException("Pick at least one date.");
    const allDay = bodyField(body, "isUnavailableAllDay") === true;
    // Validate the hours once, before touching anything.
    const ranges: [number, number][] = [];
    if (!allDay) {
      const rs = bodyField(body, "ranges");
      for (const r of Array.isArray(rs) ? rs : []) {
        const st = minutesOf(bodyField(r, "start")), en = minutesOf(bodyField(r, "end"));
        if (st === null || en === null) continue;
        if (en <= st) throw new InvalidOperationException("The end time must be after the start time.");
        ranges.push([st, en]);
      }
      if (ranges.length === 0) throw new InvalidOperationException("Give the hours the team is free that day, or mark the day unavailable.");
    }
    const reason = bodyField(body, "reason");
    const R = reason === undefined || reason === null ? null : String(reason);
    return this.db.session((conn) => conn.transaction(async (tx) => {
      let firstId = 0;
      for (const date of dates) {
        await tx.execute("UPDATE training_date_overrides SET isdeleted = 1, modified_by = @U, modified_date = NOW() WHERE OverrideDate = @D AND isdeleted = 0", { D: date, U: userId });
        const inserts: [string, Record<string, unknown>][] = allDay
          ? [["INSERT INTO training_date_overrides (OverrideDate, IsUnavailableAllDay, Reason, created_by, created_date) VALUES (@D, 1, @R, @U, NOW()); SELECT LAST_INSERT_ID();", { D: date, R, U: userId }]]
          : ranges.map(([st, en]) => ["INSERT INTO training_date_overrides (OverrideDate, IsUnavailableAllDay, StartTime, EndTime, Reason, created_by, created_date) VALUES (@D, 0, @S, @E, @R, @U, NOW()); SELECT LAST_INSERT_ID();", { D: date, S: `${hhmm(st)}:00`, E: `${hhmm(en)}:00`, R, U: userId }]);
        for (const [sql, p] of inserts) {
          const id = Number(await tx.executeScalar(sql, p));
          if (firstId === 0) firstId = id;
        }
      }
      return firstId;
    }));
  }

  /** Removing an override puts that date back on the weekly pattern. */
  async deleteDateOverride(id: number, userId: number) {
    const date = await this.db.executeScalar("SELECT OverrideDate FROM training_date_overrides WHERE pk_id = @Id AND isdeleted = 0", { Id: id });
    if (date === null || date === undefined) return;
    await this.db.execute("UPDATE training_date_overrides SET isdeleted = 1, modified_by = @U, modified_date = NOW() WHERE OverrideDate = @D AND isdeleted = 0", { D: String(date).slice(0, 10), U: userId });
  }
}
