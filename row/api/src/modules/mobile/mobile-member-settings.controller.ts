import { Body, Controller, Get, Put } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField } from "../../common/binding";
import { defineDto } from "../../common/dto";
import { badRequest, notFound, ok, unauthorized } from "../../common/results";
import { Db } from "../../database/db.service";

const flag = { type: "bool" as const, default: () => true };
export const MobileMemberSettingsDto = defineDto({
  ShowPhoneInMyClub: flag, ShowPhoneInAllClubs: flag, ShowEmailInMyClub: flag, ShowEmailInAllClubs: flag,
  NotifyUpcomingEvents: flag, NotifyAnnouncements: flag, NotifyNewsletters: flag, NotifyDocuments: flag,
});
const bit = (body: unknown, k: string) => (bodyField(body, k) === true ? 1 : 0);

/** Port of MobileMemberSettingsController.cs: the signed-in member's own privacy and notification toggles. */
@Controller("api/mobile")
@Authorize()
export class MobileMemberSettingsController {
  constructor(private readonly db: Db) {}

  private memberId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  private async load(memberId: number) {
    const row = await this.db.queryFirstOrDefault(
      `SELECT CAST(ShowPhoneInMyClub AS UNSIGNED) AS ShowPhoneInMyClub, CAST(ShowPhoneInAllClubs AS UNSIGNED) AS ShowPhoneInAllClubs,
              CAST(ShowEmailInMyClub AS UNSIGNED) AS ShowEmailInMyClub, CAST(ShowEmailInAllClubs AS UNSIGNED) AS ShowEmailInAllClubs,
              CAST(NotifyUpcomingEvents AS UNSIGNED) AS NotifyUpcomingEvents, CAST(NotifyAnnouncements AS UNSIGNED) AS NotifyAnnouncements,
              CAST(NotifyNewsletters AS UNSIGNED) AS NotifyNewsletters, CAST(NotifyDocuments AS UNSIGNED) AS NotifyDocuments
       FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0`,
      { MemberId: memberId },
    );
    return row ? ok(MobileMemberSettingsDto.map(row)) : notFound({ message: "Member profile not found." });
  }

  @Get("member-settings")
  get(@User() u: CurrentUser) {
    const memberId = this.memberId(u);
    return memberId <= 0 ? unauthorized() : this.load(memberId);
  }

  @Put("member-settings/privacy")
  async privacy(@User() u: CurrentUser, @Body() body: unknown) {
    const memberId = this.memberId(u);
    if (memberId <= 0) return unauthorized();
    if (!body || typeof body !== "object") return badRequest({ message: "Body required." });
    const rows = await this.db.execute(
      `UPDATE member_master_profile SET ShowPhoneInMyClub = @A, ShowPhoneInAllClubs = @B, ShowEmailInMyClub = @C, ShowEmailInAllClubs = @D,
           modified_by = @MemberId, modified_date = NOW()
       WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0`,
      { MemberId: memberId, A: bit(body, "showPhoneInMyClub"), B: bit(body, "showPhoneInAllClubs"), C: bit(body, "showEmailInMyClub"), D: bit(body, "showEmailInAllClubs") },
    );
    return rows === 0 ? notFound({ message: "Member profile not found." }) : this.load(memberId);
  }

  @Put("member-settings/notifications")
  async notifications(@User() u: CurrentUser, @Body() body: unknown) {
    const memberId = this.memberId(u);
    if (memberId <= 0) return unauthorized();
    if (!body || typeof body !== "object") return badRequest({ message: "Body required." });
    const rows = await this.db.execute(
      `UPDATE member_master_profile SET NotifyUpcomingEvents = @A, NotifyAnnouncements = @B, NotifyNewsletters = @C, NotifyDocuments = @D,
           modified_by = @MemberId, modified_date = NOW()
       WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0`,
      { MemberId: memberId, A: bit(body, "notifyUpcomingEvents"), B: bit(body, "notifyAnnouncements"), C: bit(body, "notifyNewsletters"), D: bit(body, "notifyDocuments") },
    );
    return rows === 0 ? notFound({ message: "Member profile not found." }) : this.load(memberId);
  }
}
