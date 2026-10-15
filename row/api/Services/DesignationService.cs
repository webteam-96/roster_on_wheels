using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class DesignationService : IDesignationService
{
    private readonly string _connectionString;

    public DesignationService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<DesignationDto>> GetAllAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Inline SQL — SP `sp_designation_get_all` cannot be updated due to SYSTEM_USER privilege issue.
        // Adds BodCount = number of active, non-deleted BOD members assigned to each designation.
        return (await connection.QueryAsync<DesignationDto>(@"
            SELECT d.pk_designation_id AS Id,
                   d.designation_name AS DesignationName,
                   d.sort_order AS SortOrder,
                   (SELECT COUNT(*) FROM board_of_directors b
                      WHERE b.fk_designation_id = d.pk_designation_id AND b.isdeleted = 0) AS BodCount
            FROM designation_master d
            WHERE d.isdeleted = 0
            ORDER BY d.sort_order, d.pk_designation_id")).ToList();
    }

    public async Task<int> CreateAsync(CreateDesignationDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // De-dup guard. designation_master has no UNIQUE index on
        // designation_name, and sp_designation_create blindly INSERTs — so a
        // second call with the same name silently creates a duplicate row.
        // Symptom: BOD rows ended up pointing at the new id (e.g. President
        // = 41 instead of 1), and any code that joins by id missed those
        // rows. Now: if an ACTIVE row with the same (case-insensitive)
        // name exists, return its id. If only a SOFT-DELETED row exists,
        // reactivate it (and update sort_order) instead of inserting.
        var name = (dto.DesignationName ?? "").Trim();
        if (string.IsNullOrEmpty(name))
            throw new ArgumentException("Designation name is required.");

        var existing = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_designation_id AS Id, isdeleted AS IsDeleted
            FROM designation_master
            WHERE LOWER(TRIM(designation_name)) = LOWER(@Name)
            ORDER BY isdeleted ASC, pk_designation_id ASC
            LIMIT 1",
            new { Name = name });

        if (existing != null)
        {
            int existingId = (int)existing.Id;
            int isDeleted = Convert.ToInt32(existing.IsDeleted);
            if (isDeleted == 0)
                return existingId; // already active — idempotent
            // Soft-deleted row — reactivate instead of creating a duplicate.
            await connection.ExecuteAsync(@"
                UPDATE designation_master
                   SET isdeleted = 0,
                       deleted_by = NULL,
                       deleted_date = NULL,
                       sort_order = @Sort,
                       modified_by = @ModifiedBy,
                       modified_date = NOW()
                 WHERE pk_designation_id = @Id",
                new { Id = existingId, Sort = dto.SortOrder, ModifiedBy = createdBy });
            return existingId;
        }

        return await connection.ExecuteScalarAsync<int>(
            "sp_designation_create",
            new { p_DesignationName = name, p_SortOrder = dto.SortOrder, p_CreatedBy = createdBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateAsync(int id, UpdateDesignationDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_designation_update",
            new { p_Id = id, p_DesignationName = dto.DesignationName, p_SortOrder = dto.SortOrder, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Block delete if any active BOD member is assigned to this designation.
        // FK board_of_directors.fk_designation_id → designation_master.pk_designation_id.
        var bodCount = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM board_of_directors
            WHERE fk_designation_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (bodCount > 0)
        {
            var name = await connection.ExecuteScalarAsync<string?>(
                "SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id AND isdeleted = 0",
                new { Id = id }) ?? "this designation";
            throw new InvalidOperationException(
                $"Cannot delete '{name}' — {bodCount} BOD member{(bodCount == 1 ? "" : "s")} {(bodCount == 1 ? "is" : "are")} currently assigned to it. " +
                "Reassign or remove those members first.");
        }

        await connection.ExecuteAsync(
            "sp_designation_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task SwapOrderAsync(int id1, int id2)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_designation_swap_order",
            new { p_Id1 = id1, p_Id2 = id2 },
            commandType: CommandType.StoredProcedure);
    }

    // Drag-and-drop full-list reorder: rewrite sort_order to match the given order.
    // Inline SQL (not an SP) per the SYSTEM_USER privilege issue.
    public async Task ReorderAllAsync(int[] orderedIds)
    {
        if (orderedIds == null || orderedIds.Length == 0) return;
        using var connection = CreateConnection();
        await connection.OpenAsync();
        for (int i = 0; i < orderedIds.Length; i++)
        {
            await connection.ExecuteAsync(
                "UPDATE designation_master SET sort_order = @Sort WHERE pk_designation_id = @Id AND isdeleted = 0",
                new { Sort = i + 1, Id = orderedIds[i] });
        }
    }
}
