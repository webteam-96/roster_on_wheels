import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { paramInt, queryInt, queryString, requireFile } from "../../common/binding";
import { badRequest, file as fileResult, notFound, ok } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { Brand } from "../../brand/brand";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";
import { XLSX_CONTENT_TYPE } from "../../services/xlsx";
import { RiDirectorService } from "./ri-director.service";

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
/** [FromQuery] int[]: ?zoneIds=1&zoneIds=2; missing = null. */
const queryInts = (v: string | string[] | undefined) => (v === undefined ? null : (Array.isArray(v) ? v : [v]).map(Number).filter(Number.isFinite).map(Math.trunc));
/** The C# actions' catch (InvalidOperationException) → 400 { message }. */
async function invalidOp<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (e) {
    if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
    throw e;
  }
}
const stamp = () => formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "yyyyMMdd_HHmmss");

/** Port of RiDirectorController.cs ([Authorize] only — no role check, as in RIZones). */
@Controller()
@Authorize()
export class RiDirectorController {
  constructor(private readonly ri: RiDirectorService) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10) || 0;
  private page = (p?: string, size?: string, d = 10) => [queryInt(p, 1), queryInt(size, d)] as const;

  @Get("api/ri-director/context")
  async context() { return ok(await this.ri.getContext()); }

  // ── Credits ──
  @Get("api/ri-director/credits/balance")
  async creditBalance() { return ok(await this.ri.getCreditBalance()); }

  @Get("api/ri-director/credits/history")
  async creditHistory(@Query("creditType") t?: string, @Query("page") p?: string, @Query("pageSize") ps?: string) {
    const [page, size] = this.page(p, ps, 20);
    return ok(await this.ri.getUsageHistory(queryString(t), page, size));
  }

  @Get("api/ri-director/credits")
  async credits(@Query("creditType") t?: string, @Query("page") p?: string, @Query("pageSize") ps?: string) {
    const [page, size] = this.page(p, ps, 20);
    return ok(await this.ri.getCredits(queryString(t), page, size));
  }

  @Post("api/ri-director/credits")
  @UseInterceptors(AnyFilesInterceptor())
  async addCredit(@User() u: CurrentUser, @Body() body: unknown, @UploadedFiles() files?: (Upload & { fieldname: string })[]) {
    const proof = (files ?? []).find((x) => x.fieldname.toLowerCase() === "proofdocument") ?? null;
    return ok({ id: await this.ri.addCredit(body ?? {}, proof, this.userId(u)) });
  }

  // ── Announcements ──
  @Get("api/ri-director/announcements")
  async announcements(@Query("status") s?: string, @Query("search") q?: string, @Query("page") p?: string, @Query("pageSize") ps?: string) {
    const [page, size] = this.page(p, ps);
    return ok(await this.ri.getAnnouncements(queryString(s, "")!, queryString(q, "")!, page, size));
  }

  @Post("api/ri-director/announcements/upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadAnnouncementImage(@UploadedFile() file?: Upload) {
    requireFile(file);
    if (!file || !file.size) return badRequest({ message: "No file uploaded" });
    if (!IMAGE_EXTS.includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return ok({ path: await this.ri.uploadAnnouncementImage(file) });
  }

  @Get("api/ri-director/announcements/:id")
  async announcement(@Param("id") id: string) {
    const r = await this.ri.getAnnouncementById(paramInt(id));
    return r ? ok(r) : notFound({ message: "Announcement not found." });
  }

  @Post("api/ri-director/announcements")
  async createAnnouncement(@User() u: CurrentUser, @Body() body: unknown) {
    return ok({ id: await this.ri.createAnnouncement(body ?? {}, this.userId(u)) });
  }

  @Put("api/ri-director/announcements/:id")
  async updateAnnouncement(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    await this.ri.updateAnnouncement(paramInt(id), body ?? {}, this.userId(u));
    return ok({ message: "Announcement updated successfully." });
  }

  @Delete("api/ri-director/announcements/:id")
  async deleteAnnouncement(@User() u: CurrentUser, @Param("id") id: string) {
    await this.ri.deleteAnnouncement(paramInt(id), this.userId(u));
    return ok({ message: "Announcement deleted successfully." });
  }

  @Get("api/ri-director/recipients/count")
  async recipientCount(@Query("channel") c?: string, @Query("target") t?: string, @Query("zoneIds") z?: string | string[], @Query("districtIds") d?: string | string[], @Query("subgroupIds") g?: string | string[]) {
    return ok({ count: await this.ri.getRecipientCount(queryString(c, "email")!, queryString(t, "all")!, queryInts(z), queryInts(d), queryInts(g)) });
  }

  // ── Upcoming events ──
  @Get("api/ri-director/upcoming-events")
  async events(@Query("status") s?: string, @Query("search") q?: string, @Query("page") p?: string, @Query("pageSize") ps?: string) {
    const [page, size] = this.page(p, ps);
    return ok(await this.ri.getUpcomingEvents(queryString(s, "")!, queryString(q, "")!, page, size));
  }

  @Post("api/ri-director/upcoming-events/upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadEventImage(@UploadedFile() file?: Upload) {
    requireFile(file);
    if (!file || !file.size) return badRequest({ message: "No file uploaded" });
    if (!IMAGE_EXTS.includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type." });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return ok({ path: await this.ri.uploadUpcomingEventImage(file) });
  }

  @Get("api/ri-director/upcoming-events/:id")
  async event(@Param("id") id: string) {
    const r = await this.ri.getUpcomingEventById(paramInt(id));
    return r ? ok(r) : notFound({ message: "Event not found." });
  }

  @Post("api/ri-director/upcoming-events")
  createEvent(@User() u: CurrentUser, @Body() body: unknown) {
    return invalidOp(async () => ok({ id: await this.ri.createUpcomingEvent(body ?? {}, this.userId(u)) }));
  }

  @Put("api/ri-director/upcoming-events/:id")
  updateEvent(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    const eventId = paramInt(id);
    return invalidOp(async () => {
      await this.ri.updateUpcomingEvent(eventId, body ?? {}, this.userId(u));
      return ok({ message: "Event updated successfully." });
    });
  }

  @Delete("api/ri-director/upcoming-events/:id")
  async deleteEvent(@User() u: CurrentUser, @Param("id") id: string) {
    await this.ri.deleteUpcomingEvent(paramInt(id), this.userId(u));
    return ok({ message: "Event deleted successfully." });
  }

  // ── Sub groups ──
  @Get("api/ri-director/sub-groups")
  async subGroups(@Query("yearId") y?: string) { return ok(await this.ri.getSubGroups(queryInt(y))); }

  @Get("api/ri-director/sub-groups/years")
  async subGroupYears() { return ok(await this.ri.getSubGroupYears()); }

  @Get("api/ri-director/sub-groups/available-members")
  async availableMembers(@Query("search") q?: string) { return ok(await this.ri.getAvailableMembers(queryString(q))); }

  @Get("api/ri-director/sub-groups/:id")
  async subGroup(@Param("id") id: string) {
    const r = await this.ri.getSubGroupById(paramInt(id));
    return r ? ok(r) : notFound({ message: "Sub group not found." });
  }

  @Post("api/ri-director/sub-groups")
  createSubGroup(@User() u: CurrentUser, @Body() body: unknown) {
    return invalidOp(async () => ok({ id: await this.ri.createSubGroup(body ?? {}, this.userId(u)) }));
  }

  @Put("api/ri-director/sub-groups/:id")
  updateSubGroup(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    const groupId = paramInt(id);
    return invalidOp(async () => {
      await this.ri.updateSubGroup(groupId, body ?? {}, this.userId(u));
      return ok({ message: "Sub group updated successfully." });
    });
  }

  @Delete("api/ri-director/sub-groups/:id")
  async deleteSubGroup(@User() u: CurrentUser, @Param("id") id: string) {
    await this.ri.deleteSubGroup(paramInt(id), this.userId(u));
    return ok({ message: "Sub group deleted successfully." });
  }

  // ── Mass emails ──
  @Get("api/ri-director/mass-emails")
  async massEmails(@Query("status") s?: string, @Query("search") q?: string, @Query("page") p?: string, @Query("pageSize") ps?: string) {
    const [page, size] = this.page(p, ps);
    return ok(await this.ri.getMassEmails(queryString(s, "")!, queryString(q, "")!, page, size));
  }

  @Get("api/ri-director/mass-emails/:id")
  async massEmail(@Param("id") id: string) {
    const r = await this.ri.getMassEmailById(paramInt(id));
    return r ? ok(r) : notFound({ message: "Mass email not found." });
  }

  @Post("api/ri-director/mass-emails")
  createMassEmail(@User() u: CurrentUser, @Body() body: unknown) {
    return invalidOp(async () => ok({ id: await this.ri.createMassEmail(body ?? {}, this.userId(u)) }));
  }

  @Put("api/ri-director/mass-emails/:id")
  updateMassEmail(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    const emailId = paramInt(id);
    return invalidOp(async () => {
      await this.ri.updateMassEmail(emailId, body ?? {}, this.userId(u));
      return ok({ message: "Mass email updated." });
    });
  }

  @Delete("api/ri-director/mass-emails/:id")
  async deleteMassEmail(@User() u: CurrentUser, @Param("id") id: string) {
    await this.ri.deleteMassEmail(paramInt(id), this.userId(u));
    return ok({ message: "Mass email deleted." });
  }

  @Post("api/ri-director/mass-emails/:id/send")
  sendMassEmail(@User() u: CurrentUser, @Param("id") id: string) {
    const emailId = paramInt(id);
    return invalidOp(async () => {
      await this.ri.sendMassEmail(emailId, this.userId(u));
      return ok({ message: "Mass email is being sent." });
    });
  }

  // ── Web links ──
  @Get("api/ri-director/weblinks")
  async weblinks() { return ok(await this.ri.getWeblinks()); }

  @Get("api/ri-director/weblinks/:id")
  async weblink(@Param("id") id: string) {
    const r = await this.ri.getWeblinkById(paramInt(id));
    return r ? ok(r) : notFound({ message: "Weblink not found." });
  }

  @Post("api/ri-director/weblinks")
  createWeblink(@User() u: CurrentUser, @Body() body: unknown) {
    return invalidOp(async () => ok({ id: await this.ri.createWeblink(body ?? {}, this.userId(u)) }));
  }

  @Put("api/ri-director/weblinks/:id")
  updateWeblink(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    const linkId = paramInt(id);
    return invalidOp(async () => {
      await this.ri.updateWeblink(linkId, body ?? {}, this.userId(u));
      return ok({ message: "Updated." });
    });
  }

  @Delete("api/ri-director/weblinks/:id")
  async deleteWeblink(@User() u: CurrentUser, @Param("id") id: string) {
    await this.ri.deleteWeblink(paramInt(id), this.userId(u));
    return ok({ message: "Deleted." });
  }

  // ── Documents ──
  @Get("api/ri-director/documents")
  async documents(@Query("status") s?: string, @Query("search") q?: string, @Query("page") p?: string, @Query("pageSize") ps?: string) {
    const [page, size] = this.page(p, ps, 20);
    return ok(await this.ri.getDocuments(queryString(s, "")!, queryString(q, "")!, page, size));
  }

  @Post("api/ri-director/documents/upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadDocument(@UploadedFile() file?: Upload) {
    requireFile(file);
    if (!file || !file.size) return badRequest({ message: "No file uploaded" });
    if (file.size > 20 * 1024 * 1024) return badRequest({ message: "File must be under 20MB" });
    const r = await this.ri.uploadDocumentFile(file);
    return ok({ path: r.path, originalFileName: r.originalName });
  }

  @Get("api/ri-director/documents/:id")
  async document(@Param("id") id: string) {
    const r = await this.ri.getDocumentById(paramInt(id));
    return r ? ok(r) : notFound({ message: "Document not found." });
  }

  @Post("api/ri-director/documents")
  async createDocument(@User() u: CurrentUser, @Body() body: unknown) {
    return ok({ id: await this.ri.createDocument(body ?? {}, this.userId(u)) });
  }

  @Put("api/ri-director/documents/:id")
  async updateDocument(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    await this.ri.updateDocument(paramInt(id), body ?? {}, this.userId(u));
    return ok({ message: "Updated." });
  }

  @Delete("api/ri-director/documents/:id")
  async deleteDocument(@User() u: CurrentUser, @Param("id") id: string) {
    await this.ri.deleteDocument(paramInt(id), this.userId(u));
    return ok({ message: "Deleted." });
  }

  // ── Newsletters ──
  @Get("api/ri-director/newsletters")
  async newsletters(@Query("status") s?: string, @Query("search") q?: string, @Query("page") p?: string, @Query("pageSize") ps?: string) {
    const [page, size] = this.page(p, ps, 20);
    return ok(await this.ri.getNewsletters(queryString(s, "")!, queryString(q, "")!, page, size));
  }

  @Post("api/ri-director/newsletters/upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadNewsletter(@UploadedFile() file?: Upload) {
    requireFile(file);
    if (!file || !file.size) return badRequest({ message: "No file uploaded" });
    if (file.size > 20 * 1024 * 1024) return badRequest({ message: "File must be under 20 MB." });
    return ok({ path: await this.ri.uploadNewsletterFile(file) });
  }

  @Get("api/ri-director/newsletters/:id")
  async newsletter(@Param("id") id: string) {
    const r = await this.ri.getNewsletterById(paramInt(id));
    return r ? ok(r) : notFound({ message: "Newsletter not found." });
  }

  @Post("api/ri-director/newsletters")
  createNewsletter(@User() u: CurrentUser, @Body() body: unknown) {
    return invalidOp(async () => ok({ id: await this.ri.createNewsletter(body ?? {}, this.userId(u)) }));
  }

  @Put("api/ri-director/newsletters/:id")
  updateNewsletter(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    const nlId = paramInt(id);
    return invalidOp(async () => {
      await this.ri.updateNewsletter(nlId, body ?? {}, this.userId(u));
      return ok({ message: "Updated." });
    });
  }

  @Delete("api/ri-director/newsletters/:id")
  async deleteNewsletter(@User() u: CurrentUser, @Param("id") id: string) {
    await this.ri.deleteNewsletter(paramInt(id), this.userId(u));
    return ok({ message: "Deleted." });
  }

  // ── Reports ──
  @Get("api/ri-director/reports/zones")
  async reportZones() { return fileResult(await this.ri.getReportZonesXlsx(), XLSX_CONTENT_TYPE, `ri_zones_${stamp()}.xlsx`); }

  @Get("api/ri-director/reports/districts")
  async reportDistricts() { return fileResult(await this.ri.getReportDistrictsXlsx(), XLSX_CONTENT_TYPE, `ri_districts_${stamp()}.xlsx`); }

  @Get("api/ri-director/reports/clubs")
  async reportClubs() { return fileResult(await this.ri.getReportClubsXlsx(), XLSX_CONTENT_TYPE, `ri_clubs_${stamp()}.xlsx`); }

  @Get("api/ri-director/reports/members")
  async reportMembers() { return fileResult(await this.ri.getReportMembersXlsx(), XLSX_CONTENT_TYPE, `ri_members_${stamp()}.xlsx`); }

  @Get("api/ri-director/reports/communications")
  async reportCommunications() { return fileResult(await this.ri.getReportCommunicationsXlsx(), XLSX_CONTENT_TYPE, `ri_communications_${stamp()}.xlsx`); }
}
