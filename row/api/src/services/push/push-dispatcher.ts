import type { DbCommands } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import type { FirebasePushService } from "./firebase-push.service";

/**
 * Port of PushDispatcher.cs: the helpers shared by the content push workers.
 * Recipients are the active members of a club (club scope) or of every club in a
 * district (district scope) with a device token and a live club → district → zone
 * chain. RI-scope items are skipped by the callers.
 */

const CHAIN = `JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
    JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
    JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1`;

/** Token → member for a club- or district-scoped item (districtId set = district scope). `extraWhere` narrows the members. */
export async function resolveClubDistrictTokens(conn: DbCommands, clubId: number, districtId: number | null, extraWhere = ""): Promise<Map<string, number>> {
  const join = districtId !== null
    ? `JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
    ${CHAIN.replace("c.pk_club_id = cm.fk_club_id AND", "c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @DistrictId AND")}`
    : `JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
    ${CHAIN}`;
  const rows = await conn.query(
    `SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.LastDeviceToken AS fcmToken
    FROM member_master_profile m
    ${join}
    WHERE m.isdeleted = 0 AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'${extraWhere}`,
    { ClubId: clubId, DistrictId: districtId },
  );
  const tokenToMember = new Map<string, number>();
  for (const r of rows) {
    const token = r.fcmToken as string | null;
    if (token && token.trim() && !tokenToMember.has(token)) tokenToMember.set(token, Number(r.memberId));
  }
  return tokenToMember;
}

/** The notification's source: the club name, or "District <number>". */
export async function resolveSourceName(conn: DbCommands, clubId: number, districtId: number | null): Promise<string> {
  try {
    if (districtId !== null) {
      const num = await conn.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId });
      return `District ${num ?? "-"}`;
    }
    const name = await conn.executeScalar<string>("SELECT ClubName FROM club_master WHERE pk_club_id = @Id", { Id: clubId });
    return name && name.trim() ? name : "Rotary Club";
  } catch {
    return Brand.Current.productName;
  }
}

export const sourceTitle = (typeLabel: string, sourceName: string) => `New ${typeLabel} · ${sourceName}`;
export const reminderTitle = (sourceName: string) => `Reminder · ${sourceName}`;
export const trimText = (s: string | null | undefined, max: number) => (!s ? "" : s.length <= max ? s : s.slice(0, max) + "…");

/**
 * Sends to every token, logs each result in `logTable` and clears the tokens
 * Firebase reports invalid. `fkCols` are the log table's foreign-key column(s)
 * and value(s) (code constants).
 */
export async function sendLogCleanup(
  conn: DbCommands, push: FirebasePushService, tokenToMember: Map<string, number>,
  title: string, body: string, data: Record<string, string>, logTable: string, fkCols: [string, number][],
): Promise<{ sent: number; failed: number }> {
  if (tokenToMember.size === 0) return { sent: 0, failed: 0 };
  const results = await push.sendMulticast(tokenToMember.keys(), title, body, data);
  const insertSql = `INSERT INTO ${logTable}
      (${fkCols.map(([c]) => c).join(", ")}, fk_member_master_profile_id, FcmToken, Status, FirebaseMessageId, ErrorMessage, SentAt, created_date)
      VALUES (${fkCols.map((_, i) => `@fk${i}`).join(", ")}, @Mid, @Tok, @Status, @MsgId, @Err, IF(@Ok, NOW(), NULL), NOW())`;
  for (const r of results) {
    const params: Record<string, unknown> = {
      Mid: tokenToMember.get(r.token) ?? 0,
      Tok: r.token.length > 500 ? r.token.slice(0, 500) : r.token,
      Status: r.success ? "Sent" : "Failed",
      MsgId: r.firebaseMessageId,
      Err: !r.errorMessage ? null : r.errorMessage.length > 1000 ? r.errorMessage.slice(0, 1000) : r.errorMessage,
      Ok: r.success ? 1 : 0,
    };
    fkCols.forEach(([, v], i) => (params[`fk${i}`] = v));
    await conn.execute(insertSql, params);
    if (r.isTokenInvalid) await conn.execute("UPDATE member_master_profile SET LastDeviceToken = NULL WHERE LastDeviceToken = @T", { T: r.token });
  }
  return { sent: results.filter((x) => x.success).length, failed: results.filter((x) => !x.success).length };
}
