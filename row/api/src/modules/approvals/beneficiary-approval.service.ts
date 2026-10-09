import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { defineDto } from "../../common/dto";
import { InvalidOperationException } from "../../common/exceptions";
import { YearTableResolver } from "../../services/year-table.resolver";
import { EmailService, type BeneficiaryDetail } from "../../services/email.service";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };

export const BeneficiaryApprovalDetailDto = defineDto({
  Id: "int", ProjectId: "int", ZoneId: "int", ClubId: "int", RequestedBeneficiaries: "int", ApprovedBeneficiaries: "int?", CurrentLimit: "int",
  ApprovalToken: str, Status: str, Remark: "string", RequestedBy: "int", YearId: "int?", RespondedDate: "datetime?", CreatedDate: "datetime",
  ProjectTitle: str, ProjectDescription: "string", ProjectDate: "datetime?", ProjectCost: "decimal?", CurrentBeneficiaries: "int?", ManHours: "int?",
  RotariansInvolved: "int?", RotaractorsInvolved: "int?", RccInvolved: "int?", ClubName: str, DistrictNumber: str, ZoneName: str,
  RequestedByName: str, RequestedByEmail: str, RequestedByMobile: str, PhotoUrls: list,
});
export type ApprovalDetail = BeneficiaryDetail & {
  id: number; projectId: number; zoneId: number; clubId: number; approvalToken: string; status: string; remark: string | null;
  requestedBy: number; yearId: number | null; respondedDate: string | null; createdDate: string; currentBeneficiaries: number | null; zoneName: string;
};
export const ZonalDashboardInfoDto = defineDto({ ZoneId: "int", ZoneName: str, ZoneCode: str });
export const ApprovalListItemDto = defineDto({
  Id: "int", ProjectId: "int", RequestedBeneficiaries: "int", CurrentLimit: "int", ApprovalToken: str, Status: str, Remark: "string",
  RespondedDate: "datetime?", CreatedDate: "datetime", ProjectTitle: str, ProjectDate: "datetime?", ClubName: str, DistrictNumber: str, RequestedByName: str,
});
export const ApprovalHistoryItemDto = defineDto({
  ApprovalId: "int", RequestedBeneficiaries: "int", ApprovedBeneficiaries: "int?", Status: str, Remark: "string", CreatedDate: "datetime",
  RespondedDate: "datetime?", RespondedByName: "string",
});
export const ZonalDistrictDto = defineDto({ Id: "int", DistrictNumber: str, DistrictName: str, TotalClubs: "int", TotalMembers: "int" });
export const ZonalClubDto = defineDto({ Id: "int", ClubName: str, ClubCode: str });

/**
 * Port of BeneficiaryApprovalService.cs: a project saved with more direct
 * beneficiaries than the system limit waits for the zone's Zonal Co-ordinator,
 * who approves (from the emailed link or the Zonal dashboard) or rejects it.
 */
@Injectable()
export class BeneficiaryApprovalService {
  private readonly log = new Logger("BeneficiaryApprovalService");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly yearTables: YearTableResolver,
    private readonly email: EmailService,
  ) {}

  private backendUrl() {
    return (this.config.get("BackendUrl") ?? Brand.Current.domains.apiBase ?? "").replace(/\/+$/, "");
  }

  async createApprovalRequest(projectId: number, clubIdIn: number, requestedBeneficiaries: number, currentLimitIn: number, requestedBy: number): Promise<number> {
    return this.db.session(async (conn) => {
      let clubId = clubIdIn;
      if (clubId === 0) {
        const info = await this.yearTables.findByProjectId(conn, projectId);
        if (info) clubId = Number((await conn.executeScalar(`SELECT fk_club_id FROM \`${info.projectsTable}\` WHERE pk_project_id = @Id AND isdeleted = 0`, { Id: projectId })) ?? 0);
      }
      let currentLimit = currentLimitIn;
      if (currentLimit === 0) {
        const s = await conn.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'direct_beneficiaries_limit'");
        currentLimit = s && /^-?\d+$/.test(s.trim()) ? parseInt(s, 10) : 0;
      }
      const zoneId = Number(
        (await conn.executeScalar(
          `SELECT d.fk_zone_id FROM club_master c
           JOIN district_master d ON d.pk_district_id = c.fk_district_id
           WHERE c.pk_club_id = @ClubId AND c.isdeleted = 0 AND d.isdeleted = 0`,
          { ClubId: clubId },
        )) ?? 0,
      );
      if (!zoneId) throw new InvalidOperationException("Could not determine zone for this club.");
      // A second request for the same project refreshes the pending one.
      const existing = await conn.queryFirstOrDefault(
        `SELECT pk_approval_id AS Id, approval_token AS Token FROM beneficiary_approval_requests
         WHERE fk_project_id = @ProjectId AND fk_club_id = @ClubId AND status = 'pending' LIMIT 1`,
        { ProjectId: projectId, ClubId: clubId },
      );
      let id: number;
      let token: string;
      if (existing) {
        id = Number(existing.Id);
        token = String(existing.Token);
        await conn.execute(
          `UPDATE beneficiary_approval_requests
           SET requested_beneficiaries = @Requested, current_limit = @Limit, requested_by = @RequestedBy, created_date = NOW()
           WHERE pk_approval_id = @Id`,
          { Requested: requestedBeneficiaries, Limit: currentLimit, RequestedBy: requestedBy, Id: id },
        );
      } else {
        token = randomUUID().replace(/-/g, "");
        id = Number(
          await conn.executeScalar(
            `INSERT INTO beneficiary_approval_requests
                 (fk_project_id, fk_zone_id, fk_club_id, requested_beneficiaries, current_limit, approval_token, status, requested_by)
             VALUES (@ProjectId, @ZoneId, @ClubId, @Requested, @Limit, @Token, 'pending', @RequestedBy);
             SELECT LAST_INSERT_ID()`,
            { ProjectId: projectId, ZoneId: zoneId, ClubId: clubId, Requested: requestedBeneficiaries, Limit: currentLimit, Token: token, RequestedBy: requestedBy },
          ),
        );
      }
      const detail = await this.detailByToken(conn, token);
      if (detail) {
        const recipients = await this.recipients(conn, detail);
        if (!recipients.some((r) => r.role === "Zonal Coordinator")) {
          this.log.warn(`Beneficiary approval ${id} for zone ${zoneId}: no active Zonal Coordinator with an email — approval links not emailed.`);
        }
        const base = this.backendUrl();
        for (const r of recipients) {
          const isZc = r.role === "Zonal Coordinator";
          try {
            await this.email.sendBeneficiaryApprovalEmail(
              r.email, r.name, detail,
              isZc ? `${base}/api/beneficiary-approval/${token}/approve` : null,
              isZc ? `${base}/api/beneficiary-approval/${token}/reject` : null,
            );
          } catch (e) {
            this.log.error(`Failed to send beneficiary approval email to ${r.role} ${r.email} for approval ${id} (row was still created): ${(e as Error).message}`);
          }
        }
      }
      return id;
    });
  }

  /** The zone's co-ordinator, the club's President and Secretary for the project's year, and the submitter (each once, by email). */
  private async recipients(conn: DbCommands, d: ApprovalDetail) {
    const out: { name: string; email: string; role: string }[] = [];
    const seen = new Set<string>();
    const add = (name: string | null, email: string | null, role: string) => {
      if (!email || !email.trim()) {
        this.log.warn(`Beneficiary approval ${d.id}: ${role} ${name} has no email — skipped.`);
        return;
      }
      const e = email.trim();
      if (seen.has(e.toLowerCase())) return;
      seen.add(e.toLowerCase());
      out.push({ name: name ?? role, email: e, role });
    };
    const zc = await conn.queryFirstOrDefault(
      `SELECT m.MemberName AS Name, m.EmailId AS Email
       FROM member_roles mr
       JOIN roles r ON r.pk_role_id = mr.fk_role_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
       WHERE mr.fk_zone_id = @ZoneId AND r.RoleName = 'ZonalCoordinator'
         AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
       LIMIT 1`,
      { ZoneId: d.zoneId },
    );
    if (zc) add(zc.Name as string | null, zc.Email as string | null, "Zonal Coordinator");
    const bod = await conn.query(
      `SELECT m.MemberName AS Name, m.EmailId AS Email, dm.designation_name AS Role
       FROM board_of_directors bod
       JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
       JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
       JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
       WHERE bod.fk_club_id = @ClubId AND COALESCE(bod.isdeleted, 0) = 0 AND m.isdeleted = 0
         AND dm.designation_name IN ('Club President', 'Club Secretary')
         AND (y.pk_year_id = @YearId OR (@YearId IS NULL AND y.IsCurrent = 1))`,
      { ClubId: d.clubId, YearId: d.yearId },
    );
    for (const role of ["Club President", "Club Secretary"]) {
      const holder = bod.find((b) => b.Role === role);
      if (!holder) this.log.warn(`Beneficiary approval ${d.id}: no ${role} in BOD for club ${d.clubId} year ${d.yearId} — skipped.`);
      else add(holder.Name as string | null, holder.Email as string | null, role);
    }
    add(d.requestedByName, d.requestedByEmail, "Submitter");
    return out;
  }

  async cancelPendingApproval(projectId: number) {
    await this.db.execute("UPDATE beneficiary_approval_requests SET status = 'cancelled' WHERE fk_project_id = @ProjectId AND status = 'pending'", { ProjectId: projectId });
  }

  getByToken(token: string) {
    return this.db.session((conn) => this.detailByToken(conn, token));
  }

  private async detailByToken(conn: DbCommands, token: string): Promise<ApprovalDetail | null> {
    const detail = BeneficiaryApprovalDetailDto.map(
      await conn.queryFirstOrDefault(
        `SELECT bar.pk_approval_id AS Id, bar.fk_project_id AS ProjectId, bar.fk_zone_id AS ZoneId,
                bar.fk_club_id AS ClubId, bar.requested_beneficiaries AS RequestedBeneficiaries,
                bar.approved_beneficiaries AS ApprovedBeneficiaries,
                bar.current_limit AS CurrentLimit, bar.approval_token AS ApprovalToken,
                bar.status AS Status, bar.remark AS Remark, bar.requested_by AS RequestedBy,
                bar.responded_date AS RespondedDate, bar.created_date AS CreatedDate,
                c.ClubName, d.DistrictNumber, z.ZoneName,
                m.MemberName AS RequestedByName, m.EmailId AS RequestedByEmail, m.PrimaryMobileNumber AS RequestedByMobile
         FROM beneficiary_approval_requests bar
         JOIN club_master c ON c.pk_club_id = bar.fk_club_id
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         JOIN zone_master z ON z.pk_zone_id = bar.fk_zone_id
         JOIN member_master_profile m ON m.pk_member_master_profile_id = bar.requested_by
         WHERE bar.approval_token = @Token`,
        { Token: token },
      ),
    ) as ApprovalDetail | null;
    if (!detail) return null;
    const info = await this.yearTables.findByProjectAndClub(conn, detail.projectId, detail.clubId);
    if (info) {
      detail.yearId = info.yearId;
      const proj = await conn.queryFirstOrDefault(
        `SELECT title AS ProjectTitle, description AS ProjectDescription, project_date AS ProjectDate, project_cost AS ProjectCost,
                direct_beneficiaries AS CurrentBeneficiaries, man_hours AS ManHours,
                rotarians_involved AS RotariansInvolved, rotaractors_involved AS RotaractorsInvolved, COALESCE(rcc_involved,0) AS RccInvolved
         FROM \`${info.projectsTable}\` WHERE pk_project_id = @ProjectId AND isdeleted = 0`,
        { ProjectId: detail.projectId },
      );
      if (proj) {
        const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
        Object.assign(detail, {
          projectTitle: (proj.ProjectTitle as string | null) ?? "", projectDescription: (proj.ProjectDescription as string | null) ?? null,
          projectDate: (proj.ProjectDate as string | null) ?? null, projectCost: n(proj.ProjectCost), currentBeneficiaries: n(proj.CurrentBeneficiaries),
          manHours: n(proj.ManHours), rotariansInvolved: n(proj.RotariansInvolved), rotaractorsInvolved: n(proj.RotaractorsInvolved), rccInvolved: n(proj.RccInvolved),
        });
      }
      const suffix = info.yearLabel.replace(/-/g, "_");
      const photos = await conn.query(
        `SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                       CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END,
                       '/', ph.image_path) AS url
         FROM \`${info.photosTable}\` ph
         JOIN \`${info.projectsTable}\` p ON p.pk_project_id = ph.fk_project_id
         WHERE ph.fk_project_id = @ProjectId
         ORDER BY ph.sort_order`,
        { ProjectId: detail.projectId },
      );
      detail.photoUrls = photos.map((p) => `${this.backendUrl()}${p.url}`);
    }
    return detail;
  }

  async approve(token: string, remark: string | null): Promise<[string, string]> {
    return this.db.session(async (conn) => {
      const appr = await conn.queryFirstOrDefault(
        `SELECT fk_project_id AS ProjectId, fk_club_id AS ClubId, requested_beneficiaries AS Requested, status AS Status
         FROM beneficiary_approval_requests WHERE approval_token = @Token`,
        { Token: token },
      );
      if (!appr) return ["not_found", "error"];
      if (appr.Status !== "pending") return [String(appr.Status), "already_processed"];
      await conn.execute(
        `UPDATE beneficiary_approval_requests SET status = 'approved', remark = @Remark, responded_date = NOW()
         WHERE approval_token = @Token AND status = 'pending'`,
        { Remark: remark ?? "", Token: token },
      );
      await this.applyApproved(conn, Number(appr.ProjectId), Number(appr.ClubId), Number(appr.Requested));
      await this.notify(conn, token, "approved", remark);
      return ["approved", "success"];
    });
  }

  private async applyApproved(conn: DbCommands, projectId: number, clubId: number, count: number) {
    const info = await this.yearTables.findByProjectAndClub(conn, projectId, clubId);
    if (!info) {
      this.log.warn(`Approved beneficiaries NOT applied — project ${projectId}/club ${clubId} not found in any year table.`);
      return;
    }
    await conn.execute(`UPDATE \`${info.projectsTable}\` SET direct_beneficiaries = @Requested, modified_date = NOW() WHERE pk_project_id = @ProjectId AND isdeleted = 0`, {
      Requested: count, ProjectId: projectId,
    });
  }

  async reject(token: string, remark: string): Promise<[string, string]> {
    return this.db.session(async (conn) => {
      const row = (await conn.callProcedure("sp_beneficiary_approval_reject", { p_Token: token, p_Remark: remark }))[0];
      const status = String(row?.Status ?? "");
      const result = String(row?.Result ?? "");
      if (result === "success") await this.notify(conn, token, "rejected", remark);
      return [status, result];
    });
  }

  async getZoneForMember(memberId: number) {
    return ZonalDashboardInfoDto.map(
      await this.db.queryFirstOrDefault(
        `SELECT mr.fk_zone_id AS ZoneId, z.ZoneName, z.ZoneName AS ZoneCode
         FROM member_roles mr
         JOIN roles r ON r.pk_role_id = mr.fk_role_id
         JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id
         WHERE mr.fk_member_master_profile_id = @Id AND r.RoleName = 'ZonalCoordinator'
           AND mr.IsActive = 1 AND mr.isdeleted = 0 AND z.isdeleted = 0
         LIMIT 1`,
        { Id: memberId },
      ),
    );
  }

  async getZoneInfoById(zoneId: number) {
    return ZonalDashboardInfoDto.map(
      await this.db.queryFirstOrDefault("SELECT z.pk_zone_id AS ZoneId, z.ZoneName, z.ZoneName AS ZoneCode FROM zone_master z WHERE z.pk_zone_id = @Id AND z.isdeleted = 0 LIMIT 1", { Id: zoneId }),
    );
  }

  /** Projects live in one table per Rotary year: a UNION of all of them, tagged with the year. */
  private async projectUnion(conn: DbCommands, withLabel = false) {
    const tables = await this.yearTables.getAllExistingYearTables(conn);
    if (!tables.length) return withLabel ? "SELECT NULL AS pk_project_id, NULL AS year_id, NULL AS year_label WHERE 1=0" : "SELECT NULL AS pk_project_id, NULL AS title, NULL AS project_date, NULL AS year_id WHERE 1=0";
    return tables
      .map((t) =>
        withLabel
          ? `SELECT pk_project_id, ${t.yearId} AS year_id, '${t.yearLabel}' AS year_label FROM \`${t.projectsTable}\` WHERE isdeleted = 0`
          : `SELECT pk_project_id, CONVERT(title USING utf8mb4) AS title, project_date, ${t.yearId} AS year_id FROM \`${t.projectsTable}\` WHERE isdeleted = 0`,
      )
      .join(" UNION ALL ");
  }

  /** The latest request per project in the zone, pending first. */
  async getApprovalRequestsByZone(zoneId: number, districtId: number, yearId: number, status: string | null, page: number, pageSize: number) {
    return this.db.session(async (conn) => {
      const pUnion = await this.projectUnion(conn);
      // pk_project_id repeats across year tables: match only the latest year's project.
      const from = `FROM beneficiary_approval_requests bar
         LEFT JOIN (${pUnion}) p ON p.pk_project_id = bar.fk_project_id
              AND p.year_id = (SELECT MAX(pp.year_id) FROM (${pUnion}) pp WHERE pp.pk_project_id = bar.fk_project_id)
         JOIN club_master c ON c.pk_club_id = bar.fk_club_id
         JOIN district_master d ON d.pk_district_id = c.fk_district_id`;
      const where = `WHERE bar.fk_zone_id = @ZoneId
           AND bar.pk_approval_id IN (
               SELECT MAX(b2.pk_approval_id) FROM beneficiary_approval_requests b2
               WHERE b2.fk_zone_id = @ZoneId GROUP BY b2.fk_project_id, b2.fk_club_id)
           AND (@DistrictId = 0 OR d.pk_district_id = @DistrictId)
           AND (@YearId = 0 OR p.year_id = @YearId)
           AND (@Status IS NULL OR bar.status = @Status)`;
      const p = { ZoneId: zoneId, DistrictId: districtId, YearId: yearId, Status: status || null, Offset: (page - 1) * pageSize, PageSize: pageSize };
      const items = ApprovalListItemDto.mapAll(
        await conn.query(
          `SELECT bar.pk_approval_id AS Id, bar.fk_project_id AS ProjectId, bar.requested_beneficiaries AS RequestedBeneficiaries,
                  bar.current_limit AS CurrentLimit, bar.approval_token AS ApprovalToken, bar.status AS Status, bar.remark AS Remark,
                  bar.responded_date AS RespondedDate, bar.created_date AS CreatedDate, p.title AS ProjectTitle, p.project_date AS ProjectDate,
                  c.ClubName, d.DistrictNumber, m.MemberName AS RequestedByName
           ${from}
           LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bar.requested_by
           ${where}
           ORDER BY CASE bar.status WHEN 'pending' THEN 0 ELSE 1 END, bar.created_date DESC
           LIMIT @Offset, @PageSize`,
          p,
        ),
      );
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) ${from} ${where}`, p));
      return { items, totalCount };
    });
  }

  async getZoneApprovalFilters(zoneId: number) {
    return this.db.session(async (conn) => {
      const yearUnion = await this.projectUnion(conn, true);
      const years = (
        await conn.query(
          `SELECT DISTINCT p.year_id AS Id, p.year_label AS Label,
                  COALESCE((SELECT ry.IsCurrent FROM rotary_year_master ry WHERE ry.pk_year_id = p.year_id), 0) AS IsCurrent
           FROM beneficiary_approval_requests bar
           JOIN (${yearUnion}) p ON p.pk_project_id = bar.fk_project_id
           WHERE bar.fk_zone_id = @ZoneId AND p.year_id IS NOT NULL
           ORDER BY p.year_label DESC`,
          { ZoneId: zoneId },
        )
      ).map((r: Row) => ({ id: Number(r.Id), label: String(r.Label ?? ""), isCurrent: r.IsCurrent === true || Number(r.IsCurrent) === 1 }));
      const districts = (
        await conn.query(
          `SELECT DISTINCT d.pk_district_id AS Id, d.DistrictNumber AS Number
           FROM beneficiary_approval_requests bar
           JOIN club_master c ON c.pk_club_id = bar.fk_club_id
           JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0
           WHERE bar.fk_zone_id = @ZoneId
           ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
          { ZoneId: zoneId },
        )
      ).map((r: Row) => ({ id: Number(r.Id), number: String(r.Number ?? "") }));
      const c = await conn.queryFirstOrDefault(
        `SELECT CAST(SUM(status = 'pending') AS SIGNED) AS Pending, CAST(SUM(status = 'approved') AS SIGNED) AS Approved,
                CAST(SUM(status = 'rejected') AS SIGNED) AS Rejected
         FROM beneficiary_approval_requests
         WHERE fk_zone_id = @ZoneId
           AND pk_approval_id IN (SELECT MAX(b2.pk_approval_id) FROM beneficiary_approval_requests b2 WHERE b2.fk_zone_id = @ZoneId GROUP BY b2.fk_project_id, b2.fk_club_id)`,
        { ZoneId: zoneId },
      );
      return { years, districts, counts: { pending: Number(c?.Pending ?? 0), approved: Number(c?.Approved ?? 0), rejected: Number(c?.Rejected ?? 0) } };
    });
  }

  async getApprovalHistory(approvalId: number, zoneId: number) {
    return this.db.session(async (conn) => {
      const key = await conn.queryFirstOrDefault(
        "SELECT fk_project_id AS ProjectId, fk_club_id AS ClubId FROM beneficiary_approval_requests WHERE pk_approval_id = @Id AND fk_zone_id = @ZoneId",
        { Id: approvalId, ZoneId: zoneId },
      );
      if (!key) return [];
      return ApprovalHistoryItemDto.mapAll(
        await conn.query(
          `SELECT bar.pk_approval_id AS ApprovalId, bar.requested_beneficiaries AS RequestedBeneficiaries, bar.approved_beneficiaries AS ApprovedBeneficiaries,
                  bar.status AS Status, bar.remark AS Remark, bar.created_date AS CreatedDate, bar.responded_date AS RespondedDate,
                  resp.MemberName AS RespondedByName
           FROM beneficiary_approval_requests bar
           LEFT JOIN member_master_profile resp ON resp.pk_member_master_profile_id = bar.responded_by
           WHERE bar.fk_zone_id = @ZoneId AND bar.fk_project_id = @ProjectId AND bar.fk_club_id = @ClubId
           ORDER BY bar.created_date DESC, bar.pk_approval_id DESC`,
          { ZoneId: zoneId, ProjectId: Number(key.ProjectId), ClubId: Number(key.ClubId) },
        ),
      );
    });
  }

  async getZoneDistricts(zoneId: number) {
    return ZonalDistrictDto.mapAll(
      await this.db.query(
        `SELECT d.pk_district_id AS Id, d.DistrictNumber, d.DistrictNumber AS DistrictName,
                (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS TotalClubs,
                (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                  JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                  JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS TotalMembers
         FROM district_master d
         WHERE d.fk_zone_id = @ZoneId AND d.isdeleted = 0 AND d.IsActive = 1
         ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
        { ZoneId: zoneId },
      ),
    );
  }

  async getDistrictClubs(districtId: number) {
    return ZonalClubDto.mapAll(await this.db.query("SELECT pk_club_id AS Id, ClubName, ClubCode FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 ORDER BY ClubName", { DistrictId: districtId }));
  }

  /** Dashboard approval: the co-ordinator may approve a different count than requested. */
  async zonalApprove(approvalId: number, zoneId: number, memberId: number, remark: string | null, approvedBeneficiaries: number | null): Promise<[string, string]> {
    return this.db.session(async (conn) => {
      const appr = await conn.queryFirstOrDefault(
        `SELECT fk_project_id AS ProjectId, fk_club_id AS ClubId, requested_beneficiaries AS Requested, status AS Status, approval_token AS Token
         FROM beneficiary_approval_requests WHERE pk_approval_id = @Id AND fk_zone_id = @ZoneId`,
        { Id: approvalId, ZoneId: zoneId },
      );
      if (!appr) return ["not_found", "error"];
      if (appr.Status !== "pending") return [String(appr.Status), "already_processed"];
      const applied = approvedBeneficiaries !== null && approvedBeneficiaries >= 0 ? approvedBeneficiaries : Number(appr.Requested);
      await conn.execute(
        `UPDATE beneficiary_approval_requests
         SET status = 'approved', approved_beneficiaries = @Applied, remark = @Remark, responded_by = @MemberId, responded_date = NOW()
         WHERE pk_approval_id = @Id AND status = 'pending'`,
        { Applied: applied, Remark: remark ?? "", MemberId: memberId, Id: approvalId },
      );
      await this.applyApproved(conn, Number(appr.ProjectId), Number(appr.ClubId), applied);
      await this.notify(conn, String(appr.Token), "approved", remark);
      return ["approved", "success"];
    });
  }

  async zonalReject(approvalId: number, zoneId: number, memberId: number, remark: string): Promise<[string, string]> {
    return this.db.session(async (conn) => {
      const row = (await conn.callProcedure("sp_zonal_reject_request", { p_ApprovalId: approvalId, p_ZoneId: zoneId, p_MemberId: memberId, p_Remark: remark }))[0];
      const status = String(row?.Status ?? "");
      const result = String(row?.Result ?? "");
      if (result === "success") await this.notify(conn, String(row!.Token), "rejected", remark);
      return [status, result];
    });
  }

  /** Decision emails to the co-ordinator, the club President and Secretary and the submitter. Failures are logged only. */
  private async notify(conn: DbCommands, token: string, decision: string, remark: string | null) {
    try {
      const detail = await this.detailByToken(conn, token);
      if (!detail) {
        this.log.warn(`Beneficiary ${decision} email not sent — approval token ${token} not found.`);
        return;
      }
      for (const r of await this.recipients(conn, detail)) {
        try {
          await this.email.sendBeneficiaryDecisionEmail(r.email, r.name, detail, decision, remark);
        } catch (e) {
          this.log.error(`Failed to send beneficiary ${decision} email to ${r.role} ${r.email} for approval ${detail.id}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.log.error(`Beneficiary ${decision} emails failed for approval token ${token}: ${(e as Error).message}`);
    }
  }
}
