using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class CashfreeKycService : ICashfreeKycService
{
    private readonly string _connectionString;
    private readonly IConfiguration _configuration;
    private readonly IEmailService _emailService;
    private readonly ILogger<CashfreeKycService> _logger;

    public CashfreeKycService(IConfiguration configuration, IEmailService emailService, ILogger<CashfreeKycService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _configuration = configuration;
        _emailService = emailService;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ── Get All ──────────────────────────────────────────────────────────

    public async Task<IEnumerable<CashfreeKycListDto>> GetAllAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryAsync<CashfreeKycListDto>(
            @"SELECT pk_kyc_id AS Id, vendor_id AS VendorId, email AS Email, phone AS Phone,
                     account_holder AS AccountHolder, account_number AS AccountNumber,
                     ifsc AS Ifsc, name AS Name, pan AS Pan, status AS Status,
                     IsActive, created_date AS CreatedDate
              FROM cashfree_kyc
              WHERE COALESCE(isdeleted, 0) = 0
              ORDER BY created_date DESC");
    }

    // ── Send OTP ─────────────────────────────────────────────────────────

    public async Task<string> SendOtpAsync()
    {
        var otp = new Random().Next(100000, 999999).ToString();
        var otpEmail = _configuration["Cashfree:OtpEmail"] ?? "";

        if (string.IsNullOrEmpty(otpEmail))
            throw new InvalidOperationException("OTP email is not configured.");

        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"INSERT INTO cashfree_otp (otp_code, purpose, is_used, expiry_date, created_date)
              VALUES (@Otp, 'CASHFREE_KYC', 0, DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW())",
            new { Otp = otp });

        var subject = "Rotary Club - Cashfree KYC Verification OTP";
        var body = $@"
            {EmailService.EMAIL_HEADER}
                        <h2 style='color: #1a365d; margin-top: 0;'>Cashfree KYC Verification</h2>
                        <p>Your OTP for Cashfree KYC verification is:</p>
                        <div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;'>
                            <p style='font-size: 32px; font-weight: bold; color: #1a365d; letter-spacing: 8px; margin: 0;'>{otp}</p>
                        </div>
                        <p style='color: #718096;'>Valid for 5 minutes. Do not share this OTP with anyone.</p>
            {EmailService.EMAIL_FOOTER}";

        await _emailService.SendGenericEmailAsync(otpEmail, subject, body);

        _logger.LogInformation("Cashfree KYC OTP sent to {Email}", otpEmail);
        return "OTP sent successfully.";
    }

    // ── Verify OTP and Save ──────────────────────────────────────────────

    public async Task<CashfreeKycListDto> VerifyOtpAndSaveAsync(CashfreeVerifyOtpDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // 1. Verify OTP
        var otpRecord = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_otp_id FROM cashfree_otp
              WHERE otp_code = @Otp AND is_used = 0 AND expiry_date > NOW() AND purpose = 'CASHFREE_KYC'
              ORDER BY pk_otp_id DESC LIMIT 1",
            new { dto.Otp });

        if (otpRecord == null)
            throw new InvalidOperationException("Invalid or expired OTP.");

        // 2. Call Cashfree FIRST. If Cashfree rejects the create/update we must NOT save a local
        //    record — an orphan local row (no matching Cashfree vendor) is exactly what caused
        //    "vendor does not exist" on later refresh. Surface Cashfree's real reason and bail
        //    out BEFORE consuming the OTP or inserting, so the user can correct and retry.
        string status = "PENDING";
        bool isEdit = dto.KycId.HasValue;

        // Duplicate Vendor ID guard (new create only): a unique key on cashfree_kyc.vendor_id
        // would otherwise make the INSERT throw a raw 500. An ACTIVE duplicate is rejected with a
        // clear message; a previously SOFT-DELETED row with the same id is reactivated at save time.
        int? existingDeletedId = null;
        if (!isEdit)
        {
            var activeId = await connection.ExecuteScalarAsync<int?>(
                "SELECT pk_kyc_id FROM cashfree_kyc WHERE vendor_id = @VendorId AND COALESCE(isdeleted,0) = 0 LIMIT 1",
                new { dto.VendorId });
            if (activeId.HasValue)
                throw new InvalidOperationException($"A vendor with Vendor ID '{dto.VendorId}' already exists.");

            existingDeletedId = await connection.ExecuteScalarAsync<int?>(
                "SELECT pk_kyc_id FROM cashfree_kyc WHERE vendor_id = @VendorId AND COALESCE(isdeleted,0) = 1 ORDER BY pk_kyc_id DESC LIMIT 1",
                new { dto.VendorId });
        }

        if (isEdit)
        {
            var (success, apiStatus, errorMsg) = await CallCashfreeAddEditAsync("PATCH", $"/easy-split/vendors/{dto.VendorId}", dto);
            if (success)
            {
                status = apiStatus;
            }
            else
            {
                _logger.LogWarning("Cashfree PUT failed for vendor {VendorId}: {Error}", dto.VendorId, errorMsg);
                var reason = ExtractCashfreeMessage(errorMsg);
                throw new InvalidOperationException(string.IsNullOrWhiteSpace(reason)
                    ? "Cashfree could not update the vendor."
                    : $"Cashfree: {reason}");
            }
        }
        else
        {
            var (success, apiStatus, errorMsg) = await CallCashfreeAddEditAsync("POST", "/easy-split/vendors", dto);
            if (success)
            {
                status = apiStatus;
            }
            else if (errorMsg.Contains("vendor already exists", StringComparison.OrdinalIgnoreCase))
            {
                // Already on Cashfree — adopt its current status instead of failing.
                var (getSuccess, getStatus, _) = await GetCashfreeVendorAsync(dto.VendorId);
                status = getSuccess ? getStatus : status;
            }
            else
            {
                _logger.LogWarning("Cashfree POST failed for vendor {VendorId}: {Error}", dto.VendorId, errorMsg);
                var reason = ExtractCashfreeMessage(errorMsg);
                throw new InvalidOperationException(string.IsNullOrWhiteSpace(reason)
                    ? "Cashfree could not create the vendor."
                    : $"Cashfree: {reason}");
            }
        }

        // 3. Cashfree accepted and OTP is valid — consume the OTP now.
        await connection.ExecuteAsync(
            "UPDATE cashfree_otp SET is_used = 1 WHERE pk_otp_id = @Id",
            new { Id = (int)otpRecord.pk_otp_id });

        // 4. Save to DB
        int kycId;
        if (isEdit)
        {
            await connection.ExecuteAsync(
                @"UPDATE cashfree_kyc
                  SET email = @Email, phone = @Phone, account_holder = @AccountHolder,
                      account_number = @AccountNumber, ifsc = @Ifsc, name = @Name,
                      pan = @Pan, status = @Status, modified_by = @UserId, modified_date = NOW()
                  WHERE pk_kyc_id = @KycId AND COALESCE(isdeleted, 0) = 0",
                new
                {
                    dto.Email, dto.Phone, dto.AccountHolder, dto.AccountNumber,
                    dto.Ifsc, dto.Name, dto.Pan, Status = status,
                    UserId = userId, KycId = dto.KycId!.Value
                });
            kycId = dto.KycId!.Value;
        }
        else if (existingDeletedId.HasValue)
        {
            // Reactivate a previously soft-deleted vendor with the same Vendor ID (avoids a
            // unique-key clash and lets a deleted vendor be re-added cleanly).
            await connection.ExecuteAsync(
                @"UPDATE cashfree_kyc
                  SET email = @Email, phone = @Phone, account_holder = @AccountHolder,
                      account_number = @AccountNumber, ifsc = @Ifsc, name = @Name, pan = @Pan,
                      status = @Status, isdeleted = 0, IsActive = 1,
                      modified_by = @UserId, modified_date = NOW()
                  WHERE pk_kyc_id = @KycId",
                new
                {
                    dto.Email, dto.Phone, dto.AccountHolder, dto.AccountNumber,
                    dto.Ifsc, dto.Name, dto.Pan, Status = status, UserId = userId, KycId = existingDeletedId.Value
                });
            kycId = existingDeletedId.Value;
        }
        else
        {
            kycId = await connection.ExecuteScalarAsync<int>(
                @"INSERT INTO cashfree_kyc (vendor_id, email, phone, account_holder, account_number,
                         ifsc, name, pan, status, created_by, created_date)
                  VALUES (@VendorId, @Email, @Phone, @AccountHolder, @AccountNumber,
                         @Ifsc, @Name, @Pan, @Status, @UserId, NOW());
                  SELECT LAST_INSERT_ID();",
                new
                {
                    dto.VendorId, dto.Email, dto.Phone, dto.AccountHolder, dto.AccountNumber,
                    dto.Ifsc, dto.Name, dto.Pan, Status = status, UserId = userId
                });
        }

        // 5. Send notification email
        try
        {
            var otpEmail = _configuration["Cashfree:OtpEmail"] ?? "";
            if (!string.IsNullOrEmpty(otpEmail))
            {
                var action = isEdit ? "updated" : "added";
                var notifSubject = $"Rotary Club - Cashfree Vendor {(isEdit ? "Updated" : "Added")}";
                var notifBody = $@"
                    {EmailService.EMAIL_HEADER}
                        <h2 style='color: #1a365d; margin-top: 0;'>Cashfree Vendor {(isEdit ? "Updated" : "Added")}</h2>
                        <p>The Cashfree vendor account has been {action} successfully.</p>
                        <div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                            <p><strong>Vendor ID:</strong> {dto.VendorId}</p>
                            <p><strong>Name:</strong> {dto.Name}</p>
                            <p><strong>Email:</strong> {dto.Email}</p>
                            <p><strong>Status:</strong> {status}</p>
                        </div>
                    {EmailService.EMAIL_FOOTER}";

                await _emailService.SendGenericEmailAsync(otpEmail, notifSubject, notifBody);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send Cashfree vendor notification email");
        }

        return new CashfreeKycListDto
        {
            Id = kycId,
            VendorId = dto.VendorId,
            Email = dto.Email,
            Phone = dto.Phone,
            AccountHolder = dto.AccountHolder,
            AccountNumber = dto.AccountNumber,
            Ifsc = dto.Ifsc,
            Name = dto.Name,
            Pan = dto.Pan,
            Status = status,
            IsActive = true,
            CreatedDate = DateTime.Now
        };
    }

    // ── Delete ───────────────────────────────────────────────────────────

    public async Task DeleteAsync(int kycId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE cashfree_kyc SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW()
              WHERE pk_kyc_id = @KycId",
            new { KycId = kycId, UserId = userId });
    }

    // ── Toggle Active ────────────────────────────────────────────────────

    public async Task ToggleActiveAsync(int kycId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE cashfree_kyc SET IsActive = NOT IsActive, modified_by = @UserId, modified_date = NOW()
              WHERE pk_kyc_id = @KycId AND COALESCE(isdeleted, 0) = 0",
            new { KycId = kycId, UserId = userId });
    }

    // ── Get Vendor Detail ────────────────────────────────────────────────

    public async Task<CashfreeVendorDetailDto> GetVendorDetailAsync(int kycId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var record = await connection.QueryFirstOrDefaultAsync<CashfreeVendorDetailDto>(
            @"SELECT pk_kyc_id AS Id, vendor_id AS VendorId, email AS Email, phone AS Phone,
                     account_holder AS AccountHolder, account_number AS AccountNumber,
                     ifsc AS Ifsc, name AS Name, pan AS Pan, status AS Status
              FROM cashfree_kyc
              WHERE pk_kyc_id = @KycId AND COALESCE(isdeleted, 0) = 0",
            new { KycId = kycId });

        if (record == null)
            throw new KeyNotFoundException("KYC record not found.");

        // Also fetch from Cashfree API
        try
        {
            var (success, _, json) = await GetCashfreeVendorAsync(record.VendorId);
            if (success)
                record.CashfreeJson = json;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch Cashfree vendor detail for {VendorId}", record.VendorId);
        }

        return record;
    }

    // ── Refresh All Status ───────────────────────────────────────────────

    public async Task<int> RefreshAllStatusAsync(int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var vendors = await connection.QueryAsync<(int Id, string VendorId)>(
            @"SELECT pk_kyc_id AS Id, vendor_id AS VendorId
              FROM cashfree_kyc WHERE COALESCE(isdeleted, 0) = 0");

        int updatedCount = 0;
        foreach (var vendor in vendors)
        {
            try
            {
                var (success, status, _) = await GetCashfreeVendorAsync(vendor.VendorId);
                if (success)
                {
                    await connection.ExecuteAsync(
                        @"UPDATE cashfree_kyc SET status = @Status, modified_by = @UserId, modified_date = NOW()
                          WHERE pk_kyc_id = @KycId",
                        new { Status = status, UserId = userId, KycId = vendor.Id });
                    updatedCount++;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to refresh status for vendor {VendorId}", vendor.VendorId);
            }
        }

        return updatedCount;
    }

    // ── Refresh Vendor Status ────────────────────────────────────────────

    public async Task<string> RefreshVendorStatusAsync(int kycId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var vendorId = await connection.ExecuteScalarAsync<string>(
            "SELECT vendor_id FROM cashfree_kyc WHERE pk_kyc_id = @KycId AND COALESCE(isdeleted, 0) = 0",
            new { KycId = kycId });

        if (string.IsNullOrEmpty(vendorId))
            throw new KeyNotFoundException("KYC record not found.");

        var (success, status, json) = await GetCashfreeVendorAsync(vendorId);
        if (!success)
        {
            // Surface Cashfree's actual reason (e.g. "vendor does not exist" for a KYC record
            // whose onboarding never completed) instead of a generic failure message.
            var reason = ExtractCashfreeMessage(json);
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(reason)
                ? "Failed to fetch vendor status from Cashfree."
                : $"Cashfree: {reason}");
        }

        await connection.ExecuteAsync(
            @"UPDATE cashfree_kyc SET status = @Status, modified_by = @UserId, modified_date = NOW()
              WHERE pk_kyc_id = @KycId",
            new { Status = status, UserId = userId, KycId = kycId });

        return status;
    }

    // ── Cashfree API Helpers ─────────────────────────────────────────────

    private async Task<(bool Success, string Status, string ErrorMessage)> CallCashfreeAddEditAsync(
        string method, string endpoint, CashfreeVerifyOtpDto dto)
    {
        var baseUrl = _configuration["Cashfree:BaseUrl"] ?? "https://api.cashfree.com/pg";
        var clientId = _configuration["Cashfree:ClientId"] ?? "";
        var clientSecret = _configuration["Cashfree:ClientSecret"] ?? "";
        var apiVersion = _configuration["Cashfree:ApiVersion"] ?? "2023-08-01";

        // Cashfree expects single objects (VendorBankDetails / VendorKYCDetails), NOT arrays.
        // The live GET response confirms bank is an object: {account_number, account_holder, ifsc}.
        var requestBody = new Dictionary<string, object?>
        {
            ["name"] = dto.Name,
            ["email"] = dto.Email,
            ["phone"] = dto.Phone,
            ["verify_account"] = true,
            ["dashboard_access"] = true,
            ["schedule_option"] = 2,
            ["bank"] = new
            {
                account_number = dto.AccountNumber,
                account_holder = dto.AccountHolder,
                ifsc = dto.Ifsc
            },
            ["kyc_details"] = new
            {
                business_type = "Non Profit/NGO",
                pan = dto.Pan
            }
        };
        // CREATE (POST) carries vendor_id in the body and status=ACTIVE. UPDATE (PATCH) has
        // vendor_id in the URL and must NOT send status — Cashfree only accepts status
        // BLOCKED/DELETED via PATCH, otherwise it errors "Invalid state".
        if (method == "POST")
        {
            requestBody["vendor_id"] = dto.VendorId;
            requestBody["status"] = "ACTIVE";
        }

        try
        {
            using var httpClient = new HttpClient();
            httpClient.DefaultRequestHeaders.Add("x-client-id", clientId);
            httpClient.DefaultRequestHeaders.Add("x-client-secret", clientSecret);
            httpClient.DefaultRequestHeaders.Add("x-api-version", apiVersion);

            var jsonContent = new StringContent(
                JsonSerializer.Serialize(requestBody),
                Encoding.UTF8,
                "application/json");

            HttpResponseMessage response;
            var url = $"{baseUrl}{endpoint}";

            if (method == "PATCH")
                response = await httpClient.PatchAsync(url, jsonContent);
            else if (method == "PUT")
                response = await httpClient.PutAsync(url, jsonContent);
            else
                response = await httpClient.PostAsync(url, jsonContent);

            var responseBody = await response.Content.ReadAsStringAsync();
            _logger.LogInformation("Cashfree {Method} {Endpoint} response: {StatusCode} - {Body}",
                method, endpoint, (int)response.StatusCode, responseBody);

            if (response.IsSuccessStatusCode)
            {
                var jsonDoc = JsonDocument.Parse(responseBody);
                var status = "ACTIVE";
                if (jsonDoc.RootElement.TryGetProperty("status", out var statusProp))
                    status = statusProp.GetString() ?? "ACTIVE";
                return (true, status, "");
            }

            return (false, "", responseBody);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Cashfree API {Method} {Endpoint} failed", method, endpoint);
            return (false, "", ex.Message);
        }
    }

    // ── Sync Vendor from Cashfree ─────────────────────────────────────────
    public async Task<int> SyncVendorFromCashfreeAsync(string vendorId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Check if already exists
        var existing = await connection.ExecuteScalarAsync<int?>(
            "SELECT pk_kyc_id FROM cashfree_kyc WHERE vendor_id = @VendorId AND COALESCE(isdeleted, 0) = 0",
            new { VendorId = vendorId });
        if (existing.HasValue)
            throw new InvalidOperationException($"Vendor '{vendorId}' already exists in the database (ID: {existing.Value}).");

        // Fetch from Cashfree API
        var (success, status, json) = await GetCashfreeVendorAsync(vendorId);
        if (!success)
            throw new InvalidOperationException($"Could not fetch vendor from Cashfree: {json}");

        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var email = root.TryGetProperty("email", out var e) ? e.GetString() ?? "" : "";
        var phone = root.TryGetProperty("phone", out var p) ? p.GetString() ?? "" : "";
        var name = root.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";

        var accountHolder = "";
        var accountNumber = "";
        var ifsc = "";
        if (root.TryGetProperty("bank", out var bank) && bank.ValueKind == JsonValueKind.Array)
        {
            foreach (var b in bank.EnumerateArray())
            {
                accountHolder = b.TryGetProperty("account_holder", out var ah) ? ah.GetString() ?? "" : "";
                accountNumber = b.TryGetProperty("account_number", out var an) ? an.GetString() ?? "" : "";
                ifsc = b.TryGetProperty("ifsc", out var i) ? i.GetString() ?? "" : "";
                break;
            }
        }

        var pan = root.TryGetProperty("related_docs", out var docs) && docs.ValueKind == JsonValueKind.Array
            ? docs.EnumerateArray().FirstOrDefault().TryGetProperty("doc_value", out var dv) ? dv.GetString() ?? "" : ""
            : "";

        var kycId = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO cashfree_kyc (vendor_id, email, phone, account_holder, account_number,
                     ifsc, name, pan, status, IsActive, created_by, created_date)
              VALUES (@VendorId, @Email, @Phone, @AccountHolder, @AccountNumber,
                     @Ifsc, @Name, @Pan, @Status, 1, @UserId, NOW());
              SELECT LAST_INSERT_ID();",
            new { VendorId = vendorId, Email = email, Phone = phone, AccountHolder = accountHolder,
                  AccountNumber = accountNumber, Ifsc = ifsc, Name = name, Pan = pan,
                  Status = status, UserId = userId });

        _logger.LogInformation("Synced vendor {VendorId} from Cashfree, inserted as pk_kyc_id={KycId}", vendorId, kycId);
        return kycId;
    }

    // Pull the human-readable "message" out of a Cashfree error body
    // (e.g. {"code":"...","message":"vendor does not exist","type":"..."}). Returns "" for
    // a non-JSON body (network/timeout) so the caller can fall back to a generic message.
    private static string ExtractCashfreeMessage(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return "";
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("message", out var msgProp))
                return msgProp.GetString() ?? "";
        }
        catch { /* not JSON */ }
        return "";
    }

    private async Task<(bool Success, string Status, string Json)> GetCashfreeVendorAsync(string vendorId)
    {
        var baseUrl = _configuration["Cashfree:BaseUrl"] ?? "https://api.cashfree.com/pg";
        var clientId = _configuration["Cashfree:ClientId"] ?? "";
        var clientSecret = _configuration["Cashfree:ClientSecret"] ?? "";
        var apiVersion = _configuration["Cashfree:ApiVersion"] ?? "2023-08-01";

        try
        {
            using var httpClient = new HttpClient();
            httpClient.DefaultRequestHeaders.Add("x-client-id", clientId);
            httpClient.DefaultRequestHeaders.Add("x-client-secret", clientSecret);
            httpClient.DefaultRequestHeaders.Add("x-api-version", apiVersion);

            var url = $"{baseUrl}/easy-split/vendors/{vendorId}";
            var response = await httpClient.GetAsync(url);
            var responseBody = await response.Content.ReadAsStringAsync();

            _logger.LogInformation("Cashfree GET vendor {VendorId} response: {StatusCode} - {Body}",
                vendorId, (int)response.StatusCode, responseBody);

            if (response.IsSuccessStatusCode)
            {
                var jsonDoc = JsonDocument.Parse(responseBody);
                var status = "ACTIVE";
                if (jsonDoc.RootElement.TryGetProperty("status", out var statusProp))
                    status = statusProp.GetString() ?? "ACTIVE";
                return (true, status, responseBody);
            }

            return (false, "", responseBody);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Cashfree GET vendor {VendorId} failed", vendorId);
            return (false, "", ex.Message);
        }
    }
}
