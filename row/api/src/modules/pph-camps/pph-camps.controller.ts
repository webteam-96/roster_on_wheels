import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { paramInt } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, DISTRICT_BLOCKED_MESSAGE, isClubDrillReachable, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import type { UploadedFile } from "../../services/media-storage";
import { PphCampListDto, PphCampService, bindCampForm, checkCampLogo, parseCampDate, validateReading } from "./pph-camp.service";

const MAX_UPLOAD = 55 * 1024 * 1024;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const logoOf = (files: UploadedFile[] | undefined) => (files ?? []).find((f) => (f as UploadedFile & { fieldname?: string }).fieldname?.toLowerCase() === "logo");

/** The attendee / reading endpoints shared by the club and district routes. */
abstract class PphAttendeeEndpoints {
  constructor(protected readonly pph: PphCampService) {}
  protected userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  protected async addReading(campId: number, body: unknown, u: CurrentUser) {
    const invalid = validateReading(body, "create");
    if (invalid) return invalid;
    try {
      return ok(await this.pph.addReading(campId, body, this.userId(u)));
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }
  protected async updateAttendee(campId: number, attendeeId: number, body: unknown, u: CurrentUser) {
    const invalid = validateReading(body, "attendee");
    if (invalid) return invalid;
    try {
      return ok(await this.pph.updateAttendee(campId, attendeeId, body, this.userId(u)));
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      throw e;
    }
  }
  protected async updateReading(campId: number, readingId: number, body: unknown, u: CurrentUser) {
    const invalid = validateReading(body, "reading");
    if (invalid) return invalid;
    try {
      return ok(await this.pph.updateReading(campId, readingId, body, this.userId(u)));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      throw e;
    }
  }
  protected async attendeeDetail(campId: number, attendeeId: number) {
    const detail = await this.pph.getAttendeeDetail(campId, attendeeId);
    return detail ? ok(detail) : notFound({ message: "Attendee not found." });
  }
}

/** Port of PphCampsController.cs: api/clubs/{clubId}/pph-camps. */
@Controller("api/clubs/:clubId/pph-camps")
@Authorize()
export class PphCampsController extends PphAttendeeEndpoints {
  constructor(
    pph: PphCampService,
    private readonly db: Db,
  ) {
    super(pph);
  }

  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  @Get()
  async camps(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.pph.getCamps(clubId));
  }

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async create(@Param("clubId") c: string, @Body() body: unknown, @UploadedFiles() files: UploadedFile[] | undefined, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const logo = logoOf(files);
    const bad = checkCampLogo(logo);
    if (bad) return badRequest({ message: bad });
    try {
      return ok(await this.pph.createCamp(clubId, bindCampForm(body), logo, this.userId(u)));
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Get("attendee-history")
  async history(@Param("clubId") c: string, @Query("mobile") mobile?: string) {
    const clubId = paramInt(c, "clubId");
    const block = await this.blocked(clubId);
    if (block) return block;
    if (!mobile || !mobile.trim()) return badRequest({ message: "Mobile number is required." });
    return ok(await this.pph.getAttendeeHistoryByMobile(mobile));
  }

  @Get("attendees-report")
  async report(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.pph.getAttendeeReport("club", clubId));
  }

  @Put(":campId")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async update(@Param("clubId") c: string, @Param("campId") cid: string, @Body() body: unknown, @UploadedFiles() files: UploadedFile[] | undefined, @User() u: CurrentUser) {
    const [clubId, campId] = [paramInt(c, "clubId"), paramInt(cid, "campId")];
    const logo = logoOf(files);
    const bad = checkCampLogo(logo);
    if (bad) return badRequest({ message: bad });
    try {
      return ok(await this.pph.updateCamp(clubId, campId, bindCampForm(body), logo, this.userId(u)));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      return badRequest({ message: message(e) });
    }
  }

  @Delete(":campId")
  async remove(@Param("clubId") c: string, @Param("campId") cid: string, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    try {
      await this.pph.deleteCamp(paramInt(cid, "campId"), this.userId(u));
      return ok({ message: "Camp deleted successfully." });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Put(":campId/toggle-active")
  async toggle(@Param("clubId") c: string, @Param("campId") cid: string, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    await this.pph.toggleCampActive(paramInt(cid, "campId"), this.userId(u));
    return ok({ message: "Camp active status toggled." });
  }

  @Get(":campId/attendees")
  async attendees(@Param("clubId") c: string, @Param("campId") cid: string) {
    const clubId = paramInt(c, "clubId");
    const campId = paramInt(cid, "campId");
    return (await this.blocked(clubId)) ?? ok(await this.pph.getAttendees(campId));
  }

  @Get(":campId/attendees/:attendeeId")
  async attendee(@Param("clubId") c: string, @Param("campId") cid: string, @Param("attendeeId") a: string) {
    const clubId = paramInt(c, "clubId");
    const [campId, attendeeId] = [paramInt(cid, "campId"), paramInt(a, "attendeeId")];
    return (await this.blocked(clubId)) ?? this.attendeeDetail(campId, attendeeId);
  }

  @Post(":campId/readings")
  reading(@Param("clubId") c: string, @Param("campId") cid: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    return this.addReading(paramInt(cid, "campId"), body, u);
  }

  @Put(":campId/attendees/:attendeeId")
  editAttendee(@Param("clubId") c: string, @Param("campId") cid: string, @Param("attendeeId") a: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    return this.updateAttendee(paramInt(cid, "campId"), paramInt(a, "attendeeId"), body, u);
  }

  @Put(":campId/readings/:readingId")
  editReading(@Param("clubId") c: string, @Param("campId") cid: string, @Param("readingId") r: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    return this.updateReading(paramInt(cid, "campId"), paramInt(r, "readingId"), body, u);
  }

  @Delete(":campId/readings/:readingId")
  async removeReading(@Param("clubId") c: string, @Param("campId") cid: string, @Param("readingId") r: string, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    await this.pph.deleteReading(paramInt(cid, "campId"), paramInt(r, "readingId"), this.userId(u));
    return ok({ message: "Reading deleted successfully." });
  }

  @Delete(":campId/attendees/:attendeeId")
  async removeAttendee(@Param("clubId") c: string, @Param("campId") cid: string, @Param("attendeeId") a: string, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    await this.pph.deleteAttendee(paramInt(cid, "campId"), paramInt(a, "attendeeId"), this.userId(u));
    return ok({ message: "Attendee deleted successfully." });
  }
}

/** DistrictModulesController.cs PPH camp endpoints: api/district-modules/{districtId}/pph-camps (district camps have no club). */
@Controller("api/district-modules/:districtId/pph-camps")
@Authorize()
export class DistrictPphCampsController extends PphAttendeeEndpoints {
  constructor(
    pph: PphCampService,
    private readonly db: Db,
  ) {
    super(pph);
  }

  private async blocked(districtId: number) {
    return !(await isDistrictDrillReachable(this.db, districtId)) ? statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE }) : null;
  }

  @Get()
  async camps(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    const block = await this.blocked(districtId);
    if (block) return block;
    return ok(
      PphCampListDto.mapAll(
        await this.db.query(
          `SELECT c.pk_camp_id AS Id, c.Title, c.Description, c.Address, c.CampDate,
                  CASE WHEN c.CampLogoPath IS NULL OR c.CampLogoPath = '' THEN NULL
                       WHEN c.CampLogoPath LIKE '/%' THEN c.CampLogoPath
                       WHEN c.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Campmaster/District', c.fk_district_id, '/', c.CampLogoPath)
                       ELSE CONCAT('/Documents/Campmaster/Group', c.fk_club_id, '/', c.CampLogoPath) END AS CampLogoPath,
                  c.IsActive, COUNT(a.pk_attendance_id) AS AttendanceCount
           FROM pph_camps c
           LEFT JOIN pph_camp_attendance a ON a.fk_camp_id = c.pk_camp_id AND a.isdeleted = 0
           WHERE c.fk_club_id IS NULL AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
           GROUP BY c.pk_camp_id, c.Title, c.Description, c.Address, c.CampDate, c.CampLogoPath, c.fk_club_id, c.fk_district_id, c.IsActive
           ORDER BY c.CampDate DESC, c.pk_camp_id DESC`,
          { DistrictId: districtId },
        ),
      ),
    );
  }

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async create(@Param("districtId") d: string, @Body() body: unknown, @UploadedFiles() files: UploadedFile[] | undefined, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const logo = logoOf(files);
    const bad = checkCampLogo(logo);
    if (bad) return badRequest({ message: bad });
    const dto = bindCampForm(body);
    const logoPath = logo ? await this.pph.saveLogo(`District${districtId}`, logo) : null;
    const campDate = parseCampDate(dto.campDate);
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO pph_camps (fk_club_id, fk_district_id, Title, Description, Address, CampDate, CampLogoPath, IsActive, created_by, created_date, isdeleted)
         VALUES (NULL, @DistrictId, @Title, @Description, @Address, @CampDate, @CampLogoPath, 1, @CreatedBy, NOW(), 0)`,
        { DistrictId: districtId, Title: dto.title, Description: dto.description, Address: dto.address, CampDate: campDate, CampLogoPath: logoPath, CreatedBy: this.userId(u) },
      );
      return ok({
        id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), title: dto.title, description: dto.description, address: dto.address,
        campDate: campDate.replace(" ", "T"), campLogoPath: logoPath ? `/Documents/Campmaster/District${districtId}/${logoPath}` : logoPath, isActive: true, attendanceCount: 0,
      });
    });
  }

  @Get("attendee-history")
  async history(@Param("districtId") d: string, @Query("mobile") mobile?: string) {
    const districtId = paramInt(d, "districtId");
    const block = await this.blocked(districtId);
    if (block) return block;
    if (!mobile || !mobile.trim()) return badRequest({ message: "Mobile number is required." });
    return ok(await this.pph.getAttendeeHistoryByMobile(mobile));
  }

  @Get("attendees-report")
  async report(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (await this.blocked(districtId)) ?? ok(await this.pph.getAttendeeReport("district", districtId));
  }

  @Put(":campId")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async update(@Param("districtId") d: string, @Param("campId") cid: string, @Body() body: unknown, @UploadedFiles() files: UploadedFile[] | undefined, @User() u: CurrentUser) {
    const [districtId, campId] = [paramInt(d, "districtId"), paramInt(cid, "campId")];
    const logo = logoOf(files);
    const bad = checkCampLogo(logo);
    if (bad) return badRequest({ message: bad });
    const dto = bindCampForm(body);
    return this.db.session(async (conn) => {
      const existing = await conn.queryFirstOrDefault(
        `SELECT pk_camp_id, CampLogoPath AS CampLogoPathRaw,
                CASE WHEN CampLogoPath IS NULL OR CampLogoPath = '' THEN NULL
                     WHEN CampLogoPath LIKE '/%' THEN CampLogoPath
                     WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Campmaster/District', fk_district_id, '/', CampLogoPath)
                     ELSE CONCAT('/Documents/Campmaster/Group', fk_club_id, '/', CampLogoPath) END AS CampLogoPathFull
         FROM pph_camps WHERE pk_camp_id = @CampId AND fk_club_id IS NULL AND fk_district_id = @DistrictId AND isdeleted = 0`,
        { CampId: campId, DistrictId: districtId },
      );
      if (!existing) return notFound({ message: "Camp not found." });
      let logoPath: string | null = existing.CampLogoPathRaw ?? null;
      if (logo) {
        await this.pph.deleteWebFile(existing.CampLogoPathFull ?? null);
        logoPath = await this.pph.saveLogo(`District${districtId}`, logo);
      }
      const campDate = parseCampDate(dto.campDate);
      await conn.execute(
        `UPDATE pph_camps SET Title = @Title, Description = @Description, Address = @Address, CampDate = @CampDate, CampLogoPath = @CampLogoPath, IsActive = @IsActive,
             modified_by = @ModifiedBy, modified_date = NOW()
         WHERE pk_camp_id = @CampId AND isdeleted = 0`,
        { CampId: campId, Title: dto.title, Description: dto.description, Address: dto.address, CampDate: campDate, CampLogoPath: logoPath, IsActive: dto.isActive ? 1 : 0, ModifiedBy: this.userId(u) },
      );
      const attendanceCount = Number(await conn.executeScalar("SELECT COUNT(*) FROM pph_camp_attendance WHERE fk_camp_id = @CampId AND isdeleted = 0", { CampId: campId }));
      return ok({
        id: campId, title: dto.title, description: dto.description, address: dto.address, campDate: campDate.replace(" ", "T"),
        campLogoPath: !logoPath ? logoPath : logoPath.startsWith("/") ? logoPath : `/Documents/Campmaster/District${districtId}/${logoPath}`, isActive: dto.isActive, attendanceCount,
      });
    });
  }

  @Delete(":campId")
  async remove(@Param("districtId") d: string, @Param("campId") cid: string, @User() u: CurrentUser) {
    const [districtId, campId] = [paramInt(d, "districtId"), paramInt(cid, "campId")];
    const count = Number(await this.db.executeScalar("SELECT COUNT(*) FROM pph_camp_attendance WHERE fk_camp_id = @CampId AND isdeleted = 0", { CampId: campId }));
    if (count > 0) return badRequest({ message: "Cannot delete camp with attendance records." });
    await this.db.execute("UPDATE pph_camps SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_camp_id = @CampId AND fk_club_id IS NULL AND fk_district_id = @DistrictId", {
      CampId: campId, DistrictId: districtId, DeletedBy: this.userId(u),
    });
    return ok({ message: "Camp deleted successfully." });
  }

  @Put(":campId/toggle-active")
  async toggle(@Param("districtId") d: string, @Param("campId") cid: string, @User() u: CurrentUser) {
    await this.db.execute(
      "UPDATE pph_camps SET IsActive = NOT IsActive, modified_by = @ModifiedBy, modified_date = NOW() WHERE pk_camp_id = @CampId AND fk_club_id IS NULL AND fk_district_id = @DistrictId AND isdeleted = 0",
      { CampId: paramInt(cid, "campId"), DistrictId: paramInt(d, "districtId"), ModifiedBy: this.userId(u) },
    );
    return ok({ message: "Camp active status toggled." });
  }

  @Get(":campId/attendees")
  async attendees(@Param("districtId") d: string, @Param("campId") cid: string) {
    const districtId = paramInt(d, "districtId");
    const campId = paramInt(cid, "campId");
    return (await this.blocked(districtId)) ?? ok(await this.pph.getAttendees(campId));
  }

  @Get(":campId/attendees/:attendeeId")
  async attendee(@Param("districtId") d: string, @Param("campId") cid: string, @Param("attendeeId") a: string) {
    const districtId = paramInt(d, "districtId");
    const [campId, attendeeId] = [paramInt(cid, "campId"), paramInt(a, "attendeeId")];
    return (await this.blocked(districtId)) ?? this.attendeeDetail(campId, attendeeId);
  }

  @Post(":campId/readings")
  reading(@Param("districtId") d: string, @Param("campId") cid: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    return this.addReading(paramInt(cid, "campId"), body, u);
  }

  @Put(":campId/attendees/:attendeeId")
  editAttendee(@Param("districtId") d: string, @Param("campId") cid: string, @Param("attendeeId") a: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    return this.updateAttendee(paramInt(cid, "campId"), paramInt(a, "attendeeId"), body, u);
  }

  @Put(":campId/readings/:readingId")
  editReading(@Param("districtId") d: string, @Param("campId") cid: string, @Param("readingId") r: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    return this.updateReading(paramInt(cid, "campId"), paramInt(r, "readingId"), body, u);
  }

  @Delete(":campId/readings/:readingId")
  async removeReading(@Param("districtId") d: string, @Param("campId") cid: string, @Param("readingId") r: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.pph.deleteReading(paramInt(cid, "campId"), paramInt(r, "readingId"), this.userId(u));
    return ok({ message: "Reading deleted successfully." });
  }

  @Delete(":campId/attendees/:attendeeId")
  async removeAttendee(@Param("districtId") d: string, @Param("campId") cid: string, @Param("attendeeId") a: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.pph.deleteAttendee(paramInt(cid, "campId"), paramInt(a, "attendeeId"), this.userId(u));
    return ok({ message: "Attendee deleted successfully." });
  }
}
