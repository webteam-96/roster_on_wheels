using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IWalletReportService
{
    Task<List<WalletReportRow>> GetReportAsync(WalletReportType type, WalletReportFilters filters);
    Task<List<WalletCreditEntryRow>> GetCreditEntriesAsync(WalletCreditEntryFilters filters);
}
