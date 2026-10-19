using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class GreetingService : IGreetingService
{
    private readonly string _connectionString;

    public GreetingService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    private const string CurrentYearIdSql = "(SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1)";

    private record PauseInfo(bool IsGreetingPaused, string? GreetingReviewedYearLabel, string? CurrentYearLabel);

    // Mirrors GreetingsJob's pause rule: a custom message (any of the 4 text fields) that was last
    // saved for an earlier Rotary year pauses all greetings for that club/district until re-saved.
    // Blank messages never pause — the worker's neutral default text goes out instead.
    private static async Task<PauseInfo> GetPauseInfoAsync(MySqlConnection connection, string table, string pkColumn, int id)
    {
        try
        {
            var row = await connection.QueryFirstOrDefaultAsync<dynamic>($@"
                SELECT (y.pk_year_id IS NOT NULL
                        AND COALESCE(t.GreetingReviewedYearId, 0) <> y.pk_year_id
                        AND (NULLIF(TRIM(t.BirthdayGreeting), '') IS NOT NULL OR NULLIF(TRIM(t.AnniversaryGreeting), '') IS NOT NULL
                             OR NULLIF(TRIM(t.BirthdayEmailMessage), '') IS NOT NULL OR NULLIF(TRIM(t.AnniversaryEmailMessage), '') IS NOT NULL)) AS IsPaused,
                       ry.YearLabel AS ReviewedLabel, y.YearLabel AS CurrentLabel
                FROM `{table}` t
                LEFT JOIN (SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1) y ON 1 = 1
                LEFT JOIN rotary_year_master ry ON ry.pk_year_id = t.GreetingReviewedYearId
                WHERE t.`{pkColumn}` = @Id
                LIMIT 1",
                new { Id = id });
            if (row == null) return new PauseInfo(false, null, null);
            return new PauseInfo(Convert.ToInt64(row.IsPaused ?? 0) != 0, (string?)row.ReviewedLabel, (string?)row.CurrentLabel);
        }
        catch (MySqlException)
        {
            // Column not added yet (initializer skipped / SQL not run) — the worker also treats that as "no pause".
            return new PauseInfo(false, null, null);
        }
    }

    public async Task<GreetingSettingsDto?> GetSettingsAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var dto = await connection.QueryFirstOrDefaultAsync<GreetingSettingsDto>(
            "sp_greeting_get_settings",
            new { p_ClubId = clubId },
            commandType: CommandType.StoredProcedure);
        if (dto != null)
        {
            var pause = await GetPauseInfoAsync(connection, "club_master", "pk_club_id", clubId);
            dto.IsGreetingPaused = pause.IsGreetingPaused;
            dto.GreetingReviewedYearLabel = pause.GreetingReviewedYearLabel;
            dto.CurrentYearLabel = pause.CurrentYearLabel;
        }
        return dto;
    }

    public async Task UpdateSettingsAsync(int clubId, UpdateGreetingSettingsDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            $@"UPDATE club_master SET
                BirthdayGreeting = @BirthdayGreeting,
                IsEnableBirthdayNotification = @IsEnableBirthdayNotification,
                AnniversaryGreeting = @AnniversaryGreeting,
                IsEnableAnniversaryNotification = @IsEnableAnniversaryNotification,
                IsGreetingSendWhatsapp = @IsGreetingSendWhatsapp,
                IsEnableBirthdayEmail = @IsEnableBirthdayEmail,
                BirthdayEmailFrom = @BirthdayEmailFrom,
                BirthdayEmailSubject = @BirthdayEmailSubject,
                BirthdayEmailMessage = @BirthdayEmailMessage,
                IsEnableAnniversaryEmail = @IsEnableAnniversaryEmail,
                AnniversaryEmailFrom = @AnniversaryEmailFrom,
                AnniversaryEmailSubject = @AnniversaryEmailSubject,
                AnniversaryEmailMessage = @AnniversaryEmailMessage,
                GreetingReviewedYearId = {CurrentYearIdSql},
                modified_by = @ModifiedBy
            WHERE pk_club_id = @ClubId",
            new
            {
                ClubId = clubId,
                dto.BirthdayGreeting,
                dto.IsEnableBirthdayNotification,
                dto.AnniversaryGreeting,
                dto.IsEnableAnniversaryNotification,
                IsGreetingSendWhatsapp = false,
                dto.IsEnableBirthdayEmail,
                dto.BirthdayEmailFrom,
                dto.BirthdayEmailSubject,
                dto.BirthdayEmailMessage,
                dto.IsEnableAnniversaryEmail,
                dto.AnniversaryEmailFrom,
                dto.AnniversaryEmailSubject,
                dto.AnniversaryEmailMessage,
                ModifiedBy = modifiedBy
            });
    }

    public async Task<DistrictGreetingSettingsDto?> GetDistrictSettingsAsync(int districtId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var dto = await connection.QueryFirstOrDefaultAsync<DistrictGreetingSettingsDto>(
            @"SELECT BirthdayGreeting, IsEnableBirthdayNotification, AnniversaryGreeting, IsEnableAnniversaryNotification,
                     IsGreetingSendWhatsapp, IsGreetingSendEmail, IsGreetingSendPush,
                     IsEnableBirthdayEmail, BirthdayEmailFrom, BirthdayEmailSubject, BirthdayEmailMessage,
                     IsEnableAnniversaryEmail, AnniversaryEmailFrom, AnniversaryEmailSubject, AnniversaryEmailMessage
              FROM district_master
              WHERE pk_district_id = @DistrictId",
            new { DistrictId = districtId });
        if (dto != null)
        {
            var pause = await GetPauseInfoAsync(connection, "district_master", "pk_district_id", districtId);
            dto.IsGreetingPaused = pause.IsGreetingPaused;
            dto.GreetingReviewedYearLabel = pause.GreetingReviewedYearLabel;
            dto.CurrentYearLabel = pause.CurrentYearLabel;
        }
        return dto;
    }

    public async Task UpdateDistrictSettingsAsync(int districtId, UpdateDistrictGreetingSettingsDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            $@"UPDATE district_master SET
                BirthdayGreeting = @BirthdayGreeting, IsEnableBirthdayNotification = @IsEnableBirthdayNotification,
                AnniversaryGreeting = @AnniversaryGreeting, IsEnableAnniversaryNotification = @IsEnableAnniversaryNotification,
                IsGreetingSendWhatsapp = @IsGreetingSendWhatsapp, IsGreetingSendEmail = @IsGreetingSendEmail,
                IsGreetingSendPush = @IsGreetingSendPush,
                IsEnableBirthdayEmail = @IsEnableBirthdayEmail, BirthdayEmailFrom = @BirthdayEmailFrom,
                BirthdayEmailSubject = @BirthdayEmailSubject, BirthdayEmailMessage = @BirthdayEmailMessage,
                IsEnableAnniversaryEmail = @IsEnableAnniversaryEmail, AnniversaryEmailFrom = @AnniversaryEmailFrom,
                AnniversaryEmailSubject = @AnniversaryEmailSubject, AnniversaryEmailMessage = @AnniversaryEmailMessage,
                GreetingReviewedYearId = {CurrentYearIdSql},
                modified_by = @ModifiedBy
            WHERE pk_district_id = @DistrictId",
            new
            {
                DistrictId = districtId,
                dto.BirthdayGreeting, dto.IsEnableBirthdayNotification,
                dto.AnniversaryGreeting, dto.IsEnableAnniversaryNotification,
                IsGreetingSendWhatsapp = false, dto.IsGreetingSendEmail, dto.IsGreetingSendPush,
                dto.IsEnableBirthdayEmail, dto.BirthdayEmailFrom, dto.BirthdayEmailSubject, dto.BirthdayEmailMessage,
                dto.IsEnableAnniversaryEmail, dto.AnniversaryEmailFrom, dto.AnniversaryEmailSubject, dto.AnniversaryEmailMessage,
                ModifiedBy = modifiedBy
            });
    }
}
