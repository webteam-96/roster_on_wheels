using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class TrfContributionService : ITrfContributionService
{
    private readonly string _connectionString;

    public TrfContributionService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ── Fund Master ────────────────────────────────────────────────────

    public async Task<IEnumerable<TrfFundDto>> GetFundsAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryAsync<TrfFundDto>(
            @"SELECT pk_fund_id AS Id, FundName, SortOrder, IsActive
              FROM trf_fund_master
              WHERE isdeleted = 0 AND IsActive = 1
              ORDER BY SortOrder, pk_fund_id");
    }

    public async Task<TrfFundDto> CreateFundAsync(CreateTrfFundDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var id = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO trf_fund_master (FundName, SortOrder, IsActive, isdeleted, created_by, created_date)
              VALUES (@FundName, @SortOrder, 1, 0, @UserId, NOW());
              SELECT LAST_INSERT_ID();",
            new { dto.FundName, dto.SortOrder, UserId = userId });

        return new TrfFundDto
        {
            Id = id,
            FundName = dto.FundName,
            SortOrder = dto.SortOrder,
            IsActive = true
        };
    }

    public async Task UpdateFundAsync(int fundId, UpdateTrfFundDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE trf_fund_master
              SET FundName = @FundName, SortOrder = @SortOrder, IsActive = @IsActive,
                  modified_by = @UserId, modified_date = NOW()
              WHERE pk_fund_id = @FundId AND isdeleted = 0",
            new { FundId = fundId, dto.FundName, dto.SortOrder, IsActive = dto.IsActive ? 1 : 0, UserId = userId });
    }

    public async Task DeleteFundAsync(int fundId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE trf_fund_master SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
              WHERE pk_fund_id = @FundId",
            new { FundId = fundId, UserId = userId });
    }

    // ── Contributions ──────────────────────────────────────────────────

    public async Task<IEnumerable<TrfContributionDto>> GetContributionsAsync(int clubId, int yearId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryAsync<TrfContributionDto>(
            @"SELECT pk_trf_id AS Id, fk_club_id AS ClubId, fk_year_id AS YearId,
                     TrfDate, DonorName, AmountUSD, fk_fund_id AS FundId, FundType, OtherFundName
              FROM trf_contributions
              WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0
              ORDER BY TrfDate DESC",
            new { ClubId = clubId, YearId = yearId });
    }

    public async Task<TrfContributionDto> CreateContributionAsync(int clubId, CreateTrfContributionDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Look up fund name to denormalize into FundType
        var fundName = await connection.ExecuteScalarAsync<string>(
            "SELECT FundName FROM trf_fund_master WHERE pk_fund_id = @FundId AND isdeleted = 0",
            new { FundId = dto.FundId }) ?? "";

        var id = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO trf_contributions (fk_club_id, fk_year_id, TrfDate, DonorName, AmountUSD,
                     fk_fund_id, FundType, OtherFundName, created_by, created_date, isdeleted)
              VALUES (@ClubId, @YearId, @TrfDate, @DonorName, @AmountUSD,
                     @FundId, @FundType, @OtherFundName, @UserId, NOW(), 0);
              SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = clubId,
                YearId = dto.YearId,
                dto.TrfDate,
                dto.DonorName,
                dto.AmountUSD,
                FundId = dto.FundId,
                FundType = fundName,
                dto.OtherFundName,
                UserId = userId
            });

        return new TrfContributionDto
        {
            Id = id,
            ClubId = clubId,
            YearId = dto.YearId,
            TrfDate = dto.TrfDate,
            DonorName = dto.DonorName,
            AmountUSD = dto.AmountUSD,
            FundId = dto.FundId,
            FundType = fundName,
            OtherFundName = dto.OtherFundName
        };
    }

    public async Task<TrfContributionDto> UpdateContributionAsync(int clubId, int trfId, UpdateTrfContributionDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Look up fund name to denormalize into FundType
        var fundName = await connection.ExecuteScalarAsync<string>(
            "SELECT FundName FROM trf_fund_master WHERE pk_fund_id = @FundId AND isdeleted = 0",
            new { FundId = dto.FundId }) ?? "";

        await connection.ExecuteAsync(
            @"UPDATE trf_contributions
              SET TrfDate = @TrfDate, DonorName = @DonorName, AmountUSD = @AmountUSD,
                  fk_fund_id = @FundId, FundType = @FundType, OtherFundName = @OtherFundName,
                  modified_by = @UserId, modified_date = NOW()
              WHERE pk_trf_id = @TrfId AND fk_club_id = @ClubId AND isdeleted = 0",
            new
            {
                TrfId = trfId,
                ClubId = clubId,
                dto.TrfDate,
                dto.DonorName,
                dto.AmountUSD,
                FundId = dto.FundId,
                FundType = fundName,
                dto.OtherFundName,
                UserId = userId
            });

        return new TrfContributionDto
        {
            Id = trfId,
            ClubId = clubId,
            TrfDate = dto.TrfDate,
            DonorName = dto.DonorName,
            AmountUSD = dto.AmountUSD,
            FundId = dto.FundId,
            FundType = fundName,
            OtherFundName = dto.OtherFundName
        };
    }

    public async Task DeleteContributionAsync(int trfId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE trf_contributions
              SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW()
              WHERE pk_trf_id = @TrfId",
            new { TrfId = trfId, UserId = userId });
    }

    // ── CMR Helpers ────────────────────────────────────────────────────

    public async Task<decimal> GetYearTotalAsync(int clubId, int yearId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryFirstOrDefaultAsync<decimal?>(
            @"SELECT SUM(AmountUSD)
              FROM trf_contributions
              WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
            new { ClubId = clubId, YearId = yearId }) ?? 0;
    }

    public async Task<decimal> GetMonthTotalAsync(int clubId, int yearId, int month)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryFirstOrDefaultAsync<decimal?>(
            @"SELECT SUM(AmountUSD)
              FROM trf_contributions
              WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
                    AND MONTH(TrfDate) = @Month AND isdeleted = 0",
            new { ClubId = clubId, YearId = yearId, Month = month }) ?? 0;
    }

    public async Task<List<TrfContributionDto>> GetContributionsForMonthAsync(int clubId, int yearId, int month)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var results = await connection.QueryAsync<TrfContributionDto>(
            @"SELECT pk_trf_id AS Id, fk_club_id AS ClubId, fk_year_id AS YearId,
                     TrfDate, DonorName, AmountUSD, fk_fund_id AS FundId, FundType, OtherFundName
              FROM trf_contributions
              WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
                    AND MONTH(TrfDate) = @Month AND isdeleted = 0
              ORDER BY TrfDate",
            new { ClubId = clubId, YearId = yearId, Month = month });

        return results.ToList();
    }
}
