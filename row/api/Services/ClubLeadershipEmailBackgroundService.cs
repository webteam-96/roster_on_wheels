using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public class ClubLeadershipEmailBackgroundService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ClubLeadershipEmailBackgroundService> _logger;
    private readonly string _connectionString;

    public ClubLeadershipEmailBackgroundService(
        IServiceProvider serviceProvider,
        ILogger<ClubLeadershipEmailBackgroundService> logger,
        IConfiguration configuration)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ClubLeadership email background service started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessDueSchedulesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in ClubLeadership email background service.");
            }
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }

    private async Task ProcessDueSchedulesAsync(CancellationToken ct)
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        var due = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, fk_district_id AS districtId, fk_year_id AS yearId
            FROM club_leadership_email_schedule
            WHERE Status = 'Pending' AND ScheduleDateTime <= NOW() AND isdeleted = 0
            ORDER BY ScheduleDateTime
            LIMIT 5")).ToList();

        foreach (var s in due)
        {
            if (ct.IsCancellationRequested) break;
            await ProcessScheduleAsync(conn, (int)s.id, (int)s.districtId, (int)s.yearId);
        }
    }

    private async Task ProcessScheduleAsync(MySqlConnection conn, int scheduleId, int districtId, int yearId)
    {
        await conn.ExecuteAsync(
            "UPDATE club_leadership_email_schedule SET Status = 'Processing' WHERE pk_id = @Id",
            new { Id = scheduleId });

        var yearLabel = await conn.ExecuteScalarAsync<string>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = yearId });

        var recipients = (await conn.QueryAsync<dynamic>(@"
            SELECT b.fk_club_id AS clubId, c.ClubName AS clubName,
                   b.fk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   m.EmailId AS email, d.designation_name AS designation
            FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id
            JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            WHERE c.fk_district_id = @D AND b.fk_year_id = @Y AND b.isdeleted = 0
              AND d.designation_name IN ('Club President', 'Club Secretary')
              AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
            new { D = districtId, Y = yearId })).ToList();

        int sent = 0, failed = 0;
        using var scope = _serviceProvider.CreateScope();
        var emailService = scope.ServiceProvider.GetRequiredService<IEmailService>();

        foreach (var r in recipients)
        {
            var logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO club_leadership_email_log
                    (fk_schedule_id, fk_district_id, fk_year_id, fk_club_id, fk_member_id, DesignationName, Email, Status)
                VALUES (@S, @D, @Y, @C, @M, @Des, @E, 'Processing');
                SELECT LAST_INSERT_ID();",
                new { S = scheduleId, D = districtId, Y = yearId, C = (int)r.clubId, M = (int)r.memberId,
                      Des = (string)r.designation, E = (string)r.email });

            try
            {
                var mobile = await conn.ExecuteScalarAsync<string?>(
                    "SELECT PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
                    new { Id = (int)r.memberId });

                var warning = await emailService.SendClubAdminAssignmentEmailAsync(
                    (string)r.email, (string)r.memberName, mobile, null,
                    (string)r.designation, (string)r.clubName, yearLabel ?? "");

                await conn.ExecuteAsync(@"
                    UPDATE club_leadership_email_log
                    SET Status = 'Sent', SentDate = NOW(), ErrorMessage = @Warn WHERE pk_id = @Id",
                    new { Id = logId, Warn = warning });
                sent++;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send leadership email to {Email}", LogMask.Email((string)r.email));
                await conn.ExecuteAsync(@"
                    UPDATE club_leadership_email_log
                    SET Status = 'Failed', ErrorMessage = @Err WHERE pk_id = @Id",
                    new { Id = logId, Err = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message });
                failed++;
            }
        }

        await conn.ExecuteAsync(@"
            UPDATE club_leadership_email_schedule
            SET Status = 'Completed', SentCount = @S, FailedCount = @F, ProcessedDate = NOW()
            WHERE pk_id = @Id",
            new { Id = scheduleId, S = sent, F = failed });
    }

}
