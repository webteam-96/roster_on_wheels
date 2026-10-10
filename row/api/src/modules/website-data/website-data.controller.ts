import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  SaveClubAboutDto, SaveClubAdvertisementDto, SaveClubBannerDto, SaveClubContactDetailDto, SaveClubSocialLinkDto, SaveWebsiteDataModuleDto,
  WebsiteDataService, type SaveClubAdvertisement, type SaveClubBanner,
} from "./website-data.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { bodyField, bodyIntList, paramInt, queryBool, queryInt, requireFile } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { ClubSiteCachePurger } from "../../services/club-site-cache-purger";
import { ensureWithinLimit, validateImage } from "../../services/image-tools";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";

const MAX_UPLOAD = 55 * 1024 * 1024;
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const DOC_EXT = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png"];
const bodyInt = (body: unknown, name: string) => Math.trunc(Number(bodyField(body, name) ?? 0)) || 0;

/** Simple image upload checks (about, advertisements). */
function checkImage(file: Upload | undefined) {
  if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
  if (!IMAGE_EXT.includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
  if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
  return null;
}

function checkDocument(file: Upload | undefined) {
  if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
  if (!DOC_EXT.includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx, jpg, jpeg, png" });
  if (file.size > 10 * 1024 * 1024) return badRequest({ message: "File size must be less than 10 MB." });
  return null;
}

/**
 * Ports of ClubAboutController.cs, ClubContactDetailController.cs, ClubSocialLinkController.cs,
 * ClubThemeController.cs, ClubBannerController.cs, ClubAdvertisementController.cs and
 * WebsiteDataModulesController.cs.
 */
@Controller("api")
@Authorize()
export class WebsiteDataController {
  constructor(
    private readonly data: WebsiteDataService,
    private readonly db: Db,
    private readonly purger: ClubSiteCachePurger,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  // ---- about ----

  @Get("clubs/:clubId/website-data/about")
  async getAbout(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.data.getAbout(clubId));
  }

  @Post("clubs/:clubId/website-data/about/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadAbout(@Param("clubId") c: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    paramInt(c, "clubId");
    return checkImage(file) ?? ok({ path: await this.data.upload(file!, "about") });
  }

  @Get("clubs/:clubId/website-data/about/:id")
  async getAboutById(@Param("clubId") c: string, @Param("id") i: string) {
    const clubId = paramInt(c, "clubId");
    const id = paramInt(i);
    const block = await this.blocked(clubId);
    if (block) return block;
    const r = await this.data.getAboutById(id);
    return r ? ok(r) : notFound({ message: "About content not found." });
  }

  @Post("clubs/:clubId/website-data/about")
  async createAbout(@Param("clubId") c: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const d = SaveClubAboutDto.create(body ?? {}) as { content: string; isActive: boolean };
    try {
      const id = await this.data.createAbout(clubId, d.content, d.isActive, this.userId(user));
      this.purger.purgeByClub(clubId);
      return ok({ id });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Put("clubs/:clubId/website-data/about/:id")
  async updateAbout(@Param("clubId") c: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const d = SaveClubAboutDto.create(body ?? {}) as { content: string; isActive: boolean };
    await this.data.updateAbout(paramInt(i), d.content, d.isActive, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "About content updated successfully." });
  }

  @Delete("clubs/:clubId/website-data/about/:id")
  async deleteAbout(@Param("clubId") c: string, @Param("id") i: string, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    await this.data.deleteAbout(paramInt(i), this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "About content deleted successfully." });
  }

  // ---- contact details ----

  @Get("clubs/:clubId/website-data/contact_details")
  async getContacts(@Param("clubId") c: string, @Query("yearId") yearId?: string) {
    const clubId = paramInt(c, "clubId");
    const y = queryInt(yearId, 0);
    return (await this.blocked(clubId)) ?? ok(await this.data.getContactDetails(clubId, y));
  }

  @Get("clubs/:clubId/website-data/contact_details/available-years")
  async getContactYears(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.data.availableYears("club_website_contact_detail", clubId));
  }

  @Get("clubs/:clubId/website-data/contact_details/:id")
  async getContact(@Param("clubId") c: string, @Param("id") i: string) {
    const clubId = paramInt(c, "clubId");
    const id = paramInt(i);
    const block = await this.blocked(clubId);
    if (block) return block;
    const r = await this.data.getContactDetail(id);
    return r ? ok(r) : notFound({ message: "Contact detail not found." });
  }

  @Post("clubs/:clubId/website-data/contact_details")
  async createContact(@Param("clubId") c: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const d = SaveClubContactDetailDto.create(body ?? {}) as { yearId: number; email: string; phone: string; isActive: boolean };
    return ok({ id: await this.data.createContactDetail(clubId, d, this.userId(user)) });
  }

  @Put("clubs/:clubId/website-data/contact_details/:id")
  async updateContact(@Param("clubId") c: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    paramInt(c, "clubId");
    const d = SaveClubContactDetailDto.create(body ?? {}) as { email: string; phone: string; isActive: boolean };
    await this.data.updateContactDetail(paramInt(i), d, this.userId(user));
    return ok({ message: "Contact detail updated successfully." });
  }

  @Delete("clubs/:clubId/website-data/contact_details/:id")
  async deleteContact(@Param("clubId") c: string, @Param("id") i: string, @User() user: CurrentUser) {
    paramInt(c, "clubId");
    await this.data.deleteContactDetail(paramInt(i), this.userId(user));
    return ok({ message: "Contact detail deleted successfully." });
  }

  // ---- social links ----

  @Get("clubs/:clubId/website-data/social_media_links")
  async getSocial(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.data.getSocialLinks(clubId));
  }

  @Put("clubs/:clubId/website-data/social_media_links/reorder-all")
  async reorderSocial(@Param("clubId") c: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    const ids = bodyIntList(body, "orderedIds");
    if (!ids.length) return badRequest({ message: "OrderedIds is required." });
    await this.data.reorderAll("club_website_social_link", clubId, ids);
    return ok({ message: "Order saved." });
  }

  @Get("clubs/:clubId/website-data/social_media_links/:id")
  async getSocialById(@Param("clubId") c: string, @Param("id") i: string) {
    const clubId = paramInt(c, "clubId");
    const id = paramInt(i);
    const block = await this.blocked(clubId);
    if (block) return block;
    const r = await this.data.getSocialLink(id);
    return r ? ok(r) : notFound({ message: "Social link not found." });
  }

  @Post("clubs/:clubId/website-data/social_media_links")
  async createSocial(@Param("clubId") c: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const d = SaveClubSocialLinkDto.create(body ?? {}) as { platform: string; linkUrl: string; sortOrder: number; isActive: boolean };
    return ok({ id: await this.data.createSocialLink(clubId, d, this.userId(user)) });
  }

  @Put("clubs/:clubId/website-data/social_media_links/:id")
  async updateSocial(@Param("clubId") c: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    paramInt(c, "clubId");
    const d = SaveClubSocialLinkDto.create(body ?? {}) as { platform: string; linkUrl: string; sortOrder: number; isActive: boolean };
    await this.data.updateSocialLink(paramInt(i), d, this.userId(user));
    return ok({ message: "Social link updated successfully." });
  }

  @Delete("clubs/:clubId/website-data/social_media_links/:id")
  async deleteSocial(@Param("clubId") c: string, @Param("id") i: string, @User() user: CurrentUser) {
    paramInt(c, "clubId");
    await this.data.deleteSocialLink(paramInt(i), this.userId(user));
    return ok({ message: "Social link deleted successfully." });
  }

  // ---- theme ----

  @Get("clubs/:clubId/website-data/theme")
  async getTheme(@Param("clubId") c: string, @Query("yearId") yearId?: string) {
    const clubId = paramInt(c, "clubId");
    const y = queryInt(yearId, 0);
    const block = await this.blocked(clubId);
    if (block) return block;
    return ok((await this.data.getClubTheme(clubId, y)) ?? {});
  }

  @Put("clubs/:clubId/website-data/theme")
  async saveTheme(@Param("clubId") c: string, @Body() body: unknown, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    await this.data.saveClubTheme(clubId, bodyInt(body, "yearId"), bodyInt(body, "themeId"), this.userId(user));
    return ok({ message: "Theme saved successfully." });
  }

  // ---- banners ----

  @Get("clubs/:clubId/website-data/banners")
  async getBanners(@Param("clubId") c: string, @Query("yearId") yearId?: string) {
    const clubId = paramInt(c, "clubId");
    const y = queryInt(yearId, 0);
    return (await this.blocked(clubId)) ?? ok(await this.data.getBanners(clubId, y));
  }

  @Get("clubs/:clubId/website-data/banners/available-years")
  async getBannerYears(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.data.availableYears("club_website_banner", clubId));
  }

  @Post("clubs/:clubId/website-data/banners/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadBanner(@Param("clubId") c: string, @UploadedFile() upload: Upload | undefined, @Query("strict") strict?: string) {
    requireFile(upload);
    paramInt(c, "clubId");
    const strictMode = queryBool(strict, false)!;
    const file = await ensureWithinLimit(upload);
    const v = validateImage(file, strictMode);
    if (!v.ok) return badRequest({ message: v.error });
    const path = await this.data.upload(file!, "banner");
    return ok({ path, url: "/uploads/banner/" + path, width: v.width, height: v.height, sizeBytes: v.sizeBytes });
  }

  @Post("clubs/:clubId/website-data/banners/upload-document")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadBannerDocument(@Param("clubId") c: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    paramInt(c, "clubId");
    return checkDocument(file) ?? ok({ path: await this.data.upload(file!, "banner") });
  }

  @Put("clubs/:clubId/website-data/banners/reorder")
  async swapBanners(@Param("clubId") c: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    await this.data.swapBanners(bodyInt(body, "id1"), bodyInt(body, "id2"));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Banners reordered successfully." });
  }

  @Put("clubs/:clubId/website-data/banners/reorder-all")
  async reorderBanners(@Param("clubId") c: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    const ids = bodyIntList(body, "orderedIds");
    if (!ids.length) return badRequest({ message: "OrderedIds is required." });
    await this.data.reorderAll("club_website_banner", clubId, ids);
    this.purger.purgeByClub(clubId);
    return ok({ message: "Order saved." });
  }

  @Get("clubs/:clubId/website-data/banners/:id")
  async getBanner(@Param("clubId") c: string, @Param("id") i: string) {
    const clubId = paramInt(c, "clubId");
    const id = paramInt(i);
    const block = await this.blocked(clubId);
    if (block) return block;
    const r = await this.data.getBanner(id);
    return r ? ok(r) : notFound({ message: "Banner not found." });
  }

  @Post("clubs/:clubId/website-data/banners")
  async createBanner(@Param("clubId") c: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const id = await this.data.createBanner(clubId, SaveClubBannerDto.create(body ?? {}) as unknown as SaveClubBanner, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ id });
  }

  @Put("clubs/:clubId/website-data/banners/:id")
  async updateBanner(@Param("clubId") c: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    await this.data.updateBanner(paramInt(i), SaveClubBannerDto.create(body ?? {}) as unknown as SaveClubBanner, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Banner updated successfully." });
  }

  @Delete("clubs/:clubId/website-data/banners/:id")
  async deleteBanner(@Param("clubId") c: string, @Param("id") i: string, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    await this.data.deleteBanner(paramInt(i), this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Banner deleted successfully." });
  }

  // ---- advertisements ----

  @Get("clubs/:clubId/website-data/advertisements")
  async getAdverts(@Param("clubId") c: string, @Query("yearId") yearId?: string) {
    const clubId = paramInt(c, "clubId");
    const y = queryInt(yearId, 0);
    return (await this.blocked(clubId)) ?? ok(await this.data.getAdvertisements(clubId, y));
  }

  @Get("clubs/:clubId/website-data/advertisements/available-years")
  async getAdvertYears(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.data.availableYears("club_website_advertisement", clubId));
  }

  @Post("clubs/:clubId/website-data/advertisements/upload-image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadAdvertImage(@Param("clubId") c: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    paramInt(c, "clubId");
    const bad = checkImage(file);
    if (bad) return bad;
    const path = await this.data.upload(file!, "advertisement");
    return ok({ path, url: "/uploads/advertisement/" + path });
  }

  @Post("clubs/:clubId/website-data/advertisements/upload-document")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadAdvertDocument(@Param("clubId") c: string, @UploadedFile() file: Upload | undefined) {
    requireFile(file);
    paramInt(c, "clubId");
    return checkDocument(file) ?? ok({ path: await this.data.upload(file!, "advertisement") });
  }

  @Put("clubs/:clubId/website-data/advertisements/reorder")
  async swapAdverts(@Param("clubId") c: string, @Body() body: unknown) {
    paramInt(c, "clubId");
    await this.data.swapAdvertisements(bodyInt(body, "id1"), bodyInt(body, "id2"));
    return ok({ message: "Advertisements reordered successfully." });
  }

  @Put("clubs/:clubId/website-data/advertisements/reorder-all")
  async reorderAdverts(@Param("clubId") c: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    const ids = bodyIntList(body, "orderedIds");
    if (!ids.length) return badRequest({ message: "OrderedIds is required." });
    await this.data.reorderAll("club_website_advertisement", clubId, ids);
    return ok({ message: "Order saved." });
  }

  @Get("clubs/:clubId/website-data/advertisements/:id")
  async getAdvert(@Param("clubId") c: string, @Param("id") i: string) {
    const clubId = paramInt(c, "clubId");
    const id = paramInt(i);
    const block = await this.blocked(clubId);
    if (block) return block;
    const r = await this.data.getAdvertisement(id);
    return r ? ok(r) : notFound({ message: "Advertisement not found." });
  }

  @Post("clubs/:clubId/website-data/advertisements")
  async createAdvert(@Param("clubId") c: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    return ok({ id: await this.data.createAdvertisement(clubId, SaveClubAdvertisementDto.create(body ?? {}) as unknown as SaveClubAdvertisement, this.userId(user)) });
  }

  @Put("clubs/:clubId/website-data/advertisements/:id")
  async updateAdvert(@Param("clubId") c: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    paramInt(c, "clubId");
    await this.data.updateAdvertisement(paramInt(i), SaveClubAdvertisementDto.create(body ?? {}) as unknown as SaveClubAdvertisement, this.userId(user));
    return ok({ message: "Advertisement updated successfully." });
  }

  @Delete("clubs/:clubId/website-data/advertisements/:id")
  async deleteAdvert(@Param("clubId") c: string, @Param("id") i: string, @User() user: CurrentUser) {
    paramInt(c, "clubId");
    await this.data.deleteAdvertisement(paramInt(i), this.userId(user));
    return ok({ message: "Advertisement deleted successfully." });
  }

  // ---- website data module catalogue ----

  @Get("website-data-modules")
  async getModules() {
    return ok(await this.data.getWebsiteDataModules());
  }

  @Put("website-data-modules/reorder")
  async swapModules(@Body() body: unknown) {
    await this.data.swapWebsiteDataModules(bodyInt(body, "id1"), bodyInt(body, "id2"));
    return ok({ message: "Order updated successfully." });
  }

  @Post("website-data-modules")
  async createModule(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const d = SaveWebsiteDataModuleDto.create(body ?? {}) as { moduleName: string; moduleKey: string; iconClass: string };
    return ok({ id: await this.data.createWebsiteDataModule(d, this.userId(user)) });
  }

  @Put("website-data-modules/:id")
  async updateModule(@Param("id") i: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const d = SaveWebsiteDataModuleDto.create(body ?? {}) as { moduleName: string; moduleKey: string; iconClass: string };
    await this.data.updateWebsiteDataModule(paramInt(i), d, this.userId(user));
    return ok({ message: "Website data module updated successfully." });
  }

  @Delete("website-data-modules/:id")
  async deleteModule(@Param("id") i: string, @User() user: CurrentUser) {
    await this.data.deleteWebsiteDataModule(paramInt(i), this.userId(user));
    return ok({ message: "Website data module deleted successfully." });
  }
}
