import { Injectable } from "@nestjs/common";
import { Db, type Row } from "../../database/db.service";
import { ArgumentException, InvalidOperationException } from "../../common/exceptions";
import { DesignationDto } from "../../dtos/board.dtos";

const scalar = (rows: Row[]) => Number(Object.values(rows[0] ?? {})[0] ?? 0);

/** Port of DesignationService.cs: the board designation master list. */
@Injectable()
export class DesignationService {
  constructor(private readonly db: Db) {}

  async getAll() {
    return DesignationDto.mapAll(
      await this.db.query(
        `SELECT d.pk_designation_id AS Id,
                d.designation_name AS DesignationName,
                d.sort_order AS SortOrder,
                (SELECT COUNT(*) FROM board_of_directors b
                   WHERE b.fk_designation_id = d.pk_designation_id AND b.isdeleted = 0) AS BodCount
         FROM designation_master d
         WHERE d.isdeleted = 0
         ORDER BY d.sort_order, d.pk_designation_id`,
      ),
    );
  }

  /** Same name (any case) as an existing designation: returns it, restoring it if deleted. */
  async create(designationName: string | null, sortOrder: number, createdBy: number): Promise<number> {
    const name = (designationName ?? "").trim();
    if (!name) throw new ArgumentException("Designation name is required.");
    return this.db.session(async (conn) => {
      const existing = await conn.queryFirstOrDefault(
        `SELECT pk_designation_id AS Id, isdeleted AS IsDeleted
         FROM designation_master
         WHERE LOWER(TRIM(designation_name)) = LOWER(@Name)
         ORDER BY isdeleted ASC, pk_designation_id ASC
         LIMIT 1`,
        { Name: name },
      );
      if (existing) {
        const id = Number(existing.Id);
        if (Number(existing.IsDeleted) === 0) return id;
        await conn.execute(
          `UPDATE designation_master
              SET isdeleted = 0, deleted_by = NULL, deleted_date = NULL, sort_order = @Sort,
                  modified_by = @ModifiedBy, modified_date = NOW()
            WHERE pk_designation_id = @Id`,
          { Id: id, Sort: sortOrder, ModifiedBy: createdBy },
        );
        return id;
      }
      return scalar(await conn.callProcedure("sp_designation_create", { p_DesignationName: name, p_SortOrder: sortOrder, p_CreatedBy: createdBy }));
    });
  }

  async update(id: number, designationName: string, sortOrder: number, modifiedBy: number) {
    await this.db.executeProcedure("sp_designation_update", { p_Id: id, p_DesignationName: designationName, p_SortOrder: sortOrder, p_ModifiedBy: modifiedBy });
  }

  async delete(id: number, deletedBy: number) {
    await this.db.session(async (conn) => {
      const bodCount = Number(await conn.executeScalar("SELECT COUNT(*) FROM board_of_directors WHERE fk_designation_id = @Id AND isdeleted = 0", { Id: id }));
      if (bodCount > 0) {
        const name = (await conn.executeScalar<string>("SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id AND isdeleted = 0", { Id: id })) ?? "this designation";
        throw new InvalidOperationException(
          `Cannot delete '${name}' — ${bodCount} BOD member${bodCount === 1 ? "" : "s"} ${bodCount === 1 ? "is" : "are"} currently assigned to it. ` +
            "Reassign or remove those members first.",
        );
      }
      await conn.executeProcedure("sp_designation_delete", { p_Id: id, p_DeletedBy: deletedBy });
    });
  }

  async swapOrder(id1: number, id2: number) {
    await this.db.executeProcedure("sp_designation_swap_order", { p_Id1: id1, p_Id2: id2 });
  }

  async reorderAll(orderedIds: number[]) {
    if (!orderedIds.length) return;
    await this.db.session(async (conn) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await conn.execute("UPDATE designation_master SET sort_order = @Sort WHERE pk_designation_id = @Id AND isdeleted = 0", { Sort: i + 1, Id: orderedIds[i] });
      }
    });
  }
}
