using System.Data;
using System.Text;
using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public partial class RiDirectorService
{
    // ══════════════════════════════════════════════════════════════
    // WEB LINKS (RI-scoped) — simple flat list (no parent hierarchy for RI)
    // ══════════════════════════════════════════════════════════════
    public async Task<List<RiWeblinkListDto>> GetWeblinksAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return (await conn.QueryAsync<RiWeblinkListDto>(@"
            SELECT pk_weblink_id AS Id, Title, Writeup, LinkType, LinkUrl, YoutubeUrl,
                   ButtonText, SortOrder, IsActive, created_date AS CreatedDate
            FROM weblinks
            WHERE Scope = 'ri' AND isdeleted = 0
            ORDER BY SortOrder ASC, pk_weblink_id DESC")).ToList();
    }

    public async Task<RiWeblinkListDto?> GetWeblinkByIdAsync(int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return await conn.QueryFirstOrDefaultAsync<RiWeblinkListDto>(@"
            SELECT pk_weblink_id AS Id, Title, Writeup, LinkType, LinkUrl, YoutubeUrl,
                   ButtonText, SortOrder, IsActive, created_date AS CreatedDate
            FROM weblinks
            WHERE pk_weblink_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
    }

    public async Task<int> CreateWeblinkAsync(RiCreateWeblinkDto dto, int createdBy)
    {
        if (string.IsNullOrWhiteSpace(dto.Title)) throw new InvalidOperationException("Title is required.");
        UrlValidator.ValidateWeblinkUrls(dto.LinkType, dto.LinkUrl, dto.YoutubeUrl);
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO weblinks (fk_club_id, fk_district_id, fk_parent_id, Level, Scope,
                Title, Writeup, LinkType, LinkUrl, YoutubeUrl, ButtonText,
                SortOrder, IsActive, created_by, created_date, isdeleted)
            VALUES (0, NULL, NULL, 1, 'ri',
                @Title, @Writeup, @LinkType, @LinkUrl, @YoutubeUrl, @ButtonText,
                @SortOrder, @IsActive, @U, NOW(), 0);
            SELECT LAST_INSERT_ID();", new
            {
                dto.Title, dto.Writeup, dto.LinkType, dto.LinkUrl, dto.YoutubeUrl, dto.ButtonText,
                dto.SortOrder,
                IsActive = dto.IsActive ? 1 : 0,
                U = createdBy
            });
    }

    public async Task UpdateWeblinkAsync(int id, RiCreateWeblinkDto dto, int modifiedBy)
    {
        if (string.IsNullOrWhiteSpace(dto.Title)) throw new InvalidOperationException("Title is required.");
        UrlValidator.ValidateWeblinkUrls(dto.LinkType, dto.LinkUrl, dto.YoutubeUrl);
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE weblinks
            SET Title = @Title, Writeup = @Writeup, LinkType = @LinkType,
                LinkUrl = @LinkUrl, YoutubeUrl = @YoutubeUrl, ButtonText = @ButtonText,
                SortOrder = @SortOrder, IsActive = @IsActive,
                modified_by = @U, modified_date = NOW()
            WHERE pk_weblink_id = @Id AND Scope = 'ri'", new
            {
                Id = id,
                dto.Title, dto.Writeup, dto.LinkType, dto.LinkUrl, dto.YoutubeUrl, dto.ButtonText,
                dto.SortOrder,
                IsActive = dto.IsActive ? 1 : 0,
                U = modifiedBy
            });
    }

    public async Task DeleteWeblinkAsync(int id, int deletedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE weblinks SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
            WHERE pk_weblink_id = @Id AND Scope = 'ri'",
            new { Id = id, U = deletedBy });
    }

    // ══════════════════════════════════════════════════════════════
    // DOCUMENTS (RI-scoped)
    // ══════════════════════════════════════════════════════════════
    public async Task<(List<DocumentListDto> Items, int TotalCount)> GetDocumentsAsync(string? status, string? search, int page, int pageSize)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var statusCond = string.IsNullOrEmpty(status) ? "" : @"AND (
            CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                 WHEN NOW() > ExpiryDateTime THEN 'Expired'
                 ELSE 'Published' END = @Status)";
        var searchCond = string.IsNullOrEmpty(search) ? "" : "AND Title LIKE CONCAT('%', @Search, '%')";

        var sql = $@"
            SELECT pk_document_id AS Id, fk_club_id AS ClubId, fk_year_id AS YearId, Title,
                   AccessType,
                   CASE
                       WHEN FilePath IS NULL OR FilePath = '' THEN NULL
                       WHEN FilePath LIKE '/%' THEN FilePath
                       WHEN Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', FilePath)
                       WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', fk_district_id, '/', FilePath)
                       ELSE CONCAT('/Documents/documentsafe/Group', fk_club_id, '/', FilePath)
                   END AS FilePath,
                   OriginalFileName, PublishDateTime, ExpiryDateTime,
                   CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > ExpiryDateTime THEN 'Expired'
                        ELSE 'Published' END AS Status
            FROM club_documents
            WHERE Scope = 'ri' AND isdeleted = 0 {statusCond} {searchCond}
            ORDER BY PublishDateTime DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM club_documents
            WHERE Scope = 'ri' AND isdeleted = 0 {statusCond} {searchCond};";

        using var multi = await conn.QueryMultipleAsync(sql, new
        {
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });
        var items = (await multi.ReadAsync<DocumentListDto>()).ToList();
        var total = await multi.ReadSingleAsync<int>();
        return (items, total);
    }

    public async Task<DocumentDetailDto?> GetDocumentByIdAsync(int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return await conn.QueryFirstOrDefaultAsync<DocumentDetailDto>(@"
            SELECT pk_document_id AS Id, fk_club_id AS ClubId, fk_year_id AS YearId, Title,
                   AccessType,
                   CASE
                       WHEN FilePath IS NULL OR FilePath = '' THEN NULL
                       WHEN FilePath LIKE '/%' THEN FilePath
                       WHEN Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', FilePath)
                       WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', fk_district_id, '/', FilePath)
                       ELSE CONCAT('/Documents/documentsafe/Group', fk_club_id, '/', FilePath)
                   END AS FilePath,
                   OriginalFileName, PublishDateTime, ExpiryDateTime,
                   CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > ExpiryDateTime THEN 'Expired'
                        ELSE 'Published' END AS Status
            FROM club_documents
            WHERE pk_document_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
    }

    public async Task<int> CreateDocumentAsync(CreateDocumentDto dto, int createdBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Documents are NOT year-wise — fk_year_id removed from the table.
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_documents (fk_club_id, fk_district_id, Scope, Title,
                AccessType, FilePath, OriginalFileName, PublishDateTime, ExpiryDateTime,
                Status, created_by, created_date, isdeleted)
            VALUES (0, NULL, 'ri', @Title, @AccessType, @FilePath, @OriginalFileName,
                @PublishDateTime, @ExpiryDateTime, 'Unpublished', @U, NOW(), 0);
            SELECT LAST_INSERT_ID();", new
            {
                dto.Title, dto.AccessType, dto.FilePath, dto.OriginalFileName,
                dto.PublishDateTime, dto.ExpiryDateTime,
                U = createdBy
            });
    }

    public async Task UpdateDocumentAsync(int id, UpdateDocumentDto dto, int modifiedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE club_documents
            SET Title = @Title, AccessType = @AccessType, FilePath = @FilePath,
                OriginalFileName = @OriginalFileName,
                PublishDateTime = @PublishDateTime, ExpiryDateTime = @ExpiryDateTime,
                modified_by = @U, modified_date = NOW()
            WHERE pk_document_id = @Id AND Scope = 'ri'", new
            {
                Id = id,
                dto.Title, dto.AccessType, dto.FilePath, dto.OriginalFileName,
                dto.PublishDateTime, dto.ExpiryDateTime,
                U = modifiedBy
            });
    }

    public async Task DeleteDocumentAsync(int id, int deletedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE club_documents SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
            WHERE pk_document_id = @Id AND Scope = 'ri'",
            new { Id = id, U = deletedBy });
    }

    public async Task<(string Path, string OriginalName)> UploadDocumentFileAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "documentsafe", "ri");
        Directory.CreateDirectory(uploadsPath);
        var originalName = file.FileName;
        var extension = Path.GetExtension(originalName);
        // IIS/URL-safe filename: replace spaces/'+'/special chars with '_' (IIS 404s on '+' etc. in the path).
        var baseName = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(originalName), @"[^A-Za-z0-9\-]+", "_").Trim('_');
        if (string.IsNullOrEmpty(baseName)) baseName = "file";
        var timestamp = DateTime.Now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"{baseName}_{Guid.NewGuid().ToString("N").Substring(0, 8)}{timestamp}{extension}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        // Store filename only — full URL reconstructed via SQL CONCAT on read
        return (fileName, originalName);
    }

    // ══════════════════════════════════════════════════════════════
    // NEWSLETTERS (RI-scoped) — with WhatsApp credit deduction
    // ══════════════════════════════════════════════════════════════
    public async Task<(List<NewsletterListDto> Items, int TotalCount)> GetNewslettersAsync(string? status, string? search, int page, int pageSize)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var statusCond = string.IsNullOrEmpty(status) ? "" : @"AND (
            CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                 WHEN NOW() > ExpiryDateTime THEN 'Expired'
                 ELSE 'Published' END = @Status)";
        var searchCond = string.IsNullOrEmpty(search) ? "" : "AND Title LIKE CONCAT('%', @Search, '%')";

        var sql = $@"
            SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, Title,
                   PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl,
                   CASE
                       WHEN FilePath IS NULL OR FilePath = '' THEN NULL
                       WHEN FilePath LIKE '/%' THEN FilePath
                       ELSE CONCAT('/Documents/ebulletin/ri/', FilePath)
                   END AS FilePath,
                   IsSendWhatsapp, IsSendEmail,
                   CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > ExpiryDateTime THEN 'Expired'
                        ELSE 'Published' END AS Status
            FROM newsletters
            WHERE Scope = 'ri' AND isdeleted = 0 {statusCond} {searchCond}
            ORDER BY PublishDateTime DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM newsletters
            WHERE Scope = 'ri' AND isdeleted = 0 {statusCond} {searchCond};";

        using var multi = await conn.QueryMultipleAsync(sql, new
        {
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });
        var items = (await multi.ReadAsync<NewsletterListDto>()).ToList();
        var total = await multi.ReadSingleAsync<int>();
        return (items, total);
    }

    public async Task<NewsletterDetailDto?> GetNewsletterByIdAsync(int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return await conn.QueryFirstOrDefaultAsync<NewsletterDetailDto>(@"
            SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, Title,
                   PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl,
                   CASE
                       WHEN FilePath IS NULL OR FilePath = '' THEN NULL
                       WHEN FilePath LIKE '/%' THEN FilePath
                       ELSE CONCAT('/Documents/ebulletin/ri/', FilePath)
                   END AS FilePath,
                   IsSendWhatsapp, IsSendEmail,
                   RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
                   CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > ExpiryDateTime THEN 'Expired'
                        ELSE 'Published' END AS Status
            FROM newsletters
            WHERE pk_newsletter_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
    }

    public async Task<int> CreateNewsletterAsync(RiCreateNewsletterDto dto, int createdBy)
    {

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO newsletters (fk_club_id, fk_district_id, Scope, Title,
                PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl, FilePath,
                IsSendWhatsapp, IsSendEmail, Status,
                RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
                created_by, created_date, isdeleted)
            VALUES (0, NULL, 'ri', @Title,
                @PublishDateTime, @ExpiryDateTime, @AttachmentType, @LinkUrl, @FilePath,
                @IsSendWhatsapp, @IsSendEmail, 'Unpublished',
                @RecipientTarget, @RecipientZoneIds, @RecipientDistrictIds, @RecipientSubgroupIds,
                @U, NOW(), 0);
            SELECT LAST_INSERT_ID();", new
            {
                dto.Title, dto.PublishDateTime, dto.ExpiryDateTime,
                dto.AttachmentType, dto.LinkUrl, dto.FilePath,
                IsSendWhatsapp = 0,
                IsSendEmail = dto.IsSendEmail ? 1 : 0,
                RecipientTarget = dto.RecipientTarget ?? "all",
                RecipientZoneIds = dto.RecipientZoneIds != null && dto.RecipientZoneIds.Length > 0 ? string.Join(",", dto.RecipientZoneIds) : null,
                RecipientDistrictIds = dto.RecipientDistrictIds != null && dto.RecipientDistrictIds.Length > 0 ? string.Join(",", dto.RecipientDistrictIds) : null,
                RecipientSubgroupIds = dto.RecipientSubgroupIds != null && dto.RecipientSubgroupIds.Length > 0 ? string.Join(",", dto.RecipientSubgroupIds) : null,
                U = createdBy
            });


        return id;
    }

    public async Task UpdateNewsletterAsync(int id, RiCreateNewsletterDto dto, int modifiedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var prior = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT IsSendWhatsapp FROM newsletters
            WHERE pk_newsletter_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
        bool priorWhatsapp = prior != null && Convert.ToBoolean(prior.IsSendWhatsapp);


        await conn.ExecuteAsync(@"
            UPDATE newsletters
            SET Title = @Title, PublishDateTime = @PublishDateTime, ExpiryDateTime = @ExpiryDateTime,
                AttachmentType = @AttachmentType, LinkUrl = @LinkUrl, FilePath = @FilePath,
                IsSendWhatsapp = @IsSendWhatsapp, IsSendEmail = @IsSendEmail,
                RecipientTarget = @RecipientTarget, RecipientZoneIds = @RecipientZoneIds,
                RecipientDistrictIds = @RecipientDistrictIds, RecipientSubgroupIds = @RecipientSubgroupIds,
                modified_by = @U, modified_date = NOW()
            WHERE pk_newsletter_id = @Id AND Scope = 'ri'", new
            {
                Id = id,
                dto.Title, dto.PublishDateTime, dto.ExpiryDateTime,
                dto.AttachmentType, dto.LinkUrl, dto.FilePath,
                IsSendWhatsapp = 0,
                IsSendEmail = dto.IsSendEmail ? 1 : 0,
                RecipientTarget = dto.RecipientTarget ?? "all",
                RecipientZoneIds = dto.RecipientZoneIds != null && dto.RecipientZoneIds.Length > 0 ? string.Join(",", dto.RecipientZoneIds) : null,
                RecipientDistrictIds = dto.RecipientDistrictIds != null && dto.RecipientDistrictIds.Length > 0 ? string.Join(",", dto.RecipientDistrictIds) : null,
                RecipientSubgroupIds = dto.RecipientSubgroupIds != null && dto.RecipientSubgroupIds.Length > 0 ? string.Join(",", dto.RecipientSubgroupIds) : null,
                U = modifiedBy
            });

    }

    public async Task DeleteNewsletterAsync(int id, int deletedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT IsSendWhatsapp, WhatsAppSentDate, Title FROM newsletters
            WHERE pk_newsletter_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
        bool shouldRefund = row != null
            && Convert.ToBoolean(row.IsSendWhatsapp)
            && row.WhatsAppSentDate == null;

        await conn.ExecuteAsync(@"
            UPDATE newsletters SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
            WHERE pk_newsletter_id = @Id AND Scope = 'ri'",
            new { Id = id, U = deletedBy });

        if (shouldRefund)
        {
            var deducted = await GetDeductedAmountAsync("WhatsApp", "RiNewsletter", id);
            if (deducted > 0)
                await RefundCreditWithHistoryAsync("WhatsApp", deducted, "RiNewsletter", id, $"Deleted before publish: {(string)row.Title}", deletedBy);
        }
    }

    public async Task<string> UploadNewsletterFileAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "ebulletin", "ri");
        Directory.CreateDirectory(uploadsPath);
        // IIS/URL-safe filename: replace spaces/'+'/special chars with '_' (IIS 404s on '+' etc. in the path).
        var originalName = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(file.FileName), @"[^A-Za-z0-9\-]+", "_").Trim('_');
        if (string.IsNullOrEmpty(originalName)) originalName = "file";
        var extension = Path.GetExtension(file.FileName);
        var timestamp = DateTime.Now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"{originalName}_{Guid.NewGuid().ToString("N").Substring(0, 8)}{timestamp}{extension}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        // Store filename only — full URL reconstructed via SQL CONCAT on read
        return fileName;
    }

    // ══════════════════════════════════════════════════════════════
    // REPORTS (XLSX — colorful)
    // ══════════════════════════════════════════════════════════════
    private static void ApplyHeader(IXLRange range, XLColor bg)
    {
        range.Style.Fill.BackgroundColor = bg;
        range.Style.Font.Bold = true;
        range.Style.Font.FontColor = XLColor.White;
        range.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        range.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        range.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
    }

    private static void ApplyDataStyle(IXLRange range, bool zebra = true)
    {
        range.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        range.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        if (zebra)
        {
            foreach (var row in range.Rows())
            {
                if (row.RowNumber() % 2 == 0)
                    row.Style.Fill.BackgroundColor = XLColor.FromHtml("#F7FAFC");
            }
        }
    }

    private static byte[] WorkbookToBytes(XLWorkbook wb)
    {
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public async Task<byte[]> GetReportZonesXlsxAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT z.pk_zone_id AS ZoneId, z.ZoneName,
                   (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.isdeleted = 0) AS Districts,
                   (SELECT COUNT(*) FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
                    WHERE d.fk_zone_id = z.pk_zone_id AND c.isdeleted = 0 AND d.isdeleted = 0) AS Clubs,
                   (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                    FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    JOIN district_master d ON d.pk_district_id = c.fk_district_id
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE d.fk_zone_id = z.pk_zone_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0) AS Members
            FROM zone_master z WHERE z.isdeleted = 0 ORDER BY z.ZoneName")).ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Zones Summary");

        // Title
        ws.Cell(1, 1).Value = "RI Director — Zones Summary";
        ws.Range(1, 1, 1, 5).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#1E40AF");
        ws.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(1).Height = 28;

        ws.Cell(2, 1).Value = $"Generated: {DateTime.Now:yyyy-MM-dd HH:mm}";
        ws.Range(2, 1, 2, 5).Merge();
        ws.Cell(2, 1).Style.Font.Italic = true;
        ws.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;

        // Header
        var headers = new[] { "Zone ID", "Zone Name", "Districts", "Clubs", "Members" };
        for (int i = 0; i < headers.Length; i++) ws.Cell(4, i + 1).Value = headers[i];
        ApplyHeader(ws.Range(4, 1, 4, headers.Length), XLColor.FromHtml("#3B82F6"));

        int row = 5;
        foreach (var r in rows)
        {
            ws.Cell(row, 1).Value = (int)r.ZoneId;
            ws.Cell(row, 2).Value = (string)r.ZoneName;
            ws.Cell(row, 3).Value = (long)r.Districts;
            ws.Cell(row, 4).Value = (long)r.Clubs;
            ws.Cell(row, 5).Value = (long)r.Members;
            row++;
        }
        if (row > 5) ApplyDataStyle(ws.Range(5, 1, row - 1, 5));

        // Totals row
        if (rows.Count > 0)
        {
            ws.Cell(row, 1).Value = "TOTAL";
            ws.Cell(row, 3).FormulaA1 = $"SUM(C5:C{row - 1})";
            ws.Cell(row, 4).FormulaA1 = $"SUM(D5:D{row - 1})";
            ws.Cell(row, 5).FormulaA1 = $"SUM(E5:E{row - 1})";
            var totalsRow = ws.Range(row, 1, row, 5);
            totalsRow.Style.Fill.BackgroundColor = XLColor.FromHtml("#DBEAFE");
            totalsRow.Style.Font.Bold = true;
            totalsRow.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        }

        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(4);
        return WorkbookToBytes(wb);
    }

    public async Task<byte[]> GetReportDistrictsXlsxAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT d.pk_district_id AS DistrictId, d.DistrictNumber, z.ZoneName,
                   (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS Clubs,
                   (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                    FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE c.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0) AS Members
            FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND d.IsActive = 1 ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber")).ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Districts Summary");

        ws.Cell(1, 1).Value = "RI Director — Districts Summary";
        ws.Range(1, 1, 1, 5).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#059669");
        ws.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(1).Height = 28;

        ws.Cell(2, 1).Value = $"Generated: {DateTime.Now:yyyy-MM-dd HH:mm}";
        ws.Range(2, 1, 2, 5).Merge();
        ws.Cell(2, 1).Style.Font.Italic = true;
        ws.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;

        var headers = new[] { "District ID", "District Number", "Zone", "Clubs", "Members" };
        for (int i = 0; i < headers.Length; i++) ws.Cell(4, i + 1).Value = headers[i];
        ApplyHeader(ws.Range(4, 1, 4, headers.Length), XLColor.FromHtml("#10B981"));

        int row = 5;
        foreach (var r in rows)
        {
            ws.Cell(row, 1).Value = (int)r.DistrictId;
            ws.Cell(row, 2).Value = (string)r.DistrictNumber;
            ws.Cell(row, 3).Value = (string?)r.ZoneName ?? "";
            ws.Cell(row, 4).Value = (long)r.Clubs;
            ws.Cell(row, 5).Value = (long)r.Members;
            row++;
        }
        if (row > 5) ApplyDataStyle(ws.Range(5, 1, row - 1, 5));

        if (rows.Count > 0)
        {
            ws.Cell(row, 1).Value = "TOTAL";
            ws.Cell(row, 4).FormulaA1 = $"SUM(D5:D{row - 1})";
            ws.Cell(row, 5).FormulaA1 = $"SUM(E5:E{row - 1})";
            var totalsRow = ws.Range(row, 1, row, 5);
            totalsRow.Style.Fill.BackgroundColor = XLColor.FromHtml("#D1FAE5");
            totalsRow.Style.Font.Bold = true;
            totalsRow.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        }

        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(4);
        return WorkbookToBytes(wb);
    }

    public async Task<byte[]> GetReportClubsXlsxAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS ClubId, c.ClubName, c.ClubRotaryId, d.DistrictNumber, z.ZoneName,
                   c.City, c.State,
                   (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS Members
            FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.isdeleted = 0 ORDER BY c.ClubName")).ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Clubs Master");

        ws.Cell(1, 1).Value = "RI Director — Clubs Master";
        ws.Range(1, 1, 1, 8).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#D97706");
        ws.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(1).Height = 28;

        ws.Cell(2, 1).Value = $"Generated: {DateTime.Now:yyyy-MM-dd HH:mm}";
        ws.Range(2, 1, 2, 8).Merge();
        ws.Cell(2, 1).Style.Font.Italic = true;
        ws.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;

        var headers = new[] { "Club ID", "Club Name", "Rotary ID", "District", "Zone", "City", "State", "Members" };
        for (int i = 0; i < headers.Length; i++) ws.Cell(4, i + 1).Value = headers[i];
        ApplyHeader(ws.Range(4, 1, 4, headers.Length), XLColor.FromHtml("#F59E0B"));

        int row = 5;
        foreach (var r in rows)
        {
            ws.Cell(row, 1).Value = (int)r.ClubId;
            ws.Cell(row, 2).Value = (string)r.ClubName;
            ws.Cell(row, 3).Value = (string?)r.ClubRotaryId ?? "";
            ws.Cell(row, 4).Value = (string?)r.DistrictNumber ?? "";
            ws.Cell(row, 5).Value = (string?)r.ZoneName ?? "";
            ws.Cell(row, 6).Value = (string?)r.City ?? "";
            ws.Cell(row, 7).Value = (string?)r.State ?? "";
            ws.Cell(row, 8).Value = (long)r.Members;
            row++;
        }
        if (row > 5)
        {
            ApplyDataStyle(ws.Range(5, 1, row - 1, 8));
            ws.RangeUsed().SetAutoFilter();
        }

        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(4);
        return WorkbookToBytes(wb);
    }

    public async Task<byte[]> GetReportMembersXlsxAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId, m.PrimaryMobileNumber,
                   m.RotaryId, c.ClubName, d.DistrictNumber, z.ZoneName
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE m.isdeleted = 0 AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber, m.RotaryId, c.ClubName, d.DistrictNumber, z.ZoneName
            ORDER BY m.MemberName")).ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Members Master");

        ws.Cell(1, 1).Value = "RI Director — Members Master";
        ws.Range(1, 1, 1, 8).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#BE185D");
        ws.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(1).Height = 28;

        ws.Cell(2, 1).Value = $"Generated: {DateTime.Now:yyyy-MM-dd HH:mm}  |  Total: {rows.Count}";
        ws.Range(2, 1, 2, 8).Merge();
        ws.Cell(2, 1).Style.Font.Italic = true;
        ws.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;

        var headers = new[] { "Member ID", "Name", "Email", "Mobile", "Rotary ID", "Club", "District", "Zone" };
        for (int i = 0; i < headers.Length; i++) ws.Cell(4, i + 1).Value = headers[i];
        ApplyHeader(ws.Range(4, 1, 4, headers.Length), XLColor.FromHtml("#EC4899"));

        int row = 5;
        foreach (var r in rows)
        {
            ws.Cell(row, 1).Value = (int)r.MemberId;
            ws.Cell(row, 2).Value = (string?)r.MemberName ?? "";
            ws.Cell(row, 3).Value = (string?)r.EmailId ?? "";
            ws.Cell(row, 4).Value = (string?)r.PrimaryMobileNumber ?? "";
            ws.Cell(row, 5).Value = (string?)r.RotaryId ?? "";
            ws.Cell(row, 6).Value = (string?)r.ClubName ?? "";
            ws.Cell(row, 7).Value = (string?)r.DistrictNumber ?? "";
            ws.Cell(row, 8).Value = (string?)r.ZoneName ?? "";
            row++;
        }
        if (row > 5)
        {
            ApplyDataStyle(ws.Range(5, 1, row - 1, 8));
            ws.RangeUsed().SetAutoFilter();
        }

        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(4);
        return WorkbookToBytes(wb);
    }

    public async Task<byte[]> GetReportCommunicationsXlsxAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Communications Log");

        ws.Cell(1, 1).Value = "RI Director — Communications Log";
        ws.Range(1, 1, 1, 6).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#7C3AED");
        ws.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(1).Height = 28;

        ws.Cell(2, 1).Value = $"Generated: {DateTime.Now:yyyy-MM-dd HH:mm}";
        ws.Range(2, 1, 2, 6).Merge();
        ws.Cell(2, 1).Style.Font.Italic = true;
        ws.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;

        var headers = new[] { "Type", "ID", "Title/Subject", "Recipients", "Date", "Status" };
        for (int i = 0; i < headers.Length; i++) ws.Cell(4, i + 1).Value = headers[i];
        ApplyHeader(ws.Range(4, 1, 4, headers.Length), XLColor.FromHtml("#8B5CF6"));

        int row = 5;
        void AddRow(string type, int id, string title, string recipients, DateTime dt, string status, string typeColor)
        {
            ws.Cell(row, 1).Value = type;
            ws.Cell(row, 1).Style.Fill.BackgroundColor = XLColor.FromHtml(typeColor);
            ws.Cell(row, 1).Style.Font.FontColor = XLColor.White;
            ws.Cell(row, 1).Style.Font.Bold = true;
            ws.Cell(row, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Cell(row, 2).Value = id;
            ws.Cell(row, 3).Value = title;
            ws.Cell(row, 4).Value = recipients;
            ws.Cell(row, 5).Value = dt.ToString("yyyy-MM-dd HH:mm");
            ws.Cell(row, 6).Value = status;

            var statusCell = ws.Cell(row, 6);
            statusCell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            statusCell.Style.Font.Bold = true;
            switch (status)
            {
                case "Published": case "Sent": statusCell.Style.Fill.BackgroundColor = XLColor.FromHtml("#D1FAE5"); statusCell.Style.Font.FontColor = XLColor.FromHtml("#065F46"); break;
                case "Expired": case "Failed": statusCell.Style.Fill.BackgroundColor = XLColor.FromHtml("#FEE2E2"); statusCell.Style.Font.FontColor = XLColor.FromHtml("#991B1B"); break;
                case "Unpublished": case "Draft": statusCell.Style.Fill.BackgroundColor = XLColor.FromHtml("#FEF3C7"); statusCell.Style.Font.FontColor = XLColor.FromHtml("#92400E"); break;
                case "Partial": case "Sending": statusCell.Style.Fill.BackgroundColor = XLColor.FromHtml("#DBEAFE"); statusCell.Style.Font.FontColor = XLColor.FromHtml("#1E40AF"); break;
            }
            row++;
        }

        var announcements = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_announcement_id AS Id, Title, RecipientTarget, PublishDateTime AS Dt,
                   CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS Status
            FROM announcements WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY PublishDateTime DESC")).ToList();
        foreach (var r in announcements)
            AddRow("Announcement", (int)r.Id, (string)r.Title, (string?)r.RecipientTarget ?? "all", (DateTime)r.Dt, (string)r.Status, "#3B82F6");

        var events = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_upcoming_event_id AS Id, Title, RecipientTarget, EventDate AS Dt,
                   CASE WHEN NOW() < PublishDate THEN 'Unpublished'
                        WHEN NOW() > ExpiryDate THEN 'Expired' ELSE 'Published' END AS Status
            FROM upcoming_events WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY EventDate DESC")).ToList();
        foreach (var r in events)
            AddRow("Event", (int)r.Id, (string)r.Title, (string?)r.RecipientTarget ?? "all", (DateTime)r.Dt, (string)r.Status, "#8B5CF6");

        var emails = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_mass_email_id AS Id, Subject, RecipientType, TotalRecipients, SentDate, Status, created_date
            FROM club_mass_emails WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY pk_mass_email_id DESC")).ToList();
        foreach (var r in emails)
        {
            var dt = (DateTime?)r.SentDate ?? (DateTime)r.created_date;
            AddRow("MassEmail", (int)r.Id, (string)r.Subject, ((int)r.TotalRecipients).ToString(), dt, (string)r.Status, "#EC4899");
        }

        var newsletters = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_newsletter_id AS Id, Title, PublishDateTime AS Dt, RecipientTarget,
                   CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS Status
            FROM newsletters WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY PublishDateTime DESC")).ToList();
        foreach (var r in newsletters)
            AddRow("Newsletter", (int)r.Id, (string)r.Title, (string?)r.RecipientTarget ?? "all", (DateTime)r.Dt, (string)r.Status, "#F59E0B");

        if (row > 5)
        {
            ws.Range(5, 1, row - 1, 6).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            ws.Range(5, 1, row - 1, 6).Style.Border.InsideBorder = XLBorderStyleValues.Thin;
            ws.RangeUsed().SetAutoFilter();
        }

        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(4);
        return WorkbookToBytes(wb);
    }
}
