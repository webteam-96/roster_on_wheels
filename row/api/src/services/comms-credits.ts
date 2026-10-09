import type { DbCommands } from "../database/db.service";
import { dbDateTime } from "../common/binding";
import { InvalidOperationException } from "../common/exceptions";
import type { CreditManagementService } from "./credit-management.service";

/**
 * The CountRecipientsAsync / credit checks repeated in the announcement,
 * upcoming-event and newsletter services: members of the club (or district)
 * with a mobile (WhatsApp) or an email, in live clubs, districts and zones.
 */
export async function countCommsRecipients(conn: DbCommands, clubId: number, districtId: number | null, forEmail = false): Promise<number> {
  const contact = forEmail ? "m.EmailId IS NOT NULL AND m.EmailId <> ''" : "m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''";
  const joins = `JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id`;
  const live = `cm.IsActive = 1 AND cm.isdeleted = 0
         AND c.IsActive = 1 AND c.isdeleted = 0
         AND d.IsActive = 1 AND d.isdeleted = 0
         AND z.IsActive = 1 AND z.isdeleted = 0
         AND m.isdeleted = 0
         AND ${contact}`;
  const sql = districtId !== null
    ? `SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm ${joins} WHERE c.fk_district_id = @Id AND ${live}`
    : `SELECT COUNT(*) FROM club_members cm ${joins} WHERE cm.fk_club_id = @Id AND ${live}`;
  return Number(await conn.executeScalar(sql, { Id: districtId ?? clubId }));
}

/**
 * Throws when the club/district cannot pay for one send to every recipient
 * plus one per reminder. `shortMessage` gives the newsletter wording.
 */
export async function requireCommsCredits(
  credits: CreditManagementService, conn: DbCommands, entityId: number, clubId: number, districtId: number | null,
  type: "WhatsApp" | "Email", reminderCount: number, shortMessage = false,
): Promise<void> {
  const members = await countCommsRecipients(conn, clubId, districtId, type === "Email");
  const needed = members * (1 + reminderCount);
  if (needed <= 0 || (await credits.hasSufficientCredits(entityId, type, needed))) return;
  if (shortMessage) throw new InvalidOperationException(`Insufficient ${type} credits. Need ${needed} credit(s).`);
  const what = type === "Email" ? "'Send through Email' to save without email notification" : "'Send through WhatsApp' to save without WhatsApp notification";
  throw new InvalidOperationException(
    `Insufficient ${type} credits. Need ${needed} credit(s) for ${members} members × ${1 + reminderCount} sends. Please uncheck ${what}, or reduce reminders, or purchase more credits.`,
  );
}

/** A stored UTC "yyyy-MM-dd HH:mm:ss" value is in the future. */
export const isFutureUtc = (dbValue: string | null) => !!dbValue && new Date(dbValue.replace(" ", "T") + "Z").getTime() > Date.now();

/** List<DateTime>? reminders from a body. */
export function reminderList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((r) => dbDateTime(r)).filter((r): r is string => r !== null) : [];
}

/**
 * Which send channels need re-checking on an edit, and whether their sent
 * counters should be cleared: a channel newly switched on, or an already-sent
 * channel whose publish time moved into the future.
 */
export function resendPlan(prior: Record<string, unknown> | null, sendWhatsapp: boolean, sendEmail: boolean, publishInFuture: boolean) {
  const waSent = !!prior && prior.WhatsAppSentDate !== null && prior.WhatsAppSentDate !== undefined;
  const emailSent = !!prior && prior.EmailSentDate !== null && prior.EmailSentDate !== undefined;
  const wa = (sendWhatsapp && !(prior && Number(prior.IsSendWhatsapp)) && !waSent) || (sendWhatsapp && waSent && publishInFuture);
  const email = (sendEmail && !(prior && Number(prior.IsSendEmail)) && !emailSent) || (sendEmail && emailSent && publishInFuture);
  const clear = [
    wa ? "WhatsAppSentDate = NULL, WhatsAppSentCount = 0, WhatsAppFailedCount = 0" : "",
    email ? "EmailSentDate = NULL, EmailSentCount = 0, EmailFailedCount = 0" : "",
  ].filter(Boolean);
  return { wa, email, clear };
}
