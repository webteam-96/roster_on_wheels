import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { defineDto } from "../../common/dto";
import { bodyField } from "../../common/binding";
import { InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { EmailService } from "../../services/email.service";
import { CreditManagementService } from "../../services/credit-management.service";

const str = { type: "string" as const, default: () => "" };

/** DTOs/ClubMassEmailDtos.cs */
export const MassEmailListDto = defineDto({
  Id: "int", Subject: str, Status: str, RecipientType: "int", TotalRecipients: "int", SentCount: "int", FailedCount: "int", SentDate: "datetime?",
  CreatedDate: "datetime",
});
export const MassEmailRecipientDto = defineDto({
  MemberId: "int", MemberName: str, Email: str, Status: { type: "string", default: () => "Pending" }, SentDate: "datetime?", ErrorMessage: "string",
});
export const MassEmailDetailDto = defineDto({
  Id: "int", FkClubId: "int", RecipientType: "int", FkSubgroupId: "int?", SubgroupName: "string", FromName: str, ReplyName: "string",
  ReplyEmail: "string", Subject: str, EmailBody: "string", Status: str, TotalRecipients: "int", SentCount: "int", FailedCount: "int",
  SentDate: "datetime?", CreatedDate: "datetime", Recipients: { type: "object", default: () => [] },
});
export const RecipientCountDto = defineDto({ TotalMembers: "int", MembersWithEmail: "int" });

/** CreateMassEmailDto. RecipientType: club 1=All, 2=Subgroup, 3=Manual; district 1=All, 2=Clubs, 3=Subgroups. */
export interface CreateMassEmail {
  recipientType: number;
  fkSubgroupId: number | null;
  subgroupIds: number[] | null;
  clubIds: number[] | null;
  memberIds: number[] | null;
  fromName: string;
  replyName: string | null;
  replyEmail: string | null;
  subject: string;
  emailBody: string | null;
  saveAsDraft: boolean;
}

/** Binds the JSON body like System.Text.Json: a missing list stays null (not empty). */
export function bindCreateMassEmail(body: unknown): CreateMassEmail {
  const list = (name: string) => {
    const v = bodyField(body, name);
    return Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))) : null;
  };
  const text = (name: string) => {
    const v = bodyField(body, name);
    return v === null || v === undefined ? null : String(v);
  };
  const rt = bodyField(body, "recipientType");
  const sg = bodyField(body, "fkSubgroupId");
  return {
    recipientType: rt === undefined || rt === null ? 1 : Math.trunc(Number(rt)),
    fkSubgroupId: sg === undefined || sg === null ? null : Math.trunc(Number(sg)),
    subgroupIds: list("subgroupIds"),
    clubIds: list("clubIds"),
    memberIds: list("memberIds"),
    fromName: text("fromName") ?? "",
    replyName: text("replyName"),
    replyEmail: text("replyEmail"),
    subject: text("subject") ?? "",
    emailBody: text("emailBody"),
    saveAsDraft: bodyField(body, "saveAsDraft") === true,
  };
}

/** "1,2,3" query lists: int.Parse throws on junk, which the C# surfaces as a 500. */
export function parseIdList(value: string | undefined): number[] | null {
  if (!value) return null;
  return value
    .split(",")
    .filter((s) => s !== "")
    .map((s) => {
      if (!/^\s*[+-]?\d+\s*$/.test(s)) throw new Error(`The input string '${s}' was not in a correct format.`);
      return parseInt(s, 10);
    });
}

const ACTIVE_CHAIN = `
  INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
  INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
  INNER JOIN district_master d ON d.pk_district_id = c.fk_district_id
  INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id`;
const ACTIVE_WHERE = `
  AND cm.IsActive = 1 AND cm.isdeleted = 0
  AND c.IsActive = 1 AND c.isdeleted = 0
  AND d.IsActive = 1 AND d.isdeleted = 0
  AND z.IsActive = 1 AND z.isdeleted = 0
  AND m.isdeleted = 0`;
const COUNT_SELECT = `SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS TotalMembers,
  COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId != '' THEN LOWER(TRIM(m.EmailId)) END) AS MembersWithEmail
  FROM member_master_profile m`;

/** Port of ClubMassEmailService.cs (club and district mass emails). */
@Injectable()
export class MassEmailService {
  private readonly log = new Logger("ClubMassEmailService");

  constructor(
    private readonly db: Db,
    private readonly email: EmailService,
    private readonly credits: CreditManagementService,
  ) {}

  async getList(clubId: number, status: string | null, search: string | null, page: number, pageSize: number, districtId: number | null = null) {
    const conditions = [districtId !== null ? "me.fk_district_id = @OwnerId" : "me.fk_club_id = @OwnerId", "me.isdeleted = 0"];
    if (status) conditions.push("me.Status = @Status");
    if (search) conditions.push("me.Subject LIKE CONCAT('%', @Search, '%')");
    const where = conditions.join(" AND ");
    const params = { OwnerId: districtId ?? clubId, Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize };
    return this.db.session(async (conn) => {
      const items = await conn.query(
        `SELECT me.pk_mass_email_id AS Id, me.Subject, me.Status, me.RecipientType, me.TotalRecipients, me.SentCount, me.FailedCount, me.SentDate,
                me.created_date AS CreatedDate
         FROM club_mass_emails me WHERE ${where}
         ORDER BY me.created_date DESC
         LIMIT @PageSize OFFSET @Offset`,
        params,
      );
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM club_mass_emails me WHERE ${where}`, params));
      return { items: MassEmailListDto.mapAll(items), totalCount };
    });
  }

  private static recipients(conn: DbCommands, id: number) {
    return conn.query(
      `SELECT r.fk_member_id AS MemberId, r.MemberName, r.Email, r.Status, r.SentDate, r.ErrorMessage
       FROM club_mass_email_recipients r
       WHERE r.fk_mass_email_id = @Id AND r.isdeleted = 0
       ORDER BY r.MemberName`,
      { Id: id },
    );
  }

  async getDetail(id: number) {
    return this.db.session(async (conn) => {
      const detail = await conn.queryFirstOrDefault(
        `SELECT me.pk_mass_email_id AS Id, me.fk_club_id AS FkClubId, me.RecipientType, me.fk_subgroup_id AS FkSubgroupId, sg.GroupName AS SubgroupName,
                me.FromName, me.ReplyName, me.ReplyEmail, me.Subject, me.EmailBody, me.Status, me.TotalRecipients, me.SentCount, me.FailedCount,
                me.SentDate, me.created_date AS CreatedDate
         FROM club_mass_emails me
         LEFT JOIN sub_groups sg ON sg.pk_sub_group_id = me.fk_subgroup_id
         WHERE me.pk_mass_email_id = @Id AND me.isdeleted = 0`,
        { Id: id },
      );
      if (!detail) return null;
      detail.Recipients = MassEmailRecipientDto.mapAll(await MassEmailService.recipients(conn, id));
      return MassEmailDetailDto.map(detail);
    });
  }

  private static subgroupIds(dto: CreateMassEmail) {
    return dto.subgroupIds ?? (dto.fkSubgroupId !== null ? [dto.fkSubgroupId] : null);
  }

  async create(clubId: number, dto: CreateMassEmail, userId: number, districtId: number | null = null): Promise<number> {
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_mass_emails (fk_club_id, fk_district_id, RecipientType, fk_subgroup_id, FromName, ReplyName, ReplyEmail, Subject, EmailBody,
                                       Status, TotalRecipients, created_by, created_date, isdeleted)
         VALUES (@ClubId, @DistrictId, @RecipientType, @SubgroupId, @FromName, @ReplyName, @ReplyEmail, @Subject, @EmailBody, 'Draft', 0,
                 @UserId, NOW(), 0)`,
        {
          ClubId: districtId !== null ? 0 : clubId, DistrictId: districtId, RecipientType: dto.recipientType,
          SubgroupId: dto.subgroupIds?.length ? dto.subgroupIds[0] : dto.fkSubgroupId, FromName: dto.fromName, ReplyName: dto.replyName,
          ReplyEmail: dto.replyEmail, Subject: dto.subject, EmailBody: dto.emailBody, UserId: userId,
        },
      );
      const id = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      await MassEmailService.addRecipients(conn, id, clubId, dto.recipientType, MassEmailService.subgroupIds(dto), dto.memberIds, districtId, dto.clubIds);
      return id;
    });
  }

  async update(id: number, dto: CreateMassEmail, userId: number) {
    await this.db.session(async (conn) => {
      await conn.execute(
        `UPDATE club_mass_emails SET RecipientType = @RecipientType, fk_subgroup_id = @SubgroupId, FromName = @FromName, ReplyName = @ReplyName,
                ReplyEmail = @ReplyEmail, Subject = @Subject, EmailBody = @EmailBody, Status = 'Draft', SentCount = 0, FailedCount = 0, SentDate = NULL,
                modified_by = @UserId, modified_date = NOW()
         WHERE pk_mass_email_id = @Id AND isdeleted = 0`,
        {
          RecipientType: dto.recipientType, SubgroupId: dto.subgroupIds?.length ? dto.subgroupIds[0] : dto.fkSubgroupId, FromName: dto.fromName,
          ReplyName: dto.replyName, ReplyEmail: dto.replyEmail, Subject: dto.subject, EmailBody: dto.emailBody, UserId: userId, Id: id,
        },
      );
      await conn.execute("UPDATE club_mass_email_recipients SET isdeleted = 1 WHERE fk_mass_email_id = @Id", { Id: id });
      const clubId = Number((await conn.executeScalar("SELECT fk_club_id FROM club_mass_emails WHERE pk_mass_email_id = @Id", { Id: id })) ?? 0);
      // As in RIZones the district id is not passed here, so a district "All members" email edits to the club-0 member list.
      await MassEmailService.addRecipients(conn, id, clubId, dto.recipientType, MassEmailService.subgroupIds(dto), dto.memberIds, null, dto.clubIds);
    });
  }

  async delete(id: number, userId: number) {
    await this.db.session(async (conn) => {
      const status = await conn.executeScalar<string>("SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = @Id AND isdeleted = 0", { Id: id });
      if (status !== "Draft") throw new InvalidOperationException("Only draft emails can be deleted.");
      await conn.execute("UPDATE club_mass_emails SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_mass_email_id = @Id", { Id: id, UserId: userId });
      await conn.execute("UPDATE club_mass_email_recipients SET isdeleted = 1 WHERE fk_mass_email_id = @Id", { Id: id });
    });
  }

  async send(id: number, userId: number) {
    const { email, recipients } = await this.db.session(async (conn) => {
      const email = await conn.queryFirstOrDefault(
        `SELECT pk_mass_email_id AS Id, fk_club_id AS ClubId, FromName, ReplyName, ReplyEmail, Subject, EmailBody, Status
         FROM club_mass_emails WHERE pk_mass_email_id = @Id AND isdeleted = 0`,
        { Id: id },
      );
      if (!email) throw new KeyNotFoundException("Mass email not found.");
      if (email.Status !== "Draft" && email.Status !== "Failed") throw new InvalidOperationException("Only draft or failed emails can be sent.");
      const recipients = await conn.query(
        `SELECT pk_id AS Id, fk_member_id AS MemberId, MemberName, Email
         FROM club_mass_email_recipients
         WHERE fk_mass_email_id = @Id AND isdeleted = 0 AND Email IS NOT NULL AND Email != '' AND (Status = 'Pending' OR Status = 'Failed')`,
        { Id: id },
      );
      if (!recipients.length) throw new InvalidOperationException("No recipients with valid email addresses.");
      return { email, recipients };
    });
    const clubId = Number(email.ClubId);
    if (!(await this.credits.hasSufficientCredits(clubId, "Email", recipients.length))) {
      throw new InvalidOperationException(`Insufficient email credits. Need ${recipients.length}, check your credit balance.`);
    }
    await this.credits.deductWithHistory(clubId, "Email", recipients.length, "MassEmail", id, `Mass Email: ${email.Subject}`, userId);
    await this.db.execute(
      "UPDATE club_mass_emails SET Status = 'Sending', TotalRecipients = @Total, modified_by = @UserId, modified_date = NOW() WHERE pk_mass_email_id = @Id",
      { Total: recipients.length, UserId: userId, Id: id },
    );
    void this.deliver(id, email, recipients);
  }

  /** The Task.Run body: send one by one, record each outcome, then the totals. */
  private async deliver(id: number, email: Row, recipients: Row[]) {
    try {
      let sent = 0;
      let failed = 0;
      for (const r of recipients) {
        try {
          await this.email.sendMassEmail(String(r.Email), String(email.Subject), email.EmailBody ?? "", email.FromName, email.ReplyName, email.ReplyEmail);
          await this.db.execute("UPDATE club_mass_email_recipients SET Status = 'Sent', SentDate = NOW() WHERE pk_id = @Id", { Id: r.Id });
          sent++;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await this.db.execute("UPDATE club_mass_email_recipients SET Status = 'Failed', ErrorMessage = @Error WHERE pk_id = @Id", { Error: message.slice(0, 500), Id: r.Id });
          failed++;
        }
      }
      await this.db.execute(
        "UPDATE club_mass_emails SET Status = @Status, SentCount = @Sent, FailedCount = @Failed, SentDate = NOW(), modified_date = NOW() WHERE pk_mass_email_id = @Id",
        { Status: failed === recipients.length ? "Failed" : "Sent", Sent: sent, Failed: failed, Id: id },
      );
    } catch (e) {
      this.log.error(`Error sending mass email ${id}: ${e instanceof Error ? e.message : e}`);
      await this.db.execute("UPDATE club_mass_emails SET Status = 'Failed', modified_date = NOW() WHERE pk_mass_email_id = @Id", { Id: id }).catch(() => undefined);
    }
  }

  async getRecipients(id: number) {
    return MassEmailRecipientDto.mapAll(await MassEmailService.recipients(this.db, id));
  }

  async getRecipientCount(clubId: number, recipientType: number, subgroupIds: number[] | null, memberIds: number[] | null, districtId: number | null = null, clubIds: number[] | null = null) {
    let sql: string;
    let params: Record<string, unknown>;
    if (recipientType === 1) {
      sql = districtId !== null
        ? `${COUNT_SELECT} ${ACTIVE_CHAIN} WHERE c.fk_district_id = @DistrictId ${ACTIVE_WHERE}`
        : `${COUNT_SELECT} ${ACTIVE_CHAIN} WHERE cm.fk_club_id = @ClubId ${ACTIVE_WHERE}`;
      params = { DistrictId: districtId, ClubId: clubId };
    } else if (recipientType === 2 && clubIds?.length) {
      sql = `${COUNT_SELECT} ${ACTIVE_CHAIN} WHERE cm.fk_club_id IN @ClubIds ${ACTIVE_WHERE}`;
      params = { ClubIds: clubIds };
    } else if ((recipientType === 2 || recipientType === 3) && subgroupIds?.length) {
      sql = `${COUNT_SELECT}
             INNER JOIN sub_group_members sgm ON sgm.fk_member_master_profile_id = m.pk_member_master_profile_id
             WHERE sgm.fk_sub_group_id IN @SubgroupIds AND sgm.isdeleted = 0 AND m.isdeleted = 0`;
      params = { SubgroupIds: subgroupIds };
    } else if (recipientType === 3 && memberIds?.length) {
      sql = `SELECT COUNT(*) AS TotalMembers,
                    COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId != '' THEN LOWER(TRIM(m.EmailId)) END) AS MembersWithEmail
             FROM member_master_profile m
             WHERE m.pk_member_master_profile_id IN @MemberIds AND m.isdeleted = 0`;
      params = { MemberIds: memberIds };
    } else {
      return RecipientCountDto.create({});
    }
    return RecipientCountDto.map((await this.db.queryFirstOrDefault(sql, params)) ?? {});
  }

  private static async addRecipients(
    conn: DbCommands, emailId: number, clubId: number, recipientType: number, subgroupIds: number[] | null, memberIds: number[] | null,
    districtId: number | null, clubIds: number[] | null,
  ) {
    const pick = "m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email";
    let members: Row[];
    if (recipientType === 1) {
      members = districtId !== null
        ? await conn.query(`SELECT DISTINCT ${pick} FROM member_master_profile m ${ACTIVE_CHAIN} WHERE c.fk_district_id = @DistrictId ${ACTIVE_WHERE}`, { DistrictId: districtId })
        : await conn.query(`SELECT ${pick} FROM member_master_profile m ${ACTIVE_CHAIN} WHERE cm.fk_club_id = @ClubId ${ACTIVE_WHERE}`, { ClubId: clubId });
    } else if (recipientType === 2 && clubIds?.length) {
      members = await conn.query(`SELECT DISTINCT ${pick} FROM member_master_profile m ${ACTIVE_CHAIN} WHERE cm.fk_club_id IN @ClubIds ${ACTIVE_WHERE}`, { ClubIds: clubIds });
    } else if ((recipientType === 2 || recipientType === 3) && subgroupIds?.length) {
      members = await conn.query(
        `SELECT DISTINCT ${pick} FROM member_master_profile m
         INNER JOIN sub_group_members sgm ON sgm.fk_member_master_profile_id = m.pk_member_master_profile_id
         WHERE sgm.fk_sub_group_id IN @SubgroupIds AND sgm.isdeleted = 0 AND m.isdeleted = 0`,
        { SubgroupIds: subgroupIds },
      );
    } else if (recipientType === 3 && memberIds?.length) {
      members = await conn.query(`SELECT ${pick} FROM member_master_profile m WHERE m.pk_member_master_profile_id IN @MemberIds AND m.isdeleted = 0`, { MemberIds: memberIds });
    } else {
      return;
    }
    const seen = new Set<string>();
    let inserted = 0;
    for (const m of members) {
      const address = typeof m.Email === "string" ? m.Email.trim() : "";
      if (!address || seen.has(address.toLowerCase())) continue;
      seen.add(address.toLowerCase());
      await conn.execute(
        `INSERT INTO club_mass_email_recipients (fk_mass_email_id, fk_member_id, MemberName, Email, Status, isdeleted)
         VALUES (@EmailId, @MemberId, @MemberName, @Email, 'Pending', 0)`,
        { EmailId: emailId, MemberId: m.MemberId, MemberName: m.MemberName, Email: address },
      );
      inserted++;
    }
    await conn.execute("UPDATE club_mass_emails SET TotalRecipients = @Total WHERE pk_mass_email_id = @Id", { Total: inserted, Id: emailId });
  }
}
