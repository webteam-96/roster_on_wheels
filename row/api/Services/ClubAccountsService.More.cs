using System.Globalization;
using Dapper;
using MySqlConnector;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>Club accounts, second package (gap agent 2026-11-20): vendors / payees, bank reconciliation, payment
/// voucher PDF, aged balances of membership dues owed. Same rules as ClubAccountsService.cs: scoped by club id,
/// the controller checks the caller manages the club, journal entries are never changed.</summary>
public partial class ClubAccountsService
{
    // ===== Vendors / payees =====

    public async Task<List<VendorDto>> ListVendorsAsync(int clubId)
    {
        var year = await YearAsync(null);
        await using var c = new MySqlConnection(_cs);
        return (await c.QueryAsync<VendorDto>(@"
            SELECT v.pk_vendor_id AS Id, v.name AS Name, v.email AS Email, v.phone AS Phone, v.address AS Address, v.notes AS Notes,
                   v.is_active AS IsActive,
                   CAST(COALESCE((SELECT SUM(l.debit) FROM acct_journal_entries e JOIN acct_journal_lines l ON l.fk_entry_id = e.pk_entry_id
                            WHERE e.fk_club_id = v.fk_club_id AND e.fk_vendor_id = v.pk_vendor_id AND e.reverses_entry_id IS NULL
                              AND NOT EXISTS (SELECT 1 FROM acct_journal_entries r WHERE r.reverses_entry_id = e.pk_entry_id)
                              AND e.entry_date BETWEEN @from AND @to), 0) AS DECIMAL(14,2)) AS PaidThisYear
            FROM acct_vendors v WHERE v.fk_club_id = @clubId ORDER BY v.is_active DESC, v.name",
            new { clubId, from = year?.StartDate ?? DateTime.MinValue, to = year?.EndDate ?? DateTime.MaxValue.Date })).ToList();
    }

    public async Task<VendorDto?> SaveVendorAsync(int clubId, int? vendorId, SaveVendorDto dto, int memberId, HttpContext http)
    {
        var name = (dto.Name ?? "").Trim();
        if (name.Length is 0 or > 150) throw new AccountsException("The payee name is 1 to 150 characters.");
        string? Opt(string? v, int max, string label)
        {
            v = Clean(v);
            if (v?.Length > max) throw new AccountsException($"The {label} is at most {max} characters.");
            return v;
        }
        var email = Opt(dto.Email, 150, "email");
        if (email != null && !System.Net.Mail.MailAddress.TryCreate(email, out _)) throw new AccountsException("The email address is not valid.");
        var p = new
        {
            clubId, vendorId, name, email, phone = Opt(dto.Phone, 40, "phone number"), address = Opt(dto.Address, 300, "address"),
            notes = Opt(dto.Notes, 500, "note"), active = dto.IsActive, memberId,
        };
        await using var c = new MySqlConnection(_cs);
        if (vendorId == null)
            vendorId = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO acct_vendors (fk_club_id, name, email, phone, address, notes, is_active, created_by)
                VALUES (@clubId, @name, @email, @phone, @address, @notes, @active, @memberId); SELECT LAST_INSERT_ID();", p);
        else if (await c.ExecuteAsync(@"
                UPDATE acct_vendors SET name = @name, email = @email, phone = @phone, address = @address, notes = @notes,
                    is_active = @active, modified_by = @memberId
                WHERE pk_vendor_id = @vendorId AND fk_club_id = @clubId", p) == 0
                 && await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM acct_vendors WHERE pk_vendor_id = @vendorId AND fk_club_id = @clubId", p) == 0)
            return null;
        await _audit.LogAsync(memberId, "SAVE", "club_vendor", vendorId, name, new { clubId }, http);
        return (await ListVendorsAsync(clubId)).First(v => v.Id == vendorId);
    }

    // ===== Bank reconciliation =====

    private async Task<string> BankAccountNameAsync(MySqlConnection c, int clubId, int accountId) =>
        await c.ExecuteScalarAsync<string?>(
            "SELECT name FROM acct_accounts WHERE pk_account_id = @accountId AND fk_club_id = @clubId AND account_type = 'asset'",
            new { clubId, accountId })
        ?? throw new AccountsException("Choose one of the club's bank or cash accounts.");

    public async Task<ReconciliationDto> ReconciliationAsync(int clubId, int accountId)
    {
        await PrepareAsync(clubId);
        await using var c = new MySqlConnection(_cs);
        var name = await BankAccountNameAsync(c, clubId, accountId);
        var p = new { clubId, accountId };
        var statement = (await c.QueryAsync<StatementLineDto>(@"
            SELECT s.pk_statement_line_id AS Id, s.line_date AS LineDate, s.description AS Description, s.amount AS Amount,
                   s.fk_journal_line_id AS JournalLineId, e.pk_entry_id AS JournalEntryId, e.memo AS JournalMemo, s.reconciled_at AS ReconciledAt
            FROM acct_statement_lines s
            LEFT JOIN acct_journal_lines l ON l.pk_line_id = s.fk_journal_line_id
            LEFT JOIN acct_journal_entries e ON e.pk_entry_id = l.fk_entry_id
            WHERE s.fk_club_id = @clubId AND s.fk_account_id = @accountId
            ORDER BY s.line_date, s.pk_statement_line_id", p)).ToList();
        var book = (await c.QueryAsync<(int LineId, int EntryId, DateTime Date, string Memo, decimal Amount, string? Reference, long Matched)>(@"
            SELECT l.pk_line_id, e.pk_entry_id, e.entry_date, e.memo, l.debit - l.credit, e.reference,
                   EXISTS (SELECT 1 FROM acct_statement_lines s WHERE s.fk_journal_line_id = l.pk_line_id)
            FROM acct_journal_lines l JOIN acct_journal_entries e ON e.pk_entry_id = l.fk_entry_id
            WHERE e.fk_club_id = @clubId AND l.fk_account_id = @accountId
            ORDER BY e.entry_date, l.pk_line_id", p)).ToList();
        decimal bookBalance = book.Sum(b => b.Amount), reconciled = book.Where(b => b.Matched != 0).Sum(b => b.Amount);
        return new(accountId, name, bookBalance, reconciled, statement.Sum(s => s.Amount), bookBalance - reconciled, statement,
            book.Where(b => b.Matched == 0).Select(b => new BookLineDto(b.LineId, b.EntryId, b.Date, b.Memo, b.Amount, b.Reference)).ToList());
    }

    public async Task<int> AddStatementLinesAsync(int clubId, int accountId, List<NewStatementLineDto> lines, int memberId, HttpContext http)
    {
        if (lines.Count is 0 or > 2000) throw new AccountsException("Add between 1 and 2000 statement lines.");
        foreach (var l in lines)
        {
            if (l.LineDate.Year < 2000 || l.LineDate.Date > DateTime.UtcNow.Date.AddDays(1)) throw new AccountsException("A statement date must be between 2000 and today.");
            if (l.Amount == 0 || decimal.Round(l.Amount, 2) != l.Amount || Math.Abs(l.Amount) > ClubLedger.MaxAmount)
                throw new AccountsException("A statement amount is not zero and has at most two decimals.");
            if (string.IsNullOrWhiteSpace(l.Description) || l.Description.Trim().Length > 255) throw new AccountsException("A statement description is 1 to 255 characters.");
        }
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await BankAccountNameAsync(c, clubId, accountId);
        await using var tx = await c.BeginTransactionAsync();
        await c.ExecuteAsync(@"
            INSERT INTO acct_statement_lines (fk_club_id, fk_account_id, line_date, description, amount, created_by, created_date)
            VALUES (@clubId, @accountId, @LineDate, @Description, @Amount, @memberId, UTC_TIMESTAMP())",
            lines.Select(l => new { clubId, accountId, LineDate = l.LineDate.Date, Description = l.Description.Trim(), l.Amount, memberId }), tx);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, "CREATE", "bank_statement_lines", accountId, null, new { clubId, count = lines.Count }, http);
        return lines.Count;
    }

    /// <summary>Adds the readable rows of a statement CSV; nothing is added when no row is readable.</summary>
    public async Task<ImportResultDto> ImportStatementCsvAsync(int clubId, int accountId, string csv, int memberId, HttpContext http)
    {
        var (rows, problems) = ClubAccountsTools.ParseStatementCsv(csv);
        if (rows.Count == 0) return new(0, problems.Count > 0 ? problems : new() { "The file has no statement lines." });
        var added = await AddStatementLinesAsync(clubId, accountId, rows.Select(r => new NewStatementLineDto(r.Date, r.Description, r.Amount)).ToList(), memberId, http);
        return new(added, problems);
    }

    /// <summary>Matches a statement line to a journal line on the same bank account with the same amount. Null when the line is not the club's.</summary>
    public async Task<bool?> MatchAsync(int clubId, int statementLineId, int journalLineId, int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        var s = await c.QuerySingleOrDefaultAsync<(int AccountId, decimal Amount, int? Matched)>(
            "SELECT fk_account_id, amount, fk_journal_line_id FROM acct_statement_lines WHERE pk_statement_line_id = @statementLineId AND fk_club_id = @clubId",
            new { clubId, statementLineId });
        if (s.AccountId == 0) return null;
        if (s.Matched != null) throw new AccountsException("This statement line is already reconciled. Undo it first.");
        var book = await c.QuerySingleOrDefaultAsync<decimal?>(@"
            SELECT l.debit - l.credit FROM acct_journal_lines l JOIN acct_journal_entries e ON e.pk_entry_id = l.fk_entry_id
            WHERE l.pk_line_id = @journalLineId AND e.fk_club_id = @clubId AND l.fk_account_id = @AccountId",
            new { clubId, journalLineId, s.AccountId });
        if (book == null) throw new AccountsException("That book entry is not on this bank account.");
        if (book.Value != s.Amount) throw new AccountsException($"The amounts differ ({book.Value:0.00} in the books, {s.Amount:0.00} on the statement).");
        try
        {
            await c.ExecuteAsync(@"UPDATE acct_statement_lines SET fk_journal_line_id = @journalLineId, reconciled_by = @memberId, reconciled_at = UTC_TIMESTAMP()
                                   WHERE pk_statement_line_id = @statementLineId AND fk_club_id = @clubId AND fk_journal_line_id IS NULL",
                new { clubId, statementLineId, journalLineId, memberId });
        }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            throw new AccountsException("That book entry is already matched to another statement line.");
        }
        return true;
    }

    public async Task<bool> UnmatchAsync(int clubId, int statementLineId)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.ExecuteAsync(@"UPDATE acct_statement_lines SET fk_journal_line_id = NULL, reconciled_by = NULL, reconciled_at = NULL
                                      WHERE pk_statement_line_id = @statementLineId AND fk_club_id = @clubId", new { clubId, statementLineId }) > 0;
    }

    /// <summary>Removes a statement line that is not reconciled (a wrong import). Null when not found.</summary>
    public async Task<bool?> DeleteStatementLineAsync(int clubId, int statementLineId)
    {
        await using var c = new MySqlConnection(_cs);
        var matched = await c.QuerySingleOrDefaultAsync<(int Id, int? Line)>(
            "SELECT pk_statement_line_id, fk_journal_line_id FROM acct_statement_lines WHERE pk_statement_line_id = @statementLineId AND fk_club_id = @clubId",
            new { clubId, statementLineId });
        if (matched.Id == 0) return null;
        if (matched.Line != null) throw new AccountsException("Undo the match before removing a reconciled statement line.");
        await c.ExecuteAsync("DELETE FROM acct_statement_lines WHERE pk_statement_line_id = @statementLineId AND fk_club_id = @clubId AND fk_journal_line_id IS NULL",
            new { clubId, statementLineId });
        return true;
    }

    /// <summary>Matches each open statement line to the one open book line with the same amount dated within 7 days
    /// (the closest date wins; ties are left for the treasurer). Returns how many were matched.</summary>
    public async Task<int> AutoMatchAsync(int clubId, int accountId, int memberId)
    {
        var rec = await ReconciliationAsync(clubId, accountId);
        var open = rec.UnmatchedBook.ToList();
        var matched = 0;
        foreach (var s in rec.Statement.Where(s => s.JournalLineId == null))
        {
            var candidates = open.Where(b => b.Amount == s.Amount && Math.Abs((b.EntryDate.Date - s.LineDate.Date).Days) <= 7)
                .OrderBy(b => Math.Abs((b.EntryDate.Date - s.LineDate.Date).Days)).ToList();
            if (candidates.Count == 0) continue;
            var best = candidates[0];
            if (candidates.Count > 1 && Math.Abs((candidates[1].EntryDate.Date - s.LineDate.Date).Days) == Math.Abs((best.EntryDate.Date - s.LineDate.Date).Days)) continue;
            try { if (await MatchAsync(clubId, s.Id, best.JournalLineId, memberId) == true) { matched++; open.Remove(best); } }
            catch (AccountsException) { /* matched meanwhile: leave it */ }
        }
        return matched;
    }

    // ===== Payment voucher =====

    /// <summary>A payment voucher PDF (with a cheque block) for a money-out entry: one that credits a bank or cash account.
    /// Null when the entry is not the club's.</summary>
    public async Task<byte[]?> VoucherPdfAsync(int clubId, int entryId)
    {
        var e = await GetEntryAsync(clubId, entryId);
        if (e == null) return null;
        await using var c = new MySqlConnection(_cs);
        var assets = (await c.QueryAsync<int>("SELECT pk_account_id FROM acct_accounts WHERE fk_club_id = @clubId AND account_type = 'asset'", new { clubId })).ToHashSet();
        var paid = e.Lines.Where(l => assets.Contains(l.AccountId) && l.Credit > 0).ToList();
        if (e.ReversesEntryId != null || paid.Count == 0) throw new AccountsException("A voucher is for money paid out of a bank or cash account.");
        var clubName = await c.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @clubId", new { clubId }) ?? "";
        var amount = paid.Sum(l => l.Credit);
        var particulars = e.Lines.Where(l => l.Debit > 0).ToList();
        var date = e.EntryDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture);
        var money = (decimal v) => v.ToString("#,##0.00", CultureInfo.InvariantCulture);

        QuestPDF.Settings.License = LicenseType.Community;
        QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;
        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(1.6f, Unit.Centimetre);
            page.DefaultTextStyle(x => x.FontSize(10).FontColor("#1B2C42"));
            page.Content().Column(col =>
            {
                col.Spacing(8);
                col.Item().Row(r =>
                {
                    r.RelativeItem().Column(h =>
                    {
                        h.Item().Text(clubName).FontSize(14).Bold().FontColor("#17458F");
                        h.Item().Text("Payment voucher").FontSize(12).SemiBold();
                    });
                    r.ConstantItem(170).AlignRight().Column(h =>
                    {
                        h.Item().AlignRight().Text($"Voucher PV-{e.Id}").Bold();
                        h.Item().AlignRight().Text($"Date {date}");
                        if (e.Reference != null) h.Item().AlignRight().Text($"Cheque / ref. {e.Reference}");
                        if (e.ReversedByEntryId != null) h.Item().AlignRight().Text($"CANCELLED by entry {e.ReversedByEntryId}").Bold().FontColor("#B42318");
                    });
                });
                col.Item().LineHorizontal(1).LineColor("#D5DEE8");
                col.Item().Text(t => { t.Span("Paid to: ").SemiBold(); t.Span(e.VendorName ?? "________________________________"); });
                col.Item().Text(t => { t.Span("Purpose: ").SemiBold(); t.Span(e.Memo); });
                col.Item().Text(t => { t.Span("Paid from: ").SemiBold(); t.Span(string.Join(", ", paid.Select(l => $"{l.Code} {l.Name}"))); });
                col.Item().PaddingTop(4).Table(table =>
                {
                    table.ColumnsDefinition(cd => { cd.ConstantColumn(60); cd.RelativeColumn(); cd.ConstantColumn(100); });
                    table.Header(h =>
                    {
                        foreach (var (label, right) in new[] { ("Code", false), ("Charged to", false), ("Amount", true) })
                        {
                            var cell = h.Cell().Background("#EDF4FB").Padding(4);
                            (right ? cell.AlignRight() : cell).Text(label).Bold();
                        }
                    });
                    foreach (var l in particulars)
                    {
                        table.Cell().BorderBottom(0.5f).BorderColor("#D5DEE8").Padding(4).Text(l.Code);
                        table.Cell().BorderBottom(0.5f).BorderColor("#D5DEE8").Padding(4).Text(l.Name + (l.Description != null ? $": {l.Description}" : ""));
                        table.Cell().BorderBottom(0.5f).BorderColor("#D5DEE8").Padding(4).AlignRight().Text(money(l.Debit));
                    }
                    table.Cell().ColumnSpan(2).Padding(4).Text("Total").Bold();
                    table.Cell().Padding(4).AlignRight().Text(money(amount)).Bold();
                });
                col.Item().Text(t => { t.Span("The sum of: ").SemiBold(); t.Span(ClubAccountsTools.AmountInWords(amount) + " only"); });
                col.Item().PaddingTop(30).Row(r =>
                {
                    foreach (var who in new[] { "Prepared by", "Approved by", "Received by" })
                        r.RelativeItem().PaddingRight(12).Column(s =>
                        {
                            s.Item().LineHorizontal(0.75f).LineColor("#64748B");
                            s.Item().Text(who).FontColor("#64748B");
                        });
                });
                // cheque block: the figures to copy onto the club's cheque (printing onto a bank's cheque layout is not supported)
                col.Item().PaddingTop(28).Border(1).BorderColor("#D5DEE8").Padding(10).Column(ch =>
                {
                    ch.Spacing(6);
                    ch.Item().Row(r =>
                    {
                        r.RelativeItem().Text("Cheque").Bold();
                        r.ConstantItem(150).AlignRight().Text($"Date {date}");
                    });
                    ch.Item().Text(t => { t.Span("Pay: ").SemiBold(); t.Span(e.VendorName ?? ""); });
                    ch.Item().Text(t => { t.Span("The sum of: ").SemiBold(); t.Span(ClubAccountsTools.AmountInWords(amount) + " only"); });
                    ch.Item().Row(r =>
                    {
                        r.RelativeItem().Text(e.Reference != null ? $"Cheque no. {e.Reference}" : "");
                        r.ConstantItem(150).Border(1).BorderColor("#1B2C42").Padding(4).AlignRight().Text(money(amount)).Bold();
                    });
                });
            });
            page.Footer().Text($"Journal entry {e.Id}. Printed {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC.").FontSize(8).FontColor("#64748B");
        })).GeneratePdf();
    }

    // ===== Aged balances (membership dues owed) =====

    private class FeeRowDb
    {
        public int MemberId { get; set; }
        public string? MemberName { get; set; }
        public string? Purpose { get; set; }
        public string? RotaryYear { get; set; }
        public bool IsFees1 { get; set; }
        public bool IsFees2 { get; set; }
        public bool IsFees3 { get; set; }
        public string? Fees1Text { get; set; }
        public string? Fees2Text { get; set; }
        public string? Fees3Text { get; set; }
        public decimal AnnualAmount { get; set; }
        public decimal Semi1Amount { get; set; }
        public decimal Semi2Amount { get; set; }
        public DateTime RaisedOn { get; set; }
        public string? PaidTypes { get; set; }
    }

    public async Task<ClubAccountsTools.AgedReport> AgedBalancesAsync(int clubId, DateTime asOf)
    {
        await using var c = new MySqlConnection(_cs);
        var rows = await c.QueryAsync<FeeRowDb>(@"
            SELECT f.fk_member_profile_id AS MemberId, m.MemberName, d.Purpose, d.RotaryYear,
                   IFNULL(d.IsFees1, 0) AS IsFees1, IFNULL(d.IsFees2, 0) AS IsFees2, IFNULL(d.IsFees3, 0) AS IsFees3,
                   d.Fees1Text, d.Fees2Text, d.Fees3Text,
                   IFNULL(f.AnnualAmount, 0) AS AnnualAmount, IFNULL(f.Semi1Amount, 0) AS Semi1Amount, IFNULL(f.Semi2Amount, 0) AS Semi2Amount,
                   COALESCE(d.created_date, f.created_date) AS RaisedOn,
                   (SELECT GROUP_CONCAT(DISTINCT p.FeeType) FROM membership_dues_payments p
                    WHERE p.fk_member_fee_id = f.pk_id AND p.IsPaid = 1 AND IFNULL(p.isdeleted, 0) = 0) AS PaidTypes
            FROM membership_dues_member_fees f
            JOIN membership_dues d ON d.pk_membership_dues_id = f.fk_membership_dues_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = f.fk_member_profile_id
            WHERE d.fk_club_id = @clubId AND IFNULL(d.isdeleted, 0) = 0 AND IFNULL(d.IsActive, 1) = 1 AND IFNULL(f.isdeleted, 0) = 0
              AND COALESCE(d.created_date, f.created_date) <= @asOfEnd",
            new { clubId, asOfEnd = asOf.Date.AddDays(1) });
        var charges = rows.SelectMany(r => ClubAccountsTools.ChargesFor(new ClubAccountsTools.FeeRow(
            r.MemberId, r.MemberName ?? $"Member {r.MemberId}", string.Join(" ", new[] { r.Purpose, r.RotaryYear }.Where(x => !string.IsNullOrWhiteSpace(x))),
            r.IsFees1, r.IsFees2, r.IsFees3, r.Fees1Text, r.Fees2Text, r.Fees3Text, r.AnnualAmount, r.Semi1Amount, r.Semi2Amount,
            r.RaisedOn, r.PaidTypes)));
        return ClubAccountsTools.BuildAging(charges, asOf);
    }
}
