import { Body, Controller, Delete, Get, Logger, Param, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { bodyField, bodyIntList, paramInt, queryBool, queryInt, queryString, requireFile } from "../../common/binding";
import { DISTRICT_BLOCKED_MESSAGE, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { hasActiveGoalRole } from "../../services/goal-login.helper";
import { AnnouncementService } from "../content/announcement.service";
import { DocumentService } from "../content/document.service";
import { UpcomingEventService } from "../content/upcoming-event.service";
import { NewsletterService } from "../content/newsletter.service";
import { MastersService, UpdateDistrictGreetingSettingsDto } from "../masters/masters.service";
import { ClubGroupsService, SaveWeblinkDto, type SaveWeblink } from "../club-groups/club-groups.service";
import { checkWeblinkFiles, weblinkFiles } from "../club-groups/club-groups.controller";
import { MassEmailService, bindCreateMassEmail, parseIdList } from "../mass-emails/mass-email.service";
import { RoleService } from "../roles/role.service";
import {
  SaveAnnouncementDto, SaveDocumentDto, SaveNewsletterDto, SaveUpcomingEventDto, type SaveAnnouncement, type SaveDocument, type SaveNewsletter, type SaveUpcomingEvent,
} from "../../dtos/content.dtos";

const MAX_UPLOAD = 55 * 1024 * 1024;
const IMAGE_TYPES = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Eight random capital letters (GenerateTempPassword). */
function generateTempPassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 8; i++) s += upper[randomInt(upper.length)];
  return s;
}

/**
 * Port of DistrictModulesController.cs, part 1: district-scoped content
 * (events, announcements, newsletters, documents), greetings, weblinks,
 * sub-groups, mass emails and the District Admin role.
 */
@Controller()
@Authorize()
export class DistrictContentController {
  private readonly log = new Logger("DistrictModulesController");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly events: UpcomingEventService,
    private readonly announcements: AnnouncementService,
    private readonly newsletters: NewsletterService,
    private readonly documents: DocumentService,
    private readonly masters: MastersService,
    private readonly groups: ClubGroupsService,
    private readonly massEmails: MassEmailService,
    private readonly roles: RoleService,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async blocked(districtId: number) {
    return !(await isDistrictDrillReachable(this.db, districtId)) ? statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE }) : null;
  }
  private static imageCheck(file: Upload | undefined) {
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (!IMAGE_TYPES.includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return null;
  }

  // ---- upcoming events ----

  @Get("api/districts/:districtId/upcoming-events")
  async getEvents(
    @Param("districtId") d: string, @Query("status") status?: string, @Query("search") search?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    const [p, ps] = [queryInt(page, 1), queryInt(pageSize, 10)];
    return (await this.blocked(districtId)) ?? ok(await this.events.getAll(0, queryString(status, "")!, queryString(search, "")!, p, ps, districtId));
  }

  @Post("api/districts/:districtId/upcoming-events/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadEventImage(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    const districtId = paramInt(d, "districtId");
    return DistrictContentController.imageCheck(file) ?? ok({ path: await this.events.uploadImage(districtId, file!) });
  }

  @Get("api/districts/:districtId/upcoming-events/:id")
  async getEvent(@Param("districtId") d: string, @Param("id") idText: string) {
    const districtId = paramInt(d, "districtId");
    const id = paramInt(idText);
    const block = await this.blocked(districtId);
    if (block) return block;
    const result = await this.events.getById(id);
    return result ? ok(result) : notFound({ message: "Event not found." });
  }

  @Post("api/districts/:districtId/upcoming-events")
  async createEvent(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    return ok({ id: await this.events.create(0, SaveUpcomingEventDto.create(body ?? {}) as unknown as SaveUpcomingEvent, this.userId(u), districtId) });
  }

  @Put("api/districts/:districtId/upcoming-events/:id")
  async updateEvent(@Param("districtId") d: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.events.update(paramInt(idText), SaveUpcomingEventDto.create(body ?? {}) as unknown as SaveUpcomingEvent, this.userId(u));
    return ok({ message: "Event updated successfully." });
  }

  @Delete("api/districts/:districtId/upcoming-events/:id")
  async deleteEvent(@Param("districtId") d: string, @Param("id") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.events.delete(paramInt(idText), this.userId(u));
    return ok({ message: "Event deleted successfully." });
  }

  // ---- announcements ----

  @Get("api/districts/:districtId/announcements")
  async getAnnouncements(
    @Param("districtId") d: string, @Query("status") status?: string, @Query("search") search?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    const [p, ps] = [queryInt(page, 1), queryInt(pageSize, 10)];
    return (await this.blocked(districtId)) ?? ok(await this.announcements.getAll(0, queryString(status, "")!, queryString(search, "")!, p, ps, districtId));
  }

  @Post("api/districts/:districtId/announcements/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadAnnouncementImage(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    const districtId = paramInt(d, "districtId");
    return DistrictContentController.imageCheck(file) ?? ok({ path: await this.announcements.uploadImage(districtId, file!) });
  }

  @Get("api/districts/:districtId/announcements/:id")
  async getAnnouncement(@Param("districtId") d: string, @Param("id") idText: string) {
    const districtId = paramInt(d, "districtId");
    const id = paramInt(idText);
    const block = await this.blocked(districtId);
    if (block) return block;
    const result = await this.announcements.getById(id);
    return result ? ok(result) : notFound({ message: "Announcement not found." });
  }

  @Post("api/districts/:districtId/announcements")
  async createAnnouncement(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    return ok({ id: await this.announcements.create(0, SaveAnnouncementDto.create(body ?? {}) as unknown as SaveAnnouncement, this.userId(u), districtId) });
  }

  @Put("api/districts/:districtId/announcements/:id")
  async updateAnnouncement(@Param("districtId") d: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.announcements.update(paramInt(idText), SaveAnnouncementDto.create(body ?? {}) as unknown as SaveAnnouncement, this.userId(u));
    return ok({ message: "Announcement updated successfully." });
  }

  @Delete("api/districts/:districtId/announcements/:id")
  async deleteAnnouncement(@Param("districtId") d: string, @Param("id") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.announcements.delete(paramInt(idText), this.userId(u));
    return ok({ message: "Announcement deleted successfully." });
  }

  // ---- newsletters ----

  @Get("api/districts/:districtId/newsletters")
  async getNewsletters(
    @Param("districtId") d: string, @Query("yearId") yearId?: string, @Query("status") status?: string, @Query("search") search?: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    const [y, p, ps] = [queryInt(yearId, 0), queryInt(page, 1), queryInt(pageSize, 10)];
    return (await this.blocked(districtId)) ?? ok(await this.newsletters.getAll(0, y, queryString(status, "")!, queryString(search, "")!, p, ps, districtId));
  }

  @Get("api/districts/:districtId/newsletters/years")
  async getNewsletterYears(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (await this.blocked(districtId)) ?? ok(await this.newsletters.getYears(0, districtId));
  }

  @Post("api/districts/:districtId/newsletters/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadNewsletter(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    const districtId = paramInt(d, "districtId");
    if (districtId <= 0) return badRequest({ message: "Invalid district id. Files cannot be uploaded without a district context." });
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (lowerExtension(file.originalname) !== ".pdf") return badRequest({ message: "Invalid file type. Only PDF files are allowed." });
    if (file.size > 20 * 1024 * 1024) return badRequest({ message: "File size must be less than 20 MB." });
    return ok({ path: await this.newsletters.uploadFile(districtId, file) });
  }

  @Get("api/districts/:districtId/newsletters/:id")
  async getNewsletter(@Param("districtId") d: string, @Param("id") idText: string) {
    const districtId = paramInt(d, "districtId");
    const id = paramInt(idText);
    const block = await this.blocked(districtId);
    if (block) return block;
    const result = await this.newsletters.getById(id);
    return result ? ok(result) : notFound({ message: "Newsletter not found." });
  }

  @Post("api/districts/:districtId/newsletters")
  async createNewsletter(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    return ok({ id: await this.newsletters.create(0, SaveNewsletterDto.create(body ?? {}) as unknown as SaveNewsletter, this.userId(u), districtId) });
  }

  @Put("api/districts/:districtId/newsletters/:id")
  async updateNewsletter(@Param("districtId") d: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.newsletters.update(paramInt(idText), SaveNewsletterDto.create(body ?? {}) as unknown as SaveNewsletter, this.userId(u));
    return ok({ message: "Newsletter updated successfully." });
  }

  @Delete("api/districts/:districtId/newsletters/:id")
  async deleteNewsletter(@Param("districtId") d: string, @Param("id") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.newsletters.delete(paramInt(idText), this.userId(u));
    return ok({ message: "Newsletter deleted successfully." });
  }

  // ---- documents ----

  @Get("api/districts/:districtId/documents")
  async getDocuments(
    @Param("districtId") d: string, @Query("status") status?: string, @Query("search") search?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    const [p, ps] = [queryInt(page, 1), queryInt(pageSize, 10)];
    return (await this.blocked(districtId)) ?? ok(await this.documents.getAll(0, queryString(status, "")!, queryString(search, "")!, p, ps, districtId));
  }

  /** Unlike the club endpoint, the district one checks only the size. */
  @Post("api/districts/:districtId/documents/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadDocument(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    const districtId = paramInt(d, "districtId");
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (file.size > 20 * 1024 * 1024) return badRequest({ message: "File size must be less than 20 MB." });
    return ok(await this.documents.uploadFile(districtId, file));
  }

  @Get("api/districts/:districtId/documents/:id")
  async getDocument(@Param("districtId") d: string, @Param("id") idText: string) {
    const districtId = paramInt(d, "districtId");
    const id = paramInt(idText);
    const block = await this.blocked(districtId);
    if (block) return block;
    const result = await this.documents.getById(id);
    return result ? ok(result) : notFound({ message: "Document not found." });
  }

  @Post("api/districts/:districtId/documents")
  async createDocument(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    return ok({ id: await this.documents.create(0, SaveDocumentDto.create(body ?? {}) as unknown as SaveDocument, this.userId(u), districtId) });
  }

  @Put("api/districts/:districtId/documents/:id")
  async updateDocument(@Param("districtId") d: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.documents.update(paramInt(idText), SaveDocumentDto.create(body ?? {}) as unknown as SaveDocument, this.userId(u));
    return ok({ message: "Document updated successfully." });
  }

  @Delete("api/districts/:districtId/documents/:id")
  async deleteDocument(@Param("districtId") d: string, @Param("id") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.documents.delete(paramInt(idText), this.userId(u));
    return ok({ message: "Document deleted successfully." });
  }

  // ---- greetings ----

  @Get("api/districts/:districtId/greetings")
  async getGreetings(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (await this.blocked(districtId)) ?? ok((await this.masters.getDistrictGreetingSettings(districtId)) ?? {});
  }

  @Put("api/districts/:districtId/greetings")
  async updateGreetings(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    await this.masters.updateDistrictGreetingSettings(districtId, UpdateDistrictGreetingSettingsDto.create(body ?? {}), this.userId(u));
    return ok({ message: "District greeting settings updated successfully." });
  }

  // ---- weblinks ----

  @Get("api/districts/:districtId/weblinks")
  async getWeblinks(@Param("districtId") d: string, @Query("parentId") parentId?: string) {
    const districtId = paramInt(d, "districtId");
    const p = queryInt(parentId);
    return (await this.blocked(districtId)) ?? ok(await this.groups.getWeblinks(0, p, districtId));
  }

  @Get("api/districts/:districtId/weblinks/tree")
  async getWeblinkTree(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (await this.blocked(districtId)) ?? ok(await this.groups.getWeblinkTree(0, districtId));
  }

  private async saveWeblink(work: () => Promise<unknown>) {
    try {
      return ok(await work());
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Post("api/districts/:districtId/weblinks")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async createWeblink(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @UploadedFiles() files: Upload[] | undefined, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const f = weblinkFiles(files);
    return (
      checkWeblinkFiles(f) ??
      this.saveWeblink(() => this.groups.createWeblink(0, SaveWeblinkDto.create(body ?? {}) as unknown as SaveWeblink, f, this.userId(u), districtId))
    );
  }

  @Put("api/districts/:districtId/weblinks/:weblinkId")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async updateWeblink(
    @Param("districtId") d: string, @Param("weblinkId") idText: string, @Body() body: Record<string, unknown>, @UploadedFiles() files: Upload[] | undefined,
    @User() u: CurrentUser,
  ) {
    const districtId = paramInt(d, "districtId");
    const id = paramInt(idText, "weblinkId");
    const f = weblinkFiles(files);
    return (
      checkWeblinkFiles(f) ??
      this.saveWeblink(() => this.groups.updateWeblink(0, id, SaveWeblinkDto.create(body ?? {}) as unknown as SaveWeblink, f, this.userId(u), districtId))
    );
  }

  @Delete("api/districts/:districtId/weblinks/:weblinkId")
  async deleteWeblink(@Param("districtId") d: string, @Param("weblinkId") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.groups.deleteWeblink(paramInt(idText, "weblinkId"), this.userId(u));
    return ok({ message: "Weblink deleted successfully." });
  }

  @Put("api/districts/:districtId/weblinks/:weblinkId/toggle-active")
  async toggleWeblink(@Param("districtId") d: string, @Param("weblinkId") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.groups.toggleWeblinkActive(paramInt(idText, "weblinkId"), this.userId(u));
    return ok({ message: "Weblink status toggled successfully." });
  }

  // ---- sub-groups ----

  @Get("api/districts/:districtId/sub-groups")
  async getSubGroups(@Param("districtId") d: string, @Query("yearId") yearId?: string) {
    const districtId = paramInt(d, "districtId");
    const y = queryInt(yearId, 0);
    return (await this.blocked(districtId)) ?? ok(await this.groups.getSubGroups(0, y, districtId));
  }

  @Get("api/districts/:districtId/sub-groups/available-years")
  async getSubGroupYears(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (await this.blocked(districtId)) ?? ok(await this.groups.getSubGroupYears(null, districtId));
  }

  @Get("api/districts/:districtId/sub-groups/district-members")
  async getSubGroupDistrictMembers(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (await this.blocked(districtId)) ?? ok(await this.groups.getSubGroupDistrictMembers(districtId));
  }

  @Get("api/districts/:districtId/sub-groups/:subGroupId")
  async getSubGroup(@Param("districtId") d: string, @Param("subGroupId") idText: string) {
    const districtId = paramInt(d, "districtId");
    const id = paramInt(idText, "subGroupId");
    const block = await this.blocked(districtId);
    if (block) return block;
    try {
      return ok(await this.groups.getSubGroupDetail(id));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      throw e;
    }
  }

  @Post("api/districts/:districtId/sub-groups")
  async createSubGroup(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const yearId = Math.trunc(Number(bodyField(body, "yearId") ?? 0)) || 0;
    return ok(await this.groups.createSubGroup(0, yearId, String(bodyField(body, "groupName") ?? ""), bodyIntList(body, "memberIds"), this.userId(u), districtId));
  }

  @Put("api/districts/:districtId/sub-groups/:subGroupId")
  async updateSubGroup(@Param("districtId") d: string, @Param("subGroupId") idText: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const yearId = Math.trunc(Number(bodyField(body, "yearId") ?? 0)) || 0;
    return ok(await this.groups.updateSubGroup(paramInt(idText, "subGroupId"), yearId, String(bodyField(body, "groupName") ?? ""), bodyIntList(body, "memberIds"), this.userId(u)));
  }

  @Delete("api/districts/:districtId/sub-groups/:subGroupId")
  async deleteSubGroup(@Param("districtId") d: string, @Param("subGroupId") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.groups.deleteSubGroup(paramInt(idText, "subGroupId"), this.userId(u));
    return ok({ message: "Sub group deleted successfully." });
  }

  // ---- mass emails ----

  @Get("api/mass-emails/sender-info")
  @AllowAnonymous()
  senderInfo() {
    return ok({ senderEmail: this.email.massEmailSenderEmail() });
  }

  @Get("api/districts/:districtId/mass-emails")
  async getMassEmails(
    @Param("districtId") d: string, @Query("status") status?: string, @Query("search") search?: string, @Query("page") pageText?: string, @Query("pageSize") pageSizeText?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    const [page, pageSize] = [queryInt(pageText, 1), queryInt(pageSizeText, 20)];
    const block = await this.blocked(districtId);
    if (block) return block;
    const { items, totalCount } = await this.massEmails.getList(0, queryString(status), queryString(search), page, pageSize, districtId);
    return ok({ items, totalCount, page, pageSize });
  }

  @Get("api/districts/:districtId/mass-emails/recipient-count")
  async getRecipientCount(
    @Param("districtId") d: string, @Query("recipientType") rt?: string, @Query("subgroupIds") subgroupIds?: string, @Query("clubIds") clubIds?: string,
    @Query("memberIds") memberIds?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    const recipientType = queryInt(rt, 0);
    const block = await this.blocked(districtId);
    if (block) return block;
    return ok(await this.massEmails.getRecipientCount(0, recipientType, parseIdList(subgroupIds), parseIdList(memberIds), districtId, parseIdList(clubIds)));
  }

  @Get("api/districts/:districtId/mass-emails/:id")
  async getMassEmail(@Param("districtId") d: string, @Param("id") idText: string) {
    const districtId = paramInt(d, "districtId");
    const id = paramInt(idText);
    const block = await this.blocked(districtId);
    if (block) return block;
    const detail = await this.massEmails.getDetail(id);
    return detail ? ok(detail) : notFound({ message: "Mass email not found." });
  }

  @Post("api/districts/:districtId/mass-emails")
  async createMassEmail(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    try {
      return ok({ id: await this.massEmails.create(0, bindCreateMassEmail(body), this.userId(u), districtId), message: "Mass email created successfully." });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Put("api/districts/:districtId/mass-emails/:id")
  async updateMassEmail(@Param("districtId") d: string, @Param("id") idText: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const id = paramInt(idText);
    try {
      await this.massEmails.update(id, bindCreateMassEmail(body), this.userId(u));
      return ok({ message: "Mass email updated successfully." });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Delete("api/districts/:districtId/mass-emails/:id")
  async deleteMassEmail(@Param("districtId") d: string, @Param("id") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const id = paramInt(idText);
    try {
      await this.massEmails.delete(id, this.userId(u));
      return ok({ message: "Mass email deleted successfully." });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Post("api/districts/:districtId/mass-emails/:id/send")
  async sendMassEmail(@Param("districtId") d: string, @Param("id") idText: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const id = paramInt(idText);
    try {
      await this.massEmails.send(id, this.userId(u));
      return ok({ message: "Mass email is being sent." });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Get("api/districts/:districtId/mass-emails/:id/recipients")
  async getMassEmailRecipients(@Param("districtId") d: string, @Param("id") idText: string) {
    const districtId = paramInt(d, "districtId");
    const id = paramInt(idText);
    return (await this.blocked(districtId)) ?? ok(await this.massEmails.getRecipients(id));
  }

  // ---- District Admin role ----

  @Post("api/districts/:districtId/members/:memberId/assign-admin")
  async assignAdmin(@Param("districtId") d: string, @Param("memberId") m: string, @User() u: CurrentUser) {
    return this.doAssignAdmin(paramInt(d, "districtId"), paramInt(m, "memberId"), this.userId(u));
  }

  private async doAssignAdmin(districtId: number, memberId: number, assignedBy: number) {
    const exists = Number(await this.db.executeScalar("SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0", { MemberId: memberId }));
    if (exists === 0) return notFound({ message: "Member not found." });
    try {
      await this.roles.checkRoleConflictPublic(memberId, 2);
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
    const { member, tempPassword } = await this.db.transaction(async (tx) => {
      const existing = await tx.executeScalar<number>(
        `SELECT pk_member_role_id FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId AND (fk_club_id IS NULL OR fk_club_id = 0) LIMIT 1`,
        { MemberId: memberId, DistrictId: districtId },
      );
      if (existing !== null && existing !== undefined) {
        await tx.execute(
          `UPDATE member_roles SET IsActive = 1, isdeleted = 0, RevokedDate = NULL, RevokedBy = NULL,
                  created_by = @AssignedBy, modified_by = @AssignedBy, modified_date = NOW()
           WHERE pk_member_role_id = @Id`,
          { Id: existing, AssignedBy: assignedBy },
        );
      } else {
        await tx.execute(
          `INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, IsActive, created_by)
           VALUES (@MemberId, 2, @DistrictId, 1, @AssignedBy)`,
          { MemberId: memberId, DistrictId: districtId, AssignedBy: assignedBy },
        );
      }
      const member = await tx.queryFirstOrDefault(
        "SELECT EmailId, MemberName, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
        { MemberId: memberId },
      );
      const cred = await tx.queryFirstOrDefault("SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @MemberId", { MemberId: memberId });
      let tempPassword: string | null = null;
      if (!cred) {
        tempPassword = generateTempPassword();
        await tx.execute(
          `INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
           VALUES (@MemberId, @Hash, 1, 1, @CreatedBy)`,
          { MemberId: memberId, Hash: bcrypt.hashSync(tempPassword, 11), CreatedBy: assignedBy },
        );
      } else if (Number(cred.isdeleted) === 1) {
        tempPassword = generateTempPassword();
        await tx.execute(
          `UPDATE member_credentials SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0, modified_by = @ModifiedBy, modified_date = NOW()
           WHERE fk_member_master_profile_id = @MemberId`,
          { MemberId: memberId, Hash: bcrypt.hashSync(tempPassword, 11), ModifiedBy: assignedBy },
        );
      } else if (Number(cred.IsActive) === 0) {
        await tx.execute(
          "UPDATE member_credentials SET IsActive = 1, modified_by = @ModifiedBy, modified_date = NOW() WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
          { MemberId: memberId, ModifiedBy: assignedBy },
        );
      }
      return { member, tempPassword };
    });
    try {
      if (member?.EmailId) {
        const rolesHtml = await DistrictContentController.allRolesHtml(this.db, memberId);
        const loginUrl = (this.config.get("FrontendUrl") ?? "").replace(/\/+$/, "") + "/login";
        const box = "<div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>";
        const credentialsHtml =
          tempPassword !== null
            ? `${box}
                            <p><strong>Login URL:</strong> <a href='${loginUrl}' style='color: #3182ce;'>${loginUrl}</a></p>
                            ${member.PrimaryMobileNumber && String(member.PrimaryMobileNumber).trim() ? `<p><strong>Username (Mobile):</strong> ${member.PrimaryMobileNumber}</p>` : ""}
                            <p><strong>Username (Email):</strong> ${member.EmailId}</p>
                            <p><strong>Temporary Password:</strong> ${tempPassword}</p>
                        </div>
                        <p style='color: #e53e3e;'><strong>Important:</strong> Please change your password after your first login.</p>`
            : `${box}
                            <p><strong>Login URL:</strong> <a href='${loginUrl}' style='color: #3182ce;'>${loginUrl}</a></p>
                            <p>Please use your existing credentials to login.</p>
                        </div>`;
        const body = `${emailHeader()}
                            <h2 style='color: #1a365d; margin-top: 0;'>Role Assignment Notification</h2>
                            <p>Dear ${member.MemberName},</p>
                            <p>You have been assigned the following role(s) on the ${Brand.Current.productName} Admin Portal:</p>
                            ${rolesHtml}
                            ${credentialsHtml}
                            <div style='text-align: center; margin: 24px 0;'>
                                <a href='${loginUrl}' style='background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;'>Login Now</a>
                            </div>
                    ${emailFooter()}`;
        await this.email.sendGenericEmail(String(member.EmailId), `${Brand.Current.shortName} - Your Role Assignment`, body);
      }
    } catch (e) {
      return ok({ message: `District Admin role assigned successfully. Email failed: ${message(e)}` });
    }
    return ok({ message: "District Admin role assigned successfully. Email sent." });
  }

  /** BuildAllRolesHtmlAsync (the district controller's own variant). */
  private static async allRolesHtml(conn: DbCommands, memberId: number) {
    const roles = await conn.query(
      `SELECT r.fk_role_id AS RoleId,
              CASE r.fk_role_id
                  WHEN 2 THEN CASE WHEN r.fk_district_id IS NOT NULL THEN 'District Admin' ELSE 'Club Admin' END
                  WHEN 3 THEN 'Super Admin'
                  WHEN 4 THEN 'Zonal Coordinator'
                  ELSE 'Member'
              END AS RoleName,
              c.ClubName, d.DistrictNumber, d2.DistrictNumber AS DirectDistrictNumber, z.ZoneName
       FROM member_roles r
       LEFT JOIN club_master c ON r.fk_club_id = c.pk_club_id
       LEFT JOIN district_master d ON c.fk_district_id = d.pk_district_id
       LEFT JOIN district_master d2 ON r.fk_district_id = d2.pk_district_id
       LEFT JOIN zone_master z ON r.fk_zone_id = z.pk_zone_id
       WHERE r.fk_member_master_profile_id = @MemberId AND r.IsActive = 1 AND r.isdeleted = 0
       ORDER BY r.fk_role_id`,
      { MemberId: memberId },
    );
    const cell = "padding: 8px 12px; border: 1px solid #ddd;";
    let html =
      "<table style='border-collapse: collapse; width: 100%; margin: 12px 0;'>" +
      "<tr style='background-color: #17458F; color: white;'>" +
      `<th style='${cell} text-align: left;'>Role</th>` +
      `<th style='${cell} text-align: left;'>Details</th>` +
      "</tr>";
    for (const r of roles) {
      const roleId = Number(r.RoleId);
      let details = "";
      // As in RIZones fk_district_id is not selected, so this branch never runs (see ROW-CHANGES.md).
      if (roleId === 2 && r.fk_district_id !== undefined && r.fk_district_id !== null) details = `District ${r.DirectDistrictNumber ?? ""}`;
      else if (roleId === 2) details = `District ${r.DistrictNumber ?? ""} - ${r.ClubName ?? ""}`;
      else if (roleId === 3) details = "All Districts & Clubs";
      else if (roleId === 4) details = r.ZoneName ?? "";
      html += `<tr><td style='${cell} font-weight: bold;'>${r.RoleName}</td><td style='${cell}'>${details}</td></tr>`;
    }
    return html + "</table>";
  }

  @Post("api/districts/:districtId/members/:memberId/remove-admin")
  async removeAdmin(@Param("districtId") d: string, @Param("memberId") m: string, @User() u: CurrentUser, @Query("sendEmail") sendEmailText?: string) {
    const districtId = paramInt(d, "districtId");
    const memberId = paramInt(m, "memberId");
    const sendEmail = queryBool(sendEmailText, true)!;
    const affected = await this.db.execute(
      `UPDATE member_roles SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @RevokedBy
       WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0`,
      { MemberId: memberId, DistrictId: districtId, RevokedBy: this.userId(u) },
    );
    if (affected === 0) return badRequest({ message: "No active District Admin role found for this member." });
    const otherRoles = Number(
      await this.db.executeScalar(
        `SELECT COUNT(*) FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
         WHERE mr.fk_member_master_profile_id = @MemberId AND mr.IsActive = 1 AND mr.isdeleted = 0
           AND r.RoleName IN ('Admin', 'SuperAdmin', 'ZonalCoordinator')`,
        { MemberId: memberId },
      ),
    );
    if (otherRoles === 0 && !(await hasActiveGoalRole(this.db, memberId))) {
      await this.db.execute("UPDATE member_credentials SET IsActive = 0 WHERE fk_member_master_profile_id = @MemberId", { MemberId: memberId });
    }
    if (sendEmail) {
      void (async () => {
        const mem = await this.db.queryFirstOrDefault("SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
        if (!mem || !mem.EmailId || !String(mem.EmailId).trim()) return;
        const districtNumber = await this.db.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId });
        await this.email.sendRoleOrMembershipRemovedEmail(String(mem.EmailId), String(mem.MemberName), "District Admin role", districtNumber && districtNumber.trim() ? `District ${districtNumber}` : null, null);
      })().catch((e) => this.log.warn(`remove-admin email: ${message(e)}`));
    }
    return ok({ message: sendEmail ? "District Admin role removed successfully." : "District Admin role removed (no email sent)." });
  }

  @Post("api/districts/:districtId/members/:memberId/club-access")
  async setClubAccess(@Param("districtId") d: string, @Param("memberId") m: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const memberId = paramInt(m, "memberId");
    if (!(u.findFirst("roles") ?? "").includes("SuperAdmin")) return statusCode(403, { message: "Only SuperAdmin can change District Admin club access." });
    const enabled = bodyField(body, "enabled") === true;
    const rows = await this.db.execute(
      `UPDATE member_roles SET AllClubsAccess = @Enabled, modified_by = @By, modified_date = NOW()
       WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId
         AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0`,
      { Enabled: enabled ? 1 : 0, MemberId: memberId, DistrictId: districtId, By: this.userId(u) },
    );
    if (rows === 0) return badRequest({ message: "This member is not an active District Admin for this district. Assign District Admin first." });
    return ok({ message: enabled ? "All-clubs access enabled." : "All-clubs access disabled.", allClubsAccess: enabled });
  }

  private static isDistrictAdmin(conn: DbCommands, caller: number, districtId: number, allClubs: boolean) {
    return conn.executeScalar(
      `SELECT COUNT(*) FROM member_roles
       WHERE fk_member_master_profile_id = @Caller AND fk_role_id = 2 AND fk_district_id = @DistrictId
         AND (fk_club_id IS NULL OR fk_club_id = 0) ${allClubs ? "AND AllClubsAccess = 1" : ""} AND IsActive = 1 AND isdeleted = 0`,
      { Caller: caller, DistrictId: districtId },
    );
  }

  @Post("api/district-admin/districts/:districtId/members/:memberId/assign-admin")
  async assignAdminByDistrictAdmin(@Param("districtId") d: string, @Param("memberId") m: string, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const memberId = paramInt(m, "memberId");
    if (!(u.findFirst("roles") ?? "").includes("SuperAdmin") && Number(await DistrictContentController.isDistrictAdmin(this.db, this.userId(u), districtId, false)) === 0) {
      return statusCode(403, { message: "You are not a District Admin for this district." });
    }
    return this.doAssignAdmin(districtId, memberId, this.userId(u));
  }

  @Get("api/district-admin/districts/:districtId/all-clubs")
  async allClubs(@Param("districtId") d: string, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    if (!(u.findFirst("roles") ?? "").includes("SuperAdmin") && Number(await DistrictContentController.isDistrictAdmin(this.db, this.userId(u), districtId, true)) === 0) {
      return statusCode(403, { message: "You do not have all-clubs access for this district." });
    }
    return ok(
      await this.db.query(
        "SELECT pk_club_id AS clubId, ClubName AS clubName, ClubRotaryId AS clubRotaryId FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club' ORDER BY ClubName",
        { DistrictId: districtId },
      ),
    );
  }
}
