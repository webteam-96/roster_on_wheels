namespace RotaryApi.DTOs;

// Club accounts (gap agent 2026-11-19): Services/ClubAccountsService.cs, Controllers/ClubAccountsController.cs.

public record ClubAccountDto(int Id, string Code, string Name, string Type, string? SystemKey, bool IsBank,
    string? BankName, string? AccountLast4, bool IsActive, decimal Balance, bool Used);

public record SaveClubAccountDto(string Code, string Name, string Type, bool IsBank, string? BankName, string? AccountLast4, bool IsActive = true);

public record JournalLineDto(int AccountId, string Code, string Name, decimal Debit, decimal Credit, string? Description);

public record JournalEntryDto(int Id, DateTime EntryDate, string Memo, string? SourceType, string? SourceId,
    int? ReversesEntryId, int? ReversedByEntryId, DateTime CreatedAt, string? CreatedByName, decimal Total, List<JournalLineDto> Lines,
    int? VendorId = null, string? VendorName = null, string? Reference = null);

public record EntryLineInputDto(int AccountId, decimal Debit, decimal Credit, string? Description);

public record CreateJournalEntryDto(DateTime? EntryDate, string Memo, List<EntryLineInputDto> Lines, int? VendorId = null, string? Reference = null);

/// <summary>Treasurer's quick entry. Kind "in" = money received into the bank account, "out" = money paid from it.</summary>
public record QuickEntryDto(string Kind, DateTime? EntryDate, int CategoryAccountId, int BankAccountId, decimal Amount, string Memo,
    int? VendorId = null, string? Reference = null);

public record ReverseEntryDto(DateTime? EntryDate, string? Memo);

public record BudgetAmountDto(int AccountId, decimal Amount);

public record SaveBudgetDto(List<BudgetAmountDto> Lines);

public record ClubAccountsSummaryDto(string? YearLabel, DateTime? YearStart, DateTime? YearEnd, List<ClubAccountDto> Banks,
    decimal YearIncome, decimal YearExpenses, decimal YearNet, List<JournalEntryDto> Recent);

/// <summary>What another module (invoices, event payments) hands to ClubAccountsService.PostPaymentAsync.</summary>
/// <param name="SourceType">short module name, e.g. "invoice_payment"; with SourceId it makes the posting idempotent</param>
/// <param name="IncomeAccountKey">system key of the income account to credit (dues_income, donations_income,
/// event_income, other_income), used when IncomeAccountId is null</param>
public record PaymentPosting(int ClubId, string SourceType, string SourceId, DateTime PaidOnUtc, decimal Amount, string Memo,
    string IncomeAccountKey = "dues_income", int? IncomeAccountId = null, int? MemberId = null);

public record PostingResult(int EntryId, bool AlreadyPosted);

// ----- Vendors, reconciliation, aged balances (gap agent, second package) -----

public record VendorDto(int Id, string Name, string? Email, string? Phone, string? Address, string? Notes, bool IsActive, decimal PaidThisYear);

public record SaveVendorDto(string Name, string? Email, string? Phone, string? Address, string? Notes, bool IsActive = true);

public record StatementLineDto(int Id, DateTime LineDate, string Description, decimal Amount, int? JournalLineId, int? JournalEntryId,
    string? JournalMemo, DateTime? ReconciledAt);

public record NewStatementLineDto(DateTime LineDate, string Description, decimal Amount);

public record AddStatementLinesDto(List<NewStatementLineDto> Lines);

/// <summary>A bank account line in the books (debit = money in) that no statement line is matched to yet.</summary>
public record BookLineDto(int JournalLineId, int EntryId, DateTime EntryDate, string Memo, decimal Amount, string? Reference);

public record ReconciliationDto(int AccountId, string AccountName, decimal BookBalance, decimal ReconciledBalance, decimal StatementTotal,
    decimal UnreconciledBook, List<StatementLineDto> Statement, List<BookLineDto> UnmatchedBook);

public record MatchStatementDto(int JournalLineId);

public record ImportResultDto(int Added, List<string> Problems);
