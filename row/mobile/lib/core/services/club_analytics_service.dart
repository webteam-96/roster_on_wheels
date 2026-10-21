import '../utils/money_format.dart';
/// Display formatters for the Club Overview dashboard (brand currency + USD).
///
/// The old mock-data aggregates (trfPct / citationPct / avenueTotalCompleted /
/// trfRemaining) were removed — the dashboard now computes those from the live
/// `/overview` payload. Only the pure currency formatters remain.
class ClubAnalyticsService {
  ClubAnalyticsService._();

  /// TRF / Foundation amounts are stored and shown in USD, no conversion (as the web `fmtUsd`).
  static String fmtUsd(num v) => shortMoney(v, 'USD');

  /// Compact money in the brand currency (kept under its old name for existing callers).
  static String fmtInr(num v) => shortMoney(v, null);
}
