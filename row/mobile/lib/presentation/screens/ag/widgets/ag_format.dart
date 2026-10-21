import '../../../../core/utils/money_format.dart';
// Shared formatters for the AG dashboard — mirror the web
// `rotary-frontend/src/components/dashboard/formatters.ts`.

/// Integer in the brand locale's grouping (1,234,567).
String agFmtInt(num v) => fmtInt(v.round());

/// Whole-number money in the brand currency.
String agFmtInr(num v) => formatMoney(v.round(), null);

/// Compact money in the brand currency ("$1.2M"); 0 -> "$0".
String agFmtInrShort(num v) => shortMoney(v, null);

/// US-grouped integer digits, e.g. 1234567 -> "1,234,567".
String _agUsGroup(num v) {
  final n = v.round();
  final neg = n < 0;
  final digits = n.abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i != 0 && (digits.length - i) % 3 == 0) buf.write(',');
    buf.write(digits[i]);
  }
  return (neg ? '-' : '') + buf.toString();
}

/// "$" + US-grouped rounded USD. TRF/Foundation amounts are stored AND served in
/// USD (backend `USD_INR` = 1, no conversion) — mirrors the web `fmtUsd`. The app
/// rounds to whole dollars as it always has for the INR formatters.
String agFmtUsd(num v) => '\$${_agUsGroup(v)}';

/// Short USD: $M (>=1e6), $K (>=1e3), else whole $. 0 -> "$0". Mirrors web `fmtUsdShort`.
String agFmtUsdShort(num v) {
  final n = v.toDouble();
  if (n == 0) return '\$0';
  final abs = n.abs();
  if (abs >= 1000000) return '\$${(n / 1000000).toStringAsFixed(1)}M';
  if (abs >= 1000) return '\$${(n / 1000).toStringAsFixed(1)}K';
  return '\$${n.round()}';
}

/// Date "yyyy-MM-dd" (or null) -> "dd MMM yyyy"; null/empty -> "—".
String agFmtDate(String? iso) {
  if (iso == null || iso.trim().isEmpty) return '–';
  final d = DateTime.tryParse(iso);
  if (d == null) return '–';
  return '${d.day.toString().padLeft(2, '0')} ${_mon[d.month - 1]} ${d.year}';
}

const _mon = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// "d MMMM yyyy" of today (for the "Data as of" footers — FE-generated, the
/// API carries no as-of timestamp).
String agToday() {
  final d = DateTime.now();
  return '${d.day} ${_monthFull[d.month - 1]} ${d.year}';
}

const _monthFull = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
