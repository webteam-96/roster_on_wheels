import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryInt, routeInt } from "../../common/binding";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { Db } from "../../database/db.service";
import { TrainingAppointmentService } from "./training-appointment.service";

/** Port of TrainingAppointmentController.cs: website training bookings (club admins) and the team's availability (SuperAdmin). */
@Controller()
@Authorize()
export class TrainingAppointmentController {
  constructor(private readonly svc: TrainingAppointmentService, private readonly db: Db) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10) || 0;
  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");

  /** SuperAdmin, or an active club admin (role 2) of this club. */
  private async canActForClub(u: CurrentUser, clubId: number) {
    if (this.isSuperAdmin(u)) return true;
    const memberId = this.userId(u);
    if (memberId === 0 || clubId <= 0) return false;
    return Number(await this.db.executeScalar(
      "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0",
      { MemberId: memberId, ClubId: clubId },
    )) > 0;
  }

  @Get("api/training-appointments/availability")
  async availability(@User() u: CurrentUser, @Query("clubId") c?: string) {
    const clubId = queryInt(c, 0);
    if (!(await this.canActForClub(u, clubId))) return forbid();
    if (!(await this.svc.hasActiveWebsite(clubId))) return badRequest({ message: "Your club needs an active website subscription to book training." });
    return ok(await this.svc.getAvailability());
  }

  @Post("api/training-appointments/book")
  async book(@User() u: CurrentUser, @Body() body: unknown) {
    if (!(await this.canActForClub(u, Math.trunc(Number(bodyField(body, "clubId")) || 0)))) return forbid();
    const res = await this.svc.book(body ?? {}, this.userId(u));
    return res.isSuccess ? ok(res) : badRequest(res);
  }

  @Get("api/training-appointments/mine")
  async mine(@User() u: CurrentUser, @Query("clubId") c?: string) {
    const clubId = queryInt(c, 0);
    if (!(await this.canActForClub(u, clubId))) return forbid();
    return ok(await this.svc.getForClub(clubId));
  }

  @Post("api/training-appointments/:id/reschedule")
  async reschedule(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    const appointmentId = routeInt(id);
    const clubId = await this.svc.getAppointmentClubId(appointmentId);
    if (clubId === null) return notFound({ message: "Appointment not found." });
    if (!(await this.canActForClub(u, clubId))) return forbid();
    const res = await this.svc.reschedule(appointmentId, body ?? {}, this.userId(u));
    return res.isSuccess ? ok(res) : badRequest(res);
  }

  @Get("api/admin/training-appointments")
  async all(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.getAll());
  }

  @Get("api/admin/training-availability")
  async availabilitySettings(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.getAvailabilitySettings());
  }

  @Put("api/admin/training-availability/week")
  async saveWeek(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    await this.svc.saveWeeklyHours(body ?? {}, this.userId(u));
    return ok(await this.svc.getAvailabilitySettings());
  }

  @Post("api/admin/training-availability/overrides")
  async saveOverride(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    await this.svc.saveDateOverride(body ?? {}, this.userId(u));
    return ok(await this.svc.getAvailabilitySettings());
  }

  @Delete("api/admin/training-availability/overrides/:id")
  async deleteOverride(@User() u: CurrentUser, @Param("id") id: string) {
    const overrideId = routeInt(id);
    if (!this.isSuperAdmin(u)) return forbid();
    await this.svc.deleteDateOverride(overrideId, this.userId(u));
    return ok(await this.svc.getAvailabilitySettings());
  }
}
