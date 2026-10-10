import { Body, Controller, Post } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField } from "../../common/binding";
import { badRequest, ok, unauthorized } from "../../common/results";
import { Db } from "../../database/db.service";

const str = (body: unknown, k: string) => { const v = bodyField(body, k); return v === null || v === undefined ? null : String(v); };

/** Port of MobileFcmController.cs: the app registers / unregisters its push token. */
@Controller("api/mobile/fcm")
@Authorize()
export class MobileFcmController {
  constructor(private readonly db: Db) {}

  private memberId = (u: CurrentUser) => {
    const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "";
    return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0;
  };

  @Post("register")
  async register(@User() u: CurrentUser, @Body() body: unknown) {
    const memberId = this.memberId(u);
    if (memberId <= 0) return unauthorized();
    // Blank or "0" tokens never enter the table.
    const token = (str(body, "fcmToken") ?? "").trim();
    if (!token || token === "0") return badRequest({ message: "fcmToken is required and must not be empty or '0'." });
    const [deviceType, deviceId] = [str(body, "deviceType"), str(body, "deviceId")];
    const existing = await this.db.executeScalar("SELECT pk_id FROM member_fcm_tokens WHERE FcmToken = @T LIMIT 1", { T: token });
    if (existing !== null && existing !== undefined) {
      await this.db.execute(
        `UPDATE member_fcm_tokens SET fk_member_master_profile_id = @Mid, DeviceType = @Dt, DeviceId = @Did, IsActive = 1, isdeleted = 0, last_used_date = NOW()
         WHERE pk_id = @Id`,
        { Id: existing, Mid: memberId, Dt: deviceType, Did: deviceId },
      );
    } else {
      await this.db.execute(
        `INSERT INTO member_fcm_tokens (fk_member_master_profile_id, FcmToken, DeviceType, DeviceId, IsActive, isdeleted, created_date, last_used_date)
         VALUES (@Mid, @Tok, @Dt, @Did, 1, 0, NOW(), NOW())`,
        { Mid: memberId, Tok: token, Dt: deviceType, Did: deviceId },
      );
    }
    // A reinstall gives the same device a new token: retire the device's older tokens.
    if (deviceId && deviceId.trim())
      await this.db.execute("UPDATE member_fcm_tokens SET IsActive = 0, last_used_date = NOW() WHERE DeviceId = @Did AND FcmToken <> @Tok AND IsActive = 1", { Did: deviceId, Tok: token });
    return ok({ success: true });
  }

  @Post("unregister")
  async unregister(@User() u: CurrentUser, @Body() body: unknown) {
    const memberId = this.memberId(u);
    if (memberId <= 0) return unauthorized();
    const token = str(body, "fcmToken");
    if (!token || !token.trim()) return badRequest({ message: "fcmToken is required." });
    await this.db.execute("UPDATE member_fcm_tokens SET IsActive = 0, last_used_date = NOW() WHERE FcmToken = @T AND fk_member_master_profile_id = @Mid", { T: token, Mid: memberId });
    return ok({ success: true });
  }
}
