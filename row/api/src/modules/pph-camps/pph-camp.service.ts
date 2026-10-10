import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { defineDto } from "../../common/dto";
import { bodyField } from "../../common/binding";
import { formatDate, dotnetRound } from "../../common/dotnet-format";
import { FormatException, InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { ValidationProblemResult } from "../../common/results";
import { webRootPath, type UploadedFile } from "../../services/media-storage";
import { CitationRecalcTrigger } from "../../services/citation-recalc.trigger";
import { tryParseDate } from "../../services/project-date.validator";

const str = { type: "string" as const, default: () => "" };

/** DTOs/PphCampDtos.cs */
export const PphCampListDto = defineDto({
  Id: "int", Title: str, Description: "string", Address: "string", CampDate: "datetime", CampLogoPath: "string", IsActive: "bool", AttendanceCount: "int",
});
export const PphMedicalReadingDto = defineDto({
  Id: "int", AttendeeId: "int", CampId: "int", RegistrationNo: "string", ReadingDate: "datetime", Age: "int?", BPSystolic: "int?", BPDiastolic: "int?",
  BloodSugarType: "string", BloodSugarValue: "decimal?", HeightCm: "decimal?", WeightKg: "decimal?", BMI: "decimal?", DiabetesStatus: "string", BPStatus: "string",
  IsOverweight: "bool", IsObese: "bool", Remarks: "string",
});
export const PphAttendeeDto = defineDto({
  Id: "int", CampId: "int", Name: str, MobileNo: str, Sex: "string", Address: "string", IsConsentedForMessages: "bool", ReadingCount: "int", LatestReading: "object",
});
export const PphAttendeeReportRowDto = defineDto({
  DistrictNumber: "string", ClubName: str, CampId: "int", CampTitle: str, CampDate: "datetime", YearLabel: str, AttendeeName: str, MobileNo: str, Sex: "string",
  Address: "string", ReadingCount: "int", LatestReadingDate: "datetime?",
});

export interface CampForm {
  title: string;
  description: string | null;
  address: string | null;
  campDate: string;
  isActive: boolean;
}

/** [FromForm] Create/UpdatePphCampDto. */
export function bindCampForm(body: unknown): CampForm {
  const s = (n: string) => {
    const v = bodyField(body, n);
    return v === undefined || v === null ? null : String(v);
  };
  return { title: s("title") ?? "", description: s("description"), address: s("address"), campDate: s("campDate") ?? "", isActive: String(bodyField(body, "isActive") ?? "").toLowerCase() === "true" };
}

/** DateTime.Parse: a FormatException (500, or 400 where the caller catches everything) when the text is not a date. */
export function parseCampDate(text: string): string {
  const parsed = tryParseDate(text);
  if (!parsed) throw new FormatException(`String '${text}' was not recognized as a valid DateTime.`);
  return parsed;
}
const asDotnet = (mysql: string) => mysql.replace(" ", "T");

export const CAMP_IMAGE_TYPES = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg"];

/** Logo checks shared by the club and district camp endpoints; null when fine. */
export function checkCampLogo(logo: UploadedFile | undefined): string | null {
  if (!logo) return null;
  if (logo.size > 5 * 1024 * 1024) return "Logo file size must be less than 5MB.";
  if (!CAMP_IMAGE_TYPES.includes(extname(logo.originalname).toLowerCase())) return "Only image files are allowed for camp logo.";
  return null;
}

/** Validation attributes of CreatePphReadingDto / UpdatePphAttendeeDto / UpdatePphReadingDto ([ApiController] 400). */
export function validateReading(body: unknown, part: "create" | "attendee" | "reading"): ValidationProblemResult | null {
  const errors: Record<string, string[]> = {};
  const s = (n: string) => String(bodyField(body, n) ?? "");
  const n = (k: string) => Number(bodyField(body, k) ?? 0) || 0;
  if (part !== "reading") {
    // [Required] fails empty and whitespace-only strings and then skips [StringLength].
    if (!s("name").trim()) errors.Name = ["Name is required."];
    else if (s("name").length > 200) errors.Name = ["Name must be 200 characters or less."];
    if (!s("mobileNo").trim()) errors.MobileNo = ["Mobile number is required."];
    else if (s("mobileNo").length > 20) errors.MobileNo = ["Mobile number must be 20 characters or less."];
    if (!s("sex").trim()) errors.Sex = ["Sex is required."];
    if (!s("address").trim()) errors.Address = ["Address is required."];
  }
  if (part !== "attendee") {
    const range = (key: string, min: number, max: number, message: string) => {
      const v = n(key);
      if (v < min || v > max) errors[key.charAt(0).toUpperCase() + key.slice(1)] = [message];
    };
    range("age", 1, 150, "Age is required and must be between 1 and 150.");
    if (n("bPSystolic") < 1 || n("bPSystolic") > 400) errors.BPSystolic = ["Systolic blood pressure is required."];
    if (n("bPDiastolic") < 1 || n("bPDiastolic") > 300) errors.BPDiastolic = ["Diastolic blood pressure is required."];
    if (!s("bloodSugarType").trim()) errors.BloodSugarType = ["Blood sugar type is required."];
    range("bloodSugarValue", 1, 2000, "Blood sugar value is required.");
    range("heightCm", 1, 300, "Height (cm) is required.");
    range("weightKg", 1, 500, "Weight (kg) is required.");
  }
  return Object.keys(errors).length ? new ValidationProblemResult(errors) : null;
}

const MEDICAL_SELECT = `SELECT pk_attendance_id AS Id, fk_attendee_id AS AttendeeId, fk_camp_id AS CampId, RegistrationNo, created_date AS ReadingDate, Age,
         BPSystolic, BPDiastolic, BloodSugarType, BloodSugarValue, HeightCm, WeightKg, BMI, DiabetesStatus, BPStatus, IsOverweight, IsObese, Remarks
  FROM pph_camp_attendance`;

/** CalcBmi: BMI to 2 places, overweight 25-30, obese 30+. */
function calcBmi(heightCm: number | null, weightKg: number | null): [number | null, boolean, boolean] {
  if (heightCm && heightCm > 0 && weightKg && weightKg > 0) {
    const m = heightCm / 100;
    const bmi = dotnetRound(weightKg / (m * m), 2);
    return [bmi, bmi >= 25 && bmi < 30, bmi >= 30];
  }
  return [null, false, false];
}

/** RotaryYearLabel: July-June. */
function rotaryYearLabel(dateText: string): string {
  const [y, m] = dateText.slice(0, 7).split("-").map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const LOGO_PATH_SQL = (a: string) => `CASE
    WHEN ${a}CampLogoPath IS NULL OR ${a}CampLogoPath = '' THEN NULL
    WHEN ${a}CampLogoPath LIKE '/%' THEN ${a}CampLogoPath
    WHEN ${a}fk_district_id IS NOT NULL THEN CONCAT('/Documents/Campmaster/District', ${a}fk_district_id, '/', ${a}CampLogoPath)
    ELSE CONCAT('/Documents/Campmaster/Group', ${a}fk_club_id, '/', ${a}CampLogoPath)
  END`;

/**
 * Port of PphCampService.cs: health check-up camps (club or district), their
 * attendees and each attendee's readings (BP, blood sugar, BMI).
 */
@Injectable()
export class PphCampService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly citation: CitationRecalcTrigger,
  ) {}

  /** SaveLogoAsync: Documents/Campmaster/<folder>/<guid>_<ddMMyyyyhhmmsstt><ext>; returns the file name. */
  async saveLogo(folder: string, file: UploadedFile): Promise<string> {
    const dir = join(webRootPath(this.config), "Documents", "Campmaster", folder);
    await mkdir(dir, { recursive: true });
    const stamp = formatDate(new Date().toISOString().slice(0, 19), "ddMMyyyyhhmmsstt");
    const name = `${randomUUID().replace(/-/g, "")}_${stamp}${extname(file.originalname)}`;
    await writeFile(join(dir, name), file.buffer);
    return name;
  }

  async deleteWebFile(relative: string | null) {
    if (!relative) return;
    await unlink(join(webRootPath(this.config), ...relative.replace(/^\/+/, "").split("/"))).catch(() => undefined);
  }

  async getCamps(clubId: number) {
    return PphCampListDto.mapAll(
      await this.db.query(
        `SELECT c.pk_camp_id AS Id, c.Title, c.Description, c.Address, c.CampDate, ${LOGO_PATH_SQL("c.")} AS CampLogoPath, c.IsActive,
                COUNT(a.pk_attendance_id) AS AttendanceCount
         FROM pph_camps c
         LEFT JOIN pph_camp_attendance a ON a.fk_camp_id = c.pk_camp_id AND COALESCE(a.isdeleted, 0) = 0
         WHERE c.fk_club_id = @ClubId AND COALESCE(c.isdeleted, 0) = 0
         GROUP BY c.pk_camp_id, c.Title, c.Description, c.Address, c.CampDate, c.CampLogoPath, c.fk_club_id, c.fk_district_id, c.IsActive
         ORDER BY c.CampDate DESC, c.pk_camp_id DESC`,
        { ClubId: clubId },
      ),
    );
  }

  async createCamp(clubId: number, dto: CampForm, logo: UploadedFile | undefined, userId: number) {
    const campDate = parseCampDate(dto.campDate);
    const logoPath = logo ? await this.saveLogo(`Group${clubId}`, logo) : null;
    const id = await this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO pph_camps (fk_club_id, Title, Description, Address, CampDate, CampLogoPath, IsActive, created_by, created_date, isdeleted)
         VALUES (@ClubId, @Title, @Description, @Address, @CampDate, @CampLogoPath, 1, @CreatedBy, NOW(), 0)`,
        { ClubId: clubId, Title: dto.title, Description: dto.description, Address: dto.address, CampDate: campDate, CampLogoPath: logoPath, CreatedBy: userId },
      );
      return Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
    });
    this.citation.triggerForClub(clubId);
    return {
      id, title: dto.title, description: dto.description, address: dto.address, campDate: asDotnet(campDate),
      campLogoPath: !logoPath ? logoPath : logoPath.startsWith("/") ? logoPath : `/Documents/Campmaster/Group${clubId}/${logoPath}`, isActive: true, attendanceCount: 0,
    };
  }

  async updateCamp(clubId: number, campId: number, dto: CampForm, logo: UploadedFile | undefined, userId: number) {
    const existing = await this.db.queryFirstOrDefault(
      `SELECT pk_camp_id, CampLogoPath AS CampLogoPathRaw, ${LOGO_PATH_SQL("")} AS CampLogoPathFull
       FROM pph_camps WHERE pk_camp_id = @CampId AND fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0`,
      { CampId: campId, ClubId: clubId },
    );
    if (!existing) throw new KeyNotFoundException("Camp not found.");
    let logoPath: string | null = existing.CampLogoPathRaw ?? null;
    if (logo) {
      await this.deleteWebFile(existing.CampLogoPathFull ?? null);
      logoPath = await this.saveLogo(`Group${clubId}`, logo);
    }
    const campDate = parseCampDate(dto.campDate);
    await this.db.execute(
      `UPDATE pph_camps SET Title = @Title, Description = @Description, Address = @Address, CampDate = @CampDate, CampLogoPath = @CampLogoPath,
           IsActive = @IsActive, modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0`,
      { CampId: campId, Title: dto.title, Description: dto.description, Address: dto.address, CampDate: campDate, CampLogoPath: logoPath, IsActive: dto.isActive ? 1 : 0, ModifiedBy: userId },
    );
    const attendanceCount = Number(await this.db.executeScalar("SELECT COUNT(*) FROM pph_camp_attendance WHERE fk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0", { CampId: campId }));
    this.citation.triggerForClub(clubId);
    return {
      id: campId, title: dto.title, description: dto.description, address: dto.address, campDate: asDotnet(campDate),
      campLogoPath: !logoPath ? logoPath : logoPath.startsWith("/") ? logoPath : `/Documents/Campmaster/Group${clubId}/${logoPath}`, isActive: dto.isActive, attendanceCount,
    };
  }

  async deleteCamp(campId: number, userId: number) {
    await this.db.session(async (conn) => {
      const count = Number(await conn.executeScalar("SELECT COUNT(*) FROM pph_camp_attendance WHERE fk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0", { CampId: campId }));
      if (count > 0) throw new InvalidOperationException("Cannot delete camp with attendance records.");
      const clubId = Number((await conn.executeScalar("SELECT fk_club_id FROM pph_camps WHERE pk_camp_id = @CampId", { CampId: campId })) ?? 0);
      await conn.execute("UPDATE pph_camps SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_camp_id = @CampId", { CampId: campId, DeletedBy: userId });
      if (clubId > 0) this.citation.triggerForClub(clubId);
    });
  }

  async toggleCampActive(campId: number, userId: number) {
    await this.db.session(async (conn) => {
      await conn.execute("UPDATE pph_camps SET IsActive = NOT IsActive, modified_by = @ModifiedBy, modified_date = NOW() WHERE pk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0", {
        CampId: campId, ModifiedBy: userId,
      });
      const clubId = Number((await conn.executeScalar("SELECT fk_club_id FROM pph_camps WHERE pk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0", { CampId: campId })) ?? 0);
      if (clubId > 0) this.citation.triggerForClub(clubId);
    });
  }

  private static readings(rows: Row[]) {
    return PphMedicalReadingDto.mapAll(rows);
  }

  async getAttendees(campId: number) {
    return this.db.session(async (conn) => {
      const attendees = await conn.query(
        `SELECT pk_attendee_id AS Id, fk_camp_id AS CampId, Name, MobileNo, Sex, Address, IsConsentedForMessages
         FROM pph_camp_attendies WHERE fk_camp_id = @CampId AND isdeleted = 0 ORDER BY pk_attendee_id DESC`,
        { CampId: campId },
      );
      if (!attendees.length) return [];
      const readings = PphCampService.readings(await conn.query(`${MEDICAL_SELECT} WHERE fk_camp_id = @CampId AND isdeleted = 0 ORDER BY pk_attendance_id DESC`, { CampId: campId }));
      return attendees.map((a) => {
        const mine = readings.filter((r) => r.attendeeId !== 0 && r.attendeeId === Number(a.Id));
        return PphAttendeeDto.map({ ...a, ReadingCount: mine.length, LatestReading: mine[0] ?? null });
      });
    });
  }

  async getAttendeeDetail(campId: number, attendeeId: number, conn: DbCommands = this.db) {
    const attendee = await conn.queryFirstOrDefault(
      `SELECT pk_attendee_id AS Id, fk_camp_id AS CampId, Name, MobileNo, Sex, Address, IsConsentedForMessages
       FROM pph_camp_attendies WHERE pk_attendee_id = @AttendeeId AND fk_camp_id = @CampId AND isdeleted = 0`,
      { AttendeeId: attendeeId, CampId: campId },
    );
    if (!attendee) return null;
    const history = PphCampService.readings(await conn.query(`${MEDICAL_SELECT} WHERE fk_attendee_id = @AttendeeId AND isdeleted = 0 ORDER BY pk_attendance_id DESC`, { AttendeeId: attendeeId }));
    return { attendee: PphAttendeeDto.map({ ...attendee, ReadingCount: history.length, LatestReading: history[0] ?? null }), history };
  }

  async addReading(campId: number, body: unknown, userId: number) {
    const s = (n: string) => {
      const v = bodyField(body, n);
      return v === undefined || v === null ? null : String(v);
    };
    const mobile = (s("mobileNo") ?? "").trim();
    const consent = bodyField(body, "isConsentedForMessages") === true;
    const height = numOrNull(bodyField(body, "heightCm"));
    const weight = numOrNull(bodyField(body, "weightKg"));
    return this.db.session(async (conn) => {
      let attendeeId = Number(
        (await conn.executeScalar("SELECT pk_attendee_id FROM pph_camp_attendies WHERE fk_camp_id = @CampId AND MobileNo = @Mobile AND isdeleted = 0 ORDER BY pk_attendee_id LIMIT 1", {
          CampId: campId, Mobile: mobile,
        })) ?? 0,
      );
      if (!attendeeId) {
        await conn.execute(
          `INSERT INTO pph_camp_attendies (fk_camp_id, Name, MobileNo, Sex, Address, IsConsentedForMessages, created_by, created_date, isdeleted)
           VALUES (@CampId, @Name, @Mobile, @Sex, @Address, @Consent, @CreatedBy, NOW(), 0)`,
          { CampId: campId, Name: s("name") ?? "", Mobile: mobile, Sex: s("sex") ?? "", Address: s("address") ?? "", Consent: consent ? 1 : 0, CreatedBy: userId },
        );
        attendeeId = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      }
      const [bmi, overweight, obese] = calcBmi(height, weight);
      const maxReg = await conn.executeScalar("SELECT MAX(CAST(SUBSTRING(RegistrationNo, 5) AS UNSIGNED)) FROM pph_camp_attendance WHERE RegistrationNo IS NOT NULL");
      const registrationNo = `PPH-${String(Number(maxReg ?? 0) + 1).padStart(4, "0")}`;
      await conn.execute(
        `INSERT INTO pph_camp_attendance (fk_camp_id, fk_attendee_id, RegistrationNo, Age, BPSystolic, BPDiastolic, BloodSugarType, BloodSugarValue,
             HeightCm, WeightKg, BMI, DiabetesStatus, BPStatus, IsOverweight, IsObese, IsConsentedForMessages, Remarks, created_by, created_date, isdeleted)
         VALUES (@CampId, @AttendeeId, @RegistrationNo, @Age, @BPSystolic, @BPDiastolic, @BloodSugarType, @BloodSugarValue,
             @HeightCm, @WeightKg, @BMI, @DiabetesStatus, @BPStatus, @IsOverweight, @IsObese, @IsConsentedForMessages, @Remarks, @CreatedBy, NOW(), 0)`,
        {
          CampId: campId, AttendeeId: attendeeId, RegistrationNo: registrationNo, Age: Math.trunc(Number(bodyField(body, "age") ?? 0)),
          BPSystolic: Math.trunc(Number(bodyField(body, "bPSystolic") ?? 0)), BPDiastolic: Math.trunc(Number(bodyField(body, "bPDiastolic") ?? 0)),
          BloodSugarType: s("bloodSugarType") ?? "", BloodSugarValue: Number(bodyField(body, "bloodSugarValue") ?? 0), HeightCm: height ?? 0, WeightKg: weight ?? 0, BMI: bmi,
          DiabetesStatus: s("diabetesStatus"), BPStatus: s("bPStatus"), IsOverweight: overweight ? 1 : 0, IsObese: obese ? 1 : 0, IsConsentedForMessages: consent ? 1 : 0,
          Remarks: s("remarks"), CreatedBy: userId,
        },
      );
      return (await this.getAttendeeDetail(campId, attendeeId, conn))!;
    });
  }

  async updateAttendee(campId: number, attendeeId: number, body: unknown, userId: number) {
    const s = (n: string) => String(bodyField(body, n) ?? "");
    const mobile = s("mobileNo").trim();
    const consent = bodyField(body, "isConsentedForMessages") === true ? 1 : 0;
    return this.db.session(async (conn) => {
      const clash = Number(
        await conn.executeScalar("SELECT COUNT(*) FROM pph_camp_attendies WHERE fk_camp_id = @CampId AND MobileNo = @Mobile AND pk_attendee_id <> @AttendeeId AND isdeleted = 0", {
          CampId: campId, Mobile: mobile, AttendeeId: attendeeId,
        }),
      );
      if (clash > 0) throw new InvalidOperationException("This mobile number is already used by another attendee in this camp.");
      const affected = await conn.execute(
        `UPDATE pph_camp_attendies SET Name = @Name, MobileNo = @Mobile, Sex = @Sex, Address = @Address, IsConsentedForMessages = @Consent,
             modified_by = @ModifiedBy, modified_date = NOW()
         WHERE pk_attendee_id = @AttendeeId AND fk_camp_id = @CampId AND isdeleted = 0`,
        { AttendeeId: attendeeId, CampId: campId, Name: s("name"), Mobile: mobile, Sex: s("sex"), Address: s("address"), Consent: consent, ModifiedBy: userId },
      );
      if (affected === 0) throw new KeyNotFoundException("Attendee not found.");
      await conn.execute("UPDATE pph_camp_attendance SET IsConsentedForMessages = @Consent WHERE fk_attendee_id = @AttendeeId AND isdeleted = 0", { AttendeeId: attendeeId, Consent: consent });
      return (await this.getAttendeeDetail(campId, attendeeId, conn))!.attendee;
    });
  }

  async updateReading(campId: number, readingId: number, body: unknown, userId: number) {
    const height = numOrNull(bodyField(body, "heightCm"));
    const weight = numOrNull(bodyField(body, "weightKg"));
    const [bmi, overweight, obese] = calcBmi(height, weight);
    const s = (n: string) => {
      const v = bodyField(body, n);
      return v === undefined || v === null ? null : String(v);
    };
    return this.db.session(async (conn) => {
      const affected = await conn.execute(
        `UPDATE pph_camp_attendance SET Age = @Age, BPSystolic = @BPSystolic, BPDiastolic = @BPDiastolic, BloodSugarType = @BloodSugarType,
             BloodSugarValue = @BloodSugarValue, HeightCm = @HeightCm, WeightKg = @WeightKg, BMI = @BMI, DiabetesStatus = @DiabetesStatus, BPStatus = @BPStatus,
             IsOverweight = @IsOverweight, IsObese = @IsObese, Remarks = @Remarks, modified_by = @ModifiedBy, modified_date = NOW()
         WHERE pk_attendance_id = @ReadingId AND fk_camp_id = @CampId AND isdeleted = 0`,
        {
          ReadingId: readingId, CampId: campId, Age: Math.trunc(Number(bodyField(body, "age") ?? 0)), BPSystolic: Math.trunc(Number(bodyField(body, "bPSystolic") ?? 0)),
          BPDiastolic: Math.trunc(Number(bodyField(body, "bPDiastolic") ?? 0)), BloodSugarType: s("bloodSugarType") ?? "", BloodSugarValue: Number(bodyField(body, "bloodSugarValue") ?? 0),
          HeightCm: height ?? 0, WeightKg: weight ?? 0, BMI: bmi, DiabetesStatus: s("diabetesStatus"), BPStatus: s("bPStatus"), IsOverweight: overweight ? 1 : 0,
          IsObese: obese ? 1 : 0, Remarks: s("remarks"), ModifiedBy: userId,
        },
      );
      if (affected === 0) throw new KeyNotFoundException("Reading not found.");
      return PphMedicalReadingDto.map(await conn.queryFirstOrDefault(`${MEDICAL_SELECT} WHERE pk_attendance_id = @ReadingId`, { ReadingId: readingId }));
    });
  }

  async deleteReading(campId: number, readingId: number, userId: number) {
    await this.db.execute("UPDATE pph_camp_attendance SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_attendance_id = @ReadingId AND fk_camp_id = @CampId", {
      ReadingId: readingId, CampId: campId, DeletedBy: userId,
    });
  }

  async deleteAttendee(campId: number, attendeeId: number, userId: number) {
    await this.db.execute("UPDATE pph_camp_attendies SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_attendee_id = @AttendeeId AND fk_camp_id = @CampId", {
      AttendeeId: attendeeId, CampId: campId, DeletedBy: userId,
    });
    await this.db.execute("UPDATE pph_camp_attendance SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE fk_attendee_id = @AttendeeId AND isdeleted = 0", {
      AttendeeId: attendeeId, DeletedBy: userId,
    });
  }

  /** Every camp visit of one mobile number (last 10 digits), grouped by club / district camp. */
  async getAttendeeHistoryByMobile(mobile: string) {
    const digits = (mobile ?? "").replace(/\D/g, "");
    const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
    const result = { mobile: last10, totalEntries: 0, groupCount: 0, groups: [] as unknown[] };
    if (!last10) return result;
    return this.db.session(async (conn) => {
      const rows = await conn.query(
        `SELECT a.pk_attendee_id AS AttendeeId, a.fk_camp_id AS CampId, a.Name AS AttendeeName, a.MobileNo AS MobileNo, a.Sex AS Sex, a.Address AS Address,
                a.IsConsentedForMessages AS IsConsentedForMessages, c.Title AS CampTitle, c.CampDate AS CampDate, c.fk_club_id AS ClubId, c.fk_district_id AS DistrictId,
                cm.ClubName AS ClubName, dm.DistrictNumber AS DistrictNumber,
                (SELECT COUNT(*) FROM pph_camp_attendance r WHERE r.fk_attendee_id = a.pk_attendee_id AND COALESCE(r.isdeleted,0) = 0) AS ReadingCount,
                (SELECT MAX(r2.created_date) FROM pph_camp_attendance r2 WHERE r2.fk_attendee_id = a.pk_attendee_id AND COALESCE(r2.isdeleted,0) = 0) AS LatestReadingDate
         FROM pph_camp_attendies a
         JOIN pph_camps c ON c.pk_camp_id = a.fk_camp_id AND COALESCE(c.isdeleted,0) = 0
         LEFT JOIN club_master cm ON cm.pk_club_id = c.fk_club_id
         LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
         WHERE COALESCE(a.isdeleted,0) = 0 AND RIGHT(REGEXP_REPLACE(COALESCE(a.MobileNo,''), '[^0-9]', ''), 10) = @Last10
         ORDER BY c.CampDate DESC, a.pk_attendee_id DESC`,
        { Last10: last10 },
      );
      const ids = [...new Set(rows.map((r) => Number(r.AttendeeId)))];
      const readings = ids.length ? PphCampService.readings(await conn.query(`${MEDICAL_SELECT} WHERE fk_attendee_id IN @Ids AND COALESCE(isdeleted,0) = 0 ORDER BY pk_attendance_id DESC`, { Ids: ids })) : [];
      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        const key = r.ClubId !== null ? `C${r.ClubId}` : r.DistrictId !== null ? `D${r.DistrictId}` : "U";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      const list = [...groups.values()].map((g) => {
        const first = g[0];
        const isDistrict = first.ClubId === null;
        return {
          clubId: first.ClubId ?? null,
          districtId: isDistrict ? (first.DistrictId ?? null) : null,
          groupName: first.ClubName && String(first.ClubName).trim() ? first.ClubName : isDistrict && first.DistrictNumber && String(first.DistrictNumber).trim() ? `District ${first.DistrictNumber} (District Camp)` : "Unknown club",
          isDistrict,
          entryCount: g.length,
          entries: g.map((r) => ({
            attendeeId: Number(r.AttendeeId), campId: Number(r.CampId), campTitle: r.CampTitle ?? "", campDate: r.CampDate, attendeeName: r.AttendeeName ?? "",
            mobileNo: r.MobileNo ?? "", sex: r.Sex ?? null, address: r.Address ?? null, readingCount: Number(r.ReadingCount), latestReadingDate: r.LatestReadingDate ?? null,
            yearLabel: rotaryYearLabel(String(r.CampDate)), isConsentedForMessages: r.IsConsentedForMessages === true || Number(r.IsConsentedForMessages) === 1,
            readings: readings.filter((x) => x.attendeeId === Number(r.AttendeeId)),
          })),
        };
      });
      const latest = (g: (typeof list)[number]) => g.entries.reduce((m, e) => (String(e.campDate) > m ? String(e.campDate) : m), "");
      list.sort((a, b) => (latest(b) > latest(a) ? 1 : latest(b) < latest(a) ? -1 : 0));
      return { mobile: last10, totalEntries: rows.length, groupCount: list.length, groups: list };
    });
  }

  async getAttendeeReport(scope: string, scopeId: number | null) {
    const filter = { club: "AND c.fk_club_id = @ScopeId", district: "AND (cm.fk_district_id = @ScopeId OR c.fk_district_id = @ScopeId)" }[(scope ?? "").toLowerCase()] ?? "";
    const rows = await this.db.query(
      `SELECT dm.DistrictNumber AS DistrictNumber,
              COALESCE(cm.ClubName, CASE WHEN c.fk_district_id IS NOT NULL THEN CONCAT('District ', dm.DistrictNumber, ' (District Camp)') ELSE 'Unknown club' END) AS ClubName,
              a.fk_camp_id AS CampId, c.Title AS CampTitle, c.CampDate AS CampDate, a.Name AS AttendeeName, a.MobileNo AS MobileNo, a.Sex AS Sex, a.Address AS Address,
              (SELECT COUNT(*) FROM pph_camp_attendance r WHERE r.fk_attendee_id = a.pk_attendee_id AND COALESCE(r.isdeleted,0) = 0) AS ReadingCount,
              (SELECT MAX(r2.created_date) FROM pph_camp_attendance r2 WHERE r2.fk_attendee_id = a.pk_attendee_id AND COALESCE(r2.isdeleted,0) = 0) AS LatestReadingDate
       FROM pph_camp_attendies a
       JOIN pph_camps c ON c.pk_camp_id = a.fk_camp_id AND COALESCE(c.isdeleted,0) = 0
       LEFT JOIN club_master cm ON cm.pk_club_id = c.fk_club_id
       LEFT JOIN district_master dm ON dm.pk_district_id = COALESCE(cm.fk_district_id, c.fk_district_id)
       WHERE COALESCE(a.isdeleted,0) = 0 ${filter}
       ORDER BY ClubName, c.CampDate DESC, a.pk_attendee_id DESC`,
      { ScopeId: scopeId },
    );
    return PphAttendeeReportRowDto.mapAll(rows.map((r) => ({ ...r, YearLabel: rotaryYearLabel(String(r.CampDate)) })));
  }
}
