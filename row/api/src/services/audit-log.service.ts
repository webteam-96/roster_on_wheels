import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import { Db } from "../database/db.service";

/**
 * Port of AuditLogService.cs: explicit audit entries written by services, with
 * the member's name and highest role. Never throws.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger("AuditLogService");
  constructor(private readonly db: Db) {}

  async log(
    memberId: number, action: string, entityType: string,
    entityId: number | null = null, entityName: string | null = null, details: unknown = null, req: Request | null = null,
  ): Promise<void> {
    try {
      await this.db.session(async (conn) => {
        const memberInfo = await conn.queryFirstOrDefault("SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id", { Id: memberId });
        const roleName = await conn.executeScalar<string>(
          `SELECT r.RoleName
           FROM member_roles mr
           JOIN roles r ON r.pk_role_id = mr.fk_role_id
           WHERE mr.fk_member_master_profile_id = @Id
             AND mr.IsActive = 1 AND mr.isdeleted = 0
           ORDER BY CASE r.RoleName
               WHEN 'SuperAdmin' THEN 1
               WHEN 'RIDirector' THEN 2
               WHEN 'ZonalCoordinator' THEN 3
               WHEN 'Admin' THEN 4
               WHEN 'AG' THEN 5
               WHEN 'ClubModerator' THEN 6
               ELSE 99
           END ASC
           LIMIT 1`,
          { Id: memberId },
        );
        let userAgent = req?.headers["user-agent"] ?? null;
        if (userAgent && userAgent.length > 500) userAgent = userAgent.slice(0, 500);
        await conn.execute(
          `INSERT INTO audit_log
               (fk_member_master_profile_id, member_name, role_name, action, entity_type,
                entity_id, entity_name, details, ip_address, user_agent)
           VALUES (@MemberId, @MemberName, @RoleName, @Action, @EntityType,
                   @EntityId, @EntityName, @Details, @Ip, @Ua)`,
          {
            MemberId: memberId,
            MemberName: memberInfo?.MemberName ?? null,
            RoleName: roleName,
            Action: action,
            EntityType: entityType,
            EntityId: entityId,
            EntityName: entityName,
            Details: details === null || details === undefined ? null : JSON.stringify(details),
            Ip: req?.ip ?? null,
            Ua: userAgent,
          },
        );
      });
    } catch (e) {
      this.logger.error(`Failed to write audit log entry: ${action} ${entityType}: ${(e as Error).message}`);
    }
  }
}
