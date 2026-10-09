import { Body, Controller, Get, Injectable, Param, Put, Query } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { bodyField, queryInt } from "../../common/binding";

let tableEnsured = false;

/** ParseEmails: split on , ; whitespace; keep plausible addresses once (case-insensitive). */
export function parseCcEmails(raw: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(/[,; \n\r\t]+/)) {
    const e = part.trim();
    if (e.length < 3 || !e.includes("@") || !e.includes(".")) continue;
    if (!seen.has(e.toLowerCase())) {
      seen.add(e.toLowerCase());
      out.push(e);
    }
  }
  return out;
}

/** Port of DistrictCmrEmailSettingsService.cs: who gets the club monthly report submission email, per district and year. */
@Injectable()
export class DistrictCmrEmailSettingsService {
  constructor(private readonly db: Db) {}

  private static async ensureTable(conn: DbCommands) {
    if (tableEnsured) return;
    await conn.execute(`CREATE TABLE IF NOT EXISTS district_cmr_email_settings (
        pk_id INT PRIMARY KEY AUTO_INCREMENT,
        fk_district_id INT NOT NULL,
        fk_year_id INT NOT NULL,
        SendToDistrictGovernor TINYINT(1) NOT NULL DEFAULT 1,
        CcEmails VARCHAR(1000) NULL,
        modified_by INT NULL,
        modified_date DATETIME NULL,
        created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_district_year (fk_district_id, fk_year_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    tableEnsured = true;
  }

  async get(districtId: number, yearId: number) {
    return this.db.session(async (conn) => {
      await DistrictCmrEmailSettingsService.ensureTable(conn);
      const row = await conn.queryFirstOrDefault("SELECT SendToDistrictGovernor, CcEmails FROM district_cmr_email_settings WHERE fk_district_id = @D AND fk_year_id = @Y LIMIT 1", { D: districtId, Y: yearId });
      // Never configured: the District Governor gets it, no CC.
      return row ? { sendToDistrictGovernor: row.SendToDistrictGovernor === true || Number(row.SendToDistrictGovernor) !== 0, ccEmails: row.CcEmails ?? "" } : { sendToDistrictGovernor: true, ccEmails: "" };
    });
  }

  async save(districtId: number, yearId: number, sendToDistrictGovernor: boolean, ccEmails: string | null, by: number) {
    await this.db.session(async (conn) => {
      await DistrictCmrEmailSettingsService.ensureTable(conn);
      await conn.execute(
        `INSERT INTO district_cmr_email_settings (fk_district_id, fk_year_id, SendToDistrictGovernor, CcEmails, modified_by, modified_date)
         VALUES (@D, @Y, @Send, @Cc, @By, NOW())
         ON DUPLICATE KEY UPDATE SendToDistrictGovernor = VALUES(SendToDistrictGovernor), CcEmails = VALUES(CcEmails), modified_by = VALUES(modified_by), modified_date = NOW()`,
        { D: districtId, Y: yearId, Send: sendToDistrictGovernor ? 1 : 0, Cc: parseCcEmails(ccEmails).join(", "), By: by },
      );
    });
  }

  /** For the mailer; never throws (a settings problem must not block the submission email). */
  async resolve(conn: DbCommands, districtId: number, yearId: number): Promise<{ sendToDistrictGovernor: boolean; ccEmails: string[] }> {
    try {
      await DistrictCmrEmailSettingsService.ensureTable(conn);
      const row = await conn.queryFirstOrDefault("SELECT SendToDistrictGovernor, CcEmails FROM district_cmr_email_settings WHERE fk_district_id = @D AND fk_year_id = @Y LIMIT 1", { D: districtId, Y: yearId });
      if (!row) return { sendToDistrictGovernor: true, ccEmails: [] };
      return { sendToDistrictGovernor: row.SendToDistrictGovernor === true || Number(row.SendToDistrictGovernor) !== 0, ccEmails: parseCcEmails(row.CcEmails) };
    } catch {
      return { sendToDistrictGovernor: true, ccEmails: [] };
    }
  }
}

/** Ports of DistrictCmrEmailSettingsController.cs and MobileDistrictCmrEmailSettingsController.cs (same contract, two prefixes). */
@Controller()
@Authorize()
export class DistrictCmrEmailSettingsController {
  constructor(private readonly settings: DistrictCmrEmailSettingsService) {}

  private isDistrictAdmin = (u: CurrentUser) => {
    const roles = u.findFirst("roles") ?? "";
    return roles.includes("Admin") || roles.includes("SuperAdmin");
  };

  private async doGet(d: string, y: string | undefined, u: CurrentUser) {
    if (!/^-?\d+$/.test(d)) return notFound();
    const [districtId, yearId] = [Number(d), queryInt(y, 0)];
    if (!this.isDistrictAdmin(u)) return forbid();
    if (districtId <= 0 || yearId <= 0) return badRequest({ message: "districtId and yearId are required." });
    return ok(await this.settings.get(districtId, yearId));
  }

  private async doSave(d: string, y: string | undefined, body: unknown, u: CurrentUser) {
    if (!/^-?\d+$/.test(d)) return notFound();
    const [districtId, yearId] = [Number(d), queryInt(y, 0)];
    if (!this.isDistrictAdmin(u)) return forbid();
    if (districtId <= 0 || yearId <= 0) return badRequest({ message: "districtId and yearId are required." });
    const send = bodyField(body, "sendToDistrictGovernor");
    const cc = bodyField(body, "ccEmails");
    await this.settings.save(districtId, yearId, send === undefined ? true : send === true, cc === null || cc === undefined ? null : String(cc), parseInt(u.findFirst("memberId") ?? "0", 10) || 0);
    return ok({ message: "Saved." });
  }

  @Get("api/districts/:districtId/cmr-email-settings")
  get(@Param("districtId") d: string, @User() u: CurrentUser, @Query("yearId") y?: string) {
    return this.doGet(d, y, u);
  }

  @Put("api/districts/:districtId/cmr-email-settings")
  save(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser, @Query("yearId") y?: string) {
    return this.doSave(d, y, body, u);
  }

  @Get("api/mobile/districts/:districtId/cmr-email-settings")
  mobileGet(@Param("districtId") d: string, @User() u: CurrentUser, @Query("yearId") y?: string) {
    return this.doGet(d, y, u);
  }

  @Put("api/mobile/districts/:districtId/cmr-email-settings")
  mobileSave(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser, @Query("yearId") y?: string) {
    return this.doSave(d, y, body, u);
  }
}
