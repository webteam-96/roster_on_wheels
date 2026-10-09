import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ProjectService, CrossYearMoveRequiredException, bindProject, type SaveProject } from "./project.service";
import { Db } from "../../database/db.service";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { ValidationProblemResult, badRequest, conflict, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { bodyField, paramInt, queryBool, queryInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { ClubSiteCachePurger } from "../../services/club-site-cache-purger";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";
import { ensureWithinLimit, validateImage } from "../../services/image-tools";
import { validateProjectDate } from "../../services/project-date.validator";
import { BeneficiaryApprovalService } from "../approvals/beneficiary-approval.service";
import { ProjectApprovalService } from "./project-approval.service";

const MAX_UPLOAD = 55 * 1024 * 1024;
const DOCUMENT_TYPES = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".png", ".jpg", ".jpeg"];

/** The [ApiController] checks every save runs before the service: a date that is not a date, at least one photo, a sane date. */
function precheck(body: unknown): { dto: SaveProject } | { error: ReturnType<typeof badRequest> } {
  const { dto, dateInvalid } = bindProject(body);
  if (dateInvalid) return { error: new ValidationProblemResult({ "$.projectDate": ["The JSON value could not be converted to System.Nullable`1[System.DateTime]."] }) };
  if (!dto.photos?.length) return { error: badRequest({ message: "At least 1 photo is required to save this project." }) };
  const dateError = validateProjectDate(dto.projectDate);
  if (dateError) return { error: badRequest({ message: dateError }) };
  return { dto };
}

/** Port of ProjectsController.cs: api/clubs/{clubId}/projects (+ the public list). */
@Controller()
@Authorize()
export class ProjectsController {
  constructor(
    private readonly projects: ProjectService,
    private readonly beneficiaries: BeneficiaryApprovalService,
    private readonly db: Db,
    private readonly purger: ClubSiteCachePurger,
    private readonly approvals: ProjectApprovalService,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  @Get("api/clubs/:clubId/projects")
  async list(
    @Param("clubId") c: string, @Query("moduleId") m?: string, @Query("yearId") y?: string, @Query("page") p?: string, @Query("pageSize") ps?: string,
    @Query("search") search?: string, @Query("projectType") projectType?: string,
  ) {
    const clubId = paramInt(c, "clubId");
    const [moduleId, yearId, page, pageSize] = [queryInt(m, 0), queryInt(y, 0), queryInt(p, 1), queryInt(ps, 20)];
    return (await this.blocked(clubId)) ?? ok(await this.projects.getByClub(clubId, moduleId, yearId, page, pageSize, queryString(search), queryString(projectType)));
  }

  @Get("api/clubs/:clubId/projects/years")
  async years(@Param("clubId") c: string, @Query("moduleId") m?: string) {
    const clubId = paramInt(c, "clubId");
    const moduleId = queryInt(m, 0);
    return (await this.blocked(clubId)) ?? ok(await this.projects.getYears(clubId, moduleId));
  }

  @Get("api/clubs/:clubId/projects/ongoing")
  async ongoing(@Param("clubId") c: string, @Query("moduleId") m?: string, @Query("search") search?: string, @Query("yearId") y?: string) {
    const clubId = paramInt(c, "clubId");
    const [moduleId, yearId] = [queryInt(m, 0), queryInt(y)];
    return (await this.blocked(clubId)) ?? ok(await this.projects.getOngoing(clubId, moduleId, queryString(search), yearId));
  }

  @Post("api/clubs/:clubId/projects/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async upload(
    @Param("clubId") c: string, @UploadedFile() upload: Upload | undefined, @Query("projectId") pid?: string, @Query("yearId") y?: string, @Query("strict") strict?: string,
  ) {
    const clubId = paramInt(c, "clubId");
    const file = await ensureWithinLimit(upload);
    const v = validateImage(file, queryBool(strict, false)!);
    if (!v.ok) return badRequest({ message: v.error });
    const path = await this.projects.uploadImage(file!, clubId, queryInt(pid), queryInt(y));
    return ok({ path, width: v.width, height: v.height, sizeBytes: v.sizeBytes });
  }

  @Post("api/clubs/:clubId/projects/upload-document")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadDocument(@Param("clubId") c: string, @UploadedFile() file: Upload | undefined) {
    const clubId = paramInt(c, "clubId");
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded." });
    if (!DOCUMENT_TYPES.includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, png, jpg, jpeg" });
    // RIZones checks 20 MB but says 10MB.
    if (file.size > 20 * 1024 * 1024) return badRequest({ message: "File size must be less than 10MB." });
    return ok({ path: await this.projects.uploadDocument(file, clubId) });
  }

  @Post("api/clubs/:clubId/projects")
  async create(@Param("clubId") c: string, @Body() body: unknown, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const checked = precheck(body);
    if ("error" in checked) return checked.error;
    const id = await this.projects.create(clubId, checked.dto, this.userId(u));
    this.purger.purgeByClub(clubId);
    return ok({ id });
  }

  @Get("api/clubs/:clubId/projects/:yearId/:id")
  async get(@Param("clubId") c: string, @Param("yearId") y: string, @Param("id") i: string) {
    const [clubId, yearId, id] = [paramInt(c, "clubId"), paramInt(y, "yearId"), paramInt(i)];
    const block = await this.blocked(clubId);
    if (block) return block;
    const r = await this.projects.getById(id, yearId, clubId);
    return r ? ok(r) : notFound({ message: "Project not found." });
  }

  @Put("api/clubs/:clubId/projects/:yearId/:id")
  async update(@Param("clubId") c: string, @Param("yearId") y: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [clubId, yearId, id] = [paramInt(c, "clubId"), paramInt(y, "yearId"), paramInt(i)];
    const checked = precheck(body);
    if ("error" in checked) return checked.error;
    try {
      await this.projects.update(id, yearId, checked.dto, this.userId(u));
    } catch (e) {
      if (!(e instanceof CrossYearMoveRequiredException)) throw e;
      return conflict({
        requiresMove: true, fromYearId: e.fromYearId, toYearId: e.toYearId, fromYearLabel: e.fromYearLabel, toYearLabel: e.toYearLabel,
        message: `This project's date moves it from ${e.fromYearLabel} to ${e.toYearLabel}. Move the project and its photos to ${e.toYearLabel}? It will get a new ID there.`,
      });
    }
    // At or under the beneficiary limit again: a pending limit-raise request is no longer needed.
    if (checked.dto.directBeneficiaries !== null) {
      try {
        const limit = parseInt((await this.db.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'direct_beneficiaries_limit'")) ?? "", 10) || 0;
        if (limit > 0 && checked.dto.directBeneficiaries <= limit) await this.beneficiaries.cancelPendingApproval(id);
      } catch {
        // never blocks the save
      }
    }
    this.purger.purgeByClub(clubId);
    return ok({ message: "Project updated successfully." });
  }

  @Post("api/clubs/:clubId/projects/:yearId/:id/move")
  async move(@Param("clubId") c: string, @Param("yearId") y: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [clubId, yearId, id] = [paramInt(c, "clubId"), paramInt(y, "yearId"), paramInt(i)];
    const checked = precheck(body);
    if ("error" in checked) return checked.error;
    try {
      const r = await this.projects.move(id, yearId, checked.dto, this.userId(u));
      this.purger.purgeByClub(clubId);
      return ok({ message: `Project moved to ${r.newYearLabel} successfully.`, ...r });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Delete("api/clubs/:clubId/projects/:yearId/:id")
  async remove(@Param("clubId") c: string, @Param("yearId") y: string, @Param("id") i: string, @User() u: CurrentUser) {
    const [clubId, yearId, id] = [paramInt(c, "clubId"), paramInt(y, "yearId"), paramInt(i)];
    await this.projects.delete(id, yearId, this.userId(u));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Project deleted successfully." });
  }

  @Post("api/clubs/:clubId/projects/:yearId/:id/photos")
  async addPhoto(@Param("clubId") c: string, @Param("yearId") y: string, @Param("id") i: string, @Body() body: unknown) {
    paramInt(c, "clubId");
    const d = bodyField(body, "description");
    const id = await this.projects.addPhoto(
      paramInt(i), paramInt(y, "yearId"), String(bodyField(body, "imagePath") ?? ""), d === null || d === undefined ? null : String(d),
      bodyField(body, "isPrimary") === true, Math.trunc(Number(bodyField(body, "sortOrder") ?? 0)) || 0,
    );
    return ok({ id });
  }

  @Delete("api/clubs/:clubId/projects/:yearId/:projectId/photos/:photoId")
  async deletePhoto(@Param("clubId") c: string, @Param("yearId") y: string, @Param("projectId") p: string, @Param("photoId") ph: string) {
    paramInt(c, "clubId");
    paramInt(p, "projectId");
    await this.projects.deletePhoto(paramInt(ph, "photoId"), paramInt(y, "yearId"));
    return ok({ message: "Photo deleted successfully." });
  }

  @Put("api/clubs/:clubId/projects/:yearId/:projectId/photos/:photoId/primary")
  async primaryPhoto(@Param("clubId") c: string, @Param("yearId") y: string, @Param("projectId") p: string, @Param("photoId") ph: string) {
    paramInt(c, "clubId");
    await this.projects.setPrimaryPhoto(paramInt(p, "projectId"), paramInt(ph, "photoId"), paramInt(y, "yearId"));
    return ok({ message: "Primary photo set successfully." });
  }

  /** ProjectApprovalController.HasModerator (an absolute route in RIZones). */
  @Get("api/clubs/:clubId/has-moderator")
  async hasModerator(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.approvals.getModeratorInfo(clubId));
  }

  @Get("api/public/clubs/:clubId/projects")
  @AllowAnonymous()
  async publicList(@Param("clubId") c: string, @Query("moduleId") m?: string, @Query("yearId") y?: string, @Query("page") p?: string, @Query("pageSize") ps?: string) {
    const clubId = paramInt(c, "clubId");
    const [moduleId, yearId, page, pageSize] = [queryInt(m, 0), queryInt(y, 0), queryInt(p, 1), queryInt(ps, 20)];
    return (await this.blocked(clubId)) ?? ok(await this.projects.getPublic(clubId, moduleId, yearId, page, pageSize));
  }
}
