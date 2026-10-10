import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AnnouncementService } from "./announcement.service";
import { DocumentService } from "./document.service";
import { UpcomingEventService } from "./upcoming-event.service";
import { NewsletterService } from "./newsletter.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { paramInt, queryInt, queryString, requireFile } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { ClubSiteCachePurger } from "../../services/club-site-cache-purger";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";
import {
  SaveAnnouncementDto, SaveDocumentDto, SaveNewsletterDto, SaveUpcomingEventDto, type SaveAnnouncement, type SaveDocument, type SaveNewsletter, type SaveUpcomingEvent,
} from "../../dtos/content.dtos";

const MAX_UPLOAD = 55 * 1024 * 1024;

/** Ports of AnnouncementsController.cs, DocumentsController.cs, UpcomingEventsController.cs and NewslettersController.cs (club scope). */
@Controller("api/clubs/:clubId")
@Authorize()
export class ClubContentController {
  constructor(
    private readonly announcements: AnnouncementService,
    private readonly documents: DocumentService,
    private readonly events: UpcomingEventService,
    private readonly newsletters: NewsletterService,
    private readonly db: Db,
    private readonly purger: ClubSiteCachePurger,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  // ---- announcements ----

  @Get("announcements")
  async getAnnouncements(
    @Param("clubId") clubText: string, @Query("status") status?: string, @Query("search") search?: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const clubId = paramInt(clubText, "clubId");
    const p = queryInt(page, 1);
    const ps = queryInt(pageSize, 10);
    return (await this.blocked(clubId)) ?? ok(await this.announcements.getAll(clubId, queryString(status, "")!, queryString(search, "")!, p, ps));
  }

  @Post("announcements/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadAnnouncementImage(@Param("clubId") clubText: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    const clubId = paramInt(clubText, "clubId");
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return ok({ path: await this.announcements.uploadImage(clubId, file) });
  }

  @Get("announcements/:id")
  async getAnnouncement(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const result = await this.announcements.getById(id);
    return result ? ok(result) : notFound({ message: "Announcement not found." });
  }

  @Post("announcements")
  async createAnnouncement(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const id = await this.announcements.create(clubId, SaveAnnouncementDto.create(body ?? {}) as unknown as SaveAnnouncement, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ id });
  }

  @Put("announcements/:id")
  async updateAnnouncement(@Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    await this.announcements.update(paramInt(idText), SaveAnnouncementDto.create(body ?? {}) as unknown as SaveAnnouncement, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Announcement updated successfully." });
  }

  @Delete("announcements/:id")
  async deleteAnnouncement(@Param("clubId") clubText: string, @Param("id") idText: string, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    await this.announcements.delete(paramInt(idText), this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Announcement deleted successfully." });
  }

  // ---- documents ----

  @Get("documents")
  async getDocuments(
    @Param("clubId") clubText: string, @Query("status") status?: string, @Query("search") search?: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const clubId = paramInt(clubText, "clubId");
    const p = queryInt(page, 1);
    const ps = queryInt(pageSize, 10);
    return (await this.blocked(clubId)) ?? ok(await this.documents.getAll(clubId, queryString(status, "")!, queryString(search, "")!, p, ps));
  }

  @Post("documents/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadDocument(@Param("clubId") clubText: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    const clubId = paramInt(clubText, "clubId");
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (![".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"].includes(lowerExtension(file.originalname))) {
      return badRequest({ message: "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX" });
    }
    if (file.size > 20 * 1024 * 1024) return badRequest({ message: "File size must be less than 20 MB." });
    return ok(await this.documents.uploadFile(clubId, file));
  }

  @Get("documents/:id")
  async getDocument(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const result = await this.documents.getById(id);
    return result ? ok(result) : notFound({ message: "Document not found." });
  }

  @Post("documents")
  async createDocument(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    return ok({ id: await this.documents.create(clubId, SaveDocumentDto.create(body ?? {}) as unknown as SaveDocument, this.userId(user)) });
  }

  @Put("documents/:id")
  async updateDocument(@Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.documents.update(paramInt(idText), SaveDocumentDto.create(body ?? {}) as unknown as SaveDocument, this.userId(user));
    return ok({ message: "Document updated successfully." });
  }

  @Delete("documents/:id")
  async deleteDocument(@Param("clubId") clubText: string, @Param("id") idText: string, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.documents.delete(paramInt(idText), this.userId(user));
    return ok({ message: "Document deleted successfully." });
  }

  // ---- upcoming events ----

  @Get("upcoming-events")
  async getEvents(
    @Param("clubId") clubText: string, @Query("status") status?: string, @Query("search") search?: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const clubId = paramInt(clubText, "clubId");
    const p = queryInt(page, 1);
    const ps = queryInt(pageSize, 10);
    return (await this.blocked(clubId)) ?? ok(await this.events.getAll(clubId, queryString(status, "")!, queryString(search, "")!, p, ps));
  }

  @Post("upcoming-events/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadEventImage(@Param("clubId") clubText: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    const clubId = paramInt(clubText, "clubId");
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return ok({ path: await this.events.uploadImage(clubId, file) });
  }

  @Get("upcoming-events/:id")
  async getEvent(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const result = await this.events.getById(id);
    return result ? ok(result) : notFound({ message: "Event not found." });
  }

  @Post("upcoming-events")
  async createEvent(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const id = await this.events.create(clubId, SaveUpcomingEventDto.create(body ?? {}) as unknown as SaveUpcomingEvent, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ id });
  }

  @Put("upcoming-events/:id")
  async updateEvent(@Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    await this.events.update(paramInt(idText), SaveUpcomingEventDto.create(body ?? {}) as unknown as SaveUpcomingEvent, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Event updated successfully." });
  }

  @Delete("upcoming-events/:id")
  async deleteEvent(@Param("clubId") clubText: string, @Param("id") idText: string, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    await this.events.delete(paramInt(idText), this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Event deleted successfully." });
  }

  // ---- newsletters ----

  @Get("newsletters")
  async getNewsletters(
    @Param("clubId") clubText: string, @Query("yearId") yearId?: string, @Query("status") status?: string, @Query("search") search?: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const clubId = paramInt(clubText, "clubId");
    const y = queryInt(yearId, 0);
    const p = queryInt(page, 1);
    const ps = queryInt(pageSize, 10);
    return (await this.blocked(clubId)) ?? ok(await this.newsletters.getAll(clubId, y, queryString(status, "")!, queryString(search, "")!, p, ps));
  }

  @Get("newsletters/years")
  async getNewsletterYears(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.newsletters.getYears(clubId));
  }

  @Post("newsletters/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadNewsletter(@Param("clubId") clubText: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    const clubId = paramInt(clubText, "clubId");
    if (clubId <= 0) return badRequest({ message: "Invalid club id. Files cannot be uploaded without a club context." });
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (lowerExtension(file.originalname) !== ".pdf") return badRequest({ message: "Invalid file type. Only PDF files are allowed." });
    if (file.size > 20 * 1024 * 1024) return badRequest({ message: "File size must be less than 20 MB." });
    return ok({ path: await this.newsletters.uploadFile(clubId, file) });
  }

  @Get("newsletters/:id")
  async getNewsletter(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const result = await this.newsletters.getById(id);
    return result ? ok(result) : notFound({ message: "Newsletter not found." });
  }

  @Post("newsletters")
  async createNewsletter(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const id = await this.newsletters.create(clubId, SaveNewsletterDto.create(body ?? {}) as unknown as SaveNewsletter, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ id });
  }

  @Put("newsletters/:id")
  async updateNewsletter(@Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    await this.newsletters.update(paramInt(idText), SaveNewsletterDto.create(body ?? {}) as unknown as SaveNewsletter, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Newsletter updated successfully." });
  }

  @Delete("newsletters/:id")
  async deleteNewsletter(@Param("clubId") clubText: string, @Param("id") idText: string, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    await this.newsletters.delete(paramInt(idText), this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Newsletter deleted successfully." });
  }
}
