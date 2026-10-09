import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { formatDate, formatNumber } from "../../common/dotnet-format";
import { resolveDefaultCurrency } from "../../services/currency.helper";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";

/** Projects in these avenues need the club moderator's approval when the club has one. */
const APPROVAL_MODULE_KEYS = new Set(["community_service", "vocational_service", "international_service", "new_generation_service", "public_image_initiative"]);
const MODERATOR = `SELECT dcm.fk_member_id AS moderatorId, m.MemberName AS moderatorName, m.EmailId AS moderatorEmail
  FROM district_club_moderator dcm JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id
  WHERE dcm.fk_club_id = @ClubId AND dcm.isdeleted = 0 AND dcm.is_active = 1 AND m.isdeleted = 0`;
const photoPathSql = (suffix: string) => `CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
    CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', ph.image_path)`;

export type Outcome = { success: boolean; message: string };

/** Port of ProjectApprovalService.cs: club-moderator approval of avenue projects (email links and the moderator screens). */
@Injectable()
export class ProjectApprovalService {
  private readonly log = new Logger("ProjectApprovalService");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly yearTables: YearTableResolver,
  ) {}

  private resolve(conn: DbCommands, projectId: number, yearId: number | null) {
    return yearId !== null ? this.yearTables.resolveByYearId(conn, yearId) : this.yearTables.findByProjectId(conn, projectId);
  }

  async getModeratorInfo(clubId: number) {
    const m = await this.db.queryFirstOrDefault(MODERATOR, { ClubId: clubId });
    return m ? { hasModerator: true, moderatorName: m.moderatorName ?? null } : { hasModerator: false, moderatorName: null };
  }

  /** Marks the project pending and emails the moderator approve / reject links; clears a stale pending when the club has no moderator. */
  async setPendingApproval(projectId: number, clubId: number, moduleId: number, createdBy: number, yearId: number | null = null) {
    await this.db.session(async (conn) => {
      const info = await this.resolve(conn, projectId, yearId);
      if (!info) return;
      const moduleKey = await conn.executeScalar<string>("SELECT ModuleKey FROM module_master WHERE pk_module_id = @Id AND isdeleted = 0", { Id: moduleId });
      if (!moduleKey || !APPROVAL_MODULE_KEYS.has(moduleKey.toLowerCase())) return;
      const moderator = await conn.queryFirstOrDefault(MODERATOR, { ClubId: clubId });
      if (!moderator) {
        await conn.execute(`UPDATE \`${info.projectsTable}\` SET approval_status = NULL, approval_token = NULL WHERE pk_project_id = @ProjectId AND approval_status = 'pending'`, { ProjectId: projectId });
        return;
      }
      const token = randomUUID().replace(/-/g, "");
      await conn.execute(`UPDATE \`${info.projectsTable}\` SET approval_status = 'pending', approval_token = @Token WHERE pk_project_id = @ProjectId`, { ProjectId: projectId, Token: token });
      const project = await conn.queryFirstOrDefault(
        `SELECT p.title, p.description, p.project_date, p.project_cost, p.direct_beneficiaries, p.man_hours, p.rotarians_involved, p.rotaractors_involved,
                COALESCE(p.rcc_involved,0) AS rcc_involved, p.location, mm.ModuleName, c.ClubName, d.DistrictNumber,
                admin.MemberName AS adminName, admin.EmailId AS adminEmail, admin.PrimaryMobileNumber AS adminMobile
         FROM \`${info.projectsTable}\` p
         LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
         LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
         WHERE p.pk_project_id = @ProjectId`,
        { ProjectId: projectId },
      );
      const suffix = info.yearLabel.replace(/-/g, "_");
      const photos = await conn.query(
        `SELECT ${photoPathSql(suffix)} AS image_path FROM \`${info.photosTable}\` ph JOIN \`${info.projectsTable}\` p ON p.pk_project_id = ph.fk_project_id
         WHERE ph.fk_project_id = @ProjectId ORDER BY ph.sort_order`,
        { ProjectId: projectId },
      );
      try {
        const backend = this.config.get("BackendUrl") ?? "http://localhost:5000";
        const approveUrl = `${backend}/api/project-approval/${token}/approve`;
        const rejectUrl = `${backend}/api/project-approval/${token}/reject`;
        const photoHtml = photos
          .map((ph) => `<img src='${backend}${ph.image_path}' alt='Project Photo' style='width: 120px; height: 90px; object-fit: cover; border-radius: 4px; margin: 4px;' />`)
          .join("");
        const dash = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
        const row = (k: string, v: string, first = false) =>
          `<tr><td style='padding: 6px 0; color: #718096;${first ? " width: 40%;" : ""}'>${k}</td><td style='padding: 6px 0;'>${v}</td></tr>`;
        const body = `${emailHeader()}
                <h2 style='color: #1a365d; margin-top: 0;'>Project Approval Required</h2>
                <p>Dear ${moderator.moderatorName ?? ""},</p>
                <p>A new project has been submitted and requires your approval.</p>
                <div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <h3 style='color: #2d3748; margin-top: 0;'>Project Details</h3>
                    <table style='width: 100%; border-collapse: collapse; font-size: 14px;'>
                        ${row("Module", `<strong>${dash(project?.ModuleName)}</strong>`, true)}
                        ${row("Title", `<strong>${dash(project?.title)}</strong>`)}
                        ${row("Club", dash(project?.ClubName))}
                        ${row("District", dash(project?.DistrictNumber))}
                        ${row("Date", project?.project_date ? formatDate(project.project_date, "dd MMM yyyy") : "—")}
                        ${row("Cost", project?.project_cost !== null && project?.project_cost !== undefined ? formatNumber(Number(project.project_cost), "C") : "—")}
                        ${row("Direct Beneficiaries", dash(project?.direct_beneficiaries))}
                        ${row("Man Hours", dash(project?.man_hours))}
                        ${row("Location", dash(project?.location))}
                    </table>
                    ${project?.description ? `<p style='margin-top: 12px; color: #4a5568;'><strong>Description:</strong> ${project.description}</p>` : ""}
                </div>
                ${photoHtml ? `<div style='margin: 16px 0;'><strong>Photos:</strong><br/><div style='margin-top: 8px;'>${photoHtml}</div></div>` : ""}
                <div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <h3 style='color: #2d3748; margin-top: 0;'>Submitted By</h3>
                    <table style='width: 100%; border-collapse: collapse; font-size: 14px;'>
                        ${row("Name", dash(project?.adminName), true)}
                        ${row("Email", dash(project?.adminEmail))}
                        ${row("Mobile", dash(project?.adminMobile))}
                    </table>
                </div>
                <div style='text-align: center; margin: 24px 0;'>
                    <a href='${approveUrl}' style='background-color: #38a169; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 12px;'>Approve</a>
                    <a href='${rejectUrl}' style='background-color: #e53e3e; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold;'>Reject</a>
                </div>
                <p style='font-size: 12px; color: #a0aec0; text-align: center;'>You can also login to the web portal to approve or reject this project.</p>
            ${emailFooter()}`;
        if (moderator.moderatorEmail && String(moderator.moderatorEmail).trim()) {
          await this.email.sendGenericEmail(String(moderator.moderatorEmail), `Project Approval Required - ${project?.ClubName ?? ""} - ${project?.title ?? ""}`, body);
        }
      } catch (e) {
        this.log.error(`Failed to send moderator approval email for project ${projectId}: ${(e as Error).message}`);
      }
    });
  }

  async getProjectDetailForModerator(projectId: number, memberId: number, yearId: number | null) {
    return this.db.session(async (conn) => {
      const info = await this.resolve(conn, projectId, yearId);
      if (!info) return null;
      const p = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id AS ProjectId, p.title AS Title, p.description AS Description, p.project_date AS ProjectDate, p.project_cost AS ProjectCost,
                p.direct_beneficiaries AS DirectBeneficiaries, p.man_hours AS ManHours, p.rotarians_involved AS RotariansInvolved,
                p.rotaractors_involved AS RotaractorsInvolved, COALESCE(p.rcc_involved,0) AS RccInvolved, p.location AS Location, p.project_type AS ProjectType,
                p.is_joint_project AS IsJointProject, p.co_host_name AS CoHostName, p.club_role AS ClubRole, p.approval_status AS ApprovalStatus,
                p.approval_remark AS ApprovalRemark, p.approval_date AS ApprovalDate, p.created_date AS CreatedDate, mm.ModuleName AS ModuleName,
                c.ClubName AS ClubName, d.DistrictNumber AS DistrictNumber, aof.name AS AreaOfFocusName, cat.name AS CategoryName, scat.name AS SubCategoryName,
                f.name AS FundingName, admin.MemberName AS AdminName, admin.EmailId AS AdminEmail, admin.PrimaryMobileNumber AS AdminMobile,
                CASE WHEN admin.ProfilePhotoPath IS NULL OR admin.ProfilePhotoPath = '' THEN NULL
                     WHEN admin.ProfilePhotoPath LIKE '/Documents/directory/%' THEN admin.ProfilePhotoPath
                     ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(admin.ProfilePhotoPath, '/', -1)) END AS AdminPhoto
         FROM \`${info.projectsTable}\` p
         JOIN district_club_moderator dcm ON dcm.fk_club_id = p.fk_club_id AND dcm.fk_member_id = @MemberId AND dcm.isdeleted = 0 AND dcm.is_active = 1
         LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
         LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
         LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
         LEFT JOIN sub_category_master scat ON scat.pk_sub_category_id = p.fk_sub_category_id
         LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
         LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
         WHERE p.pk_project_id = @ProjectId AND p.isdeleted = 0`,
        { ProjectId: projectId, MemberId: memberId },
      );
      if (!p) return null;
      const photos = await conn.query(
        `SELECT ${photoPathSql(info.yearLabel.replace(/-/g, "_"))} AS imagePath, ph.description
         FROM \`${info.photosTable}\` ph JOIN \`${info.projectsTable}\` p ON p.pk_project_id = ph.fk_project_id
         WHERE ph.fk_project_id = @ProjectId ORDER BY ph.sort_order`,
        { ProjectId: projectId },
      );
      const keys = [
        "ProjectId", "Title", "Description", "ProjectDate", "ProjectCost", "DirectBeneficiaries", "ManHours", "RotariansInvolved", "RotaractorsInvolved",
        "RccInvolved", "Location", "ProjectType", "IsJointProject", "CoHostName", "ClubRole", "ApprovalStatus", "ApprovalRemark", "ApprovalDate", "CreatedDate",
        "ModuleName", "ClubName", "DistrictNumber", "AreaOfFocusName", "CategoryName", "SubCategoryName", "FundingName", "AdminName", "AdminEmail", "AdminMobile", "AdminPhoto",
      ];
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k.charAt(0).toLowerCase() + k.slice(1)] = p[k] ?? null;
      out.rccInvolved = Number(p.RccInvolved ?? 0);
      out.photos = photos.map((ph) => ({ imagePath: ph.imagePath, description: ph.description ?? null }));
      return out;
    });
  }

  async getByToken(token: string): Promise<Row | null> {
    return this.db.session(async (conn) => {
      for (const t of await this.yearTables.getAllExistingYearTables(conn)) {
        const hit = await conn.queryFirstOrDefault(
          `SELECT p.pk_project_id AS projectId, p.title, p.description, p.project_date AS projectDate, p.project_cost AS projectCost, p.Currency AS currency,
                  p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours, p.location, p.approval_status AS approvalStatus,
                  p.approval_remark AS approvalRemark, mm.ModuleName AS moduleName, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                  admin.MemberName AS submittedByName
           FROM \`${t.projectsTable}\` p
           LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
           LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
           LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
           LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
           WHERE p.approval_token = @Token AND p.isdeleted = 0
           LIMIT 1`,
          { Token: token },
        );
        if (hit) return { ...hit, currency: hit.currency ?? resolveDefaultCurrency(null) } as Row;
      }
      return null;
    });
  }

  private async findByToken(conn: DbCommands, token: string): Promise<{ info: YearTableInfo; project: Row } | null> {
    for (const t of await this.yearTables.getAllExistingYearTables(conn)) {
      const hit = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id, p.approval_status, p.title, p.fk_club_id, c.ClubName, admin.MemberName AS adminName, admin.EmailId AS adminEmail
         FROM \`${t.projectsTable}\` p
         LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
         LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
         WHERE p.approval_token = @Token AND p.isdeleted = 0 LIMIT 1`,
        { Token: token },
      );
      if (hit) return { info: t, project: hit };
    }
    return null;
  }

  private static moderatorId(conn: DbCommands, clubId: number) {
    return conn.executeScalar("SELECT fk_member_id FROM district_club_moderator WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1", { ClubId: clubId });
  }

  private async decideByToken(token: string, remark: string | null, decision: "approved" | "rejected"): Promise<Outcome> {
    return this.db.session(async (conn) => {
      const found = await this.findByToken(conn, token);
      if (!found) return { success: false, message: "Project not found." };
      const { info, project } = found;
      if (project.approval_status !== "pending") return { success: false, message: `Project has already been ${project.approval_status ?? ""}.` };
      const approvedBy = await ProjectApprovalService.moderatorId(conn, Number(project.fk_club_id));
      await conn.execute(
        `UPDATE \`${info.projectsTable}\` SET approval_status = @Decision, approval_remark = @Remark, approved_by = @ApprovedBy, approval_date = NOW()
         WHERE approval_token = @Token AND approval_status = 'pending'`,
        { Decision: decision, Token: token, Remark: remark, ApprovedBy: approvedBy ?? null },
      );
      await this.notifyAdmin(conn, project, decision, remark);
      return { success: true, message: decision === "approved" ? "Project approved successfully." : "Project rejected." };
    });
  }

  approveByToken(token: string, remark: string | null) {
    return this.decideByToken(token, remark, "approved");
  }

  async rejectByToken(token: string, remark: string) {
    if (!remark || !remark.trim()) return { success: false, message: "Remark is required for rejection." };
    return this.decideByToken(token, remark, "rejected");
  }

  private async moderatorDecision(projectId: number, memberId: number, remark: string | null, yearId: number | null, decision: "approved" | "rejected"): Promise<Outcome> {
    return this.db.session(async (conn) => {
      const info = await this.resolve(conn, projectId, yearId);
      if (!info) return { success: false, message: "Project not found." };
      const project = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id, p.approval_status, p.title, p.fk_club_id, c.ClubName, admin.MemberName AS adminName, admin.EmailId AS adminEmail
         FROM \`${info.projectsTable}\` p
         LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
         LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
         WHERE p.pk_project_id = @ProjectId AND p.isdeleted = 0`,
        { ProjectId: projectId },
      );
      if (!project) return { success: false, message: "Project not found." };
      if (project.approval_status !== "pending") return { success: false, message: `Project has already been ${project.approval_status ?? ""}.` };
      const assigned = Number(
        await conn.executeScalar("SELECT COUNT(*) FROM district_club_moderator WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0 AND is_active = 1", {
          ClubId: project.fk_club_id, MemberId: memberId,
        }),
      );
      if (assigned === 0) return { success: false, message: "You are not the moderator for this club." };
      await conn.execute(
        `UPDATE \`${info.projectsTable}\` SET approval_status = @Decision, approval_remark = @Remark, approved_by = @ApprovedBy, approval_date = NOW()
         WHERE pk_project_id = @ProjectId AND approval_status = 'pending'`,
        { Decision: decision, ProjectId: projectId, Remark: remark, ApprovedBy: memberId },
      );
      await this.notifyAdmin(conn, project, decision, remark);
      return { success: true, message: decision === "approved" ? "Project approved successfully." : "Project rejected." };
    });
  }

  moderatorApprove(projectId: number, memberId: number, remark: string | null, yearId: number | null) {
    return this.moderatorDecision(projectId, memberId, remark, yearId, "approved");
  }

  async moderatorReject(projectId: number, memberId: number, remark: string, yearId: number | null) {
    if (!remark || !remark.trim()) return { success: false, message: "Remark is required for rejection." };
    return this.moderatorDecision(projectId, memberId, remark, yearId, "rejected");
  }

  async getYearSummary(memberId: number) {
    return this.db.session(async (conn) => {
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return [];
      const legs = tables.map(
        (t) => `SELECT ${t.yearId} AS yearId, '${t.yearLabel}' AS yearLabel, (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = ${t.yearId}) AS isCurrent,
                       SUM(CASE WHEN p.approval_status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
                       SUM(CASE WHEN p.approval_status = 'approved' THEN 1 ELSE 0 END) AS approvedCount,
                       SUM(CASE WHEN p.approval_status = 'rejected' THEN 1 ELSE 0 END) AS rejectedCount,
                       COUNT(*) AS totalCount
                FROM \`${t.projectsTable}\` p
                JOIN district_club_moderator dcm ON dcm.fk_club_id = p.fk_club_id AND dcm.fk_member_id = @MemberId AND dcm.isdeleted = 0 AND dcm.is_active = 1
                WHERE p.approval_status IS NOT NULL AND p.isdeleted = 0
                HAVING COUNT(*) > 0`,
      );
      const summaries = (await conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY u.yearId DESC`, { MemberId: memberId })).map((r) => ({
        yearId: Number(r.yearId), yearLabel: String(r.yearLabel), isCurrent: r.isCurrent === true || Number(r.isCurrent) === 1,
        pendingCount: Number(r.pendingCount), approvedCount: Number(r.approvedCount), rejectedCount: Number(r.rejectedCount), totalCount: Number(r.totalCount),
      }));
      if (!summaries.some((s) => s.isCurrent)) {
        const current = await conn.queryFirstOrDefault("SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        if (current && tables.some((t) => t.yearId === Number(current.pk_year_id))) {
          summaries.push({ yearId: Number(current.pk_year_id), yearLabel: String(current.YearLabel), isCurrent: true, pendingCount: 0, approvedCount: 0, rejectedCount: 0, totalCount: 0 });
        }
      }
      return summaries.sort((a, b) => b.yearId - a.yearId);
    });
  }

  async getProjectsForModerator(memberId: number, yearId: number, status: string | null, page: number, pageSize: number, moduleKey: string | null) {
    return this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) return { items: [] as Row[], totalCount: 0 };
      const statusFilter = status === "pending" || status === "approved" || status === "rejected" ? `AND p.approval_status = '${status}'` : "";
      const moduleFilter = moduleKey ? "AND mm.ModuleKey = @ModuleKey" : "";
      const from = `FROM \`${info.projectsTable}\` p
        JOIN district_club_moderator dcm ON dcm.fk_club_id = p.fk_club_id AND dcm.fk_member_id = @MemberId AND dcm.isdeleted = 0 AND dcm.is_active = 1
        LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id`;
      const params = { MemberId: memberId, ModuleKey: moduleKey, Offset: (page - 1) * pageSize, PageSize: pageSize };
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) ${from} WHERE p.approval_status IS NOT NULL AND p.isdeleted = 0 ${statusFilter} ${moduleFilter}`, params));
      const items = await conn.query(
        `SELECT p.pk_project_id AS projectId, p.title, p.description, p.project_date AS projectDate, p.project_cost AS projectCost,
                p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours, p.location, p.approval_status AS approvalStatus,
                p.approval_remark AS approvalRemark, p.approval_date AS approvalDate, p.created_date AS createdDate, mm.ModuleName AS moduleName,
                c.ClubName AS clubName, admin.MemberName AS createdByName
         ${from}
         LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
         LEFT JOIN member_master_profile admin ON admin.pk_member_master_profile_id = p.created_by
         WHERE p.approval_status IS NOT NULL AND p.isdeleted = 0 ${statusFilter} ${moduleFilter}
         ORDER BY FIELD(p.approval_status, 'pending', 'approved', 'rejected'), p.created_date DESC
         LIMIT @Offset, @PageSize`,
        params,
      );
      return { items, totalCount };
    });
  }

  /**
   * Emails the decision to the submitter, the club admins and the current
   * President / Secretary. (RIZones also sends an approval push; ROW has no push
   * provider configured yet, see ROW-CHANGES.md.)
   */
  private async notifyAdmin(conn: DbCommands, project: Row, decision: "approved" | "rejected", remark: string | null) {
    try {
      const clubId = Number(project.fk_club_id);
      const moderatorName =
        (await conn.executeScalar<string>(
          `SELECT m.MemberName FROM district_club_moderator dcm JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id
           WHERE dcm.fk_club_id = @ClubId AND dcm.isdeleted = 0 AND dcm.is_active = 1`,
          { ClubId: clubId },
        )) ?? "Club Moderator";
      const recipients = new Map<string, string>();
      const add = (e: unknown) => {
        if (typeof e === "string" && e.trim() && !recipients.has(e.toLowerCase())) recipients.set(e.toLowerCase(), e);
      };
      add(project.adminEmail);
      for (const r of await conn.query(
        `SELECT DISTINCT m.EmailId FROM member_roles mr JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
         WHERE mr.fk_club_id = @ClubId AND mr.fk_role_id = 2 AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId != ''`,
        { ClubId: clubId },
      )) add(r.EmailId);
      for (const r of await conn.query(
        `SELECT DISTINCT m.EmailId FROM board_of_directors bod
         JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
         JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
         JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
         WHERE bod.fk_club_id = @ClubId AND bod.isdeleted = 0 AND dm.designation_name IN ('President', 'Secretary')
           AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId != ''`,
        { ClubId: clubId },
      )) add(r.EmailId);
      if (!recipients.size) return;
      const color = decision === "approved" ? "#38a169" : "#e53e3e";
      const text = decision === "approved" ? "Approved" : "Rejected";
      const row = (k: string, v: string, extra = "") => `<tr><td style='padding: 6px 0; color: #718096;${extra}'>${k}</td><td style='padding: 6px 0;'>${v}</td></tr>`;
      const body = `${emailHeader()}
                <h2 style='color: #1a365d; margin-top: 0;'>Project ${text}</h2>
                <p>A project has been <strong style='color: ${color};'>${text}</strong> by the Club Moderator.</p>
                <div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <table style='width: 100%; border-collapse: collapse; font-size: 14px;'>
                        ${row("Project", `<strong>${project.title ?? ""}</strong>`, " width: 40%;")}
                        ${row("Club", String(project.ClubName ?? ""))}
                        ${row("Status", `<span style='color: ${color}; font-weight: 600;'>${text}</span>`)}
                        ${row("Reviewed By", moderatorName)}
                        ${row("Submitted By", String(project.adminName ?? ""))}
                        ${remark && remark.trim() ? row("Remark", remark) : ""}
                    </table>
                </div>
            ${emailFooter()}`;
      for (const to of recipients.values()) {
        await this.email.sendGenericEmail(to, `Project ${text} - ${project.title ?? ""}`, body).catch((e) => this.log.warn(`Failed to send project decision email to ${to}: ${(e as Error).message}`));
      }
    } catch (e) {
      this.log.error(`Failed to send notification emails for project decision: ${(e as Error).message}`);
    }
  }
}
