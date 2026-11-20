using System.Globalization;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Club accounts (gap agent 2026-11-19): chart of accounts, bank accounts, double-entry journal, treasurer's quick
/// entries, profit and loss, balance sheet, budget vs actual per Rotary year. Rules and maths: ClubLedger.
/// Posted entries are never edited or deleted, only reversed. Paid membership dues post themselves
/// (SyncDuesPaymentsAsync, run before every read); other modules call PostPaymentAsync / ReversePaymentAsync.
/// Callers (ClubAccountsController) check that the member manages the club; every query here is scoped by club id.
/// </summary>
public partial class ClubAccountsService
{
    public const string DuesSource = "membership_dues_payment";
    private readonly string _cs;
    private readonly IAuditLogService _audit;

    public ClubAccountsService(IConfiguration config, IAuditLogService audit)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _audit = audit;
    }

    /// <summary>Thrown for input the club must fix; the controller answers 400 with the message.</summary>
    public class AccountsException(string message) : Exception(message);

    // ===== Chart of accounts =====

    /// <summary>Gives the club the starter chart on first use (INSERT IGNORE: safe when two requests race).</summary>
    public async Task EnsureChartAsync(int clubId)
    {
        await using var c = new MySqlConnection(_cs);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM acct_accounts WHERE fk_club_id = @clubId", new { clubId }) > 0) return;
        foreach (var a in ClubLedger.StarterChart)
            await c.ExecuteAsync(@"INSERT IGNORE INTO acct_accounts (fk_club_id, code, name, account_type, system_key, is_bank)
                                   VALUES (@clubId, @Code, @Name, @Type, @Key, @IsBank)",
                new { clubId, a.Code, a.Name, a.Type, a.Key, a.IsBank });
    }

    public async Task<List<ClubAccountDto>> ListAccountsAsync(int clubId, DateTime? asOf = null)
    {
        await PrepareAsync(clubId);
        await using var c = new MySqlConnection(_cs);
        var rows = await c.QueryAsync<AccountRow>(@"
            SELECT a.pk_account_id AS Id, a.code AS Code, a.name AS Name, a.account_type AS Type, a.system_key AS SystemKey,
                   a.is_bank AS IsBank, a.bank_name AS BankName, a.account_last4 AS AccountLast4, a.is_active AS IsActive,
                   COALESCE(SUM(l.debit), 0) AS Debits, COALESCE(SUM(l.credit), 0) AS Credits, COUNT(l.pk_line_id) AS LineCount
            FROM acct_accounts a
            LEFT JOIN (acct_journal_lines l JOIN acct_journal_entries e ON e.pk_entry_id = l.fk_entry_id AND e.entry_date <= @asOf)
                   ON l.fk_account_id = a.pk_account_id
            WHERE a.fk_club_id = @clubId
            GROUP BY a.pk_account_id ORDER BY a.code", new { clubId, asOf = (asOf ?? DateTime.MaxValue.Date).Date });
        return rows.Select(r => new ClubAccountDto(r.Id, r.Code, r.Name, r.Type, r.SystemKey, r.IsBank, r.BankName, r.AccountLast4,
            r.IsActive, ClubLedger.Balance(r.Type, r.Debits, r.Credits), r.LineCount > 0)).ToList();
    }

    public async Task<ClubAccountDto?> SaveAccountAsync(int clubId, int? accountId, SaveClubAccountDto dto, int memberId, HttpContext http)
    {
        await PrepareAsync(clubId);
        var code = (dto.Code ?? "").Trim();
        var name = (dto.Name ?? "").Trim();
        var type = (dto.Type ?? "").Trim().ToLowerInvariant();
        if (code.Length is 0 or > 10 || !code.All(char.IsLetterOrDigit)) throw new AccountsException("The code is 1 to 10 letters or digits.");
        if (name.Length is 0 or > 120) throw new AccountsException("The name is 1 to 120 characters.");
        if (!ClubLedger.Types.Contains(type)) throw new AccountsException("Choose a type: asset, liability, equity, income or expense.");
        if (dto.IsBank && type != ClubLedger.Asset) throw new AccountsException("A bank account is an asset account.");
        var last4 = string.IsNullOrWhiteSpace(dto.AccountLast4) ? null : dto.AccountLast4.Trim();
        if (last4 != null && (last4.Length != 4 || !last4.All(char.IsDigit))) throw new AccountsException("Give only the last 4 digits of the bank account number.");
        var bankName = dto.IsBank && !string.IsNullOrWhiteSpace(dto.BankName) ? dto.BankName.Trim() : null;
        if (bankName?.Length > 120) throw new AccountsException("The bank name is at most 120 characters.");

        await using var c = new MySqlConnection(_cs);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM acct_accounts WHERE fk_club_id = @clubId AND code = @code AND pk_account_id <> @id",
                new { clubId, code, id = accountId ?? 0 }) > 0)
            throw new AccountsException($"The club already has an account with code {code}.");
        var p = new { clubId, accountId, code, name, type, isBank = dto.IsBank, bankName, last4 = dto.IsBank ? last4 : null, active = dto.IsActive, memberId };
        if (accountId == null)
        {
            accountId = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO acct_accounts (fk_club_id, code, name, account_type, is_bank, bank_name, account_last4, is_active, created_by)
                VALUES (@clubId, @code, @name, @type, @isBank, @bankName, @last4, @active, @memberId); SELECT LAST_INSERT_ID();", p);
        }
        else
        {
            var current = await c.QuerySingleOrDefaultAsync<(string Type, string? Key)>(
                "SELECT account_type, system_key FROM acct_accounts WHERE pk_account_id = @accountId AND fk_club_id = @clubId", p);
            if (current.Type == null) return null;
            var used = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM acct_journal_lines WHERE fk_account_id = @accountId", p) > 0;
            if (used && current.Type != type) throw new AccountsException("This account has entries, so its type cannot change.");
            if (current.Key != null && !dto.IsActive) throw new AccountsException("This account is used for automatic postings and cannot be switched off.");
            await c.ExecuteAsync(@"
                UPDATE acct_accounts SET code = @code, name = @name, account_type = @type, is_bank = @isBank, bank_name = @bankName,
                    account_last4 = @last4, is_active = @active, modified_by = @memberId
                WHERE pk_account_id = @accountId AND fk_club_id = @clubId", p);
        }
        await _audit.LogAsync(memberId, "SAVE", "club_account", accountId, name, new { clubId, code, type }, http);
        return (await ListAccountsAsync(clubId)).First(a => a.Id == accountId);
    }

    // ===== Journal =====

    public async Task<List<JournalEntryDto>> ListEntriesAsync(int clubId, DateTime? from, DateTime? to, int? accountId, int limit = 500)
    {
        await PrepareAsync(clubId);
        await using var c = new MySqlConnection(_cs);
        var ids = (await c.QueryAsync<int>(@"
            SELECT e.pk_entry_id FROM acct_journal_entries e
            WHERE e.fk_club_id = @clubId AND e.entry_date >= @from AND e.entry_date <= @to
              AND (@accountId IS NULL OR EXISTS (SELECT 1 FROM acct_journal_lines l WHERE l.fk_entry_id = e.pk_entry_id AND l.fk_account_id = @accountId))
            ORDER BY e.entry_date DESC, e.pk_entry_id DESC LIMIT @limit",
            new { clubId, from = (from ?? DateTime.MinValue).Date, to = (to ?? DateTime.MaxValue).Date, accountId, limit = Math.Clamp(limit, 1, 2000) })).ToList();
        return await LoadEntriesAsync(c, clubId, ids);
    }

    public async Task<JournalEntryDto?> GetEntryAsync(int clubId, int entryId)
    {
        await using var c = new MySqlConnection(_cs);
        return (await LoadEntriesAsync(c, clubId, new List<int> { entryId })).FirstOrDefault();
    }

    public async Task<JournalEntryDto> CreateEntryAsync(int clubId, CreateJournalEntryDto dto, int memberId, HttpContext http)
    {
        await PrepareAsync(clubId);
        var lines = (dto.Lines ?? new()).Select(l => new ClubLedger.Line(l.AccountId, l.Debit, l.Credit, Clean(l.Description))).ToList();
        var id = await InsertEntryAsync(clubId, EntryDate(dto.EntryDate), dto.Memo, lines, null, null, null, memberId, dto.VendorId, dto.Reference);
        await _audit.LogAsync(memberId, "CREATE", "journal_entry", id, null, new { clubId, total = lines.Sum(l => l.Debit) }, http);
        return (await GetEntryAsync(clubId, id))!;
    }

    public async Task<JournalEntryDto> QuickEntryAsync(int clubId, QuickEntryDto dto, int memberId, HttpContext http)
    {
        await PrepareAsync(clubId);
        var moneyIn = dto.Kind switch { "in" => true, "out" => false, _ => throw new AccountsException("Choose money in or money out.") };
        if (dto.Amount <= 0) throw new AccountsException("The amount must be more than zero.");
        await using (var c = new MySqlConnection(_cs))
        {
            var cat = await c.QuerySingleOrDefaultAsync<string>(
                "SELECT account_type FROM acct_accounts WHERE pk_account_id = @id AND fk_club_id = @clubId", new { id = dto.CategoryAccountId, clubId });
            if (cat != (moneyIn ? ClubLedger.Income : ClubLedger.Expense))
                throw new AccountsException(moneyIn ? "Choose an income account." : "Choose an expense account.");
            var bank = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM acct_accounts WHERE pk_account_id = @id AND fk_club_id = @clubId AND account_type = 'asset'", new { id = dto.BankAccountId, clubId });
            if (bank == 0) throw new AccountsException("Choose the bank or cash account the money went through.");
        }
        var lines = ClubLedger.Simple(moneyIn, dto.CategoryAccountId, dto.BankAccountId, dto.Amount, null);
        var id = await InsertEntryAsync(clubId, EntryDate(dto.EntryDate), dto.Memo, lines, null, null, null, memberId, dto.VendorId, dto.Reference);
        await _audit.LogAsync(memberId, "CREATE", "journal_entry", id, null, new { clubId, kind = dto.Kind, amount = dto.Amount }, http);
        return (await GetEntryAsync(clubId, id))!;
    }

    /// <summary>Posts the mirror image of an entry. Null when the entry is not the club's.</summary>
    public async Task<JournalEntryDto?> ReverseEntryAsync(int clubId, int entryId, ReverseEntryDto dto, int? memberId, HttpContext? http)
    {
        var original = await GetEntryAsync(clubId, entryId);
        if (original == null) return null;
        if (original.ReversesEntryId != null) throw new AccountsException("This entry is itself a reversal and cannot be reversed.");
        if (original.ReversedByEntryId != null) throw new AccountsException("This entry has already been reversed.");
        var lines = ClubLedger.Reverse(original.Lines.Select(l => new ClubLedger.Line(l.AccountId, l.Debit, l.Credit, l.Description)));
        var memo = string.IsNullOrWhiteSpace(dto.Memo) ? $"Reversal of entry {entryId}: {original.Memo}" : dto.Memo;
        if (memo.Length > 255) memo = memo[..255];
        var date = EntryDate(dto.EntryDate);
        if (date < original.EntryDate) throw new AccountsException("A reversal cannot be dated before the entry it reverses.");
        int id;
        try { id = await InsertEntryAsync(clubId, date, memo, lines, null, null, entryId, memberId); }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            throw new AccountsException("This entry has already been reversed.");
        }
        if (memberId is > 0) await _audit.LogAsync(memberId.Value, "REVERSE", "journal_entry", entryId, null, new { clubId, reversal = id }, http);
        return await GetEntryAsync(clubId, id);
    }

    // ===== Postings from other modules =====

    /// <summary>
    /// Records a payment the club received: debit the club's default bank account, credit the income account.
    /// Idempotent on (ClubId, SourceType, SourceId): calling it twice returns the first entry with AlreadyPosted.
    /// Throws AccountsException for a zero/negative amount or an unknown income account.
    /// </summary>
    public async Task<PostingResult> PostPaymentAsync(PaymentPosting p)
    {
        if (string.IsNullOrWhiteSpace(p.SourceType) || p.SourceType.Length > 40) throw new AccountsException("SourceType is 1 to 40 characters.");
        if (string.IsNullOrWhiteSpace(p.SourceId) || p.SourceId.Length > 64) throw new AccountsException("SourceId is 1 to 64 characters.");
        if (p.Amount <= 0) throw new AccountsException("A payment amount must be more than zero.");
        await EnsureChartAsync(p.ClubId);
        await using var c = new MySqlConnection(_cs);
        var existing = await FindSourceAsync(c, p.ClubId, p.SourceType, p.SourceId);
        if (existing != null) return new(existing.Value, true);
        var bank = await c.ExecuteScalarAsync<int?>(@"
            SELECT pk_account_id FROM acct_accounts WHERE fk_club_id = @ClubId AND is_bank = 1 AND is_active = 1
            ORDER BY system_key = 'bank' DESC, code LIMIT 1", p)
            ?? throw new AccountsException("The club has no active bank account to post the payment to.");
        var income = p.IncomeAccountId != null
            ? await c.ExecuteScalarAsync<int?>("SELECT pk_account_id FROM acct_accounts WHERE pk_account_id = @IncomeAccountId AND fk_club_id = @ClubId AND account_type = 'income'", p)
            : await c.ExecuteScalarAsync<int?>("SELECT pk_account_id FROM acct_accounts WHERE system_key = @IncomeAccountKey AND fk_club_id = @ClubId AND account_type = 'income'", p);
        if (income == null) throw new AccountsException("The income account for this payment was not found.");
        var lines = ClubLedger.Simple(true, income.Value, bank, decimal.Round(p.Amount, 2), null);
        try
        {
            return new(await InsertEntryAsync(p.ClubId, p.PaidOnUtc.Date, p.Memo, lines, p.SourceType, p.SourceId, null, p.MemberId), false);
        }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            return new((await FindSourceAsync(c, p.ClubId, p.SourceType, p.SourceId))!.Value, true); // a parallel call won the race
        }
    }

    /// <summary>Cancels an earlier PostPaymentAsync (refund, payment deleted). False when nothing was posted or it is already reversed.</summary>
    public async Task<bool> ReversePaymentAsync(int clubId, string sourceType, string sourceId, string reason, int? memberId = null)
    {
        await using var c = new MySqlConnection(_cs);
        var id = await FindSourceAsync(c, clubId, sourceType, sourceId);
        if (id == null) return false;
        try { return await ReverseEntryAsync(clubId, id.Value, new ReverseEntryDto(DateTime.UtcNow, reason), memberId, null) != null; }
        catch (AccountsException) { return false; }
    }

    /// <summary>
    /// Posts every paid membership dues payment of the club that has no entry yet, and reverses the entry of any
    /// payment that is no longer paid (deleted or rejected). Cheap when nothing changed: two indexed queries.
    /// </summary>
    public async Task<int> SyncDuesPaymentsAsync(int clubId)
    {
        await using var c = new MySqlConnection(_cs);
        var pending = (await c.QueryAsync<(int Id, decimal Amount, DateTime? PaidOn, DateTime? Created, string? Purpose, string? Member)>(@"
            SELECT p.pk_id, p.Amount, p.PaymentDate, p.created_date, d.Purpose, m.MemberName
            FROM membership_dues_payments p
            JOIN membership_dues d ON d.pk_membership_dues_id = p.fk_membership_dues_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = p.fk_member_profile_id
            WHERE d.fk_club_id = @clubId AND p.IsPaid = 1 AND IFNULL(p.isdeleted, 0) = 0 AND p.Amount > 0
              AND NOT EXISTS (SELECT 1 FROM acct_journal_entries e
                              WHERE e.fk_club_id = @clubId AND e.source_type = @src AND e.source_id = CAST(p.pk_id AS CHAR) COLLATE utf8mb4_unicode_ci)",
            new { clubId, src = DuesSource })).ToList();
        var posted = 0;
        foreach (var r in pending)
        {
            var memo = $"Membership dues{(string.IsNullOrWhiteSpace(r.Purpose) ? "" : ": " + r.Purpose)}{(string.IsNullOrWhiteSpace(r.Member) ? "" : " from " + r.Member)}";
            var res = await PostPaymentAsync(new PaymentPosting(clubId, DuesSource, r.Id.ToString(CultureInfo.InvariantCulture),
                r.PaidOn ?? r.Created ?? DateTime.UtcNow, r.Amount, memo.Length > 255 ? memo[..255] : memo));
            if (!res.AlreadyPosted) posted++;
        }
        var gone = await c.QueryAsync<string>(@"
            SELECT e.source_id FROM acct_journal_entries e
            LEFT JOIN membership_dues_payments p ON p.pk_id = CAST(e.source_id AS UNSIGNED)
            WHERE e.fk_club_id = @clubId AND e.source_type = @src
              AND NOT EXISTS (SELECT 1 FROM acct_journal_entries r WHERE r.reverses_entry_id = e.pk_entry_id)
              AND (p.pk_id IS NULL OR p.IsPaid <> 1 OR IFNULL(p.isdeleted, 0) = 1)", new { clubId, src = DuesSource });
        foreach (var sourceId in gone)
            await ReversePaymentAsync(clubId, DuesSource, sourceId, "Dues payment cancelled or deleted");
        return posted;
    }

    // ===== Reports =====

    public async Task<ClubLedger.ProfitAndLoss> ProfitAndLossAsync(int clubId, DateTime from, DateTime to)
    {
        await PrepareAsync(clubId);
        return ClubLedger.BuildProfitAndLoss(await TotalsAsync(clubId, from, to));
    }

    public async Task<ClubLedger.BalanceSheet> BalanceSheetAsync(int clubId, DateTime asOf)
    {
        await PrepareAsync(clubId);
        return ClubLedger.BuildBalanceSheet(await TotalsAsync(clubId, DateTime.MinValue, asOf));
    }

    public class YearRow
    {
        public int Id { get; set; }
        public string YearLabel { get; set; } = "";
        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }
        public bool IsCurrent { get; set; }
    }

    public async Task<YearRow?> YearAsync(int? yearId)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.QueryFirstOrDefaultAsync<YearRow>(@"
            SELECT pk_year_id AS Id, YearLabel, StartDate, EndDate, IFNULL(IsCurrent, 0) AS IsCurrent FROM rotary_year_master
            WHERE IFNULL(isdeleted, 0) = 0 AND (pk_year_id = @yearId OR (@yearId IS NULL AND CURDATE() BETWEEN StartDate AND EndDate))
            ORDER BY IsCurrent DESC LIMIT 1", new { yearId });
    }

    public async Task<(YearRow Year, ClubLedger.BudgetReport Report)?> BudgetVsActualAsync(int clubId, int yearId)
    {
        var year = await YearAsync(yearId);
        if (year == null) return null;
        await PrepareAsync(clubId);
        var totals = await TotalsAsync(clubId, year.StartDate, year.EndDate);
        await using var c = new MySqlConnection(_cs);
        var budgets = (await c.QueryAsync<(int AccountId, decimal Amount)>(
                "SELECT fk_account_id, amount FROM acct_budgets WHERE fk_club_id = @clubId AND fk_year_id = @yearId", new { clubId, yearId }))
            .ToDictionary(b => b.AccountId, b => b.Amount);
        return (year, ClubLedger.BuildBudgetVsActual(totals, budgets));
    }

    /// <summary>Replaces the year's budget amounts for the given accounts. False when the year does not exist.</summary>
    public async Task<bool> SaveBudgetAsync(int clubId, int yearId, SaveBudgetDto dto, int memberId, HttpContext http)
    {
        if (await YearAsync(yearId) == null) return false;
        await PrepareAsync(clubId);
        var lines = dto.Lines ?? new();
        if (lines.Any(l => l.Amount < 0 || l.Amount > ClubLedger.MaxAmount || decimal.Round(l.Amount, 2) != l.Amount))
            throw new AccountsException("Budget amounts are zero or more, with at most two decimals.");
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var ids = lines.Select(l => l.AccountId).Distinct().ToList();
        var valid = ids.Count == 0 ? 0 : await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM acct_accounts WHERE fk_club_id = @clubId AND pk_account_id IN @ids AND account_type IN ('income','expense')", new { clubId, ids });
        if (valid != ids.Count) throw new AccountsException("Budgets are set on the club's income and expense accounts only.");
        await using var tx = await c.BeginTransactionAsync();
        foreach (var l in lines)
            await c.ExecuteAsync(@"
                INSERT INTO acct_budgets (fk_club_id, fk_year_id, fk_account_id, amount, modified_by, modified_date)
                VALUES (@clubId, @yearId, @AccountId, @Amount, @memberId, UTC_TIMESTAMP())
                ON DUPLICATE KEY UPDATE amount = VALUES(amount), modified_by = VALUES(modified_by), modified_date = VALUES(modified_date)",
                new { clubId, yearId, l.AccountId, l.Amount, memberId }, tx);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, "UPDATE", "club_budget", yearId, null, new { clubId, accounts = lines.Count }, http);
        return true;
    }

    /// <summary>The treasurer's view for the app: bank balances, this Rotary year's income and spending, latest entries.</summary>
    public async Task<ClubAccountsSummaryDto> SummaryAsync(int clubId)
    {
        var accounts = await ListAccountsAsync(clubId);
        var year = await YearAsync(null);
        var pl = year == null ? null : ClubLedger.BuildProfitAndLoss(await TotalsAsync(clubId, year.StartDate, year.EndDate));
        await using var c = new MySqlConnection(_cs);
        var recentIds = (await c.QueryAsync<int>(
            "SELECT pk_entry_id FROM acct_journal_entries WHERE fk_club_id = @clubId ORDER BY entry_date DESC, pk_entry_id DESC LIMIT 10", new { clubId })).ToList();
        return new(year?.YearLabel, year?.StartDate, year?.EndDate, accounts.Where(a => a.IsBank || a.SystemKey == "cash").ToList(),
            pl?.TotalIncome ?? 0, pl?.TotalExpenses ?? 0, pl?.Net ?? 0, await LoadEntriesAsync(c, clubId, recentIds));
    }

    // ===== Internals =====

    private async Task PrepareAsync(int clubId)
    {
        await EnsureChartAsync(clubId);
        await SyncDuesPaymentsAsync(clubId);
    }

    private async Task<List<ClubLedger.AccountTotal>> TotalsAsync(int clubId, DateTime from, DateTime to)
    {
        await using var c = new MySqlConnection(_cs);
        return (await c.QueryAsync<ClubLedger.AccountTotal>(@"
            SELECT a.pk_account_id AS AccountId, a.code AS Code, a.name AS Name, a.account_type AS Type,
                   COALESCE(SUM(l.debit), 0) AS Debits, COALESCE(SUM(l.credit), 0) AS Credits
            FROM acct_accounts a
            LEFT JOIN (acct_journal_lines l JOIN acct_journal_entries e
                       ON e.pk_entry_id = l.fk_entry_id AND e.entry_date >= @from AND e.entry_date <= @to)
                   ON l.fk_account_id = a.pk_account_id
            WHERE a.fk_club_id = @clubId
            GROUP BY a.pk_account_id, a.code, a.name, a.account_type ORDER BY a.code",
            new { clubId, from = from.Date, to = to.Date })).ToList();
    }

    private async Task<int> InsertEntryAsync(int clubId, DateTime date, string? memo, List<ClubLedger.Line> lines,
        string? sourceType, string? sourceId, int? reverses, int? memberId, int? vendorId = null, string? reference = null)
    {
        reference = Clean(reference);
        if (reference?.Length > 40) throw new AccountsException("The cheque or transfer reference is at most 40 characters.");
        memo = (memo ?? "").Trim();
        if (memo.Length is 0 or > 255) throw new AccountsException("Describe the entry in 1 to 255 characters.");
        if (date.Year < 2000 || date > DateTime.UtcNow.Date.AddYears(1)) throw new AccountsException("Choose a date between 2000 and a year from now.");
        var error = ClubLedger.Validate(lines);
        if (error != null) throw new AccountsException(error);

        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var ids = lines.Select(l => l.AccountId).Distinct().ToList();
        // reversals may use accounts switched off since; new entries may not
        var ok = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM acct_accounts WHERE fk_club_id = @clubId AND pk_account_id IN @ids AND (is_active = 1 OR @rev)",
            new { clubId, ids, rev = reverses != null });
        if (ok != ids.Count) throw new AccountsException("Every line must use one of the club's active accounts.");
        if (vendorId != null && await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM acct_vendors WHERE pk_vendor_id = @vendorId AND fk_club_id = @clubId AND is_active = 1", new { vendorId, clubId }) == 0)
            throw new AccountsException("Choose one of the club's payees.");

        await using var tx = await c.BeginTransactionAsync();
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO acct_journal_entries (fk_club_id, entry_date, memo, source_type, source_id, reverses_entry_id, created_by, created_date, fk_vendor_id, reference)
            VALUES (@clubId, @date, @memo, @sourceType, @sourceId, @reverses, @memberId, UTC_TIMESTAMP(), @vendorId, @reference); SELECT LAST_INSERT_ID();",
            new { clubId, date = date.Date, memo, sourceType, sourceId, reverses, memberId, vendorId, reference }, tx);
        await c.ExecuteAsync(@"INSERT INTO acct_journal_lines (fk_entry_id, fk_account_id, debit, credit, description)
                               VALUES (@id, @AccountId, @Debit, @Credit, @Description)",
            lines.Select(l => new { id, l.AccountId, l.Debit, l.Credit, l.Description }), tx);
        await tx.CommitAsync();
        return id;
    }

    private static async Task<int?> FindSourceAsync(MySqlConnection c, int clubId, string sourceType, string sourceId) =>
        await c.ExecuteScalarAsync<int?>(
            "SELECT pk_entry_id FROM acct_journal_entries WHERE fk_club_id = @clubId AND source_type = @sourceType AND source_id = @sourceId",
            new { clubId, sourceType, sourceId });

    private static async Task<List<JournalEntryDto>> LoadEntriesAsync(MySqlConnection c, int clubId, List<int> ids)
    {
        if (ids.Count == 0) return new();
        var heads = (await c.QueryAsync<EntryRow>(@"
            SELECT e.pk_entry_id AS Id, e.entry_date AS EntryDate, e.memo AS Memo, e.source_type AS SourceType, e.source_id AS SourceId,
                   e.reverses_entry_id AS ReversesEntryId, r.pk_entry_id AS ReversedByEntryId, e.created_date AS CreatedAt, m.MemberName AS CreatedByName,
                   e.fk_vendor_id AS VendorId, v.name AS VendorName, e.reference AS Reference
            FROM acct_journal_entries e
            LEFT JOIN acct_journal_entries r ON r.reverses_entry_id = e.pk_entry_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = e.created_by
            LEFT JOIN acct_vendors v ON v.pk_vendor_id = e.fk_vendor_id AND v.fk_club_id = e.fk_club_id
            WHERE e.fk_club_id = @clubId AND e.pk_entry_id IN @ids", new { clubId, ids })).ToList();
        var lines = (await c.QueryAsync<(int EntryId, int AccountId, string Code, string Name, decimal Debit, decimal Credit, string? Description)>(@"
            SELECT l.fk_entry_id, l.fk_account_id, a.code, a.name, l.debit, l.credit, l.description
            FROM acct_journal_lines l JOIN acct_accounts a ON a.pk_account_id = l.fk_account_id
            WHERE l.fk_entry_id IN @ids ORDER BY l.pk_line_id", new { ids = heads.Select(h => h.Id).DefaultIfEmpty(0) }))
            .ToLookup(l => l.EntryId);
        var order = ids.Select((id, i) => (id, i)).ToDictionary(x => x.id, x => x.i);
        return heads.OrderBy(h => order[h.Id]).Select(h =>
        {
            var ls = lines[h.Id].Select(l => new JournalLineDto(l.AccountId, l.Code, l.Name, l.Debit, l.Credit, l.Description)).ToList();
            return new JournalEntryDto(h.Id, h.EntryDate, h.Memo, h.SourceType, h.SourceId, h.ReversesEntryId, h.ReversedByEntryId,
                DateTime.SpecifyKind(h.CreatedAt, DateTimeKind.Utc), h.CreatedByName, ls.Sum(l => l.Debit), ls, h.VendorId, h.VendorName, h.Reference);
        }).ToList();
    }

    private static DateTime EntryDate(DateTime? d) => (d ?? DateTime.UtcNow).Date;

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private class AccountRow
    {
        public int Id { get; set; }
        public string Code { get; set; } = "";
        public string Name { get; set; } = "";
        public string Type { get; set; } = "";
        public string? SystemKey { get; set; }
        public bool IsBank { get; set; }
        public string? BankName { get; set; }
        public string? AccountLast4 { get; set; }
        public bool IsActive { get; set; }
        public decimal Debits { get; set; }
        public decimal Credits { get; set; }
        public long LineCount { get; set; }
    }

    private class EntryRow
    {
        public int Id { get; set; }
        public DateTime EntryDate { get; set; }
        public string Memo { get; set; } = "";
        public string? SourceType { get; set; }
        public string? SourceId { get; set; }
        public int? ReversesEntryId { get; set; }
        public int? ReversedByEntryId { get; set; }
        public DateTime CreatedAt { get; set; }
        public string? CreatedByName { get; set; }
        public int? VendorId { get; set; }
        public string? VendorName { get; set; }
        public string? Reference { get; set; }
    }
}
