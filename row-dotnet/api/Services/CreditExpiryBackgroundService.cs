using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public class CreditExpiryBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CreditExpiryBackgroundService> _logger;

    public CreditExpiryBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration configuration, ILogger<CreditExpiryBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Run immediately on startup, then every 24 hours
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessExpiryAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in credit expiry background job");
            }

            // Wait 24 hours
            await Task.Delay(TimeSpan.FromHours(24), stoppingToken);
        }
    }

    private async Task ProcessExpiryAsync()
    {
        var connectionString = _configuration.GetConnectionString("DefaultConnection")!;
        using var connection = new MySqlConnection(connectionString);
        await connection.OpenAsync();

        // 1. Mark expired credits as inactive
        var expiredCount = await connection.ExecuteAsync(
            "UPDATE club_credits SET IsActive = 0, modified_date = NOW() WHERE IsActive = 1 AND NOW() > ToDate AND isdeleted = 0");

        if (expiredCount > 0)
            _logger.LogInformation("Marked {Count} credit records as expired", expiredCount);

        // 2. Send expiry warning emails (5 days before) — only once per credit
        var expiringCredits = (await connection.QueryAsync<dynamic>(@"
            SELECT cc.pk_credit_id, cc.fk_club_id, cc.CreditType,
                   (cc.CreditCount - cc.UsedCount) AS Remaining,
                   cc.ToDate,
                   DATEDIFF(cc.ToDate, NOW()) AS DaysLeft,
                   c.ClubName
            FROM club_credits cc
            JOIN club_master c ON c.pk_club_id = cc.fk_club_id
            WHERE cc.IsActive = 1 AND cc.isdeleted = 0
              AND DATEDIFF(cc.ToDate, NOW()) <= 5
              AND DATEDIFF(cc.ToDate, NOW()) >= 0
              AND (cc.CreditCount - cc.UsedCount) > 0
              AND cc.pk_credit_id NOT IN (
                  SELECT CAST(SourceDetail AS UNSIGNED) FROM club_credit_usage_history
                  WHERE Source = 'ExpiryWarning' AND fk_club_id = cc.fk_club_id
              )")).ToList();

        if (expiringCredits.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var emailService = scope.ServiceProvider.GetRequiredService<IEmailService>();

        foreach (var credit in expiringCredits)
        {
            try
            {
                int clubId = (int)credit.fk_club_id;
                string creditType = (string)credit.CreditType;
                int remaining = (int)credit.Remaining;
                int daysLeft = (int)credit.DaysLeft;
                string clubName = (string)credit.ClubName;
                DateTime toDate = (DateTime)credit.ToDate;

                // Get admin email
                var adminInfo = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT m.MemberName, m.EmailId
                    FROM member_roles mr
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
                    WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 AND mr.isdeleted = 0
                    LIMIT 1", new { ClubId = clubId });

                if (adminInfo != null && !string.IsNullOrWhiteSpace((string?)adminInfo.EmailId))
                {
                    var subject = $"⚠️ {creditType} Credits Expiring Soon - {clubName}";
                    var body = $@"
                        {EmailService.EMAIL_HEADER}
                            <h2 style='color: #d69e2e; margin-top: 0;'>⚠️ {creditType} Credits Expiring Soon</h2>
                            <p>Dear {(string)adminInfo.MemberName},</p>
                            <p>Your <strong>{creditType}</strong> credits for <strong>{clubName}</strong> are expiring soon.</p>
                            <div style='background-color: #fffff0; border: 1px solid #f6e05e; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                                <table style='width:100%;border-collapse:collapse;'>
                                    <tr><td style='padding:6px 0;font-weight:bold;'>Credit Type:</td><td>{creditType}</td></tr>
                                    <tr><td style='padding:6px 0;font-weight:bold;'>Remaining Credits:</td><td style='color:#e53e3e;font-weight:bold;'>{remaining}</td></tr>
                                    <tr><td style='padding:6px 0;font-weight:bold;'>Expiry Date:</td><td style='color:#e53e3e;font-weight:bold;'>{toDate:dd-MMM-yyyy}</td></tr>
                                    <tr><td style='padding:6px 0;font-weight:bold;'>Days Left:</td><td style='color:#e53e3e;font-weight:bold;'>{daysLeft} day{(daysLeft != 1 ? "s" : "")}</td></tr>
                                </table>
                            </div>
                            <p>Please contact your administrator to renew your credits before they expire.</p>
                        {EmailService.EMAIL_FOOTER}";

                    await emailService.SendGenericEmailAsync((string)adminInfo.EmailId, subject, body);

                    // Record that we sent this warning (to avoid duplicate emails)
                    await connection.ExecuteAsync(
                        @"INSERT INTO club_credit_usage_history (fk_club_id, fk_district_id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
                          VALUES (@ClubId, NULL, @CreditType, 0, 'ExpiryWarning', @CreditId, @CreditIdStr, @Remaining, @Remaining, 0, NOW())",
                        new { ClubId = clubId, CreditType = creditType, CreditId = (int)credit.pk_credit_id, CreditIdStr = credit.pk_credit_id.ToString(), Remaining = remaining });

                    _logger.LogInformation("Sent {CreditType} expiry warning to {Email} for club {Club} ({DaysLeft} days left)",
                        creditType, (string)adminInfo.EmailId, clubName, daysLeft);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send expiry warning for credit {Id}", (int)credit.pk_credit_id);
            }
        }
    }
}
