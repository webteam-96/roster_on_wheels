import { Injectable } from "@nestjs/common";
import type { DbCommands } from "../database/db.service";
import { Brand } from "../brand/brand";

/**
 * Port of YearTableResolver.cs. Projects live in one table per Rotary year:
 * rotary_projects_2026_27 and rotary_project_photos_2026_27, created on demand.
 */
export interface YearTableInfo {
  yearId: number;
  yearLabel: string;
  projectsTable: string;
  photosTable: string;
}

const suffixFromLabel = (yearLabel: string) => yearLabel.replace(/-/g, "_");

/** Only labels like "2026-27" ever become table names. */
function assertLabel(yearLabel: string): void {
  if (!/^\d{4}-\d{2}$/.test(yearLabel)) throw new Error(`Invalid Rotary year label: ${yearLabel}`);
}

export const projectsTableName = (yearLabel: string) => `rotary_projects_${suffixFromLabel(yearLabel)}`;
export const photosTableName = (yearLabel: string) => `rotary_project_photos_${suffixFromLabel(yearLabel)}`;

const info = (yearId: number, label: string): YearTableInfo => ({
  yearId,
  yearLabel: label,
  projectsTable: projectsTableName(label),
  photosTable: photosTableName(label),
});

@Injectable()
export class YearTableResolver {
  getProjectsTableName = projectsTableName;
  getPhotosTableName = photosTableName;

  /** The year whose start-end range contains the date ("YYYY-MM-DD..."). */
  async resolveByDate(conn: DbCommands, projectDate: string | Date): Promise<YearTableInfo | null> {
    const row = await conn.queryFirstOrDefault(
      `SELECT pk_year_id, YearLabel
       FROM rotary_year_master
       WHERE @D BETWEEN StartDate AND EndDate
         AND isdeleted = 0
       LIMIT 1`,
      { D: projectDate },
    );
    return row ? info(Number(row.pk_year_id), row.YearLabel) : null;
  }

  async resolveByYearId(conn: DbCommands, yearId: number): Promise<YearTableInfo | null> {
    const label = await conn.executeScalar<string>(
      `SELECT YearLabel FROM rotary_year_master
       WHERE pk_year_id = @Id AND isdeleted = 0 LIMIT 1`,
      { Id: yearId },
    );
    return label ? info(yearId, label) : null;
  }

  /** Every year whose project and photo tables both exist, oldest first. */
  async getAllExistingYearTables(conn: DbCommands): Promise<YearTableInfo[]> {
    const rows = await conn.query(
      `SELECT y.pk_year_id, y.YearLabel
       FROM rotary_year_master y
       WHERE y.isdeleted = 0
         AND EXISTS (
             SELECT 1 FROM information_schema.tables t
             WHERE t.table_schema = DATABASE()
               AND t.table_name = CONCAT('rotary_projects_', REPLACE(y.YearLabel, '-', '_'))
         )
         AND EXISTS (
             SELECT 1 FROM information_schema.tables t
             WHERE t.table_schema = DATABASE()
               AND t.table_name = CONCAT('rotary_project_photos_', REPLACE(y.YearLabel, '-', '_'))
         )
       ORDER BY y.StartDate`,
    );
    return rows.map((r) => info(Number(r.pk_year_id), r.YearLabel));
  }

  async findByProjectId(conn: DbCommands, projectId: number): Promise<YearTableInfo | null> {
    for (const t of await this.getAllExistingYearTables(conn)) {
      const exists = Number(await conn.executeScalar(`SELECT COUNT(*) FROM \`${t.projectsTable}\` WHERE pk_project_id = @Id`, { Id: projectId }));
      if (exists > 0) return t;
    }
    return null;
  }

  async findByProjectAndClub(conn: DbCommands, projectId: number, clubId: number): Promise<YearTableInfo | null> {
    for (const t of await this.getAllExistingYearTables(conn)) {
      const exists = Number(
        await conn.executeScalar(`SELECT COUNT(*) FROM \`${t.projectsTable}\` WHERE pk_project_id = @Id AND fk_club_id = @Club AND isdeleted = 0`, {
          Id: projectId,
          Club: clubId,
        }),
      );
      if (exists > 0) return t;
    }
    return null;
  }

  ensureTablesExist(conn: DbCommands, yearLabel: string): Promise<void> {
    return ensureYearTablesExist(conn, yearLabel);
  }
}

/** CREATE TABLE IF NOT EXISTS for one year's project and photo tables. */
export async function ensureYearTablesExist(conn: DbCommands, yearLabel: string): Promise<void> {
  assertLabel(yearLabel);
  const suffix = suffixFromLabel(yearLabel);
  const projTbl = `rotary_projects_${suffix}`;
  const photoTbl = `rotary_project_photos_${suffix}`;
  const fkName = `fk_photo_project_${suffix}`;
  const currency = /^[A-Z]{3}$/.test(Brand.Current.locale.defaultCurrency) ? Brand.Current.locale.defaultCurrency : "USD";
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`${projTbl}\` (
        pk_project_id INT AUTO_INCREMENT PRIMARY KEY,
        fk_club_id INT NOT NULL,
        fk_district_id INT NULL,
        fk_module_id INT NOT NULL,
        fk_year_id INT NOT NULL,
        DistrictProjectType VARCHAR(20) NULL,
        project_type VARCHAR(20) NOT NULL DEFAULT 'one_time',
        parent_project_id INT NULL,
        ongoing_group_title VARCHAR(200) NULL,
        is_joint_project TINYINT(1) DEFAULT 0,
        co_host_name VARCHAR(200) NULL,
        club_role VARCHAR(10) NULL,
        title VARCHAR(500) NOT NULL,
        description VARCHAR(1000) NULL,
        location VARCHAR(200) NULL,
        fk_area_of_focus_id INT NULL,
        other_area_of_focus VARCHAR(100) NULL,
        fk_category_id INT NULL,
        other_category VARCHAR(100) NULL,
        fk_sub_category_id INT NULL,
        other_sub_category VARCHAR(100) NULL,
        project_date DATE NULL,
        project_cost DECIMAL(15,2) NULL,
        Currency VARCHAR(5) NOT NULL DEFAULT '${currency}',
        fk_funding_id INT NULL,
        direct_beneficiaries INT NULL,
        man_hours INT NULL,
        rotarians_involved INT NULL,
        rotaractors_involved INT NULL,
        rcc_involved INT NULL DEFAULT 0,
        send_whatsapp TINYINT(1) DEFAULT 0,
        meeting_type VARCHAR(20) NULL,
        agenda_document VARCHAR(500) NULL,
        minutes_document VARCHAR(500) NULL,
        attendance INT NULL,
        attendance_percentage DECIMAL(5,2) NULL,
        global_grant_number VARCHAR(50) NULL,
        amount_sanctioned DECIMAL(15,2) NULL,
        amount_received DECIMAL(15,2) NULL,
        amount_spent DECIMAL(15,2) NULL,
        host_clubs_districts VARCHAR(500) NULL,
        global_partner_clubs_districts VARCHAR(500) NULL,
        csr_company_name VARCHAR(200) NULL,
        IsSendWhatsapp TINYINT(1) NOT NULL DEFAULT 0,
        WhatsAppSentDate DATETIME NULL,
        WhatsAppSentCount INT NOT NULL DEFAULT 0,
        WhatsAppFailedCount INT NOT NULL DEFAULT 0,
        send_email TINYINT(1) DEFAULT 0,
        EmailSentDate DATETIME NULL,
        EmailSentCount INT NOT NULL DEFAULT 0,
        EmailFailedCount INT NOT NULL DEFAULT 0,
        PushNotificationSent TINYINT(1) DEFAULT 0,
        PushNotificationSentAt DATETIME NULL,
        synced_to_org TINYINT(1) NOT NULL DEFAULT 0,
        synced_to_org_date DATETIME NULL,
        approval_status VARCHAR(20) NULL,
        approval_remark VARCHAR(500) NULL,
        approved_by INT NULL,
        approval_date DATETIME NULL,
        approval_token VARCHAR(64) NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_by INT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        modified_by INT NULL,
        modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
        isdeleted INT DEFAULT 0,
        deleted_by INT NULL,
        deleted_date DATETIME NULL,
        old_pk INT NULL,
        INDEX idx_club_module (fk_club_id, fk_module_id, isdeleted),
        INDEX idx_year (fk_year_id),
        INDEX idx_parent (parent_project_id),
        INDEX idx_date (project_date),
        INDEX idx_old_pk (old_pk)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`${photoTbl}\` (
        pk_photo_id INT AUTO_INCREMENT PRIMARY KEY,
        fk_project_id INT NOT NULL,
        image_path VARCHAR(500) NOT NULL,
        description VARCHAR(500) NULL,
        is_primary TINYINT(1) DEFAULT 0,
        sort_order INT DEFAULT 0,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_photos_project (fk_project_id),
        CONSTRAINT \`${fkName}\` FOREIGN KEY (fk_project_id) REFERENCES \`${projTbl}\`(pk_project_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

/**
 * Port of RotaryYearHelper.EnsureRotaryYearAsync: the id of the Rotary year
 * (July-June) containing `date`, creating the year row and its tables if needed.
 * With no date: the current year, else the year of today (UTC).
 */
export async function ensureRotaryYear(conn: DbCommands, date: Date | string | null | undefined): Promise<number> {
  if (date === null || date === undefined) {
    const currentId = Number((await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1")) ?? 0);
    if (currentId > 0) return currentId;
    date = new Date();
  }
  const [y, m] = typeof date === "string" ? date.slice(0, 7).split("-").map(Number) : [date.getUTCFullYear(), date.getUTCMonth() + 1];
  const startYear = m >= 7 ? y : y - 1;
  const label = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

  const existingId = Number((await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE YearLabel = @Label LIMIT 1", { Label: label })) ?? 0);
  if (existingId > 0) {
    await conn.execute("UPDATE rotary_year_master SET isdeleted = 0 WHERE pk_year_id = @Id AND isdeleted = 1", { Id: existingId });
    await ensureYearTablesExist(conn, label);
    return existingId;
  }
  const newId = Number(
    await conn.executeScalar(
      `INSERT INTO rotary_year_master (YearLabel, StartDate, EndDate, IsCurrent, isdeleted, created_date)
       VALUES (@Label, @StartDate, @EndDate, 0, 0, NOW());
       SELECT LAST_INSERT_ID();`,
      { Label: label, StartDate: `${startYear}-07-01`, EndDate: `${startYear + 1}-06-30` },
    ),
  );
  await ensureYearTablesExist(conn, label);
  return newId;
}
