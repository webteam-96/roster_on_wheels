import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, forbid, ok, statusCode } from "../../common/results";
import { paramInt, queryInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, DISTRICT_BLOCKED_MESSAGE, isClubDrillReachable, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { lowerExtension, type UploadedFile } from "../../services/media-storage";
import { AddCreditDto, CreditManagementService, UpdateCreditDto, type AddCredit, type UpdateCredit } from "../../services/credit-management.service";

const PROOF_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png"];
const PROOF_ERROR = "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, JPEG, PNG";
const proofOf = (files: UploadedFile[] | undefined) =>
  (files ?? []).find((f) => (f as UploadedFile & { fieldname?: string }).fieldname?.toLowerCase() === "proofdocument" && f.size > 0);

/** Port of CreditManagementController.cs: api/credit-management. */
@Controller("api/credit-management")
@Authorize()
export class CreditManagementController {
  constructor(
    private readonly credits: CreditManagementService,
    private readonly db: Db,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private isAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("Admin");

  /** SuperAdmin, the club's admin, or the admin of the club's district. */
  private async canViewClubBalance(u: CurrentUser, clubId: number) {
    if (this.isSuperAdmin(u)) return true;
    const memberId = this.userId(u);
    if (memberId === 0) return false;
    return (
      Number(
        await this.db.executeScalar(
          `SELECT COUNT(*) FROM member_roles mr
           WHERE mr.fk_member_master_profile_id = @MemberId
             AND mr.fk_role_id = 2
             AND mr.IsActive = 1 AND mr.isdeleted = 0
             AND (mr.fk_club_id = @ClubId
                  OR mr.fk_district_id = (SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId))`,
          { MemberId: memberId, ClubId: clubId },
        ),
      ) > 0
    );
  }

  private async canViewDistrictBalance(u: CurrentUser, districtId: number) {
    if (this.isSuperAdmin(u)) return true;
    const memberId = this.userId(u);
    if (memberId === 0) return false;
    return (
      Number(
        await this.db.executeScalar(
          `SELECT COUNT(*) FROM member_roles
           WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_district_id = @DistrictId
             AND IsActive = 1 AND isdeleted = 0`,
          { MemberId: memberId, DistrictId: districtId },
        ),
      ) > 0
    );
  }

  @Get()
  async getCredits(
    @User() user: CurrentUser, @Query("districtId") districtId?: string, @Query("clubId") clubId?: string, @Query("creditType") creditType?: string,
    @Query("status") status?: string, @Query("page") pageText?: string, @Query("pageSize") pageSizeText?: string,
  ) {
    const page = queryInt(pageText, 1);
    const pageSize = queryInt(pageSizeText, 20);
    if (!this.isSuperAdmin(user)) return forbid();
    const { items, totalCount } = await this.credits.getCredits(queryInt(districtId), queryInt(clubId), queryString(creditType), queryString(status), page, pageSize);
    return ok({ items, totalCount, page, pageSize });
  }

  @Post()
  @UseInterceptors(AnyFilesInterceptor())
  async addCredit(@Body() body: Record<string, unknown>, @UploadedFiles() files: UploadedFile[] | undefined, @User() user: CurrentUser) {
    if (!this.isSuperAdmin(user)) return forbid();
    const proof = proofOf(files);
    if (proof && !PROOF_EXTENSIONS.includes(lowerExtension(proof.originalname))) return badRequest({ message: PROOF_ERROR });
    try {
      const id = await this.credits.addCredit(AddCreditDto.create(body ?? {}) as unknown as AddCredit, proof, this.userId(user));
      return ok({ id, message: "Credit added successfully." });
    } catch (e) {
      return badRequest({ message: (e as Error).message });
    }
  }

  @Put(":id")
  @UseInterceptors(AnyFilesInterceptor())
  async updateCredit(@Param("id") idText: string, @Body() body: Record<string, unknown>, @UploadedFiles() files: UploadedFile[] | undefined, @User() user: CurrentUser) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return forbid();
    const proof = proofOf(files);
    if (proof && !PROOF_EXTENSIONS.includes(lowerExtension(proof.originalname))) return badRequest({ message: PROOF_ERROR });
    await this.credits.updateCredit(id, UpdateCreditDto.create(body ?? {}) as unknown as UpdateCredit, proof, this.userId(user));
    return ok({ message: "Credit updated successfully." });
  }

  @Delete(":id")
  async deleteCredit(@Param("id") idText: string, @User() user: CurrentUser) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return forbid();
    await this.credits.deleteCredit(id, this.userId(user));
    return ok({ message: "Credit deleted successfully." });
  }

  @Get("club/:clubId/balance")
  async clubBalance(@Param("clubId") clubText: string, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    if (!(await this.canViewClubBalance(user, clubId))) return forbid();
    return ok(await this.credits.getClubCreditBalance(clubId));
  }

  @Get("district/:districtId/balance")
  async districtBalance(@Param("districtId") districtText: string, @User() user: CurrentUser) {
    const districtId = paramInt(districtText, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    if (!(await this.canViewDistrictBalance(user, districtId))) return forbid();
    return ok(await this.credits.getDistrictCreditBalance(districtId));
  }

  @Get("notifications")
  async notifications(@User() user: CurrentUser) {
    if (!this.isAdmin(user) && !this.isSuperAdmin(user)) return forbid();
    const clubId = parseInt(user.findFirst("clubId") ?? "0", 10);
    if (!clubId) return ok([]);
    return ok(await this.credits.checkExpiringCredits(clubId));
  }

  @Get("usage-history")
  async usageHistory(
    @User() user: CurrentUser, @Query("clubId") clubId?: string, @Query("districtId") districtId?: string, @Query("creditType") creditType?: string,
    @Query("page") pageText?: string, @Query("pageSize") pageSizeText?: string,
  ) {
    const page = queryInt(pageText, 1);
    const pageSize = queryInt(pageSizeText, 20);
    if (!this.isSuperAdmin(user)) return forbid();
    return ok(await this.credits.getUsageHistory(queryInt(clubId), queryInt(districtId), queryString(creditType), page, pageSize));
  }
}
