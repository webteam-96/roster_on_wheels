import { Injectable } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { InvalidOperationException } from "../../common/exceptions";
import { dbDateTime } from "../../common/binding";
import { CommsLimits, requireMax } from "../../services/comms-limits";
import { saveWithReadableName, type UploadedFile } from "../../services/media-storage";
import { DocumentDto, type SaveDocument } from "../../dtos/content.dtos";

const FILE_PATH = `
    CASE
        WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
        WHEN d.FilePath LIKE '/%' THEN d.FilePath
        WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
        WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
        ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
    END`;

/** Port of DocumentService.cs: the club (or district) document safe. */
@Injectable()
export class DocumentService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async getAll(clubId: number, status: string, search: string, page: number, pageSize: number, districtId: number | null = null) {
    const where = districtId !== null ? "d.fk_district_id = @EntityId" : "d.fk_club_id = @EntityId";
    const statusCond = status
      ? `AND (CASE WHEN NOW() < d.PublishDateTime THEN 'Unpublished' WHEN NOW() > d.ExpiryDateTime THEN 'Expired' ELSE 'Published' END = @Status)`
      : "";
    const searchCond = search ? "AND d.Title LIKE CONCAT('%', @Search, '%')" : "";
    const [rows, count] = await this.db.queryMultiple(
      `SELECT d.pk_document_id AS Id, d.fk_club_id AS ClubId,
              d.Title, d.AccessType,
              ${FILE_PATH} AS FilePath,
              d.OriginalFileName, d.PublishDateTime, d.ExpiryDateTime,
              CASE
                  WHEN NOW() < d.PublishDateTime THEN 'Unpublished'
                  WHEN NOW() > d.ExpiryDateTime THEN 'Expired'
                  ELSE 'Published'
              END AS Status
       FROM club_documents d
       WHERE ${where} AND d.isdeleted = 0
       ${statusCond} ${searchCond}
       ORDER BY d.PublishDateTime DESC
       LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) FROM club_documents d
       WHERE ${where} AND d.isdeleted = 0
       ${statusCond} ${searchCond};`,
      { EntityId: districtId ?? clubId, Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: DocumentDto.mapAll(rows), totalCount: Number(Object.values(count[0] ?? {})[0] ?? 0) };
  }

  async getById(id: number) {
    return DocumentDto.map(
      await this.db.queryFirstOrDefault(
        `SELECT d.pk_document_id AS Id,
                d.fk_club_id AS ClubId,
                d.Title,
                d.AccessType,
                ${FILE_PATH} AS FilePath,
                d.OriginalFileName,
                d.PublishDateTime,
                d.ExpiryDateTime,
                CASE
                    WHEN d.ExpiryDateTime < NOW() THEN 'Expired'
                    WHEN d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW() THEN 'Published'
                    ELSE 'Unpublished'
                END AS Status
         FROM club_documents d
         WHERE d.pk_document_id = @Id AND d.isdeleted = 0`,
        { Id: id },
      ),
    );
  }

  async create(clubId: number, dto: SaveDocument, createdBy: number, districtId: number | null = null): Promise<number> {
    requireMax(dto.title, CommsLimits.DocumentTitle, "Title");
    return Number(
      await this.db.executeScalar(
        `INSERT INTO club_documents (fk_club_id, fk_district_id, Title, AccessType, FilePath,
             OriginalFileName, PublishDateTime, ExpiryDateTime, created_by, created_date, isdeleted)
         VALUES (@ClubId, @DistrictId, @Title, @AccessType, @FilePath,
             @OriginalFileName, @PublishDateTime, @ExpiryDateTime, @CreatedBy, NOW(), 0);
         SELECT LAST_INSERT_ID();`,
        {
          ClubId: districtId !== null ? 0 : clubId, DistrictId: districtId, Title: dto.title, AccessType: dto.accessType, FilePath: dto.filePath,
          OriginalFileName: dto.originalFileName, PublishDateTime: dbDateTime(dto.publishDateTime) ?? "0001-01-01 00:00:00",
          ExpiryDateTime: dbDateTime(dto.expiryDateTime) ?? "0001-01-01 00:00:00", CreatedBy: createdBy,
        },
      ),
    );
  }

  async update(id: number, dto: SaveDocument, modifiedBy: number) {
    requireMax(dto.title, CommsLimits.DocumentTitle, "Title");
    await this.db.session(async (conn) => {
      const expired = Number(await conn.executeScalar("SELECT COUNT(*) FROM club_documents WHERE pk_document_id = @Id AND isdeleted = 0 AND ExpiryDateTime < NOW()", { Id: id }));
      if (expired > 0) throw new InvalidOperationException("Cannot edit an expired item. Once an item's expiry date has passed, it can no longer be modified.");
      await conn.executeProcedure("sp_document_update", {
        p_Id: id, p_Title: dto.title, p_AccessType: dto.accessType, p_FilePath: dto.filePath, p_OriginalFileName: dto.originalFileName,
        p_PublishDateTime: dbDateTime(dto.publishDateTime) ?? "0001-01-01 00:00:00", p_ExpiryDateTime: dbDateTime(dto.expiryDateTime) ?? "0001-01-01 00:00:00",
        p_ModifiedBy: modifiedBy,
      });
    });
  }

  async delete(id: number, deletedBy: number) {
    await this.db.executeProcedure("sp_document_delete", { p_Id: id, p_DeletedBy: deletedBy });
  }

  async uploadFile(clubId: number, file: UploadedFile): Promise<{ path: string; originalName: string }> {
    const path = await saveWithReadableName(this.config, file, "", "Documents", "documentsafe", `Group${clubId}`);
    return { path, originalName: file.originalname };
  }
}
